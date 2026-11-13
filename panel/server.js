/**
 * Sofi panel — one file, two modes (PANEL_MODE in panel/.env):
 *   panel  web UI + PIN login, controls this box's bots, forwards the other box to its agent
 *   agent  same JSON API, no UI, X-Agent-Key secret, served over TLS
 * Only processes listed in accounts.json can be touched — never other pm2 apps.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

const lib = require('./lib');
const overrides = require('../src/overrides');

const ROOT = path.join(__dirname, '..');
const ACCOUNTS = path.join(ROOT, 'accounts.json');
const env = process.env;
const MODE = env.PANEL_MODE === 'agent' ? 'agent' : 'panel';
const BOX = env.BOX_NAME || (MODE === 'agent' ? 'root' : 'botuser');
const AGENT_BOX = env.AGENT_NAME || 'root';
const [PM2, ...PM2_PRE] = (env.PM2_BIN || 'pm2').split(' '); // e.g. "node fake-pm2.js" for local tests

// Defaults for the settings form, read without loading the bot's .env into this process.
const DEFAULTS = (() => {
  const saved = { ...process.env };
  const d = require('../config').DEFAULTS;
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  return Object.fromEntries(Object.keys(overrides.SETTINGS).map(k => [k, d[k]]));
})();

// ── helpers ──────────────────────────────────────────────────────────────────
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, box-local like pm2 logs

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };

function pm2(args) {
  // Clean env: never leak panel secrets or our own pm2 identity into pm2/bots.
  const cleanEnv = { PATH: env.PATH, HOME: env.HOME, ...(env.PM2_HOME ? { PM2_HOME: env.PM2_HOME } : {}) };
  return new Promise((resolve, reject) => {
    execFile(PM2, [...PM2_PRE, ...args], { cwd: ROOT, env: cleanEnv, timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => err ? reject(new HttpError(500, `pm2 ${args[0]} failed: ${(stderr || err.message).slice(0, 300)}`)) : resolve(stdout));
  });
}

async function pm2List() {
  const out = await pm2(['jlist']);
  return JSON.parse(out.slice(out.indexOf('[')));
}

const accounts = () => (fs.existsSync(ACCOUNTS) ? lib.readAccounts(ACCOUNTS) : []);
function account(name) {
  const a = accounts().find(x => x.name === name);
  if (!a) bad(`unknown account ${name}`);
  return a;
}
const logFile = (a) => path.join(ROOT, 'logs', `${a.instance}-out.log`);

async function restart(name) {
  await pm2(['startOrRestart', 'ecosystem.config.js', '--only', name, '--update-env']);
  await pm2(['save']);
}

// ── local operations (this box) ──────────────────────────────────────────────
const local = {
  async state() {
    const procs = Object.fromEntries((await pm2List()).map(p => [p.name, p]));
    const ov = overrides.load();
    return {
      box: BOX,
      global: ov.global,
      accounts: accounts().map(a => {
        const p = procs[a.name];
        const pe = p ? p.pm2_env : null;
        return {
          name: a.name,
          instance: a.instance,
          token: lib.mask(a.token),
          userId: lib.tokenUserId(a.token),
          status: pe ? pe.status : 'not in pm2',
          restarts: pe ? pe.restart_time : 0,
          uptimeMs: pe && pe.status === 'online' ? Date.now() - pe.pm_uptime : 0,
          memory: p && p.monit ? p.monit.memory : 0,
          overrides: ov.accounts[a.instance] || {},
          ...lib.parseStatus(lib.tail(logFile(a)), today()),
        };
      }),
    };
  },

  async logs({ name }) {
    const a = account(name);
    const text = lib.tail(logFile(a), 64 * 1024).replace(/\x1b\[[0-9;]*m/g, '');
    return { lines: text.split('\n').filter(Boolean).slice(-50).map(l => l.replace(/^\S+ \S+: /, '')) };
  },

  async action({ name, action }) {
    account(name);
    if (action === 'stop') { await pm2(['stop', name]); await pm2(['save']); }
    else if (action === 'start' || action === 'restart') await restart(name);
    else bad('action must be start, stop or restart');
    return { ok: true };
  },

  async token({ name, token }) {
    token = String(token || '').trim();
    const all = accounts();
    const a = all.find(x => x.name === name) || bad(`unknown account ${name}`);
    const id = lib.tokenUserId(token);
    if (!id) bad('that does not look like a Discord user token');
    const oldId = lib.tokenUserId(a.token);
    if (oldId && id !== oldId) bad(`token belongs to user ${id}, but ${name} is user ${oldId} — use Add account for a different account`);
    a.token = token;
    lib.writeAccounts(ACCOUNTS, all);
    await restart(name);
    return { ok: true };
  },

  async settings({ scope, values }) {
    const errs = overrides.validate(values);
    if (errs.length) bad(errs.join('; '));
    const ov = overrides.load();
    if (scope === 'global') ov.global = values;
    else if (accounts().some(a => a.instance === scope)) {
      if (Object.keys(values).length) ov.accounts[scope] = values; else delete ov.accounts[scope];
    } else bad(`unknown scope ${scope}`);
    lib.writeJsonAtomic(overrides.FILE, ov);
    return { ok: true };
  },

  async account({ name, instance, token }) {
    token = String(token || '').trim();
    if (!/^[\w-]{1,40}$/.test(name || '')) bad('name: letters, digits, - or _ only');
    if (!/^acc\d{1,3}$/.test(instance || '')) bad('instance must look like acc6');
    const id = lib.tokenUserId(token) || bad('that does not look like a Discord user token');
    const all = accounts();
    if (all.some(a => a.instance === instance)) bad(`${instance} is already used`);
    if (all.some(a => lib.tokenUserId(a.token) === id)) bad('that Discord account is already set up');
    if ((await pm2List()).some(p => p.name === name)) bad(`a pm2 process called ${name} already exists`);
    all.push({ name, instance, token, channels: '' });
    lib.writeAccounts(ACCOUNTS, all);
    await restart(name);
    return { ok: true };
  },
};

// ── agent client (panel mode) ────────────────────────────────────────────────
function agentCall(method, route, body) {
  if (!env.AGENT_URL) return Promise.reject(new HttpError(503, 'no agent configured'));
  const url = new URL(route, env.AGENT_URL);
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      ca: env.AGENT_CA ? fs.readFileSync(env.AGENT_CA) : undefined,
      timeout: 40000,
      headers: { 'x-agent-key': env.AGENT_KEY || '', 'content-type': 'application/json' },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(buf); } catch { return reject(new HttpError(502, 'bad agent reply')); }
        res.statusCode < 400 ? resolve(json) : reject(new HttpError(res.statusCode, json.error || 'agent error'));
      });
    });
    req.on('timeout', () => req.destroy(new Error('agent timeout')));
    req.on('error', (e) => reject(e instanceof HttpError ? e : new HttpError(502, `${AGENT_BOX} unreachable: ${e.message}`)));
    if (data) req.write(data);
    req.end();
  });
}

/** Run an op on the named box: here, or via the agent. */
function onBox(box, op, args) {
  if (box === BOX || MODE === 'agent') return local[op](args);
  if (box === AGENT_BOX) return op === 'state' || op === 'logs'
    ? agentCall('GET', `/api/${op}?${new URLSearchParams(args)}`)
    : agentCall('POST', `/api/${op}`, args);
  bad(`unknown box ${box}`);
}

// ── auth (panel mode) ────────────────────────────────────────────────────────
const sessions = new Map(); // sid -> expiry
const fails = new Map();    // ip  -> { n, until }
const SESSION_MS = 7 * 24 * 3600 * 1000;

const clientIp = (req) => req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
function sessionOk(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sofi_sid=([a-f0-9]{64})/);
  const exp = m && sessions.get(m[1]);
  return !!exp && exp > Date.now();
}
// The per-IP limit trusts CF-Connecting-IP, which a direct-to-origin caller could fake,
// so there is also a global cap: 20 wrong PINs in 15 min locks every login for 15 min.
const globalFails = { n: 0, since: 0, until: 0 };
function login(req, res, pin) {
  const ip = clientIp(req);
  const f = fails.get(ip) || { n: 0, until: 0 };
  const now = Date.now();
  if (f.until > now || globalFails.until > now) throw new HttpError(429, 'too many tries — wait 15 minutes');
  if (!env.PANEL_PIN || !safeEqual(String(pin || ''), env.PANEL_PIN)) {
    if (now - globalFails.since > 15 * 60 * 1000) { globalFails.n = 0; globalFails.since = now; }
    if (++globalFails.n >= 20) globalFails.until = now + 15 * 60 * 1000;
    f.n += 1;
    if (f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60 * 1000; }
    fails.set(ip, f);
    throw new HttpError(401, 'wrong PIN');
  }
  fails.delete(ip);
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, Date.now() + SESSION_MS);
  res.setHeader('set-cookie', `sofi_sid=${sid}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
  return { ok: true };
}

// ── http ─────────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 65536) { reject(new HttpError(413, 'too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new HttpError(400, 'bad JSON')); } });
  });
}

const STATIC = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'] };

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (MODE === 'panel' && req.method === 'GET' && STATIC[p]) {
    const [file, type] = STATIC[p];
    res.writeHead(200, {
      'content-type': `${type}; charset=utf-8`,
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    return res.end(fs.readFileSync(path.join(__dirname, file)));
  }
  if (!p.startsWith('/api/')) throw new HttpError(404, 'not found');
  if (req.method === 'POST' && !(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'json only');

  const body = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
  const op = p.slice(5);

  if (MODE === 'agent') {
    if (!env.AGENT_KEY || !safeEqual(req.headers['x-agent-key'] || '', env.AGENT_KEY)) throw new HttpError(401, 'bad agent key');
    if (!local[op]) throw new HttpError(404, 'not found');
    return local[op](body);
  }

  if (op === 'login' && req.method === 'POST') return login(req, res, body.pin);
  if (!sessionOk(req)) throw new HttpError(401, 'login required');
  if (op === 'logout') {
    const m = (req.headers.cookie || '').match(/sofi_sid=([a-f0-9]{64})/);
    if (m) sessions.delete(m[1]);
    return { ok: true };
  }
  if (op === 'state') {
    const boxes = await Promise.all([BOX, ...(env.AGENT_URL ? [AGENT_BOX] : [])].map(b =>
      onBox(b, 'state', {}).catch(e => ({ box: b, error: e.message, accounts: [] }))));
    return { boxes, settings: overrides.SETTINGS, defaults: DEFAULTS };
  }
  if (op === 'settings' && body.scope === 'global') {
    // Shared settings go to every box; report a box that missed it instead of hiding it.
    const errs = overrides.validate(body.values);
    if (errs.length) bad(errs.join('; '));
    const res2 = await Promise.allSettled([BOX, ...(env.AGENT_URL ? [AGENT_BOX] : [])].map(b => onBox(b, 'settings', body)));
    const failed = res2.map((r, i) => r.status === 'rejected' ? `${i ? AGENT_BOX : BOX}: ${r.reason.message}` : null).filter(Boolean);
    if (failed.length) throw new HttpError(502, `not saved on ${failed.join('; ')}`);
    return { ok: true };
  }
  if (!local[op]) throw new HttpError(404, 'not found');
  if ((req.method === 'GET') !== (op === 'logs')) throw new HttpError(405, 'wrong method');
  const { box, ...args } = body;
  return onBox(box || BOX, op, args);
}

function handler(req, res) {
  route(req, res)
    .then((out) => { if (!res.headersSent) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(out)); } })
    .catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
}

const port = Number(env.PANEL_PORT || (MODE === 'agent' ? 8131 : 8130));
const host = env.PANEL_HOST || (MODE === 'agent' ? '0.0.0.0' : '127.0.0.1');
const server = MODE === 'agent'
  ? https.createServer({ key: fs.readFileSync(env.TLS_KEY), cert: fs.readFileSync(env.TLS_CERT) }, handler)
  : http.createServer(handler);
server.listen(port, host, () => console.log(`sofi ${MODE} (${BOX}) on ${host}:${port}`));

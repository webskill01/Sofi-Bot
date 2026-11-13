const fs = require('fs');

/** Discord user id embedded in the first part of a user token, or null. */
function tokenUserId(token) {
  if (typeof token !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  const id = Buffer.from(token.split('.')[0], 'base64').toString('utf8');
  return /^\d{15,21}$/.test(id) ? id : null;
}

const mask = (token) => (token ? `${token.split('.')[0]}.•••` : '');

function readAccounts(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Atomic write (tmp + rename), owner-only permissions: the file holds tokens. */
function writeAccounts(file, accounts) {
  writeJsonAtomic(file, accounts, 0o600);
}

function writeJsonAtomic(file, data, mode = 0o644) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
  fs.renameSync(tmp, file);
}

/** Last `bytes` of a file as text ('' if missing). */
function tail(file, bytes = 1024 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const AUTH_ERR = /401: Unauthorized|TOKEN INVALID|invalid token was provided|TOKEN_INVALID/;

/**
 * Status from a bot's out-log text. `today` is YYYY-MM-DD in the box's local time,
 * which is what pm2 stamps the log lines with.
 * deadToken: an auth error since the last start, with no claim after it.
 * lastError: only an error not yet followed by a claim or a restart.
 */
function parseStatus(text, today) {
  const lines = stripAnsi(text).split('\n').filter(Boolean);
  const s = { user: null, claimsToday: 0, lastClaim: null, lastError: null, deadToken: false };
  let sinceStart = [];
  for (const line of lines) {
    const user = line.match(/\] \[([^\]]+)\] /);
    if (user) s.user = user[1];
    if (line.includes('Starting Sofi Auto-Claim Bot')) { sinceStart = []; s.lastError = null; }
    sinceStart.push(line);
    if (line.includes('CLAIM →')) {
      if (line.startsWith(today)) s.claimsToday++;
      s.lastError = null; // a claim after an error means it recovered
      const card = line.match(/CLAIM → "([^"]*)"/);
      s.lastClaim = `${line.slice(0, 19)} ${card ? card[1] : ''}`.trim();
    }
    if (/\[error\]/.test(line) || line.includes('Failed to send')) {
      s.lastError = line.replace(/^\S+ \S+: /, '').slice(0, 200);
    }
  }
  const lastAuth = sinceStart.findLastIndex(l => AUTH_ERR.test(l));
  const lastClaim = sinceStart.findLastIndex(l => l.includes('CLAIM →'));
  s.deadToken = lastAuth !== -1 && lastAuth > lastClaim;
  return s;
}

module.exports = { tokenUserId, mask, readAccounts, writeAccounts, writeJsonAtomic, tail, parseStatus };

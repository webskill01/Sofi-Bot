// Sofi panel UI. All text goes through textContent — log lines and names are untrusted.
const app = document.getElementById('app');
let data = null;
let refreshTimer = null;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = err ? 'err' : '';
  t.style.display = 'block';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.style.display = 'none'; }, err ? 7000 : 3000);
}

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  const json = await res.json().catch(() => ({ error: 'bad reply' }));
  if (res.status === 401 && json.error === 'login required') { showLogin(); throw new Error(json.error); }
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

/** Run a button's action with a busy state and a toast. */
async function act(btn, fn, okMsg) {
  btn.disabled = true;
  try { await fn(); if (okMsg) toast(okMsg); await load(); }
  catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
}

// ── login ────────────────────────────────────────────────────────────────────
function showLogin() {
  clearInterval(refreshTimer);
  const pin = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'PIN', autocomplete: 'current-password' });
  const go = h('button', { class: 'primary', type: 'submit' }, 'Log in');
  const form = h('form', { class: 'card', id: 'login', onsubmit: (e) => {
    e.preventDefault();
    act(go, async () => { await api('/api/login', { pin: pin.value }); startRefresh(); });
  } }, h('h1', {}, 'Sofi Panel'), pin, h('div', { class: 'row actions' }, go));
  app.replaceChildren(form);
  pin.focus();
}

// ── formatting ───────────────────────────────────────────────────────────────
function fmtUptime(ms) {
  if (!ms) return '—';
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor(m / 60) % 24}h`;
}

function statusBadge(a) {
  if (a.status === 'online' && a.deadToken) return h('span', { class: 'badge bad' }, 'DEAD TOKEN');
  if (a.status === 'online') return h('span', { class: 'badge ok' }, 'online');
  if (a.deadToken) return h('span', { class: 'badge bad' }, `${a.status} · dead token`);
  return h('span', { class: a.status === 'stopped' ? 'badge warn' : 'badge bad' }, a.status);
}

// ── settings form ────────────────────────────────────────────────────────────
// values: current override object. inherited: what a blank field falls back to.
function settingsForm(values, inherited, onSave, saveLabel) {
  const inputs = {};
  const fields = Object.entries(data.settings).map(([key, type]) => {
    const has = key in values;
    let input;
    if (type === 'boolean') {
      input = h('select', {},
        h('option', { value: '' }, `inherit (${inherited[key] ? 'on' : 'off'})`),
        h('option', { value: 'true', selected: has && values[key] === true }, 'on'),
        h('option', { value: 'false', selected: has && values[key] === false }, 'off'));
    } else {
      input = h('input', { type: 'number', min: '0', step: 'any', placeholder: `inherit (${inherited[key]})`, value: has ? values[key] : undefined });
    }
    inputs[key] = { input, type };
    return h('label', {}, key, input);
  });
  const btn = h('button', { class: 'primary', onclick: () => {
    const out = {};
    for (const [key, { input, type }] of Object.entries(inputs)) {
      if (input.value === '') continue;
      out[key] = type === 'boolean' ? input.value === 'true' : Number(input.value);
    }
    act(btn, () => onSave(out), 'Saved — bots pick it up within 30s');
  } }, saveLabel);
  return h('div', {}, h('div', { class: 'settings' }, fields), h('div', { class: 'row actions' }, btn));
}

// ── account card ─────────────────────────────────────────────────────────────
function accountCard(box, a, globalValues) {
  const key = `${box}/${a.name}`;
  const call = (path, body) => api(path, { box, name: a.name, ...body });

  const tokenInput = h('input', { type: 'password', placeholder: 'paste new token', autocomplete: 'off' });
  const tokenBtn = h('button', { class: 'primary', onclick: () => act(tokenBtn, async () => {
    await call('/api/token', { token: tokenInput.value });
    tokenInput.value = '';
  }, `${a.name}: token saved, restarting`) }, 'Save + restart');

  const logBox = h('pre', {}, 'loading…');
  const logs = h('details', { 'data-k': `${key}/logs`, ontoggle: (e) => { if (e.target.open) loadLogs(); } },
    h('summary', {}, 'Logs (last 50 lines)'), logBox);
  async function loadLogs() {
    try {
      const r = await api(`/api/logs?${new URLSearchParams({ box, name: a.name })}`);
      logBox.textContent = r.lines.join('\n') || '(empty)';
      logBox.scrollTop = logBox.scrollHeight;
    } catch (e) { logBox.textContent = e.message; }
  }

  const btn = (label, action, cls) => {
    const b = h('button', { class: cls, onclick: () => act(b, () => call('/api/action', { action }), `${a.name}: ${action} sent`) }, label);
    return b;
  };
  const running = a.status === 'online';
  const inherited = { ...data.defaults, ...globalValues };
  const overrideCount = Object.keys(a.overrides).length;

  return h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('div', {}, h('div', { class: 'name' }, a.user || a.name), h('div', { class: 'dim small' }, `${a.name} · ${a.instance} · ${a.token}`)),
      statusBadge(a)),
    h('dl', {},
      h('dt', {}, 'Claims today'), h('dd', {}, String(a.claimsToday)),
      h('dt', {}, 'Last claim'), h('dd', {}, a.lastClaim || '—'),
      h('dt', {}, 'Uptime'), h('dd', {}, `${fmtUptime(a.uptimeMs)} · ${a.restarts} restarts · ${Math.round(a.memory / 1048576)} MB`),
      a.lastError ? [h('dt', {}, 'Last error'), h('dd', { class: 'small warn' }, a.lastError)] : null),
    h('div', { class: 'row actions' },
      running ? btn('Restart', 'restart') : btn('Start', 'start', 'primary'),
      running ? btn('Stop', 'stop', 'danger') : null),
    h('details', { 'data-k': `${key}/token` }, h('summary', {}, 'Change token'),
      h('div', { class: 'row actions' }, tokenInput, tokenBtn),
      h('div', { class: 'dim small' }, 'Must be the same Discord account. Copy it without logging out afterwards.')),
    h('details', { 'data-k': `${key}/settings` }, h('summary', {}, `Account settings${overrideCount ? ` (${overrideCount} override${overrideCount > 1 ? 's' : ''})` : ''}`),
      settingsForm(a.overrides, inherited, (values) => api('/api/settings', { box, scope: a.instance, values }), 'Save for this account')),
    logs);
}

function addAccountForm(box, accounts) {
  const used = new Set(accounts.map(a => a.instance));
  let n = 1; while (used.has(`acc${n}`)) n++;
  const name = h('input', { placeholder: 'pm2 name', value: `sofi-bot${n}` });
  const instance = h('input', { placeholder: 'instance', value: `acc${n}` });
  const token = h('input', { type: 'password', placeholder: 'token', autocomplete: 'off' });
  const go = h('button', { class: 'primary', onclick: () => act(go, () =>
    api('/api/account', { box, name: name.value.trim(), instance: instance.value.trim(), token: token.value }), 'Account added and started') }, 'Add + start');
  return h('details', { class: 'card', 'data-k': `add/${box}` }, h('summary', {}, `Add account on ${box}`),
    h('div', { class: 'settings' }, h('label', {}, 'pm2 name', name), h('label', {}, 'instance', instance), h('label', {}, 'token', token)),
    h('div', { class: 'row actions' }, go));
}

// ── page ─────────────────────────────────────────────────────────────────────
function render() {
  // Re-rendering rebuilds the DOM; keep whatever sections were open.
  const open = new Set([...app.querySelectorAll('details[open][data-k]')].map(d => d.dataset.k));
  const main = data.boxes[0];
  const global = main.global || {};
  const eventOn = 'EVENT_MODE' in global ? global.EVENT_MODE : data.defaults.EVENT_MODE;
  const mismatch = data.boxes.some(b => !b.error && JSON.stringify(b.global || {}) !== JSON.stringify(global));

  const sw = h('button', { class: `switch${eventOn ? ' on' : ''}`, 'aria-label': 'Event mode', onclick: () =>
    act(sw, () => api('/api/settings', { scope: 'global', values: { ...global, EVENT_MODE: !eventOn } }), `Event mode ${eventOn ? 'OFF' : 'ON'} on all bots`) });

  const all = data.boxes.flatMap(b => b.accounts);
  const working = all.filter(a => a.status === 'online' && !a.deadToken).length;

  app.replaceChildren(
    h('h1', {}, 'Sofi Panel', h('span', { class: 'spacer' }),
      h('span', { class: 'dim small' }, `${working}/${all.length} working`),
      h('button', { onclick: (e) => act(e.target, async () => {}, null) }, 'Refresh'),
      h('button', { onclick: async () => { await api('/api/logout', {}).catch(() => {}); showLogin(); } }, 'Log out')),
    h('div', { class: 'card' },
      h('div', { class: 'event' }, sw, h('div', {}, h('div', { class: 'name' }, `Event mode ${eventOn ? 'ON' : 'OFF'}`),
        h('div', { class: 'dim small' }, 'All bots, both servers. Claim rules change within 30s; sleep/AFK schedule from the next day (restart a bot to apply now).'))),
      mismatch ? h('div', { class: 'small warn actions' }, 'Servers have different global settings — save again to sync.') : null,
      h('details', { 'data-k': 'global' }, h('summary', {}, 'All global settings'),
        settingsForm(global, data.defaults, (values) => api('/api/settings', { scope: 'global', values }), 'Save for all bots'))),
    ...data.boxes.flatMap(b => [
      h('h2', {}, `${b.box} VPS`),
      b.error ? h('div', { class: 'card boxerr' }, b.error) : h('div', { class: 'grid' }, b.accounts.map(a => accountCard(b.box, a, global))),
      b.error ? null : addAccountForm(b.box, b.accounts),
    ].filter(Boolean)));
  for (const d of app.querySelectorAll('details[data-k]')) if (open.has(d.dataset.k)) d.open = true;
}

async function load(auto = false) {
  // Don't wipe a half-typed token or settings edit on auto-refresh.
  if (auto && document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
  data = await api('/api/state');
  render();
}

function startRefresh() {
  load().catch(e => toast(e.message, true));
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => load(true).catch(() => {}), 20000);
}

startRefresh();

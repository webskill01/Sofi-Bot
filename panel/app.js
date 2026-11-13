// Sofi panel UI. All text goes through textContent — log lines and names are untrusted.
const app = document.getElementById('app');
const sheet = document.getElementById('sheet');
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

// Lucide-style stroke icons (paths only; static strings, never user data).
const ICONS = {
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  play: 'M6 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  restart: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  key: 'M15.5 7.5l3 3M21 2l-9.6 9.6M15.5 7.5L19 4M7.5 21a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  logs: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
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

// ── sheet (bottom sheet on phones, dialog on desktop) ───────────────────────
function openSheet(title, sub, body, foot) {
  sheet.replaceChildren(
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('div', { class: 'title' }, title, sub ? h('div', { class: 'sub' }, sub) : null),
      h('button', { class: 'ghost icon', 'aria-label': 'Close', onclick: () => sheet.close() }, icon('x'))),
    h('div', { class: 'sheet-body' }, body),
    foot ? h('div', { class: 'sheet-foot' }, foot) : null);
  sheet.showModal();
}
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); }); // backdrop tap

// ── login ────────────────────────────────────────────────────────────────────
function showLogin() {
  clearInterval(refreshTimer);
  if (sheet.open) sheet.close();
  const pin = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'Enter PIN', autocomplete: 'current-password', 'aria-label': 'PIN' });
  const go = h('button', { class: 'primary', type: 'submit' }, 'Log in');
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'login-box' },
    h('div', { class: 'logo' }, 'S'),
    h('h1', {}, 'Sofi Panel'),
    h('div', { class: 'sub' }, 'Bots on botuser + root VPS'),
    h('form', { class: 'card', onsubmit: (e) => {
      e.preventDefault();
      act(go, async () => { await api('/api/login', { pin: pin.value }); startRefresh(); });
    } }, h('label', { class: 'field' }, h('span', { class: 'label' }, 'PIN'), pin), go),
    h('div', { class: 'foot' }, 'Private panel · internal use only'))));
  pin.focus();
}

// ── formatting ───────────────────────────────────────────────────────────────
function fmtUptime(ms) {
  if (!ms) return '—';
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor(m / 60) % 24}h`;
}

function statusPill(a) {
  if (a.deadToken) return h('span', { class: 'pill bad' }, a.status === 'online' ? 'Dead token' : 'Stopped · token');
  if (a.status === 'online') return h('span', { class: 'pill ok' }, 'Online');
  return h('span', { class: a.status === 'stopped' ? 'pill warn' : 'pill bad' }, a.status[0].toUpperCase() + a.status.slice(1));
}

const label = (key) => key.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/\bms\b/, '(ms)').replace(/\bist\b/, 'IST').replace(/\bwl\b/g, 'WL');

// ── settings form ────────────────────────────────────────────────────────────
// values: current override object. inherited: what a blank field falls back to.
function settingsSheet(title, sub, values, inherited, onSave) {
  const inputs = {};
  const field = ([key, type]) => {
    const has = key in values;
    const input = type === 'boolean'
      ? h('select', {},
        h('option', { value: '' }, `Inherit (${inherited[key] ? 'on' : 'off'})`),
        h('option', { value: 'true', selected: has && values[key] === true }, 'On'),
        h('option', { value: 'false', selected: has && values[key] === false }, 'Off'))
      : h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: `Inherit (${inherited[key]})`, value: has ? values[key] : undefined });
    inputs[key] = { input, type };
    return h('label', { class: 'field' }, h('span', { class: 'label' }, label(key)), input, h('span', { class: 'hint' }, key));
  };
  const entries = Object.entries(data.settings);
  const save = h('button', { class: 'primary', onclick: () => {
    const out = {};
    for (const [key, { input, type }] of Object.entries(inputs)) {
      if (input.value === '') continue;
      out[key] = type === 'boolean' ? input.value === 'true' : Number(input.value);
    }
    act(save, async () => { await onSave(out); sheet.close(); }, 'Saved — bots pick it up within 30s');
  } }, 'Save');
  openSheet(title, sub, [
    h('div', { class: 'group' }, 'Switches'),
    h('div', { class: 'fields two' }, entries.filter(e => e[1] === 'boolean').map(field)),
    h('div', { class: 'group' }, 'Numbers'),
    h('div', { class: 'fields two' }, entries.filter(e => e[1] !== 'boolean').map(field)),
    h('p', { class: 'note' }, 'Leave a field blank to inherit.'),
  ], [h('button', { onclick: () => sheet.close() }, 'Cancel'), save]);
}

// ── account card ─────────────────────────────────────────────────────────────
function tokenSheet(box, a) {
  const input = h('input', { type: 'password', placeholder: 'Paste new token', autocomplete: 'off', 'aria-label': 'Token' });
  const save = h('button', { class: 'primary', onclick: () => act(save, async () => {
    await api('/api/token', { box, name: a.name, token: input.value });
    sheet.close();
  }, `${a.name}: token saved, restarting`) }, 'Save + restart');
  openSheet('Change token', `${a.user || a.name} · ${box}`, [
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'New token'), input),
    h('p', { class: 'note' }, 'Must be the same Discord account. Copy it, then close the tab — logging out kills the token.'),
  ], [h('button', { onclick: () => sheet.close() }, 'Cancel'), save]);
  input.focus();
}

function logsSheet(box, a) {
  const pre = h('pre', {}, 'Loading…');
  const reload = async () => {
    try {
      const r = await api(`/api/logs?${new URLSearchParams({ box, name: a.name })}`);
      pre.textContent = r.lines.join('\n') || '(empty)';
      pre.parentElement.scrollTop = pre.parentElement.scrollHeight;
    } catch (e) { pre.textContent = e.message; }
  };
  openSheet('Logs', `${a.user || a.name} · last 50 lines`, pre,
    [h('button', { onclick: (e) => act(e.currentTarget, reload) }, icon('refresh'), 'Reload')]);
  reload();
}

function accountCard(box, a, globalValues) {
  const call = (action) => api('/api/action', { box, name: a.name, action });
  const btn = (text, action, cls, ic) => {
    const b = h('button', { class: cls, onclick: () => act(b, () => call(action), `${a.name}: ${action} sent`) }, icon(ic), text);
    return b;
  };
  const running = a.status === 'online';
  const overrides = Object.keys(a.overrides).length;
  const who = a.user || a.name;

  return h('div', { class: 'card acc' },
    h('div', { class: 'acc-head' },
      h('div', { class: 'avatar' }, who.replace(/^[^a-z0-9]+/i, '')[0]?.toUpperCase() || '?'),
      h('div', { class: 'who' }, h('div', { class: 'name' }, who), h('div', { class: 'sub' }, `${a.name} · ${a.instance} · ${a.token}`)),
      statusPill(a)),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Claims today'), h('div', { class: 'value' }, String(a.claimsToday))),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Last claim'), h('div', { class: 'value', title: a.lastClaim || '' }, a.lastClaim ? a.lastClaim.replace(/^\d{4}-\d\d-\d\d /, '') : '—')),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Uptime'), h('div', { class: 'value', title: `${a.restarts} restarts · ${Math.round(a.memory / 1048576)} MB` }, fmtUptime(a.uptimeMs)))),
    a.lastError ? h('div', { class: 'errline' }, a.lastError) : null,
    h('div', { class: 'actions' },
      running ? btn('Restart', 'restart', 'grow', 'restart') : btn('Start', 'start', 'primary grow', 'play'),
      running ? btn('Stop', 'stop', 'danger grow', 'stop') : null),
    h('div', { class: 'tools' },
      h('button', { class: 'ghost sm', onclick: () => tokenSheet(box, a) }, icon('key'), 'Token'),
      h('button', { class: 'ghost sm', onclick: () => settingsSheet('Account settings', `${who} · overrides global`,
        a.overrides, { ...data.defaults, ...globalValues }, (values) => api('/api/settings', { box, scope: a.instance, values })) },
      icon('sliders'), overrides ? `Settings (${overrides})` : 'Settings'),
      h('button', { class: 'ghost sm', onclick: () => logsSheet(box, a) }, icon('logs'), 'Logs')));
}

function addAccountSheet(box, accounts) {
  const used = new Set(accounts.map(a => a.instance));
  let n = 1; while (used.has(`acc${n}`)) n++;
  const name = h('input', { value: `sofi-bot${n}`, autocomplete: 'off' });
  const instance = h('input', { value: `acc${n}`, autocomplete: 'off' });
  const token = h('input', { type: 'password', placeholder: 'Discord token', autocomplete: 'off' });
  const f = (text, input) => h('label', { class: 'field' }, h('span', { class: 'label' }, text), input);
  const go = h('button', { class: 'primary', onclick: () => act(go, async () => {
    await api('/api/account', { box, name: name.value.trim(), instance: instance.value.trim(), token: token.value });
    sheet.close();
  }, 'Account added and started') }, 'Add + start');
  openSheet('Add account', `${box} VPS`, h('div', { class: 'fields' },
    h('div', { class: 'fields two' }, f('pm2 name', name), f('Instance', instance)), f('Token', token)),
  [h('button', { onclick: () => sheet.close() }, 'Cancel'), go]);
  token.focus();
}

// ── page ─────────────────────────────────────────────────────────────────────
function render() {
  const main = data.boxes[0];
  const global = main.global || {};
  const eventOn = 'EVENT_MODE' in global ? global.EVENT_MODE : data.defaults.EVENT_MODE;
  const mismatch = data.boxes.some(b => !b.error && JSON.stringify(b.global || {}) !== JSON.stringify(global));
  const all = data.boxes.flatMap(b => b.accounts);
  const working = all.filter(a => a.status === 'online' && !a.deadToken).length;
  const claims = all.reduce((s, a) => s + (a.claimsToday || 0), 0);

  const sw = h('button', { class: `switch${eventOn ? ' on' : ''}`, role: 'switch', 'aria-checked': String(eventOn), 'aria-label': 'Event mode', onclick: () =>
    act(sw, () => api('/api/settings', { scope: 'global', values: { ...global, EVENT_MODE: !eventOn } }), `Event mode ${eventOn ? 'OFF' : 'ON'} on all bots`) });

  app.replaceChildren(
    h('header', {}, h('div', { class: 'bar' },
      h('div', { class: 'logo' }, 'S'), h('div', { class: 'title' }, 'Sofi Panel'), h('span', { class: 'spacer' }),
      h('button', { class: 'ghost', 'aria-label': 'Global settings', onclick: () =>
        settingsSheet('Global settings', 'All bots, both servers', global, data.defaults, (values) => api('/api/settings', { scope: 'global', values })) },
      icon('sliders'), h('span', { class: 'hide-sm' }, 'Settings')),
      h('button', { class: 'ghost icon', 'aria-label': 'Refresh', onclick: (e) => act(e.currentTarget, async () => {}) }, icon('refresh')),
      h('button', { class: 'ghost icon', 'aria-label': 'Log out', onclick: async () => { await api('/api/logout', {}).catch(() => {}); showLogin(); } }, icon('logout')))),
    h('main', {},
      h('div', { class: 'kpis' },
        h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Working'), h('div', { class: 'value' }, String(working), h('small', {}, ` / ${all.length}`))),
        h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Claims today'), h('div', { class: 'value' }, String(claims))),
        h('div', { class: 'card event' },
          h('div', { class: 'text' }, h('div', { class: 'name' }, `Event mode ${eventOn ? 'on' : 'off'}`),
            h('div', { class: 'sub', style: 'white-space:normal' }, 'Claim rules change within 30s; sleep schedule from tomorrow (restart to apply now).'),
            mismatch ? h('div', { class: 'warnline' }, 'Servers have different global settings — save once to sync.') : null),
          sw)),
      ...data.boxes.flatMap(b => [
        h('h2', {}, `${b.box} VPS`, b.error ? null : h('span', { class: 'count' }, `${b.accounts.length} account${b.accounts.length === 1 ? '' : 's'}`),
          b.error ? null : h('button', { class: 'sm', onclick: () => addAccountSheet(b.box, b.accounts) }, icon('plus'), 'Add')),
        b.error ? h('div', { class: 'card boxerr' }, b.error) : h('div', { class: 'grid' }, b.accounts.map(a => accountCard(b.box, a, global))),
      ])));
}

async function load(auto = false) {
  // Don't rebuild under an open sheet or a half-typed input.
  if (auto && (sheet.open || ['INPUT', 'SELECT'].includes(document.activeElement?.tagName))) return;
  data = await api('/api/state');
  render();
}

function startRefresh() {
  load().catch(e => { if (e.message !== 'login required') toast(e.message, true); });
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => load(true).catch(() => {}), 20000);
}

startRefresh();

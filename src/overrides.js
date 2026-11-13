/**
 * Runtime setting overrides, written by the Sofi panel to overrides.json:
 *   { "global": { KEY: value }, "accounts": { "acc1": { KEY: value } } }
 * Only whitelisted keys are applied, and only when the value matches the type.
 * A key removed from the file falls back to its default from config/index.js.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'overrides.json');

// key -> type. Everything else (TOKEN, CHANNELS, ...) can never be overridden.
const SETTINGS = {
  EVENT_MODE: 'boolean',
  LOTTERY_ENABLED: 'boolean',
  LAZY_DAY_ENABLED: 'boolean',
  DRY_RUN: 'boolean',
  SLEEP_START_HOUR_IST: 'number',
  SLEEP_END_HOUR_IST: 'number',
  EVENT_SLEEP_END_HOUR_IST: 'number',
  GEN_SUPER_ULTRA: 'number',
  GEN_ULTRA_LOW: 'number',
  GEN_ULTRA_WL_MIN: 'number',
  WL_OVERRIDE_THRESHOLD: 'number',
  EVENT_CARD_WL_MIN: 'number',
  EVENT_NORMAL_WL_OVERRIDE: 'number',
  DROP_COOLDOWN_MS: 'number',
};

const validValue = (key, v) =>
  SETTINGS[key] === 'number' ? typeof v === 'number' && Number.isFinite(v) && v >= 0 : typeof v === SETTINGS[key];

/** List of human-readable errors for a { KEY: value } object; [] when valid. */
function validate(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return ['values must be an object'];
  const errs = [];
  for (const [k, v] of Object.entries(values)) {
    if (!(k in SETTINGS)) errs.push(`${k}: not an editable setting`);
    else if (!validValue(k, v)) errs.push(`${k}: must be a ${SETTINGS[k]}`);
  }
  return errs;
}

function load(file = FILE) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { global: d.global || {}, accounts: d.accounts || {} };
  } catch {
    return { global: {}, accounts: {} };
  }
}

/** Reset whitelisted keys to defaults, then layer global and this account's overrides. */
function apply(config, defaults, data, instanceId) {
  const layers = [data.global || {}, (data.accounts || {})[instanceId] || {}];
  for (const key of Object.keys(SETTINGS)) {
    if (!(key in defaults)) continue;
    let value = defaults[key];
    for (const layer of layers) if (key in layer && validValue(key, layer[key])) value = layer[key];
    config[key] = value;
  }
}

/** Re-apply whenever the file's mtime changes. Returns the timer (unref'd). */
function watch(config, defaults, instanceId, onChange, file = FILE, everyMs = 30000) {
  let last = mtime(file);
  const t = setInterval(() => {
    const m = mtime(file);
    if (m === last) return;
    last = m;
    const before = Object.fromEntries(Object.keys(SETTINGS).map(k => [k, config[k]]));
    apply(config, defaults, load(file), instanceId);
    const changed = Object.keys(SETTINGS).filter(k => before[k] !== config[k]).map(k => `${k}=${config[k]}`);
    if (changed.length) onChange(changed);
  }, everyMs);
  t.unref();
  return t;
}

function mtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

module.exports = { SETTINGS, FILE, validate, load, apply, watch };

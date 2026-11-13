const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ov = require('../src/overrides');
const lib = require('../panel/lib');

test('validate accepts whitelisted keys of the right type', () => {
  assert.deepStrictEqual(ov.validate({ EVENT_MODE: false, GEN_ULTRA_LOW: 50 }), []);
});

test('validate rejects unknown keys and wrong types', () => {
  const errs = ov.validate({ TOKEN: 'x', EVENT_MODE: 'yes', GEN_ULTRA_LOW: NaN });
  assert.strictEqual(errs.length, 3);
});

test('apply: global then account override, removed keys fall back to defaults', () => {
  const defaults = { EVENT_MODE: true, LOTTERY_ENABLED: false, GEN_ULTRA_LOW: 100, TOKEN: 't' };
  const config = { ...defaults };
  ov.apply(config, defaults, { global: { EVENT_MODE: false, GEN_ULTRA_LOW: 80 }, accounts: { acc1: { GEN_ULTRA_LOW: 60 } } }, 'acc1');
  assert.strictEqual(config.EVENT_MODE, false);
  assert.strictEqual(config.GEN_ULTRA_LOW, 60);
  ov.apply(config, defaults, { global: {} }, 'acc1');
  assert.strictEqual(config.EVENT_MODE, true);
  assert.strictEqual(config.GEN_ULTRA_LOW, 100);
});

test('apply ignores invalid values and non-whitelisted keys', () => {
  const defaults = { EVENT_MODE: true, TOKEN: 't' };
  const config = { ...defaults };
  ov.apply(config, defaults, { global: { EVENT_MODE: 'no', TOKEN: 'evil' } }, 'acc1');
  assert.strictEqual(config.EVENT_MODE, true);
  assert.strictEqual(config.TOKEN, 't');
});

test('load returns empty overrides for missing or corrupt file', () => {
  const f = path.join(os.tmpdir(), `ov-${process.pid}.json`);
  assert.deepStrictEqual(ov.load(f), { global: {}, accounts: {} });
  fs.writeFileSync(f, '{bad');
  assert.deepStrictEqual(ov.load(f), { global: {}, accounts: {} });
  fs.unlinkSync(f);
});

test('tokenUserId decodes the id part and rejects junk', () => {
  assert.strictEqual(lib.tokenUserId('MTUzMTUzMzQzNjQwNDM2NzU5Mg.Gxxxxx.yyyyyyyy'), '1531533436404367592');
  assert.strictEqual(lib.tokenUserId('NzY4ODk2Mzg2MzY3NDg4MDgy.Gxxxxx.yy-yy_yy'), '768896386367488082');
  assert.strictEqual(lib.tokenUserId('not a token'), null);
  assert.strictEqual(lib.tokenUserId('aGVsbG8.a.b'), null); // decodes to "hello", not digits
});

test('mask keeps only the id part', () => {
  assert.strictEqual(lib.mask('MTUz.abc.def'), 'MTUz.•••');
  assert.strictEqual(lib.mask(''), '');
});

test('parseStatus reads user, claims today, last claim and dead token', () => {
  const E = '\x1b[31merror\x1b[39m', I = '\x1b[32minfo\x1b[39m';
  const log = [
    `2026-11-12 23:00:00: 2026-11-12 23:00:00 [${I}] [duck] CLAIM → "Old" | P3`,
    `2026-11-13 10:00:00: 2026-11-13 10:00:00 [${I}] Starting Sofi Auto-Claim Bot...`,
    `2026-11-13 10:00:05: 2026-11-13 10:00:05 [${I}] [duck] CLAIM → "Nanaba" | P3`,
    `2026-11-13 10:10:05: 2026-11-13 10:10:05 [${I}] [duck] CLAIM → "Lou" | P3`,
  ].join('\n');
  const s = lib.parseStatus(log, '2026-11-13');
  assert.strictEqual(s.user, 'duck');
  assert.strictEqual(s.claimsToday, 2);
  assert.strictEqual(s.lastClaim, '2026-11-13 10:10:05 Lou');
  assert.strictEqual(s.deadToken, false);

  const dead = log + `\n2026-11-13 11:00:00: 2026-11-13 11:00:00 [${E}] [duck] Failed to send sd: 401: Unauthorized`;
  assert.strictEqual(lib.parseStatus(dead, '2026-11-13').deadToken, true);
  assert.match(lib.parseStatus(dead, '2026-11-13').lastError, /401/);

  const recovered = dead + `\n2026-11-13 11:05:00: 2026-11-13 11:05:00 [${I}] Starting Sofi Auto-Claim Bot...`;
  assert.strictEqual(lib.parseStatus(recovered, '2026-11-13').deadToken, false);
  assert.strictEqual(lib.parseStatus(recovered, '2026-11-13').lastError, null);

  const claimedAfter = dead + `\n2026-11-13 11:10:00: 2026-11-13 11:10:00 [${I}] [duck] CLAIM → "Mia" | P3`;
  assert.strictEqual(lib.parseStatus(claimedAfter, '2026-11-13').lastError, null);
});

test('writeAccounts/readAccounts round-trip atomically', () => {
  const f = path.join(os.tmpdir(), `acc-${process.pid}.json`);
  const accts = [{ name: 'sofi-bot', instance: 'acc1', token: 'a.b.c', channels: '' }];
  lib.writeAccounts(f, accts);
  assert.deepStrictEqual(lib.readAccounts(f), accts);
  fs.unlinkSync(f);
});

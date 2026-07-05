const { test } = require('node:test');
const assert = require('node:assert');
const { shouldEnterLottery } = require('../src/lottery');

const cfg = { LOTTERY_MIN_SECONDS_LEFT: 120, LOTTERY_COST: 10 };
const now = 1_000_000_000_000;
const info = (over = {}) => ({ round: 3, entries: 100, endsAt: now + 600_000, cost: 10, ...over });

test('enters a fresh affordable round', () => {
  const d = shouldEnterLottery({ info: info(), lastEnteredRound: 2, coffeeBalance: 50, nowMs: now, cfg });
  assert.strictEqual(d.enter, true);
});
test('skips a round already entered', () => {
  const d = shouldEnterLottery({ info: info(), lastEnteredRound: 3, coffeeBalance: 50, nowMs: now, cfg });
  assert.strictEqual(d.enter, false);
});
test('skips when coffee below cost', () => {
  const d = shouldEnterLottery({ info: info(), lastEnteredRound: 2, coffeeBalance: 5, nowMs: now, cfg });
  assert.strictEqual(d.enter, false);
});
test('skips when round nearly over', () => {
  const d = shouldEnterLottery({ info: info({ endsAt: now + 60_000 }), lastEnteredRound: 2, coffeeBalance: 50, nowMs: now, cfg });
  assert.strictEqual(d.enter, false);
});
test('skips when no info', () => {
  assert.strictEqual(shouldEnterLottery({ info: null, lastEnteredRound: null, coffeeBalance: 99, nowMs: now, cfg }).enter, false);
});

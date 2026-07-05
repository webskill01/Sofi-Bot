const { test } = require('node:test');
const assert = require('node:assert');
const { parseEventItems, parseDropMessage, parseCoffeeGrab, parseLotteryInfo, parseCoffeeBalance, isSevMessage } = require('../src/parser');
const fx = require('./fixtures');

// ── Task 2: free item vs event card discriminator ──────────────────────────
test('free ☕ item (no label) is an event item', () => {
  const items = parseEventItems(fx.mixedCoffee);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].buttonIndex, 1); // the "Coffees" button
});

test('labeled ☕ card (411) is NOT an event item', () => {
  const items = parseEventItems(fx.mixedCoffee);
  assert.ok(!items.some(i => i.buttonIndex === 3), 'event card must not be treated as a free item');
});

test('coffee card-only drop yields zero free items', () => {
  assert.strictEqual(parseEventItems(fx.coffeeCardOnly).length, 0);
});

test('shells free item still detected (regression)', () => {
  const items = parseEventItems(fx.shellsFreeItem);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].buttonIndex, 1);
});

test('normal drop yields zero free items (regression)', () => {
  assert.strictEqual(parseEventItems(fx.normalDrop).length, 0);
});

// ── Task 3: positional card → button mapping ───────────────────────────────
test('mixed coffee drop: cards get WL from their OWN button', () => {
  const cards = parseDropMessage(fx.mixedCoffee);
  assert.strictEqual(cards.length, 3); // free-item line is not a card
  const arataka = cards.find(c => c.name === 'Arataka Reigen');
  assert.strictEqual(arataka.isEventCard, true);
  assert.strictEqual(arataka.wishlist, 411);
  assert.strictEqual(arataka.customId, 'cf_4');
  const homura = cards.find(c => c.name === 'Homura Kurusu');
  assert.strictEqual(homura.wishlist, 1);
  assert.strictEqual(homura.customId, 'dh_1');
});

test('coffee card-only: event card WL 88 from ☕ button', () => {
  const cards = parseDropMessage(fx.coffeeCardOnly);
  const anis = cards.find(c => c.name === 'Anis');
  assert.strictEqual(anis.isEventCard, true);
  assert.strictEqual(anis.wishlist, 88);
  assert.strictEqual(anis.customId, 'cf_2');
});

test('normal drop WLs map correctly (regression)', () => {
  const cards = parseDropMessage(fx.normalDrop);
  assert.deepStrictEqual(cards.map(c => c.wishlist), [3, 7, 1]);
});

test('shells drop: cards skip the free item button (regression)', () => {
  const cards = parseDropMessage(fx.shellsFreeItem);
  assert.strictEqual(cards.length, 2);
  assert.deepStrictEqual(cards.map(c => c.wishlist), [5, 9]);
  assert.deepStrictEqual(cards.map(c => c.customId), ['dh_1', 'dh_3']);
});

// ── Cooldown parsing (Sofi's bare shorthand) ───────────────────────────────
const { parseCooldownMessage } = require('../src/parser');
const cd = (content) => parseCooldownMessage({ author: { id: 'sofi' }, content, embeds: [] }, 'sofi');
const SOFI = '853629533855809596';
const cdSofi = (content) => parseCooldownMessage({ author: { id: SOFI }, content, embeds: [] }, SOFI);

test('bare seconds "12s" parses to exactly 12s (no baked buffer)', () => {
  const r = cd('@Toji Your Drop will be ready in: 12s');
  assert.strictEqual(r.onCooldown, true);
  assert.strictEqual(r.remainingMs, 12000);
});

test('compound "1m 25s" parses to exactly 85s', () => {
  assert.strictEqual(cd('Your Drop will be ready in: 1m 25s').remainingMs, 85000);
});

test('bare minutes "3m" parses to 180s', () => {
  assert.strictEqual(cd('ready in: 3m').remainingMs, 180000);
});

test('word form "30 seconds" still parses', () => {
  assert.strictEqual(cd('please wait 30 seconds').remainingMs, 30000);
});

test('non-cooldown message is not flagged', () => {
  assert.strictEqual(cd('some unrelated text').onCooldown, false);
});

// ── Future-event-proof: new items work by config/emoji alone ───────────────
const { parseEventItems: pei } = require('../src/parser');
const evBtn = (emoji, label) => ({ type: 'BUTTON', style: 'PRIMARY', emoji, label, customId: 'x' });
const drop1 = (btn) => ({ id: 'm', content: '`1.` :x: | Item', author: { id: 'z' }, components: [{ components: [btn] }], embeds: [] });

test('rose unicode item (in config emoji list) detected', () => {
  assert.strictEqual(pei(drop1(evBtn({ name: '🌹', id: null }, undefined))).length, 1);
});
test('candy custom-emoji item (in config names) detected', () => {
  assert.strictEqual(pei(drop1(evBtn({ name: 'candy', id: '999' }, undefined))).length, 1);
});
test('brand-new custom-emoji item (not in config) still auto-detected', () => {
  assert.strictEqual(pei(drop1(evBtn({ name: 'brandnew_thing', id: '777' }, undefined))).length, 1);
});
test('event CARD with event emoji + wishlist is NOT an item', () => {
  assert.strictEqual(pei(drop1(evBtn({ name: '🌹', id: null }, '250'))).length, 0);
});
test('unknown UNICODE emoji with no label is NOT grabbed (avoids false positives)', () => {
  // a bare unicode emoji not in config and no custom id → not an item
  assert.strictEqual(pei(drop1(evBtn({ name: '🎲', id: null }, undefined))).length, 0);
});

// ── Task 4: currency / lottery parsers ─────────────────────────────────────
test('parseCoffeeGrab reads delta from grab reply', () => {
  const m = { content: "<@u>'s caffeine level is raising after drinking ☕ **17 Coffee**", embeds: [] };
  assert.strictEqual(parseCoffeeGrab(m), 17);
  const m2 = { content: '<@u> defeated 44 opponents and claimed ☕ **18 Coffee**', embeds: [] };
  assert.strictEqual(parseCoffeeGrab(m2), 18);
  assert.strictEqual(parseCoffeeGrab({ content: 'no currency here', embeds: [] }), null);
});

test('parseLotteryInfo extracts round, entries, endsAt, cost', () => {
  const info = parseLotteryInfo(fx.sevEmbed);
  assert.strictEqual(info.round, 3);
  assert.strictEqual(info.entries, 108);
  assert.strictEqual(info.endsAt, 1785083650 * 1000);
  assert.strictEqual(info.cost, 10);
});

test('isSevMessage true for sev embed, false for drop', () => {
  assert.strictEqual(isSevMessage(fx.sevEmbed), true);
  assert.strictEqual(isSevMessage(fx.normalDrop), false);
});

test('parseCoffeeBalance reads coffee from si Event embed', () => {
  assert.strictEqual(parseCoffeeBalance(fx.siEventEmbed), 28);
  assert.strictEqual(parseCoffeeBalance(fx.normalDrop), null);
});

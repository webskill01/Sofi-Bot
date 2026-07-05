const { test } = require('node:test');
const assert = require('node:assert');
const { selectCard } = require('../src/claimDecision');

const card = (name, gen, wishlist, isEventCard = false) => ({ name, gen, wishlist, isEventCard, buttonIndex: 0, customId: name });

test('equal wishlist → picks lower gen', () => {
  const d = selectCard([card('A', 800, 300), card('B', 200, 300), card('C', 900, 300)]);
  assert.strictEqual(d.card.name, 'B'); // same WL, lowest gen
});

test('all WL 0 → picks lowest gen (not random)', () => {
  const d = selectCard([card('A', 900, 0), card('B', 120, 0), card('C', 700, 0)]);
  assert.strictEqual(d.card.name, 'B');
});

test('higher wishlist still wins over lower gen', () => {
  const d = selectCard([card('A', 50, 100), card('B', 900, 500)]);
  assert.strictEqual(d.card.name, 'B');
});

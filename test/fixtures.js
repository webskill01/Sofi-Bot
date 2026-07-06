// Mock discord.js-selfbot button/message shapes from REAL Sofi drops.
// buttons: { type:'BUTTON', style:'PRIMARY', label, emoji:{name,id}, customId }
const dh = (label, i) => ({ type: 'BUTTON', style: 'PRIMARY', label, emoji: { name: 'dropheart', id: '1458959263497195685' }, customId: `dh_${i}` });
const coffee = (label, i) => ({ type: 'BUTTON', style: 'PRIMARY', label, emoji: { name: '☕', id: null }, customId: `cf_${i}` });
const shell = (label, i) => ({ type: 'BUTTON', style: 'PRIMARY', label, emoji: { name: 'shell', id: null }, customId: `sh_${i}` });

function msg(content, buttons, embeds) {
  return { id: 'm', content, author: { id: '853629533855809596' }, components: [{ components: buttons }], embeds: embeds || [] };
}

// Mixed 4-line coffee drop: line2 = FREE item (☕ no label), line4 = event card (☕ 411)
const mixedCoffee = msg(
  '<@u> is **dropping** cards\n' +
  '`1.` :lightw: | G•`622 ` | Homura Kurusu • Grimoire Magic Academy\n' +
  '`2.` :coffee: | Coffees\n' +
  '`3.` :windw: | G•`1716` | Kitahara Hakushuu • Bungo\n' +
  '`4.` :firew: | G•`    ` | Arataka Reigen • Mob Psycho 100',
  [dh('1', 1), coffee(undefined, 2), dh('0', 3), coffee('411', 4)]
);

// Coffee event card only (Anis), WL 88 on ☕ button. No free item.
const coffeeCardOnly = msg(
  '<@u> is **dropping** cards\n' +
  '`1.` :windw: | G•`723 ` | Akiko Narumi • Fuuto Pi\n' +
  '`2.` :iceew: | G•`    ` | Anis • Goddess of Victory NIKKE\n' +
  '`3.` :earthw: | G•`651 ` | Roger MacKenzie • Outlander',
  [dh('0', 1), coffee('88', 2), dh('0', 3)]
);

// Shells-style: free shell item (no label) + two dropheart cards. Must stay unchanged.
const shellsFreeItem = msg(
  '<@u> is **dropping** cards\n' +
  '`1.` :windw: | G•`500 ` | A • X\n' +
  '`2.` :shell: | Shells\n' +
  '`3.` :firew: | G•`900 ` | B • Y',
  [dh('5', 1), shell(undefined, 2), dh('9', 3)]
);

// Two free items + one card in a 3-slot drop: slots 1 & 2 are free coffees
// (numbered lines, no G•), slot 3 is a real card. All three should be taken:
// both items grabbed, then the card claimed.
const twoFreeItems = msg(
  '<@u> is **dropping** cards\n' +
  '`1.` :coffee: | Coffees\n' +
  '`2.` :coffee: | Coffees\n' +
  '`3.` :firew: | G•`825 ` | Real Card • Some Series',
  [coffee(undefined, 1), coffee(undefined, 2), dh('300', 3)]
);

// Plain normal drop, no event content at all.
const normalDrop = msg(
  '<@u> is **dropping** cards\n' +
  '`1.` :windw: | G•`100 ` | A • X\n' +
  '`2.` :firew: | G•`50  ` | B • Y\n' +
  '`3.` :earthw: | G•`200 ` | C • Z',
  [dh('3', 1), dh('7', 2), dh('1', 3)]
);

const sevEmbed = msg('', [
  { type: 'BUTTON', style: 'PRIMARY', label: 'Leaderboard', customId: 'lb' },
  { type: 'BUTTON', style: 'PRIMARY', label: 'Lottery', customId: 'lottery_btn' },
], [{
  title: 'Maid & Butler 2026 [Ends <t:1785081600:R>]',
  description: 'Event stuff\n\nLottery [#3] ( 108 ) | Ends <t:1785083650:R>\nUse the Lottery button below at the cost of **10** :coffee: for a chance to win',
}]);

const siEventEmbed = msg('', [], [{
  author: { name: 'SOFI: INVENTORY (what_the_duckkk)' },
  description: '💳 • 43 • Gen Scratchers\n🍙 • 69 • Onigiri\n☕ • 28 • Coffee',
}]);

module.exports = { msg, dh, coffee, shell, mixedCoffee, coffeeCardOnly, shellsFreeItem, twoFreeItems, normalDrop, sevEmbed, siEventEmbed };

const { test } = require('node:test');
const assert = require('node:assert');
const { isOwnResponse } = require('../src/ownership');

const ctx = { commandMsgId: 'cmd123', selfUserId: 'me999' };
const withMentions = (ids) => ({ mentions: { users: new Set(ids) } });

test('accepts a reply to our command message', () => {
  const m = { reference: { messageId: 'cmd123' }, mentions: { users: new Set() } };
  assert.strictEqual(isOwnResponse(m, ctx), true);
});

test('accepts a message that mentions our user', () => {
  assert.strictEqual(isOwnResponse(withMentions(['me999']), ctx), true);
});

test('rejects another player\'s drop (mentions someone else, replies to their command)', () => {
  const m = { reference: { messageId: 'otherCmd' }, mentions: { users: new Set(['stranger777']) } };
  assert.strictEqual(isOwnResponse(m, ctx), false);
});

test('rejects a message with no reference and no mentions', () => {
  assert.strictEqual(isOwnResponse({ mentions: { users: new Set() } }, ctx), false);
});

test('safe when mentions is missing', () => {
  assert.strictEqual(isOwnResponse({ reference: { messageId: 'otherCmd' } }, ctx), false);
});

test('does not match reply when we have no pending command id', () => {
  const m = { reference: { messageId: 'cmd123' }, mentions: { users: new Set() } };
  assert.strictEqual(isOwnResponse(m, { commandMsgId: null, selfUserId: 'me999' }), false);
});

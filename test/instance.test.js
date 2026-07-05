const { test } = require('node:test');
const assert = require('node:assert');

// Re-resolve instance.js under a controlled env (it memoizes at load time).
function freshInstanceId(env) {
  const saved = { ...process.env };
  delete process.env.INSTANCE_ID;
  delete process.env.TOKEN;
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/instance')];
  const { instanceId } = require('../src/instance');
  // restore
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  delete require.cache[require.resolve('../src/instance')];
  return instanceId;
}

test('INSTANCE_ID takes precedence', () => {
  assert.strictEqual(freshInstanceId({ INSTANCE_ID: 'bot3' }), 'bot3');
});

test('two different tokens → two different instance ids (no ledger collision)', () => {
  const a = freshInstanceId({ TOKEN: 'AAA' });
  const b = freshInstanceId({ TOKEN: 'BBB' });
  assert.notStrictEqual(a, b);
  assert.match(a, /^auto-/);
});

test('no INSTANCE_ID and no token → default', () => {
  assert.strictEqual(freshInstanceId({}), 'default');
});

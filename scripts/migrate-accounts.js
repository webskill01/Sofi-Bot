// One-time: turn an old hand-written ecosystem.config.js into accounts.json.
// Usage: node scripts/migrate-accounts.js [path/to/old-ecosystem.js]
// Refuses to overwrite an existing accounts.json.
const fs = require('fs');
const path = require('path');
const { writeAccounts } = require('../panel/lib');

const root = path.join(__dirname, '..');
const src = path.resolve(process.argv[2] || path.join(root, 'ecosystem.config.js'));
const out = path.join(root, 'accounts.json');

if (fs.existsSync(out)) {
  console.error(`${out} already exists — not overwriting.`);
  process.exit(1);
}

const accounts = require(src).apps
  .filter(a => a.env && a.env.TOKEN)
  .map(a => ({
    name: a.name,
    instance: a.env.INSTANCE_ID,
    token: a.env.TOKEN,
    channels: a.env.CHANNEL_IDS || '',
  }));

for (const a of accounts) {
  if (!a.name || !a.instance) throw new Error(`app missing name/INSTANCE_ID: ${JSON.stringify(a.name)}`);
}

writeAccounts(out, accounts);
console.log(`Wrote ${accounts.length} accounts: ${accounts.map(a => `${a.name}/${a.instance}`).join(', ')}`);

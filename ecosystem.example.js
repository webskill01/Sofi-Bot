// pm2 apps for every Sofi account, built from accounts.json (written by the panel).
// Deploy: cp ecosystem.example.js ecosystem.config.js
// accounts.json: [{ "name": "sofi-bot", "instance": "acc1", "token": "...", "channels": "" }]
const fs = require('fs');
const path = require('path');

const sharedConfig = {
  script: 'src/bot.js',
  watch: false,
  autorestart: true,
  restart_delay: 10000,        // Wait 10s before restarting on crash
  max_restarts: 10,            // Stop trying after 10 crashes in a row
  min_uptime: '30s',           // Must stay up 30s to count as a successful start
  max_memory_restart: '300M',  // Restart if memory exceeds 300MB
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  merge_logs: true,
};

const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, 'accounts.json'), 'utf8'));

module.exports = {
  apps: accounts.map(a => ({
    ...sharedConfig,
    name: a.name,
    out_file: `logs/${a.instance}-out.log`,
    error_file: `logs/${a.instance}-error.log`,
    env: {
      NODE_ENV: 'production',
      TOKEN: a.token,
      CHANNEL_IDS: a.channels || '',
      INSTANCE_ID: a.instance,
    },
  })),
};

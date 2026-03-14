// Shared PM2 config applied to every app instance
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

module.exports = {
  apps: [
    {
      ...sharedConfig,
      name: 'sofi-bot',
      out_file: 'logs/acc1-out.log',
      error_file: 'logs/acc1-error.log',
      env: {
        NODE_ENV: 'production',
        TOKEN: 'ACCOUNT_1_TOKEN_HERE',
        CHANNEL_IDS: '',
      },
    },
    // Uncomment and fill in to add a second account:
    {
      ...sharedConfig,
      name: 'sofi-bot2',
      out_file: 'logs/acc2-out.log',
      error_file: 'logs/acc2-error.log',
      env: {
        NODE_ENV: 'production',
        TOKEN: 'ACCOUNT_2_TOKEN_HERE',
        CHANNEL_IDS: '',
      },
    },
  ],
};

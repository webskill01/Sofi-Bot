module.exports = {
  apps: [
    {
      name: 'sofi-bot',
      script: 'src/bot.js',
      watch: false,
      autorestart: true,
      restart_delay: 10000,          // Wait 10s before restarting on crash
      max_restarts: 10,              // Stop trying after 10 crashes in a row
      min_uptime: '30s',             // Must stay up 30s to count as a successful start
      max_memory_restart: '200M',    // Restart if memory exceeds 200MB
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

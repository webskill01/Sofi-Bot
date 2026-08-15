const { createLogger, format, transports } = require('winston');

const { combine, timestamp, printf, colorize, errors } = format;

// Which account these logs belong to — set once on ready via logger.setUser().
// ponytail: module-level string, one client per process.
let user = '';

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]${user} ${stack || message}`;
});

// Console only. PM2 captures stdout/stderr into per-instance files
// (out_file / error_file in ecosystem.config.js) and pm2-logrotate keeps them
// bounded — so a separate winston file would just be a duplicate.
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),
  ],
});

logger.setUser = (name) => { user = name ? ` [${name}]` : ''; };

module.exports = logger;

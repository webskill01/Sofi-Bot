const { createLogger, format, transports } = require('winston');
const path = require('path');
const { instanceId } = require('./instance');

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}] ${stack || message}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    // Console output with colors
    new transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),
    // File: all logs (per-instance so multiple bots don't interleave)
    new transports.File({
      filename: path.join('logs', `sofi-bot-${instanceId}.log`),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      tailable: true,
    }),
    // File: errors only (per-instance)
    new transports.File({
      filename: path.join('logs', `error-${instanceId}.log`),
      level: 'error',
      maxsize: 2 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;

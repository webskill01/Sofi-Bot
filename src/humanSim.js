const config = require('../config');
const logger = require('./logger');

/**
 * Human simulation utilities.
 *
 * All timing randomness uses a Box-Muller Gaussian distribution so delays
 * cluster naturally around a mean rather than being uniformly random.
 * This makes the bot's timing look more like actual human reaction times.
 */

// -- Gaussian random --------------------------------------------------------

/**
 * Box-Muller transform: returns a random number from a normal distribution
 * with the given mean and standard deviation, clamped to [min, max].
 */
function gaussianRandom(mean, stddev, min, max) {
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt((-2 * Math.log(s)) / s);
  const result = mean + stddev * u * mul;
  return Math.min(max, Math.max(min, Math.round(result)));
}

/**
 * Simple uniform random integer between min and max (inclusive).
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// -- Sleep -------------------------------------------------------------------

/**
 * Promisified sleep.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -- Reaction delay ----------------------------------------------------------

/**
 * Get a human-like reaction delay before claiming a card.
 * Late night = slower and more variable.
 *
 * @param {boolean} lateNight
 * @returns {number} delay in milliseconds
 */
function getReactionDelay(lateNight) {
  if (lateNight) {
    const mean = (config.LATE_MIN_REACTION_MS + config.LATE_MAX_REACTION_MS) / 2;
    const stddev = (config.LATE_MAX_REACTION_MS - config.LATE_MIN_REACTION_MS) / 5;
    return gaussianRandom(mean, stddev, config.LATE_MIN_REACTION_MS, config.LATE_MAX_REACTION_MS);
  }
  const mean = (config.MIN_REACTION_DELAY_MS + config.MAX_REACTION_DELAY_MS) / 2;
  const stddev = (config.MAX_REACTION_DELAY_MS - config.MIN_REACTION_DELAY_MS) / 5;
  return gaussianRandom(mean, stddev, config.MIN_REACTION_DELAY_MS, config.MAX_REACTION_DELAY_MS);
}

/**
 * Wait for a human-like reaction delay before clicking claim.
 * @param {boolean} lateNight
 */
async function waitReactionDelay(lateNight) {
  const delay = getReactionDelay(lateNight);
  logger.debug(`Reaction delay: ${(delay / 1000).toFixed(1)}s`);
  await sleep(delay);
}

// -- Drop timing jitter ------------------------------------------------------

/**
 * Get the next drop interval: base cooldown + random extra delay.
 * ~88% of the time: normal jitter (0-1 min).
 * ~12% of the time: "late" jitter (1-5 min) — simulates being distracted.
 * All values are configurable in config/index.js.
 *
 * @param {{ lazy?: boolean, windDown?: boolean }} [opts] - Lazy day / wind-down flags
 * @returns {number} milliseconds until next drop
 */
function getDropInterval(opts = {}) {
  const { lazy = false, windDown = false } = opts;

  if (lazy) {
    // Lazy day: longer base cooldown, wider jitter, more distraction
    const isLate = Math.random() < config.LAZY_DROP_LATE_CHANCE;
    const jitter = isLate
      ? randInt(config.LAZY_DROP_JITTER_MAX_MS, config.LAZY_DROP_LATE_JITTER_MAX_MS)
      : randInt(config.LAZY_DROP_JITTER_MIN_MS, config.LAZY_DROP_JITTER_MAX_MS);
    return config.LAZY_DROP_COOLDOWN_MS + jitter;
  }

  // Wind-down evening: normal cooldown but slightly higher late chance
  const lateChance = windDown ? config.LAZY_WIND_DOWN_LATE_CHANCE : config.DROP_LATE_CHANCE;
  const isLate = Math.random() < lateChance;
  const jitter = isLate
    ? randInt(config.DROP_JITTER_MAX_MS, config.DROP_LATE_JITTER_MAX_MS)
    : randInt(config.DROP_JITTER_MIN_MS, config.DROP_JITTER_MAX_MS);
  return config.DROP_COOLDOWN_MS + jitter;
}

// -- Typing simulation -------------------------------------------------------

/**
 * Simulate typing a command with human-like keypress delays.
 * @param {string} text
 * @returns {number} total ms spent "typing"
 */
function getTypingDuration(text) {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    total += randInt(45, 120);
  }
  total += randInt(200, 600);
  return total;
}

/**
 * Wait as if you're typing the command before sending it.
 * @param {string} command
 */
async function simulateTyping(command) {
  const duration = getTypingDuration(command);
  logger.debug(`Simulating typing "${command}" (${duration}ms)`);
  await sleep(duration);
}

// -- IST time helpers --------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

/**
 * Get the current time in IST.
 * @returns {{ hours: number, minutes: number, totalMinutes: number }}
 */
function getISTTime() {
  const utcMs = Date.now();
  const istMs = utcMs + IST_OFFSET_MS;
  const d = new Date(istMs);
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

/**
 * Check if the current IST time is in "late night" mode.
 */
function isLateNight() {
  const { hours } = getISTTime();
  return hours >= config.LATE_NIGHT_START_HOUR_IST;
}

// -- AFK break schedule ------------------------------------------------------

/**
 * Plan random AFK breaks for the day.
 * The waking hours are everything OUTSIDE the sleep window (2am-5am).
 * Breaks are spread across the full waking period.
 *
 * @param {{ startMinutes: number, endMinutes: number }} sleepWindow
 * @param {boolean} [lazy=false] - Use lazy day break counts/durations
 * @returns {Array<{ startMinutes: number, durationMs: number, label: string }>}
 */
function planAfkBreaks(sleepWindow, lazy = false) {
  const minCount = lazy ? config.LAZY_AFK_MIN_COUNT : config.AFK_MIN_COUNT;
  const maxCount = lazy ? config.LAZY_AFK_MAX_COUNT : config.AFK_MAX_COUNT;
  const minDuration = lazy ? config.LAZY_AFK_MIN_DURATION_MS : config.AFK_MIN_DURATION_MS;
  const maxDuration = lazy ? config.LAZY_AFK_MAX_DURATION_MS : config.AFK_MAX_DURATION_MS;
  const count = randInt(minCount, maxCount);
  const breaks = [];

  // Waking hours: from sleep end to next sleep start (roughly 5am to 2am next day)
  // For break planning, use 5am (sleep end) to midnight as the window
  const wakeStart = sleepWindow.endMinutes;  // ~5am = 300
  const wakeEnd = 24 * 60;                   // midnight = 1440

  // Lunch break (always scheduled)
  const lunchStart =
    config.LUNCH_START_HOUR_IST * 60 +
    randInt(0, (config.LUNCH_END_HOUR_IST - config.LUNCH_START_HOUR_IST) * 60 * 0.4);
  const lunchDuration = randInt(config.LUNCH_DURATION_MIN_MS, config.LUNCH_DURATION_MAX_MS);
  breaks.push({ startMinutes: lunchStart, durationMs: lunchDuration, label: 'lunch' });

  // Additional random breaks spread across waking hours
  const wakeRange = wakeEnd - wakeStart;
  const added = new Set([lunchStart]);

  for (let i = 0; i < count - 1; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const breakStart = wakeStart + randInt(
        Math.floor(wakeRange * 0.05),
        Math.floor(wakeRange * 0.95)
      );
      const tooClose = breaks.some(b => Math.abs(b.startMinutes - breakStart) < 60);
      if (!tooClose && !added.has(breakStart)) {
        const duration = randInt(minDuration, maxDuration);
        breaks.push({ startMinutes: breakStart, durationMs: duration, label: `afk-${i + 1}` });
        added.add(breakStart);
        break;
      }
      attempts++;
    }
  }

  breaks.sort((a, b) => a.startMinutes - b.startMinutes);
  breaks.forEach(b => {
    const h = Math.floor(b.startMinutes / 60);
    const m = b.startMinutes % 60;
    logger.info(`AFK break [${b.label}] at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} IST for ${(b.durationMs / 60000).toFixed(0)}min`);
  });

  return breaks;
}

/**
 * Check if current IST time falls inside an AFK break.
 * Returns the break object if currently in one, else null.
 */
function getCurrentAfkBreak(breaks) {
  const { totalMinutes } = getISTTime();
  for (const b of breaks) {
    const endMinutes = b.startMinutes + Math.floor(b.durationMs / 60000);
    if (totalMinutes >= b.startMinutes && totalMinutes < endMinutes) {
      return b;
    }
  }
  return null;
}

module.exports = {
  sleep,
  waitReactionDelay,
  getDropInterval,
  simulateTyping,
  getISTTime,
  isLateNight,
  planAfkBreaks,
  getCurrentAfkBreak,
  randInt,
};

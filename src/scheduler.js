const config = require('../config');
const logger = require('./logger');
const {
  getISTTime,
  isLateNight,
  sleep,
  randInt,
  planAfkBreaks,
  getCurrentAfkBreak,
} = require('./humanSim');
const { saveState } = require('./stateStore');

/**
 * Scheduler manages:
 *  - Sleep window (2am-5am IST with jitter) — bot is OFF during this time
 *  - AFK break schedule — random breaks during waking hours
 *  - Providing a simple isActive() check for the bot loop
 *  - Auto-refreshing AFK breaks at midnight IST
 */

class Scheduler {
  constructor() {
    this._sleepWindow = null;   // { startMinutes, endMinutes } for today
    this._afkBreaks = [];
    this._lastDate = null;      // 'YYYY-MM-DD' string in IST
  }

  /**
   * Initialize or refresh today's schedule if the IST date has changed.
   */
  _refreshIfNewDay() {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const dateStr = now.toISOString().slice(0, 10);

    if (dateStr !== this._lastDate) {
      logger.info(`New IST day detected (${dateStr}) — generating schedule`);
      this._sleepWindow = this._generateSleepWindow();
      this._afkBreaks = planAfkBreaks(this._sleepWindow);
      this._lastDate = dateStr;
      // Persist so a same-day restart restores the exact same schedule
      saveState({ afkDate: dateStr, sleepWindow: this._sleepWindow, afkBreaks: this._afkBreaks });
    }
  }

  /**
   * Generate today's sleep window with jitter.
   * Sleep is from ~2am to ~5am IST (configurable).
   */
  _generateSleepWindow() {
    const startJitter = randInt(-config.SLEEP_JITTER_MIN, config.SLEEP_JITTER_MIN);
    const endJitter = randInt(-config.SLEEP_JITTER_MIN, config.SLEEP_JITTER_MIN);

    const startMinutes = config.SLEEP_START_HOUR_IST * 60 + startJitter;
    const endMinutes = config.SLEEP_END_HOUR_IST * 60 + endJitter;

    const fmt = (m) => {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };

    logger.info(`Today's sleep window: ${fmt(startMinutes)} IST - ${fmt(endMinutes)} IST`);
    return { startMinutes, endMinutes };
  }

  /**
   * Returns true if the bot should currently be active.
   * False during sleep window or AFK breaks.
   */
  isActive() {
    this._refreshIfNewDay();

    // Check sleep window
    if (this._isInSleepWindow()) {
      return false;
    }

    // Check AFK break
    const afk = getCurrentAfkBreak(this._afkBreaks);
    if (afk) {
      return false;
    }

    return true;
  }

  /**
   * Check if current IST time is inside the sleep window.
   */
  _isInSleepWindow() {
    const { totalMinutes } = getISTTime();
    return totalMinutes >= this._sleepWindow.startMinutes &&
           totalMinutes < this._sleepWindow.endMinutes;
  }

  /**
   * Returns the current state as a string for logging.
   */
  getStatus() {
    this._refreshIfNewDay();
    const { hours, minutes, totalMinutes } = getISTTime();
    const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} IST`;

    if (this._isInSleepWindow()) {
      const remaining = this._sleepWindow.endMinutes - totalMinutes;
      return `sleeping (2am-5am window) — wakes in ${remaining}min (at ${time})`;
    }

    const afk = getCurrentAfkBreak(this._afkBreaks);
    if (afk) {
      const afkEndMin = afk.startMinutes + Math.floor(afk.durationMs / 60000);
      const remaining = afkEndMin - totalMinutes;
      return `AFK break [${afk.label}] — ${remaining}min remaining`;
    }

    return `active — ${time}${isLateNight() ? ' (late night mode)' : ''}`;
  }

  /**
   * If currently in the sleep window, sleep until it ends, then return.
   * Returns true if we slept, false if not in sleep window.
   */
  async waitForSleepEnd() {
    this._refreshIfNewDay();
    const { totalMinutes } = getISTTime();

    if (this._isInSleepWindow()) {
      const waitMs = (this._sleepWindow.endMinutes - totalMinutes) * 60 * 1000;
      const buffer = randInt(30000, 180000); // 30s-3min buffer after wake
      logger.info(`In sleep window — sleeping for ${Math.round(waitMs / 60000)}min`);
      await sleep(waitMs + buffer);
      this._refreshIfNewDay();
      return true;
    }

    return false;
  }

  /**
   * Restore state from a previous run (loaded via stateStore).
   * If the saved date matches today's IST date, reuse the saved AFK schedule
   * so restarts don't randomise breaks mid-day.
   *
   * @param {object} saved — result of loadState()
   */
  restoreState(saved) {
    if (!saved || !saved.afkDate || !saved.afkBreaks) return;

    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const today = now.toISOString().slice(0, 10);

    if (saved.afkDate !== today) return;
    if (!Array.isArray(saved.afkBreaks) || saved.afkBreaks.length === 0) return;

    this._afkBreaks = saved.afkBreaks;
    this._lastDate = today;

    // Restore the exact sleep window from state; fall back to regenerating only if missing
    if (saved.sleepWindow && saved.sleepWindow.startMinutes != null) {
      this._sleepWindow = saved.sleepWindow;
    } else {
      this._sleepWindow = this._generateSleepWindow();
    }

    // Re-log the full schedule so it's visible in logs on every restart
    logger.info(`Restored today's schedule from saved state (${today})`);
    const fmt = (m) => {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };
    logger.info(`Today's sleep window: ${fmt(this._sleepWindow.startMinutes)} IST - ${fmt(this._sleepWindow.endMinutes)} IST`);
    for (const b of this._afkBreaks) {
      const h = Math.floor(b.startMinutes / 60);
      const m = b.startMinutes % 60;
      logger.info(`AFK break [${b.label}] at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} IST for ${Math.round(b.durationMs / 60000)}min`);
    }
  }

  /**
   * If currently in an AFK break, sleep for the remaining break duration.
   * Returns true if we slept, false if no break was active.
   */
  async handleAfkBreak() {
    const afk = getCurrentAfkBreak(this._afkBreaks);
    if (!afk) return false;

    const { totalMinutes } = getISTTime();
    const afkEndMin = afk.startMinutes + Math.floor(afk.durationMs / 60000);
    const remainingMs = (afkEndMin - totalMinutes) * 60 * 1000;

    if (remainingMs > 0) {
      logger.info(`AFK break [${afk.label}] — pausing for ${Math.round(remainingMs / 60000)}min`);
      await sleep(remainingMs + randInt(15000, 60000));
    }
    return true;
  }
}

module.exports = new Scheduler();

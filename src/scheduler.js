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

    // Lazy day state
    this._isLazyDay = false;        // Is today a lazy day?
    this._lazyDayDate = null;       // 'YYYY-MM-DD' of the chosen lazy day this week
    this._lazyWeekStart = null;     // 'YYYY-MM-DD' when this week's lazy day was decided
    this._lazySkippedThisWeek = false; // True if skip chance triggered
  }

  /**
   * Initialize or refresh today's schedule if the IST date has changed.
   */
  _refreshIfNewDay() {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const dateStr = now.toISOString().slice(0, 10);

    if (dateStr !== this._lastDate) {
      logger.info(`New IST day detected (${dateStr}) — generating schedule`);

      // Decide lazy day for this week (must happen before sleep/AFK generation)
      this._decideLazyDay(dateStr, now);

      this._sleepWindow = this._generateSleepWindow();
      this._afkBreaks = this._isLazyDay
        ? planAfkBreaks(this._sleepWindow, true)
        : planAfkBreaks(this._sleepWindow);
      this._lastDate = dateStr;

      if (this._isLazyDay) {
        logger.info(`TODAY IS A LAZY DAY — reduced activity mode`);
      }

      // Persist so a same-day restart restores the exact same schedule
      saveState({
        afkDate: dateStr,
        sleepWindow: this._sleepWindow,
        afkBreaks: this._afkBreaks,
        lazyDayDate: this._lazyDayDate,
        lazyWeekStart: this._lazyWeekStart,
        isLazyDay: this._isLazyDay,
        lazySkippedThisWeek: this._lazySkippedThisWeek,
      });
    }
  }

  /**
   * Decide the lazy day for this week using weighted random selection.
   * A "week" is 7 days from when the decision was made.
   * @param {string} todayStr - 'YYYY-MM-DD' in IST
   * @param {Date} nowIST - current Date object adjusted to IST
   */
  _decideLazyDay(todayStr, nowIST) {
    // Check if we need a new weekly decision
    const needsNewDecision = !this._lazyWeekStart || this._daysSince(this._lazyWeekStart, todayStr) >= 7;

    if (needsNewDecision) {
      // Skip chance — some weeks have no lazy day
      if (Math.random() < config.LAZY_DAY_SKIP_CHANCE) {
        logger.info(`Lazy day: skipping this week (${(config.LAZY_DAY_SKIP_CHANCE * 100).toFixed(0)}% skip chance triggered)`);
        this._lazyDayDate = null;
        this._lazySkippedThisWeek = true;
        this._isLazyDay = false;
        this._lazyWeekStart = todayStr;
        return;
      }

      // Weighted random pick: find a day within the next 7 days
      const chosenDayOfWeek = this._weightedRandomDay();
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      // Find the next occurrence of chosenDayOfWeek from today
      const todayDow = nowIST.getUTCDay(); // 0=Sun, 1=Mon, ...
      let daysUntil = chosenDayOfWeek - todayDow;
      if (daysUntil <= 0) daysUntil += 7;
      // If today IS the chosen day (daysUntil === 7 after wrap), use today
      if (daysUntil === 7) daysUntil = 0;

      const lazyDate = new Date(nowIST.getTime() + daysUntil * 24 * 60 * 60 * 1000);
      this._lazyDayDate = lazyDate.toISOString().slice(0, 10);
      this._lazyWeekStart = todayStr;
      this._lazySkippedThisWeek = false;

      logger.info(`Lazy day this week: ${dayNames[chosenDayOfWeek]} (${this._lazyDayDate})`);
    }

    // Check if today is the lazy day
    this._isLazyDay = this._lazyDayDate === todayStr;
  }

  /**
   * Weighted random day selection from config weights.
   * Config weights are [Mon, Tue, Wed, Thu, Fri, Sat, Sun] (index 0-6).
   * Returns JS day-of-week (0=Sun, 1=Mon, ..., 6=Sat).
   */
  _weightedRandomDay() {
    const weights = config.LAZY_DAY_WEIGHTS; // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    let roll = Math.random() * totalWeight;

    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        // Convert config index (0=Mon) to JS day (0=Sun): Mon=1, Tue=2, ..., Sun=0
        return (i + 1) % 7;
      }
    }
    return 1; // fallback: Monday
  }

  /**
   * Calculate days between two 'YYYY-MM-DD' date strings.
   */
  _daysSince(fromStr, toStr) {
    const from = new Date(fromStr + 'T00:00:00Z');
    const to = new Date(toStr + 'T00:00:00Z');
    return Math.floor((to - from) / (24 * 60 * 60 * 1000));
  }

  /**
   * Generate today's sleep window with jitter.
   * Normal: ~2am to ~7am IST. Lazy day: ~8pm to ~10-12pm IST.
   */
  _generateSleepWindow() {
    const startJitter = randInt(-config.SLEEP_JITTER_MIN, config.SLEEP_JITTER_MIN);

    let startMinutes, endMinutes;

    if (this._isLazyDay) {
      // Lazy day: sleep early (8-10pm), wake late (10am-12pm)
      startMinutes = config.LAZY_SLEEP_START_HOUR_IST * 60 + startJitter;
      // Random wake time between LAZY_SLEEP_END and LAZY_SLEEP_END_MAX
      const wakeHour = randInt(config.LAZY_SLEEP_END_HOUR_IST * 60, config.LAZY_SLEEP_END_MAX_HOUR_IST * 60);
      const endJitter = randInt(-config.SLEEP_JITTER_MIN, config.SLEEP_JITTER_MIN);
      endMinutes = wakeHour + endJitter;
    } else {
      const endJitter = randInt(-config.SLEEP_JITTER_MIN, config.SLEEP_JITTER_MIN);
      startMinutes = config.SLEEP_START_HOUR_IST * 60 + startJitter;
      endMinutes = config.SLEEP_END_HOUR_IST * 60 + endJitter;
    }

    const fmt = (m) => {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };

    const dayType = this._isLazyDay ? ' (LAZY DAY)' : '';
    logger.info(`Today's sleep window${dayType}: ${fmt(startMinutes)} IST - ${fmt(endMinutes)} IST`);
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
   * On lazy days the window wraps midnight: e.g. 20:00 → 10:00 next day.
   * This means sleep if time >= start OR time < end.
   */
  _isInSleepWindow() {
    const { totalMinutes } = getISTTime();

    if (this._sleepWindow.startMinutes > this._sleepWindow.endMinutes) {
      // Wraps midnight (lazy day): sleep if >= start OR < end
      return totalMinutes >= this._sleepWindow.startMinutes || totalMinutes < this._sleepWindow.endMinutes;
    }

    // Normal: sleep if >= start AND < end
    return totalMinutes >= this._sleepWindow.startMinutes &&
           totalMinutes < this._sleepWindow.endMinutes;
  }

  /**
   * Returns true if today is a lazy day (reduced activity).
   */
  isLazyDay() {
    this._refreshIfNewDay();
    return this._isLazyDay;
  }

  /**
   * Returns true if tomorrow is a lazy day AND current time is past the wind-down hour.
   * Used to slightly increase late-drop chance the evening before a lazy day.
   */
  isWindDownEvening() {
    this._refreshIfNewDay();
    if (!this._lazyDayDate) return false;

    const { hours } = getISTTime();
    if (hours < config.LAZY_WIND_DOWN_HOUR_IST) return false;

    // Check if tomorrow is the lazy day
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    return tomorrowStr === this._lazyDayDate;
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

    const flags = [];
    if (this._isLazyDay) flags.push('LAZY DAY');
    if (isLateNight()) flags.push('late night mode');
    if (this.isWindDownEvening()) flags.push('wind-down evening');
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    return `active — ${time}${suffix}`;
  }

  /**
   * If currently in the sleep window, sleep until it ends, then return.
   * Returns true if we slept, false if not in sleep window.
   */
  async waitForSleepEnd() {
    this._refreshIfNewDay();
    const { totalMinutes } = getISTTime();

    if (this._isInSleepWindow()) {
      let waitMin;
      if (this._sleepWindow.startMinutes > this._sleepWindow.endMinutes) {
        // Wraps midnight (lazy day): calculate minutes until endMinutes
        if (totalMinutes >= this._sleepWindow.startMinutes) {
          // Before midnight: wait until midnight + endMinutes
          waitMin = (1440 - totalMinutes) + this._sleepWindow.endMinutes;
        } else {
          // After midnight: wait until endMinutes
          waitMin = this._sleepWindow.endMinutes - totalMinutes;
        }
      } else {
        waitMin = this._sleepWindow.endMinutes - totalMinutes;
      }

      const waitMs = waitMin * 60 * 1000;
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

    // Restore lazy day state (persists across the week, not just today)
    if (saved.lazyWeekStart) {
      this._lazyWeekStart = saved.lazyWeekStart;
      this._lazyDayDate = saved.lazyDayDate || null;
      this._lazySkippedThisWeek = saved.lazySkippedThisWeek || false;
      this._isLazyDay = saved.isLazyDay || false;

      // Verify: if the week is still valid (< 7 days old), keep it
      if (this._daysSince(this._lazyWeekStart, today) >= 7) {
        // Week expired — will be re-decided on next _refreshIfNewDay
        this._lazyWeekStart = null;
        this._lazyDayDate = null;
        this._isLazyDay = false;
        this._lazySkippedThisWeek = false;
      } else {
        // Re-check if today is the lazy day
        this._isLazyDay = this._lazyDayDate === today;
      }
    }

    this._afkBreaks = saved.afkBreaks;
    this._lastDate = today;

    // Restore the exact sleep window from state; fall back to regenerating only if missing
    if (saved.sleepWindow && saved.sleepWindow.startMinutes != null) {
      this._sleepWindow = saved.sleepWindow;
    } else {
      this._sleepWindow = this._generateSleepWindow();
    }

    // Re-log the full schedule so it's visible in logs on every restart
    logger.info(`Restored today's schedule from saved state (${today})${this._isLazyDay ? ' — LAZY DAY' : ''}`);
    if (this._lazyDayDate) {
      logger.info(`Lazy day this week: ${this._lazyDayDate}${this._isLazyDay ? ' (TODAY)' : ''}`);
    } else if (this._lazySkippedThisWeek) {
      logger.info('Lazy day: skipped this week');
    }
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

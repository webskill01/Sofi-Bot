/**
 * Lightweight state persistence.
 * Reads/writes logs/state.json so key bot state survives PM2 restarts.
 *
 * The file is always overwritten (never appended), so it cannot grow unbounded.
 * Stale scd timestamps (past) are pruned on every save.
 * The whole file is reset when the saved IST date differs from today (new day).
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join('logs', 'state.json');

/**
 * Load persisted state. Returns {} if file is missing or corrupt.
 */
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Merge `patch` into the current state and write back to disk.
 * Automatically prunes past scd timestamps and wipes stale data when
 * the saved date no longer matches today's IST date.
 *
 * @param {object} patch — fields to update
 */
function saveState(patch) {
  const now = Date.now();
  const todayIST = new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let current = loadState();

  // If the saved date is from a different day, discard everything except
  // lastSdailyTime (which spans days) so stale scd / afk data is cleared.
  if (current.afkDate && current.afkDate !== todayIST) {
    current = { lastSdailyTime: current.lastSdailyTime };
  }

  const next = { ...current, ...patch, savedAt: now };

  // Prune scd timestamps that are already in the past
  if (Array.isArray(next.scdTimesToday)) {
    next.scdTimesToday = next.scdTimesToday.filter(t => t > now);
  }

  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal — state persistence failure should never crash the bot
    console.error(`[stateStore] Failed to save state: ${err.message}`);
  }
}

module.exports = { loadState, saveState };

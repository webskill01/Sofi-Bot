require('dotenv').config();

module.exports = {
  // ─── Discord ─────────────────────────────────────────────────────────────────
  TOKEN: process.env.TOKEN,
  SOFI_BOT_ID: process.env.SOFI_BOT_ID || '853629533855809596',

  // ─── Multi-Channel Config ─────────────────────────────────────────────────────
  // Add one channel ID per server you want to drop in.
  // The bot will rotate through them in session bursts (CHANNEL_SESSION_MIN to MAX drops).
  // Right-click a channel in Discord → Copy Channel ID (needs Developer Mode enabled).
  CHANNELS: [
    '925595419256451077',  // Replace with your channel ID(s)
    '1331257457128771654',  // Add more channels here
    '1233860234439823391',
  ],
  CHANNEL_SESSION_MIN: 5,  // Min consecutive drops in one channel before switching
  CHANNEL_SESSION_MAX: 10,  // Max consecutive drops in one channel before switching

  // ─── Dry Run ──────────────────────────────────────────────────────────────────
  DRY_RUN: process.env.DRY_RUN === 'true',

  // ─── Claim Thresholds ─────────────────────────────────────────────────────────
  // Priority order: gen ≤ 10 → event card → gen ≤ 100 w/ high WL → highest WL → random
  GEN_SUPER_ULTRA: 10,          // Gen ≤ 10 = absolute top priority (rarest cards)
  GEN_ULTRA_LOW: 100,           // Gen ≤ 100 = very rare
  GEN_ULTRA_WL_MIN: 500,        // Gen ≤ 100 card must have WL > this to trigger priority
  WL_OVERRIDE_THRESHOLD: 2500,  // If any card has WL ≥ 2500, it beats gen ≤ 100 priority

  // ─── Event Card Settings ──────────────────────────────────────────────────────
  // Event cards have no gen (empty gen field). Always pick unless:
  //   event WL < EVENT_CARD_WL_MIN AND normal card WL > EVENT_NORMAL_WL_OVERRIDE
  EVENT_CARD_WL_MIN: 100,           // Min WL for event card auto-pick
  EVENT_NORMAL_WL_OVERRIDE: 1000,   // Normal card WL must exceed this to beat low-WL event card

  // ─── Event Item Settings ──────────────────────────────────────────────────────
  // Special event items (onigiri, shells, roses) appear as buttons with event emoji.
  // Claiming these does NOT consume grab cooldown — always claim them.
  // Change these names each event season.
  EVENT_ITEM_NAMES: ['onigiri'],
  EVENT_ITEM_EMOJIS: ['🍙'],

  // ─── Drop Cycle ───────────────────────────────────────────────────────────────
  DROP_COOLDOWN_MS: 8 * 60 * 1000,      // 8 minutes base (Sofi's cooldown)
  DROP_JITTER_MIN_MS: 0,                // Min normal jitter after base cooldown
  DROP_JITTER_MAX_MS: 1 * 60 * 1000,    // Max normal jitter (1 min)
  DROP_LATE_JITTER_MAX_MS: 5 * 60 * 1000, // Max "late" jitter (5 min) — simulates being distracted
  DROP_LATE_CHANCE: 0.12,               // 12% chance of a late drop
  DROP_RESPONSE_TIMEOUT_MS: 15 * 1000,  // Wait up to 15s for Sofi to respond
  GRAB_COOLDOWN_MS: 4 * 60 * 1000,      // 4 minutes between grabs

  // ─── Human Simulation ─────────────────────────────────────────────────────────
  MIN_REACTION_DELAY_MS: 4000,     // Min delay before clicking claim (4s)
  MAX_REACTION_DELAY_MS: 18000,    // Max delay before clicking claim (18s)
  LATE_MIN_REACTION_MS: 8000,      // Slower at night: min 8s
  LATE_MAX_REACTION_MS: 30000,     // Slower at night: max 30s
  EVENT_ITEM_DELAY_MIN_MS: 1000,   // Min delay before clicking event item (1s)
  EVENT_ITEM_DELAY_MAX_MS: 3000,   // Max delay before clicking event item (3s)

  // ─── Sleep Window (IST = UTC+5:30) ────────────────────────────────────────────
  // Bot only sleeps during this window. Runs 24/7 otherwise with breaks.
  SLEEP_START_HOUR_IST: 2,        // Sleep starts at 2am IST
  SLEEP_END_HOUR_IST: 5,          // Sleep ends at 5am IST
  SLEEP_JITTER_MIN: 20,           // ±20 min jitter on sleep start/end

  // ─── AFK / Break Simulation ───────────────────────────────────────────────────
  AFK_MIN_COUNT: 2,                      // Min AFK breaks per day
  AFK_MAX_COUNT: 3,                      // Max AFK breaks per day
  AFK_MIN_DURATION_MS: 20 * 60 * 1000,  // Min AFK duration: 20 min
  AFK_MAX_DURATION_MS: 40 * 60 * 1000,  // Max AFK duration: 40 min
  LUNCH_START_HOUR_IST: 12,             // Lunch break window start: 12pm IST
  LUNCH_END_HOUR_IST: 14,               // Lunch break window end: 2pm IST
  LUNCH_DURATION_MIN_MS: 30 * 60 * 1000, // Lunch min: 30 min
  LUNCH_DURATION_MAX_MS: 75 * 60 * 1000, // Lunch max: 75 min

  // ─── Late Night Mode (IST) ────────────────────────────────────────────────────
  LATE_NIGHT_START_HOUR_IST: 23,  // After 11pm IST = late night mode (slower delays)

  // ─── Extra Commands ───────────────────────────────────────────────────────────
  // scd (show cooldown) — run randomly throughout the day for human activity
  SCD_DAILY_COUNT_MIN: 10,         // Min scd commands per day
  SCD_DAILY_COUNT_MAX: 12,         // Max scd commands per day

  // sdaily — run every ~24 hours
  SDAILY_INTERVAL_MS: 24 * 60 * 60 * 1000,   // 24 hours base
  SDAILY_JITTER_MS: 2 * 60 * 60 * 1000,      // 0-2 hours extra delay after base interval
};

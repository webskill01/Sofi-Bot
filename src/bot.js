require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');

const config = require('../config');
const logger = require('./logger');
const { isSofiDropMessage, parseDropMessage, parseEventItems, parseCooldownMessage } = require('./parser');
const { selectCard, logDecision } = require('./claimDecision');
const scheduler = require('./scheduler');
const {
  sleep,
  waitReactionDelay,
  getDropInterval,
  simulateTyping,
  isLateNight,
  randInt,
} = require('./humanSim');

// -- Validate required env vars -----------------------------------------------
if (!config.TOKEN) {
  logger.error('TOKEN is not set in .env — cannot start');
  process.exit(1);
}
if (!config.CHANNELS || config.CHANNELS.length === 0) {
  logger.error('No CHANNELS configured in config/index.js — cannot start');
  process.exit(1);
}

// -- Bot state ----------------------------------------------------------------
const client = new Client({ checkUpdate: false });

let isRunning = false;
let pendingDropMsgId = null;
let lastGrabTime = 0;
let waitingForDrop = false;
let pendingDropResult = null;

// Extra command tracking
let scdTimesToday = [];       // Planned timestamps for scd commands today
let lastSdailyTime = 0;      // Timestamp of last sdaily command
let lastScdPlanDate = null;   // Date string of last scd plan

// -- Channel session state ----------------------------------------------------
let activeChannelId = null;     // Currently active channel ID
let channelDropsRemaining = 0;  // Drops left in current channel session

/**
 * Rotate to a new channel (different from the current one if possible).
 * Resets the session drop counter.
 */
function rotateChannel() {
  const channels = config.CHANNELS;
  if (channels.length === 1) {
    activeChannelId = channels[0];
  } else {
    const others = channels.filter(id => id !== activeChannelId);
    activeChannelId = others[Math.floor(Math.random() * others.length)];
  }
  channelDropsRemaining = randInt(config.CHANNEL_SESSION_MIN, config.CHANNEL_SESSION_MAX);
  logger.info(`Channel session: ${activeChannelId} — ${channelDropsRemaining} drops`);
}

// -- Utility ------------------------------------------------------------------

function pickDropCommand() {
  return Math.random() < 0.5 ? 'sdrop' : 'sd';
}

function getChannel() {
  if (!activeChannelId) rotateChannel();
  const ch = client.channels.cache.get(activeChannelId);
  if (!ch) throw new Error(`Channel ${activeChannelId} not found in cache`);
  return ch;
}

function canGrab() {
  return Date.now() - lastGrabTime >= config.GRAB_COOLDOWN_MS;
}

// -- Extra commands -----------------------------------------------------------

/**
 * Plan scd command times for today.
 * Spreads 10-12 commands randomly across waking hours (5am-2am IST).
 */
function planScdTimes() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const dateStr = now.toISOString().slice(0, 10);

  if (dateStr === lastScdPlanDate) return; // Already planned for today
  lastScdPlanDate = dateStr;

  const count = randInt(config.SCD_DAILY_COUNT_MIN, config.SCD_DAILY_COUNT_MAX);
  const times = [];

  // Spread across waking hours: 5am (300min) to 1:30am next day (1530min)
  const wakeStartMin = config.SLEEP_END_HOUR_IST * 60;
  const wakeEndMin = 24 * 60; // midnight
  const rangeMs = (wakeEndMin - wakeStartMin) * 60 * 1000;

  const todayStartMs = Date.now();
  const istNow = now.getUTCHours() * 60 + now.getUTCMinutes();

  for (let i = 0; i < count; i++) {
    // Random time within waking hours
    const offsetMin = randInt(0, wakeEndMin - wakeStartMin);
    const targetMin = wakeStartMin + offsetMin;

    // Convert to timestamp: minutes from now
    let diffMin = targetMin - istNow;
    if (diffMin < 0) diffMin += 24 * 60; // Wrap to next occurrence

    const targetMs = todayStartMs + diffMin * 60 * 1000 + randInt(0, 59000);
    times.push(targetMs);
  }

  times.sort((a, b) => a - b);
  scdTimesToday = times;
  logger.info(`Planned ${count} scd commands for today`);
}

/**
 * Check and run any pending scd commands.
 */
async function checkScdCommands() {
  planScdTimes();

  const now = Date.now();
  while (scdTimesToday.length > 0 && scdTimesToday[0] <= now) {
    scdTimesToday.shift();

    try {
      const channel = getChannel();
      await simulateTyping('scd');
      await channel.send('scd');
      logger.info(`Sent scd command (${scdTimesToday.length} remaining today)`);
      await sleep(randInt(2000, 5000));
    } catch (err) {
      logger.error(`Failed to send scd: ${err.message}`);
    }
  }
}

/**
 * Check and run sdaily if it's due (every ~24 hours).
 */
async function checkSdaily() {
  const now = Date.now();

  if (lastSdailyTime === 0) {
    // First run — set it so we run sdaily soon (within 5-30 min)
    lastSdailyTime = now - config.SDAILY_INTERVAL_MS + randInt(5 * 60 * 1000, 30 * 60 * 1000);
  }

  const interval = config.SDAILY_INTERVAL_MS + randInt(0, config.SDAILY_JITTER_MS);

  if (now - lastSdailyTime >= interval) {
    try {
      const channel = getChannel();
      await simulateTyping('sdaily');
      await channel.send('sdaily');
      lastSdailyTime = now;
      logger.info('Sent sdaily command');
      await sleep(randInt(3000, 8000));
    } catch (err) {
      logger.error(`Failed to send sdaily: ${err.message}`);
    }
  }
}

// -- Drop routine -------------------------------------------------------------

/**
 * Send the drop command and wait for Sofi's drop message.
 */
async function triggerDrop() {
  const channel = getChannel();
  const command = pickDropCommand();

  logger.info(`Sending drop command: ${command}`);
  await simulateTyping(command);

  let ourMsg;
  try {
    ourMsg = await channel.send(command);
    pendingDropMsgId = ourMsg.id;
  } catch (err) {
    logger.error(`Failed to send ${command}: ${err.message}`);
    pendingDropMsgId = null;
    return null;
  }

  // Wait up to DROP_RESPONSE_TIMEOUT_MS for Sofi to respond
  const deadline = Date.now() + config.DROP_RESPONSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(500);
    if (pendingDropResult !== null) {
      const result = pendingDropResult;
      pendingDropResult = null;
      // Decrement channel session counter; rotate when exhausted
      channelDropsRemaining--;
      if (channelDropsRemaining <= 0) rotateChannel();
      return result;
    }
  }

  logger.warn('Sofi did not respond to drop command within timeout');
  pendingDropMsgId = null;

  // Still count this as a drop attempt for channel session tracking
  channelDropsRemaining--;
  if (channelDropsRemaining <= 0) rotateChannel();

  return null;
}

// -- Claim routine ------------------------------------------------------------

/**
 * Parse, decide, and claim a card from a Sofi drop message.
 * Handles dual claim: event item (free) + regular card.
 */
async function handleDrop(dropMsg) {
  const cards = parseDropMessage(dropMsg);

  if (cards.length === 0) {
    logger.warn('Parsed 0 cards from drop message — format may have changed');
    logger.debug(`Message ID: ${dropMsg.id}`);
    logger.debug(`Content: ${(dropMsg.content || '').substring(0, 500)}`);
    logger.debug(`Components: ${JSON.stringify(dropMsg.components.map(r => r.components?.map(b => b.label)))}`);
    return;
  }

  // -- Step 1: Click event item buttons (free, no grab cooldown) --------------
  const eventItems = parseEventItems(dropMsg);
  if (eventItems.length > 0) {
    logger.info(`Found ${eventItems.length} event item(s) — claiming first`);

    for (const item of eventItems) {
      const delay = randInt(config.EVENT_ITEM_DELAY_MIN_MS, config.EVENT_ITEM_DELAY_MAX_MS);
      logger.debug(`Event item delay: ${(delay / 1000).toFixed(1)}s`);
      await sleep(delay);

      if (config.DRY_RUN) {
        logger.info(`[DRY RUN] Would click event item button ${item.buttonIndex} (label: "${item.label}")`);
        continue;
      }

      try {
        const row = dropMsg.components[0];
        const button = row?.components[item.buttonIndex];
        if (button) {
          if (item.customId) {
            await dropMsg.clickButton(item.customId);
          } else {
            await dropMsg.clickButton(item.buttonIndex);
          }
          logger.info(`Claimed event item at button ${item.buttonIndex} (label: "${item.label}")`);
        }
      } catch (err) {
        logger.error(`Failed to click event item button: ${err.message}`);
      }
    }

    // Small pause between event item claim and regular card claim
    await sleep(randInt(1000, 3000));
  }

  // -- Step 2: Select and claim a regular card --------------------------------
  const lateNight = isLateNight();
  const decision = selectCard(cards);
  logDecision(cards, decision);

  if (!decision.card) {
    logger.info('No card claimed this drop.');
    return;
  }

  // Check grab cooldown
  if (!canGrab()) {
    const waitMs = config.GRAB_COOLDOWN_MS - (Date.now() - lastGrabTime);
    logger.warn(`Grab cooldown active — waiting ${Math.round(waitMs / 1000)}s before claiming`);
    await sleep(waitMs + randInt(2000, 5000));
  }

  // Human-like delay before clicking
  await waitReactionDelay(lateNight);

  // Log button details for debugging
  if (dropMsg.components && dropMsg.components.length > 0) {
    const row = dropMsg.components[0];
    const btns = row.components || [];
    logger.debug(`Button details: ${JSON.stringify(btns.map((b, i) => ({
      idx: i, label: b.label, customId: b.customId, type: b.type, style: b.style
    })))}`);
  }

  if (config.DRY_RUN) {
    const genStr = decision.card.isEventCard ? 'EVENT' : decision.card.gen;
    logger.info(`[DRY RUN] Would click button for "${decision.card.name}" (Gen:${genStr} WL:${decision.card.wishlist})`);
    return;
  }

  // Click the claim button
  try {
    const targetRow = dropMsg.components[0];
    let button;

    // Try to find button by customId first
    if (decision.card.customId) {
      button = targetRow?.components.find(b => b.customId === decision.card.customId);
    }

    // Fallback to index
    if (!button && decision.card.buttonIndex !== null) {
      button = targetRow?.components[decision.card.buttonIndex];
    }

    if (!button) {
      logger.error(`Button not found for card "${decision.card.name}"`);
      return;
    }

    if (button.customId) {
      await dropMsg.clickButton(button.customId);
    } else {
      const idx = targetRow.components.indexOf(button);
      await dropMsg.clickButton(idx);
    }

    lastGrabTime = Date.now();
    const genStr = decision.card.isEventCard ? 'EVENT' : decision.card.gen;
    logger.info(`Claimed "${decision.card.name}" (Gen:${genStr} WL:${decision.card.wishlist})`);
  } catch (err) {
    logger.error(`Failed to click claim button: ${err.message}`);
    logger.debug(`Error stack: ${err.stack}`);
  }
}

// -- Message event ------------------------------------------------------------

client.on('messageCreate', async (message) => {
  if (message.author.id !== config.SOFI_BOT_ID) return;
  if (message.channelId !== activeChannelId) return;

  // Check if Sofi is telling us there's a cooldown
  const cooldown = parseCooldownMessage(message, config.SOFI_BOT_ID);
  if (cooldown.onCooldown) {
    logger.warn(`Sofi cooldown detected — waiting ${Math.round(cooldown.remainingMs / 1000)}s`);
    await sleep(cooldown.remainingMs);
    return;
  }

  // Only accept drop messages while we're waiting for our own drop
  if (!waitingForDrop) return;

  if (isSofiDropMessage(message, config.SOFI_BOT_ID)) {
    logger.debug(`Received Sofi drop message: ${message.id}`);
    pendingDropResult = message;
    waitingForDrop = false;
  }
});

// Also handle message edits — Sofi sometimes adds buttons on edit
client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (!newMsg || newMsg.author?.id !== config.SOFI_BOT_ID) return;
  if (newMsg.channelId !== activeChannelId) return;
  if (!waitingForDrop) return;

  const hadButtons = oldMsg.components && oldMsg.components.length > 0;
  const hasButtons = newMsg.components && newMsg.components.length > 0;

  if (!hadButtons && hasButtons && isSofiDropMessage(newMsg, config.SOFI_BOT_ID)) {
    logger.debug(`Received Sofi drop (via message update): ${newMsg.id}`);
    pendingDropResult = newMsg;
    waitingForDrop = false;
  }
});

// -- Main loop ----------------------------------------------------------------

async function mainLoop() {
  isRunning = true;
  logger.info('Main loop started');

  while (isRunning) {
    // Check sleep window (2am-5am IST)
    const slept = await scheduler.waitForSleepEnd();
    if (slept) {
      logger.info('Woke up from sleep window');
      continue;
    }

    // Check AFK breaks
    if (!scheduler.isActive()) {
      const afkSlept = await scheduler.handleAfkBreak();
      if (afkSlept) {
        logger.info('Returned from AFK break');
        continue;
      }
      // If not active for some other reason, wait a bit
      logger.debug(`Scheduler status: ${scheduler.getStatus()}`);
      await sleep(30000);
      continue;
    }

    logger.debug(`Scheduler status: ${scheduler.getStatus()}`);

    // Run extra commands if due
    await checkScdCommands();
    await checkSdaily();

    // Trigger a drop
    waitingForDrop = true;
    const dropMsg = await triggerDrop();
    waitingForDrop = false;

    if (dropMsg) {
      await handleDrop(dropMsg);
    } else {
      logger.warn('No drop message received — will retry next cycle');
    }

    // Wait for next drop cycle (8 min +/- jitter)
    const nextInterval = getDropInterval();
    logger.info(`Next drop in ${Math.round(nextInterval / 1000)}s`);
    await sleep(nextInterval);
  }
}

// -- Client events ------------------------------------------------------------

client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag} (${client.user.id})`);
  logger.info(`Sofi bot ID: ${config.SOFI_BOT_ID}`);
  logger.info(`Dry run mode: ${config.DRY_RUN}`);
  logger.info(`Configured channels: ${config.CHANNELS.length}`);

  // Validate all configured channels are accessible
  let anyValid = false;
  for (const id of config.CHANNELS) {
    const ch = client.channels.cache.get(id);
    if (!ch) {
      logger.warn(`Channel ${id} not found in cache — bot may not be in that server`);
    } else {
      logger.info(`Channel ready: ${id} (#${ch.name || ch.id})`);
      anyValid = true;
    }
  }
  if (!anyValid) {
    logger.error('None of the configured channels are accessible — check CHANNELS in config/index.js');
    process.exit(1);
  }

  // Pick the first channel session
  rotateChannel();

  mainLoop().catch(err => {
    logger.error(`Main loop crashed: ${err.message}`, err);
    process.exit(1);
  });
});

client.on('error', (err) => {
  logger.error(`Discord client error: ${err.message}`);
});

client.on('disconnect', () => {
  logger.warn('Disconnected from Discord');
});

// -- Graceful shutdown --------------------------------------------------------

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down gracefully');
  isRunning = false;
  await client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  isRunning = false;
  await client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err?.message || err}`);
});

// -- Start --------------------------------------------------------------------

logger.info('Starting Sofi Auto-Claim Bot...');
client.login(config.TOKEN);

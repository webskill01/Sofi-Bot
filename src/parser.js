const config = require('../config');
const logger = require('./logger');

/**
 * Parses a Sofi drop message.
 *
 * Real Sofi format (confirmed from live testing):
 *
 *   Normal drop content:
 *     @User is dropping cards
 *     `1.` :emoji: | G•`1486` | Zoe Powell • S.W.A.T
 *     `2.` :emoji: | G•`635 ` | Elite Barbarian • Clash Royale
 *     `3.` :emoji: | G•`1323` | Star Platinum • JoJo's Bizarre Adventure
 *
 *   Event drop content (event card has empty gen):
 *     `1.` :emoji: | G•`    ` | Ushio Kofune • Summertime Rendering  ← EVENT CARD
 *     `2.` :emoji: | G•`729 ` | Hebdar • Devils and Realist
 *     `3.` :emoji: | G•`825 ` | Yulejacket • Fortnite
 *
 *   Normal buttons: [dropheart "0", dropheart "2", dropheart "82", "Join Sofi Cafe"]
 *   Event buttons:  [🍙 "80", dropheart "0", dropheart "4"]
 *
 * Gen comes from message content (G•{number}).
 * Wishlist comes from button labels (plain numbers).
 * Event items use non-dropheart emoji (🍙/🐚/🌹) — free claim.
 */

// Regex to extract card lines from message content
// Matches: `1.` <anything> | G•`1486` | Card Name • Series Name
// Also matches event cards with empty gen: G•`    `
const CARD_LINE_PATTERN = /`(\d+)\.\`?\s*.*?\|\s*G\s*[•·]\s*`([^`]*)`\s*\|\s*(.+)/g;

// Fallback: looser pattern
const CARD_LINE_FALLBACK = /G\s*[•·]\s*`([^`]*)`\s*\|\s*(.+)/g;

/**
 * Check if a message is a Sofi drop message.
 */
function isSofiDropMessage(message, sofiBotId) {
  if (message.author.id !== sofiBotId) return false;
  if (!message.components || message.components.length === 0) return false;

  const content = (message.content || '').toLowerCase();
  if (content.includes('dropping')) return true;
  if (/g\s*[•·]\s*`/i.test(message.content || '')) return true;

  logger.debug('Sofi message has buttons but no drop keywords in content');
  return false;
}

/**
 * Check if a button is an event item (onigiri, shells, roses, etc).
 * Event item buttons use special emoji instead of "dropheart".
 *
 * @param {Object} button - discord.js button component
 * @returns {boolean}
 */
function isEventItemButton(button) {
  if (!button) return false;
  // discord.js-selfbot-v13 may report type as 'BUTTON' (string) or 2 (number)
  if (button.type !== 'BUTTON' && button.type !== 2) return false;
  if (button.style === 'LINK' || button.style === 5) return false;

  // Check emoji — event items have non-dropheart emoji
  const emoji = button.emoji;
  if (!emoji) return false;

  const emojiName = (emoji.name || '').toLowerCase();
  if (emojiName === 'dropheart') return false;

  // Label can be numeric (e.g. "80") or null/empty for event items like onigiri
  // The key identifier is the emoji, not the label

  // Check against configured event item unicode emojis (e.g. rice_ball -> 🍙)
  const emojiChar = emoji.name || '';
  if (config.EVENT_ITEM_EMOJIS.includes(emojiChar)) return true;

  // Check against configured event item names
  const isKnownItem = config.EVENT_ITEM_NAMES.some(
    name => emojiName.includes(name.toLowerCase())
  );
  if (isKnownItem) return true;

  // Check common unicode emoji names used by Discord (e.g. "rice_ball" for 🍙)
  const unicodeNames = ['rice_ball', 'shell', 'rose', 'cherry_blossom', 'candy', 'star'];
  if (unicodeNames.some(n => emojiName.includes(n))) return true;

  // If it has a custom emoji that's not dropheart, likely an event item
  if (emoji.id && emojiName !== 'dropheart') {
    logger.debug(`Unknown non-dropheart button emoji: "${emojiName}" (id: ${emoji.id}) — treating as event item`);
    return true;
  }

  return false;
}

/**
 * Extract event item buttons from a Sofi drop message.
 * These are free claims that don't consume grab cooldown.
 *
 * @param {import('discord.js-selfbot-v13').Message} message
 * @returns {Array<{ buttonIndex, customId, label }>}
 */
function parseEventItems(message) {
  const items = [];

  for (const row of message.components) {
    const components = row.components || [];
    for (let i = 0; i < components.length; i++) {
      const button = components[i];
      if (isEventItemButton(button)) {
        items.push({
          buttonIndex: i,
          customId: button.customId || null,
          label: button.label || '',
        });
        logger.debug(`Found event item button at index ${i}: "${button.label}" (emoji: ${button.emoji?.name})`);
      }
    }
  }

  return items;
}

/**
 * Extract all card data from a Sofi drop message.
 *
 * @param {import('discord.js-selfbot-v13').Message} message
 * @returns {Array<{ buttonIndex, customId, name, series, gen, wishlist, isEventCard }>}
 */
function parseDropMessage(message) {
  const content = message.content || '';
  const cards = [];

  // ── Step 1: Extract gen + card name from message content ───────────────
  const cardLines = [];
  CARD_LINE_PATTERN.lastIndex = 0;
  let match;

  while ((match = CARD_LINE_PATTERN.exec(content)) !== null) {
    const index = parseInt(match[1], 10) - 1;
    const genStr = match[2].trim(); // May be empty for event cards
    const gen = genStr === '' ? null : parseInt(genStr, 10);
    const nameAndSeries = match[3].trim();
    const parts = nameAndSeries.split(/\s*•\s*/);
    const name = parts[0]?.trim() || `Card ${index + 1}`;
    const series = parts[1]?.trim() || '';

    cardLines.push({
      index,
      gen: (gen !== null && !isNaN(gen)) ? gen : null,
      name,
      series,
      isEventCard: gen === null || isNaN(gen),
    });
  }

  // Fallback pattern
  if (cardLines.length === 0) {
    CARD_LINE_FALLBACK.lastIndex = 0;
    let fallbackIdx = 0;
    while ((match = CARD_LINE_FALLBACK.exec(content)) !== null) {
      const genStr = match[1].trim();
      const gen = genStr === '' ? null : parseInt(genStr, 10);
      const nameAndSeries = match[2].trim();
      const parts = nameAndSeries.split(/\s*•\s*/);
      const name = parts[0]?.trim() || `Card ${fallbackIdx + 1}`;
      const series = parts[1]?.trim() || '';

      cardLines.push({
        index: fallbackIdx,
        gen: (gen !== null && !isNaN(gen)) ? gen : null,
        name,
        series,
        isEventCard: gen === null || isNaN(gen),
      });
      fallbackIdx++;
    }
  }

  if (cardLines.length === 0) {
    logger.debug('Could not parse any card lines from message content');
    logger.debug(`Content: ${content.substring(0, 300)}`);
    return [];
  }

  // ── Step 2: Extract wishlist counts from non-event-item buttons ────────
  // Sofi uses abbreviated labels: "0", "82", "2.7K", "1.2K", etc.
  const parseWL = (label) => {
    if (!label) return null;
    const s = label.trim().toUpperCase();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const kMatch = s.match(/^(\d+(?:\.\d+)?)K$/);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    return null;
  };

  const wishlistValues = [];
  for (const row of message.components) {
    const components = row.components || [];
    for (const button of components) {
      // Skip event item buttons (they're handled separately)
      if (isEventItemButton(button)) continue;

      const wl = parseWL(button.label);
      if (wl !== null) {
        wishlistValues.push({
          wishlist: wl,
          customId: button.customId || null,
        });
      }
    }
  }

  // ── Step 3: Combine card lines with wishlist values ────────────────────
  // Event cards may not have a corresponding dropheart button (their button is the event item)
  // Normal cards get WL from dropheart buttons in order
  let wlIdx = 0;
  for (let i = 0; i < cardLines.length; i++) {
    const line = cardLines[i];

    if (line.isEventCard) {
      // Event card WL comes from the event item button label
      const eventItems = parseEventItems(message);
      const eventWL = eventItems.length > 0 ? (parseWL(eventItems[0].label) ?? 0) : 0;
      const eventCustomId = eventItems.length > 0 ? eventItems[0].customId : null;

      cards.push({
        buttonIndex: eventItems.length > 0 ? eventItems[0].buttonIndex : i,
        customId: eventCustomId,
        name: line.name,
        series: line.series,
        gen: null,
        wishlist: eventWL,
        isEventCard: true,
      });
    } else {
      // Normal card — get WL from next dropheart button
      const wlData = wishlistValues[wlIdx] || { wishlist: 0, customId: null };
      wlIdx++;

      cards.push({
        buttonIndex: wlData.customId ? null : i, // Will use customId for clicking
        customId: wlData.customId,
        name: line.name,
        series: line.series,
        gen: line.gen,
        wishlist: wlData.wishlist,
        isEventCard: false,
      });
    }
  }

  if (cards.length > 0) {
    logger.debug(`Parsed ${cards.length} card(s) from drop message ${message.id}`);
    cards.forEach((c, i) => {
      const genStr = c.isEventCard ? 'EVENT' : c.gen;
      logger.debug(`  Card ${i + 1}: "${c.name}" (${c.series}) | Gen: ${genStr} | WL: ${c.wishlist} | Event: ${c.isEventCard}`);
    });
  }

  return cards;
}

/**
 * Check if a message is Sofi telling us the sdrop is on cooldown.
 */
function parseCooldownMessage(message, sofiBotId) {
  if (message.author.id !== sofiBotId) return { onCooldown: false, remainingMs: 0 };

  const text = [
    message.content || '',
    ...(message.embeds || []).map(e => `${e.title || ''} ${e.description || ''}`),
  ].join(' ').toLowerCase();

  if (!text.includes('cooldown') && !text.includes('wait') && !text.includes('minute')) {
    return { onCooldown: false, remainingMs: 0 };
  }

  const minuteMatch = text.match(/(\d+)\s*(?:min|minute)/i);
  const secMatch = text.match(/(\d+)\s*(?:sec|second)/i);
  const mmssMatch = text.match(/(\d+):(\d{2})/);

  let remainingMs = 0;
  if (mmssMatch) {
    remainingMs = (parseInt(mmssMatch[1]) * 60 + parseInt(mmssMatch[2])) * 1000;
  } else {
    if (minuteMatch) remainingMs += parseInt(minuteMatch[1]) * 60 * 1000;
    if (secMatch) remainingMs += parseInt(secMatch[1]) * 1000;
  }

  remainingMs += 5000;
  return { onCooldown: true, remainingMs };
}

module.exports = { isSofiDropMessage, parseDropMessage, parseEventItems, parseCooldownMessage };

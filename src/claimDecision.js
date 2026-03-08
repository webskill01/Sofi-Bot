const config = require('../config');
const logger = require('./logger');

/**
 * Decision engine for which card to claim from a Sofi drop.
 *
 * Priority (highest to lowest):
 *
 *  P0 — Super Ultra Gen (gen ≤ 10)
 *       Absolute rarest. ALWAYS pick.
 *
 *  P1 — Event Card (no gen)
 *       Always pick event cards. Exception: if event WL < EVENT_CARD_WL_MIN
 *       AND a normal card has WL > EVENT_NORMAL_WL_OVERRIDE, pick the normal.
 *
 *  P2 — Ultra Low Gen (gen ≤ 100 AND WL > 500)
 *       Very rare + popular. Pick it.
 *       Exception: if another card has WL ≥ 2500, pick that instead.
 *
 *  P3 — Highest Wishlist (always)
 *       Base rule. Pick the card with the highest wishlist count.
 *
 *  P4 — Random (all WL = 0)
 *       If all cards have 0 wishlist, pick a random one.
 *
 * NEVER skip — always claim a card from every drop.
 */

function lowestGen(cards) {
  return cards.reduce((best, c) => (c.gen < best.gen ? c : best));
}

function highestWishlist(cards) {
  return cards.reduce((best, c) => (c.wishlist > best.wishlist ? c : best));
}

function randomCard(cards) {
  return cards[Math.floor(Math.random() * cards.length)];
}

/**
 * Select which card to claim from a drop.
 *
 * @param {Array<{ buttonIndex, name, gen, wishlist, isEventCard }>} cards
 * @returns {{ card: Object, reason: string }}
 */
function selectCard(cards) {
  if (!cards || cards.length === 0) {
    return { card: null, reason: 'no cards parsed' };
  }

  const normalCards = cards.filter(c => !c.isEventCard && c.gen !== null);
  const eventCards = cards.filter(c => c.isEventCard);

  // ── P0: Super Ultra Gen (gen ≤ 10) — absolute rarest ──────────────────
  const superUltra = normalCards.filter(c => c.gen <= config.GEN_SUPER_ULTRA);
  if (superUltra.length > 0) {
    const pick = lowestGen(superUltra);
    return { card: pick, reason: `P0 super-ultra gen (gen=${pick.gen}, WL=${pick.wishlist})` };
  }

  // ── P1: Event Card — always pick unless low WL + high normal WL ───────
  if (eventCards.length > 0) {
    const eventCard = highestWishlist(eventCards);
    const bestNormalWL = normalCards.length > 0 ? highestWishlist(normalCards) : null;

    if (
      eventCard.wishlist < config.EVENT_CARD_WL_MIN &&
      bestNormalWL &&
      bestNormalWL.wishlist > config.EVENT_NORMAL_WL_OVERRIDE
    ) {
      return {
        card: bestNormalWL,
        reason: `P1 normal over event (event WL=${eventCard.wishlist} < ${config.EVENT_CARD_WL_MIN}, normal WL=${bestNormalWL.wishlist})`,
      };
    }

    return { card: eventCard, reason: `P1 event card (WL=${eventCard.wishlist})` };
  }

  // ── P2: Ultra Low Gen (gen ≤ 100 AND WL > 500) ────────────────────────
  const ultraLowGen = normalCards.filter(
    c => c.gen <= config.GEN_ULTRA_LOW && c.wishlist > config.GEN_ULTRA_WL_MIN
  );
  if (ultraLowGen.length > 0) {
    // Exception: if another card has WL ≥ 2500, pick the high WL card
    const veryHighWL = normalCards.filter(c => c.wishlist >= config.WL_OVERRIDE_THRESHOLD);
    if (veryHighWL.length > 0) {
      const pick = highestWishlist(veryHighWL);
      return {
        card: pick,
        reason: `P2 WL override (WL=${pick.wishlist} ≥ ${config.WL_OVERRIDE_THRESHOLD}, beating gen ≤ ${config.GEN_ULTRA_LOW})`,
      };
    }

    const pick = lowestGen(ultraLowGen);
    return { card: pick, reason: `P2 ultra-low gen (gen=${pick.gen}, WL=${pick.wishlist})` };
  }

  // ── P3: Highest Wishlist — base rule ───────────────────────────────────
  const best = highestWishlist(cards);
  if (best.wishlist > 0) {
    const genStr = best.isEventCard ? 'EVENT' : best.gen;
    return { card: best, reason: `P3 highest wishlist (gen=${genStr}, WL=${best.wishlist})` };
  }

  // ── P4: All WL = 0 — pick random ──────────────────────────────────────
  const pick = randomCard(cards);
  const genStr = pick.isEventCard ? 'EVENT' : pick.gen;
  return { card: pick, reason: `P4 random pick — all WL=0 (gen=${genStr})` };
}

/**
 * Log the decision summary.
 */
function logDecision(cards, decision) {
  const cardSummary = cards
    .map((c, i) => {
      const genStr = c.isEventCard ? 'EVT' : c.gen;
      return `[${i + 1}] "${c.name}" Gen:${genStr} WL:${c.wishlist}`;
    })
    .join(' | ');

  if (decision.card) {
    logger.info(`CLAIM → "${decision.card.name}" | ${decision.reason} | Drop: ${cardSummary}`);
  } else {
    logger.info(`SKIP  → ${decision.reason} | Drop: ${cardSummary}`);
  }
}

module.exports = { selectCard, logDecision };

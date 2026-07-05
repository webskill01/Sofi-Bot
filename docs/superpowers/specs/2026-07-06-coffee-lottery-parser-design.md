# Sofi Bot — Coffee Lottery Auto-Entry, Coffee Tracking & Parser Correctness

## Goal
Auto-enter Sofi's hourly event lottery when affordable, tracking coffee currency without spamming `si`. Fix the event-item vs event-card ambiguity that coffee drops expose. Add a gen tie-break. Ship without regressing the working bot.

## Parser correctness
Distinguish by button label: an event-emoji button with **no numeric label** is a **free item**; with a **number** it is an **event card** (number = wishlist). Map each drop line `N.` to button index `N-1`. Lines with `G•` are cards (empty gen = event card); lines with an event emoji + name but no `G•` are free items. Event-card WL comes from its own button, not the first event-item button.

## Grab order (behavior unchanged)
Free items first (free, grab stays available), then one card via the existing P0–P4 engine. Event cards remain P1. Priority rules untouched — only the data feeding them is corrected.

## Coffee tracking
A persisted `coffeeBalance` estimate that survives the daily state reset. `+N` per free-item grab reply ("…X Coffee"). `−LOTTERY_COST` per entry. Reconcile against the real value via `si → Event category` only at startup and every ~8h (jittered) — never before every entry. If Sofi rejects an entry for insufficient coffee, snap the estimate down, skip, reconcile next chance. Sofi is the final judge, so drift never causes waste.

## Lottery auto-entry
Send `sev` on a human cadence (see below). Parse `Lottery [#N] ( entries ) | Ends <t:unix:R>` and cost. Enter when `N ≠ lastEnteredRound` AND `coffeeBalance ≥ cost` (no reserve buffer). Click the Lottery button, read reply for success/fail, update balance and `lastEnteredRound` (persisted across days). Never double-enter; skip if a round has under ~2 min left.

## Human cadence (not just jitter)
The `sev` check obeys the existing human model, not a rigid timer: never fires during sleep window, AFK, or lunch; Gaussian-distributed spacing around ~1h, wider and slower at night; a small chance to skip a round entirely (human forgetfulness); variable reaction delay before clicking. Reuses `scheduler`/`humanSim`, adding no parallel scheduling logic.

## Tie-break
`highestWishlist` ties prefer lower gen. P4 (all WL 0) picks the lowest-gen card instead of random.

## Config (config/index.js)
`LOTTERY_ENABLED` master switch, `LOTTERY_COST` (10), `SEV_INTERVAL_MS` (~1h) + `SEV_JITTER_MS` (~30m), `LOTTERY_SKIP_CHANCE`, `COFFEE_RECONCILE_MS` (~8h). Sane defaults; one switch disables.

## Testing & safety
Every real drop layout provided (shells-style, onigiri, coffee free-item, coffee event-card, mixed 4-line) becomes a parser test. New parser must produce identical grabs on already-working cases, correct grabs on coffee cases; any regression on a working case blocks the change. Unknown replies fall back to skip + log — never spam-click.

## Open verifications (implementation time)
Exact `si → Event` string-select interaction, and the lottery success vs "not enough coffee" reply wording. Both confirmed against live Sofi before trusting; safe fallback if they differ.

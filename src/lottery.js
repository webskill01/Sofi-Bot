/**
 * Pure decision: should we enter this lottery round right now?
 * @returns {{enter:boolean, reason:string}}
 */
function shouldEnterLottery({ info, lastEnteredRound, coffeeBalance, nowMs, cfg }) {
  if (!info) return { enter: false, reason: 'no lottery info parsed' };
  if (info.round === lastEnteredRound) return { enter: false, reason: `already entered round #${info.round}` };
  const cost = info.cost || cfg.LOTTERY_COST;
  if (coffeeBalance < cost) return { enter: false, reason: `insufficient coffee (${coffeeBalance} < ${cost})` };
  const secsLeft = (info.endsAt - nowMs) / 1000;
  if (secsLeft < cfg.LOTTERY_MIN_SECONDS_LEFT) return { enter: false, reason: `round #${info.round} ends in ${Math.round(secsLeft)}s` };
  return { enter: true, reason: `enter round #${info.round} (${coffeeBalance} coffee, ${Math.round(secsLeft)}s left)` };
}

module.exports = { shouldEnterLottery };

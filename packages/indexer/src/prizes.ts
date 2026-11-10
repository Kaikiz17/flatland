import { isPrizeRulesConfigured, PRIZE_KIND_LUCKY } from '@flatland/core';

export { isPrizeRulesConfigured, PRIZE_KIND_LUCKY };

/** Pure planner: which lucky slots are due a payLucky call right now. No-op when PrizeRules is unset. */
export function planLuckyPayouts(input: {
  prizeRules?: string | null;
  lucky: { position: bigint; claimed: boolean }[];
  voterCount: bigint;
}): number[] {
  if (!isPrizeRulesConfigured(input.prizeRules)) return [];
  const due: number[] = [];
  input.lucky.forEach((l, slot) => {
    if (!l.claimed && l.position > 0n && l.position <= input.voterCount) due.push(slot);
  });
  return due;
}

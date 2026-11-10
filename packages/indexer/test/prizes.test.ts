import { describe, expect, it } from 'vitest';
import { isPrizeRulesConfigured, planLuckyPayouts } from '../src/prizes.js';

const ADDR = '0x1111111111111111111111111111111111111111';
const ZERO = '0x0000000000000000000000000000000000000000';

describe('planLuckyPayouts', () => {
  const lucky = [
    { position: 1n, claimed: false },
    { position: 172n, claimed: false },
    { position: 3n, claimed: true },
  ];

  it('is a no-op when PRIZE_RULES is unset, empty, or zero', () => {
    expect(planLuckyPayouts({ lucky, voterCount: 200n })).toEqual([]);
    expect(planLuckyPayouts({ prizeRules: undefined, lucky, voterCount: 200n })).toEqual([]);
    expect(planLuckyPayouts({ prizeRules: '', lucky, voterCount: 200n })).toEqual([]);
    expect(planLuckyPayouts({ prizeRules: ZERO, lucky, voterCount: 200n })).toEqual([]);
    expect(planLuckyPayouts({ prizeRules: 'not-an-address', lucky, voterCount: 200n })).toEqual([]);
    expect(isPrizeRulesConfigured(undefined)).toBe(false);
    expect(isPrizeRulesConfigured(ZERO)).toBe(false);
    expect(isPrizeRulesConfigured(ADDR)).toBe(true);
  });

  it('pays only unclaimed spots whose voter number has arrived', () => {
    expect(planLuckyPayouts({ prizeRules: ADDR, lucky, voterCount: 0n })).toEqual([]);
    expect(planLuckyPayouts({ prizeRules: ADDR, lucky, voterCount: 1n })).toEqual([0]);
    expect(planLuckyPayouts({ prizeRules: ADDR, lucky, voterCount: 3n })).toEqual([0]); // 172 not yet, 3 already claimed
    expect(planLuckyPayouts({ prizeRules: ADDR, lucky, voterCount: 172n })).toEqual([0, 1]);
  });
});

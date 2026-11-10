import { describe, expect, it } from 'vitest';
import { flatScore, scoreOf } from '../src/score.ts';
const st = (votes: number, streak: number) => ({ votes, acts: 0, streak, bestStreak: streak, tier: 1, burned: (BigInt(votes) * 10n ** 18n).toString() });
describe('flat score', () => {
  it('ranks wallets, counts created elections, handles unknown wallets', () => {
    const s: any = { standing: { '0xaaa': st(3, 2), '0xbbb': st(1, 1) }, elections: [{ creator: '0xBBB' }, { creator: '0xBBB' }] };
    expect(scoreOf({ votes: 3, acts: 0, created: 0, streak: 2 })).toBe(80);
    const a = flatScore(s, '0xAAA'), b = flatScore(s, '0xbbb');
    expect(a).toMatchObject({ votes: 3, score: 80, created: 0, rank: 1, of: 2 });
    expect(b).toMatchObject({ created: 2, score: 10 + 40 + 25, rank: 2 });
    const n = flatScore(s, '0xccc');
    expect(n).toMatchObject({ score: 0, rank: null, votes: 0, tierName: '—' });
  });
});

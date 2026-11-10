import { tierName } from './tier.js';
import type { Snapshot } from './snapshot.js';

export interface FlatScore {
  address: string; votes: number; acts: number; burned: string; created: number; streak: number; bestStreak: number;
  tier: number; tierName: string; score: number; rank: number | null; of: number;
}

/** Flat Score = 10/vote + 5/act + 20/election created + 25/streak week. Pure and public: anyone can recompute it from the snapshot. */
export const scoreOf = (v: { votes: number; acts: number; created: number; streak: number }) => v.votes * 10 + v.acts * 5 + v.created * 20 + v.streak * 25;

export function flatScore(s: Pick<Snapshot, 'standing' | 'elections'>, address: string): FlatScore {
  const who = address.toLowerCase();
  const created = new Map<string, number>();
  for (const e of s.elections) created.set(e.creator.toLowerCase(), (created.get(e.creator.toLowerCase()) ?? 0) + 1);
  const wallets = new Set<string>([...Object.keys(s.standing).map((k) => k.toLowerCase()), ...created.keys(), who]);
  const rows = [...wallets].map((w) => {
    const r = s.standing[w] ?? Object.entries(s.standing).find(([k]) => k.toLowerCase() === w)?.[1];
    const v = { votes: r?.votes ?? 0, acts: r?.acts ?? 0, created: created.get(w) ?? 0, streak: r?.streak ?? 0 };
    return { w, r, v, score: scoreOf(v) };
  }).filter((x) => x.score > 0 || x.w === who);
  rows.sort((a, b) => b.score - a.score);
  const me = rows.find((x) => x.w === who)!;
  return {
    address, votes: me.v.votes, acts: me.v.acts, burned: me.r?.burned ?? '0', created: me.v.created, streak: me.v.streak, bestStreak: me.r?.bestStreak ?? 0,
    tier: me.r?.tier ?? 0, tierName: tierName(me.r?.tier ?? 0), score: me.score, rank: me.score > 0 ? rows.indexOf(me) + 1 : null, of: rows.filter((x) => x.score > 0).length,
  };
}

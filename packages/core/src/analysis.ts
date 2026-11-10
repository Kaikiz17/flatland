import type { Address } from 'viem';
import { fairnessScore, type FairnessScore } from './fairness.js';
import type { ClusterResult } from './cluster.js';
import type { ElectionView } from './snapshot.js';

export interface Analysis {
  rawVoters: number;
  counted: number;
  collapsed: number;
  uniqueSources: number;
  /** tallies after sybil collapse, including provisional (not yet attested) deposit-path votes */
  liveTallies: number[];
  attested: boolean;
  fairness: FairnessScore;
  clusters: { source: Address; keeper: Address; members: Address[]; collapsed: Address[]; popular: boolean }[];
  /** wallets (lowercase) collapsed into a keeper, chain + deposit */
  collapsedMap: Record<string, Address>;
}

/** Builds the fairness view for one election. `cr` comes from the indexer's clustering; absent => no sybil data yet. */
export function analyzeElection(e: ElectionView, cr?: ClusterResult | { clusters: Analysis['clusters']; collapsedMap: Record<string, Address>; uniqueSources: number }): Analysis {
  const collapsedMap: Record<string, Address> = {};
  let clusters: Analysis['clusters'] = [];
  let uniqueSources: number | undefined;
  if (cr) {
    clusters = cr.clusters;
    uniqueSources = cr.uniqueSources;
    if ('collapsedMap' in cr) Object.assign(collapsedMap, cr.collapsedMap);
    else for (const [k, v] of (cr as ClusterResult).collapsed) collapsedMap[k] = v;
  }
  // onchain collapses are authoritative
  for (const c of e.collapsed) collapsedMap[c.loser.toLowerCase()] = c.keeper;
  const chainCounted = e.chainVotes.filter((v) => !collapsedMap[v.voter.toLowerCase()]).length;
  const dep = e.depositVotes.filter((v) => !collapsedMap[v.voter.toLowerCase()]);
  const attested = e.depositsSubmitted;
  const liveTallies = e.options.map((_, o) => e.chainTally[o] ?? 0);
  if (attested) e.options.forEach((_, o) => (liveTallies[o] += e.depositTally[o] ?? 0));
  else for (const d of dep) liveTallies[d.option] += 1;
  const rawVoters = e.chainVotes.length + e.collapsed.length + e.depositVotes.length;
  const counted = attested ? chainCounted + e.depositCount : chainCounted + dep.length;
  const collapsed = Object.keys(collapsedMap).length;
  const fairness = fairnessScore({
    tallies: liveTallies,
    rawVoters: Math.max(rawVoters, counted + collapsed),
    collapsed,
    counted,
    uniqueSources: uniqueSources ?? counted,
    hasAttestation: attested || e.tallier === '0x0000000000000000000000000000000000000000',
    openChallenges: e.challenges.filter((c) => !c.resolved).length,
    upheldChallenges: e.challenges.filter((c) => c.upheld).length,
  });
  return { rawVoters, counted, collapsed, uniqueSources: uniqueSources ?? counted, liveTallies, attested, fairness, clusters, collapsedMap };
}

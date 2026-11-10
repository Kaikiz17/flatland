import type { Address, Hex } from 'viem';
import {
  analyzeElection, auditExport, buildDepositTree, clusterVoters,
  type Analysis, type ElectionView, type FundingProvider, type VoterRef, type DepositEntry,
} from '@flatland/core';

export interface ElectionPlan {
  analysis: Analysis;
  /** deposit-path voters that are counted, in leaf order */
  entries: DepositEntry[];
  proofs: Hex[][];
  root: Hex;
  counts: number[];
  chainCollapses: { loser: Address; keeper: Address }[];
  audit: ReturnType<typeof auditExport>;
}

/** Pure: given an election's public data + a funding provider, compute everything the tallier would post. */
export async function planElection(e: ElectionView, provider: FundingProvider, opts: { popularLimit?: number; ignoreSources?: Address[] } = {}): Promise<ElectionPlan> {
  const refs: VoterRef[] = [
    ...e.chainVotes.map((v) => ({ voter: v.voter, option: v.option, at: v.block * 10_000 + v.logIndex, path: 'chain' as const })),
    ...e.depositVotes.map((v) => ({ voter: v.voter, option: v.option, at: v.block * 10_000 + v.logIndex, path: 'deposit' as const })),
  ];
  // onchain collapses already executed count as clustered members (keep them out of the unique-source maths)
  const alreadyGone = new Set(e.collapsed.map((c) => c.loser.toLowerCase()));
  const live = refs.filter((r) => !alreadyGone.has(r.voter.toLowerCase()));
  const cr = await clusterVoters(live, provider, opts);

  const chainSet = new Set(e.chainVotes.map((v) => v.voter.toLowerCase()));
  const chainCollapses = [...cr.collapsed.entries()]
    .filter(([loser]) => chainSet.has(loser))
    .map(([loser, keeper]) => ({ loser: loser as Address, keeper }));
  const counted = e.depositVotes.filter((d) => !cr.collapsed.has(d.voter.toLowerCase()));
  const entries: DepositEntry[] = counted.map((d) => ({ voter: d.voter, option: d.option }));
  const { root, proofs } = buildDepositTree(entries);
  const counts = e.options.map((_, o) => entries.filter((x) => x.option === o).length);

  const asView: ElectionView = { ...e };
  const analysis = analyzeElection(asView, cr);
  const chainVotersAfter = e.chainVotes.filter((v) => !cr.collapsed.has(v.voter.toLowerCase()) && !alreadyGone.has(v.voter.toLowerCase()));
  const audit = auditExport({
    electionId: e.id,
    root,
    entries,
    proofs,
    chainVoters: chainVotersAfter.map((v) => ({ voter: v.voter, option: v.option })),
    clusters: cr.clusters.map((c) => ({ source: c.source, keeper: c.keeper, members: c.members, collapsed: c.collapsed, popular: c.popular })),
  });
  return { analysis, entries, proofs, root, counts, chainCollapses, audit };
}

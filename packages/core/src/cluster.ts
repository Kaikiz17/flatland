import type { Address } from 'viem';

/**
 * Funding-source clustering (the World is Fair rule "wallets funded from the same source collapse to one vote").
 *
 * A "funding source" is the address that first funded the wallet (first inbound ETH / WIF transfer).
 * Wallets sharing a source form a cluster; the earliest voter is the keeper, the rest collapse.
 * Anti false-positive: a source that funded more than `popularLimit` of this election's voters is treated as a
 * *popular source* (exchange hot wallet, faucet, airdrop contract). Those wallets are NOT collapsed; the group is
 * published flagged `popular` so it is auditable but harmless.
 */
export interface VoterRef {
  voter: Address;
  option: number;
  at: number; // ordering key: block number (then log index) of the vote
  path: 'chain' | 'deposit';
}

export interface FundingInfo {
  source: Address | null;
  tx?: string;
}

export type FundingProvider = (wallet: Address) => Promise<FundingInfo>;

export interface Cluster {
  source: Address;
  keeper: Address;
  members: Address[]; // includes keeper
  collapsed: Address[]; // members minus keeper
  popular: boolean;
}

export interface ClusterResult {
  clusters: Cluster[];
  collapsed: Map<string, Address>; // lowercased loser -> keeper
  sources: Map<string, Address | null>; // lowercased wallet -> source
  uniqueSources: number;
}

export async function clusterVoters(
  voters: VoterRef[],
  provider: FundingProvider,
  opts: { popularLimit?: number; ignoreSources?: Address[] } = {},
): Promise<ClusterResult> {
  const popularLimit = opts.popularLimit ?? 25;
  const ignore = new Set((opts.ignoreSources ?? []).map((a) => a.toLowerCase()));
  const sources = new Map<string, Address | null>();
  for (const v of voters) {
    const info = await provider(v.voter);
    sources.set(v.voter.toLowerCase(), info.source && !ignore.has(info.source.toLowerCase()) ? info.source : null);
  }
  const bySource = new Map<string, VoterRef[]>();
  for (const v of voters) {
    const s = sources.get(v.voter.toLowerCase());
    if (!s) continue;
    const k = s.toLowerCase();
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k)!.push(v);
  }
  const clusters: Cluster[] = [];
  const collapsed = new Map<string, Address>();
  for (const [k, group] of bySource) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.at - b.at);
    const popular = group.length > popularLimit;
    const keeper = group[0].voter;
    const losers = group.slice(1).map((g) => g.voter);
    clusters.push({ source: sources.get(group[0].voter.toLowerCase())!, keeper, members: group.map((g) => g.voter), collapsed: popular ? [] : losers, popular });
    if (!popular) for (const l of losers) collapsed.set(l.toLowerCase(), keeper);
  }
  // unique sources among counted (non-collapsed) voters; wallets with no known source count as their own source
  const seen = new Set<string>();
  for (const v of voters) {
    if (collapsed.has(v.voter.toLowerCase())) continue;
    seen.add((sources.get(v.voter.toLowerCase()) ?? v.voter).toLowerCase());
  }
  return { clusters, collapsed, sources, uniqueSources: seen.size };
}

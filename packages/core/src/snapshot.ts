import { getAddress, parseEventLogs, type Address, type Hex, type Log, type PublicClient } from 'viem';
import { flatlandAbi, erc20Abi, standingAbi, wifGateAbi, basketVaultAbi, wifBuybackAbi } from './abis.js';
import { depositAddress } from './deposit.js';
import type { Deployment } from './deployment.js';

export interface ChainVote {
  voter: Address;
  option: number;
  block: number;
  logIndex: number;
  ts: number;
  tx: Hex;
}
export interface DepositVote {
  voter: Address;
  option: number;
  amount: string; // wei
  block: number;
  logIndex: number;
  ts: number;
  tx: Hex;
}
export interface ElectionView {
  id: number;
  creator: Address;
  title: string;
  options: string[];
  metaURI: string;
  start: number;
  end: number;
  voteCost: string;
  tallier: Address;
  executor: Address;
  winners: number;
  prizeToken: Address;
  status: 'open' | 'upcoming' | 'ended' | 'finalized';
  statusRaw: number;
  winner: number;
  executed: boolean;
  /** attested + onchain counts as the contract holds them */
  tallies: number[];
  chainTally: number[];
  depositTally: number[];
  depositsSubmitted: boolean;
  depositRoot: Hex;
  depositCount: number;
  challengeEnds: number;
  openChallenges: number;
  burned: string;
  prizePool: string;
  drawBlock: number;
  seed: Hex;
  chainVotes: ChainVote[];
  /** raw deposit-path transfers seen by the indexer (before clustering/attestation) */
  depositVotes: DepositVote[];
  depositAddresses: Address[];
  collapsed: { loser: Address; keeper: Address; groupURI: string }[];
  challenges: { cid: number; challenger: Address; accused: Address; evidence: string; resolved?: boolean; upheld?: boolean }[];
  groupsURI?: string;
}
export interface GateView {
  id: number;
  creator: Address;
  kind: number;
  title: string;
  metaURI: string;
  start: number;
  end: number;
  cost: string;
  cap: number;
  count: number;
  actors: { who: Address; position: number; ts: number }[];
}
export interface BasketView {
  address: Address;
  epochs: { epoch: number; electionId: number; assets: number[]; start: number }[];
  assets: { idx: number; token: Address; symbol: string; listed: boolean; targetBps: number; backers: number }[];
  pendingFees: string;
  totalFeesBurned: string;
  totalSupply: string;
  navUsdg: string | null; // null if an oracle is stale/paused
  buybackWifBurned: string;
  round: number;
  promoteThreshold: number;
}
export interface Snapshot {
  version: 1;
  generatedAt: number;
  head: number;
  deployment: Deployment;
  totals: {
    wifBurned: string; // all Flatland burns: elections + gates + basket nominations + buybacks
    electionBurned: string;
    gateBurned: string;
    buybackBurned: string;
    votes: number;
    elections: number;
    gates: number;
    participants: number;
    acts: number;
  };
  elections: ElectionView[];
  gates: GateView[];
  basket: BasketView | null;
  countries: Record<string, number>;
  voterCountry: Record<string, string>;
  standing: Record<string, { votes: number; acts: number; streak: number; bestStreak: number; tier: number; burned: string }>;
}

export interface ReadOptions {
  fromBlock?: bigint;
  maxRange?: bigint;
  withDeposits?: boolean;
  /** only fetch block timestamps for the latest N vote logs (older ones get approximate ts) */
  log?: (m: string) => void;
}

async function getLogsChunked(client: PublicClient, p: { address: Address | Address[]; from: bigint; to: bigint; args?: any; event?: any; maxRange: bigint }) {
  const out: Log[] = [];
  const run = async (a: bigint, b: bigint): Promise<void> => {
    try {
      const logs = await client.getLogs({ address: p.address, fromBlock: a, toBlock: b, ...(p.event ? { event: p.event, args: p.args } : {}) } as any);
      out.push(...(logs as Log[]));
    } catch (e: any) {
      if (b - a < 1000n) throw e;
      const mid = a + (b - a) / 2n;
      await run(a, mid);
      await run(mid + 1n, b);
    }
  };
  for (let a = p.from; a <= p.to; a += p.maxRange) await run(a, a + p.maxRange - 1n > p.to ? p.to : a + p.maxRange - 1n);
  return out;
}

const blockTsCache = new Map<bigint, number>();
async function tsOf(client: PublicClient, block: bigint) {
  const c = blockTsCache.get(block);
  if (c) return c;
  const b = await client.getBlock({ blockNumber: block });
  const t = Number(b.timestamp);
  blockTsCache.set(block, t);
  return t;
}

export async function readSnapshot(client: PublicClient, dep: Deployment, opts: ReadOptions = {}): Promise<Snapshot> {
  const head = await client.getBlockNumber();
  const from = opts.fromBlock ?? BigInt(dep.deployBlock);
  const maxRange = opts.maxRange ?? 4_000_000n;
  const now = Number((await client.getBlock({ blockNumber: head })).timestamp);
  const hub = { address: dep.flatland, abi: flatlandAbi } as const;

  const hubLogs = parseEventLogs({ abi: flatlandAbi, logs: (await getLogsChunked(client, { address: dep.flatland, from, to: head, maxRange })) as any });
  const gateLogs = parseEventLogs({ abi: wifGateAbi, logs: (await getLogsChunked(client, { address: dep.gate, from, to: head, maxRange })) as any });
  const standLogs = parseEventLogs({ abi: standingAbi, logs: (await getLogsChunked(client, { address: dep.standing, from, to: head, maxRange })) as any });
  const vaultLogs = parseEventLogs({ abi: basketVaultAbi, logs: (await getLogsChunked(client, { address: dep.basket, from, to: head, maxRange })) as any });

  // ── elections ──
  const byId = new Map<number, ElectionView>();
  for (const l of hubLogs) {
    if (l.eventName !== 'ElectionCreated') continue;
    const a = l.args as any;
    byId.set(Number(a.id), {
      id: Number(a.id), creator: a.creator, title: a.title, options: [...a.options], metaURI: a.metaURI,
      start: Number(a.start), end: Number(a.end), voteCost: a.voteCost.toString(), tallier: a.tallier, executor: a.executor,
      winners: Number(a.winners), prizeToken: a.prizeToken, status: 'open', statusRaw: 1, winner: 0, executed: false,
      tallies: [], chainTally: [], depositTally: [], depositsSubmitted: false, depositRoot: '0x', depositCount: 0, challengeEnds: 0,
      openChallenges: 0, burned: '0', prizePool: '0', drawBlock: 0, seed: '0x', chainVotes: [], depositVotes: [], depositAddresses: [],
      collapsed: [], challenges: [],
    });
  }
  const ids = [...byId.keys()];
  if (ids.length) {
    const calls = ids.flatMap((id) => [
      { ...hub, functionName: 'getElection', args: [BigInt(id)] },
      { ...hub, functionName: 'tallies', args: [BigInt(id)] },
      { ...hub, functionName: 'chainTally', args: [BigInt(id)] },
      { ...hub, functionName: 'depositTally', args: [BigInt(id)] },
    ]) as any[];
    const res = await client.multicall({ contracts: calls, allowFailure: false });
    ids.forEach((id, i) => {
      const e = byId.get(id)!;
      const g = res[i * 4] as any;
      e.statusRaw = Number(g.status);
      e.winner = Number(g.winner);
      e.executed = g.executed;
      e.tallies = (res[i * 4 + 1] as bigint[]).map(Number);
      e.chainTally = (res[i * 4 + 2] as number[]).map(Number);
      e.depositTally = (res[i * 4 + 3] as number[]).map(Number);
      e.depositsSubmitted = g.depositsSubmitted;
      e.depositRoot = g.depositRoot;
      e.depositCount = Number(g.depositCount);
      e.challengeEnds = Number(g.challengeEnds);
      e.openChallenges = Number(g.openChallenges);
      e.burned = g.burned.toString();
      e.prizePool = g.prizePool.toString();
      e.drawBlock = Number(g.drawBlock);
      e.seed = g.seed;
      e.status = e.statusRaw === 2 ? 'finalized' : now < e.start ? 'upcoming' : now >= e.end ? 'ended' : 'open';
      for (let o = 0; o < e.options.length; o++) e.depositAddresses.push(depositAddress(dep.flatland, dep.boxImpl, id, o));
    });
  }

  // chain votes (+ timestamps)
  const voteLogs = hubLogs.filter((l) => l.eventName === 'Voted');
  for (const l of voteLogs) {
    const a = l.args as any;
    const e = byId.get(Number(a.id));
    if (!e) continue;
    e.chainVotes.push({ voter: a.voter, option: Number(a.option), block: Number(l.blockNumber), logIndex: l.logIndex!, ts: await tsOf(client, l.blockNumber!), tx: l.transactionHash! });
  }
  for (const l of hubLogs) {
    const a = l.args as any;
    const e = byId.get(Number(a.id ?? -1));
    if (!e) continue;
    if (l.eventName === 'Collapsed') e.collapsed.push({ loser: a.loser, keeper: a.keeper, groupURI: a.groupURI });
    if (l.eventName === 'ChallengeOpened') e.challenges.push({ cid: Number(a.cid), challenger: a.challenger, accused: a.accused, evidence: a.evidence });
    if (l.eventName === 'ChallengeResolved') {
      const c = e.challenges.find((x) => x.cid === Number(a.cid));
      if (c) { c.resolved = true; c.upheld = a.upheld; }
    }
    if (l.eventName === 'DepositsSubmitted') e.groupsURI = a.uri;
  }

  // raw deposit-path transfers
  if (opts.withDeposits !== false && ids.length) {
    const boxToElection = new Map<string, { id: number; option: number }>();
    for (const e of byId.values()) e.depositAddresses.forEach((b, o) => boxToElection.set(b.toLowerCase(), { id: e.id, option: o }));
    const boxes = [...boxToElection.keys()].map((b) => getAddress(b));
    for (let i = 0; i < boxes.length; i += 150) {
      const part = boxes.slice(i, i + 150);
      const logs = parseEventLogs({
        abi: erc20Abi,
        logs: (await getLogsChunked(client, { address: dep.wif, from, to: head, maxRange, event: erc20Abi[6], args: { to: part } })) as any,
      });
      const seen = new Set<string>();
      for (const l of logs) {
        const a = l.args as any;
        const m = boxToElection.get((a.to as string).toLowerCase());
        if (!m) continue;
        const e = byId.get(m.id)!;
        const ts = await tsOf(client, l.blockNumber!);
        if (ts < e.start || ts >= e.end) continue;
        if (a.value < BigInt(e.voteCost)) continue;
        const key = `${m.id}:${(a.from as string).toLowerCase()}`;
        if (seen.has(key)) continue; // 1 wallet = 1 vote: first qualifying transfer only, rest is burned
        seen.add(key);
        e.depositVotes.push({ voter: a.from, option: m.option, amount: a.value.toString(), block: Number(l.blockNumber), logIndex: l.logIndex!, ts, tx: l.transactionHash! });
      }
    }
    for (const e of byId.values()) {
      const chainSet = new Set(e.chainVotes.map((v) => v.voter.toLowerCase()));
      e.depositVotes = e.depositVotes.filter((d) => !chainSet.has(d.voter.toLowerCase()));
      e.depositVotes.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    }
  }

  // ── gates ──
  const gates = new Map<number, GateView>();
  for (const l of gateLogs) {
    const a = l.args as any;
    if (l.eventName === 'GateCreated') {
      gates.set(Number(a.id), { id: Number(a.id), creator: a.creator, kind: Number(a.kind), title: a.title, metaURI: a.metaURI, start: Number(a.start), end: Number(a.end), cost: a.cost.toString(), cap: Number(a.cap), count: 0, actors: [] });
    } else if (l.eventName === 'Acted') {
      const g = gates.get(Number(a.id));
      if (g) { g.count++; g.actors.push({ who: a.who, position: Number(a.position), ts: await tsOf(client, l.blockNumber!) }); }
    }
  }

  // ── standing / countries ──
  const countries: Record<string, number> = {};
  const voterCountry: Record<string, string> = {};
  for (const l of standLogs) {
    if (l.eventName !== 'CountrySet') continue;
    const a = l.args as any;
    const hx = (a.country as string).slice(2);
    const cc = String.fromCharCode(parseInt(hx.slice(0, 2), 16) || 0, parseInt(hx.slice(2, 4), 16) || 0);
    if (cc && cc !== '\0\0' && /^[A-Z]{2}$/.test(cc)) voterCountry[(a.who as string).toLowerCase()] = cc;
    else delete voterCountry[(a.who as string).toLowerCase()];
  }
  for (const cc of Object.values(voterCountry)) countries[cc] = (countries[cc] ?? 0) + 1;
  const standing: Snapshot['standing'] = {};
  const people = new Set<string>();
  for (const e of byId.values()) for (const v of e.chainVotes) people.add(v.voter.toLowerCase());
  for (const g of gates.values()) for (const a of g.actors) people.add(a.who.toLowerCase());
  const plist = [...people] as Address[];
  if (plist.length) {
    const recs = await client.multicall({
      contracts: plist.flatMap((p) => [
        { address: dep.standing, abi: standingAbi, functionName: 'record', args: [p] },
        { address: dep.standing, abi: standingAbi, functionName: 'tier', args: [p] },
      ]) as any[],
      allowFailure: false,
    });
    plist.forEach((p, i) => {
      const r = recs[i * 2] as any;
      standing[p.toLowerCase()] = { votes: r.votes, acts: r.acts, streak: r.streak, bestStreak: r.bestStreak, tier: Number(recs[i * 2 + 1]), burned: r.burned.toString() };
    });
  }

  // ── basket ──
  let basket: BasketView | null = null;
  try {
    const bv = { address: dep.basket, abi: basketVaultAbi } as const;
    const n = Number(await client.readContract({ ...bv, functionName: 'assetCount' }));
    const assets: BasketView['assets'] = [];
    const epochCount = Number(await client.readContract({ ...bv, functionName: 'epochCount' }));
    const targets = (await client.readContract({ ...bv, functionName: 'targets' })) as number[];
    for (let i = 0; i < n; i++) {
      const a = (await client.readContract({ ...bv, functionName: 'assetAt', args: [BigInt(i)] })) as any;
      const backers = Number(await client.readContract({ ...bv, functionName: 'backers', args: [BigInt(epochCount), BigInt(i)] }));
      assets.push({ idx: i, token: a.token, symbol: a.symbol, listed: a.listed, targetBps: Number(targets[i] ?? 0), backers });
    }
    let nav: string | null = null;
    try { nav = (await client.readContract({ ...bv, functionName: 'totalAssets' })).toString(); } catch { nav = null; }
    const epochs: BasketView['epochs'] = [];
    for (const l of vaultLogs) {
      if (l.eventName !== 'EpochOpened') continue;
      const a = l.args as any;
      epochs.push({ epoch: Number(a.epoch), electionId: Number(a.electionId), assets: [...a.assets].map(Number), start: Number(a.start) });
    }
    basket = {
      address: dep.basket, epochs, assets,
      pendingFees: (await client.readContract({ ...bv, functionName: 'pendingFees' })).toString(),
      totalFeesBurned: (await client.readContract({ ...bv, functionName: 'totalFeesBurned' })).toString(),
      totalSupply: (await client.readContract({ ...bv, functionName: 'totalSupply' })).toString(),
      navUsdg: nav,
      buybackWifBurned: (await client.readContract({ address: dep.buyback, abi: wifBuybackAbi, functionName: 'totalWifBurned' })).toString(),
      round: epochCount,
      promoteThreshold: Number(await client.readContract({ ...bv, functionName: 'promoteThreshold' })),
    };
  } catch (e) {
    opts.log?.('basket read failed: ' + (e as Error).message);
  }

  const electionBurned = (await client.readContract({ ...hub, functionName: 'totalBurned' })) as bigint;
  const gateBurned = (await client.readContract({ address: dep.gate, abi: wifGateAbi, functionName: 'totalBurned' })) as bigint;
  const buybackBurned = basket ? BigInt(basket.buybackWifBurned) : 0n;
  const nominations = vaultLogs.filter((l) => l.eventName === 'Nominated').length;
  const totalVotes = Number(await client.readContract({ ...hub, functionName: 'totalVotes' }));
  const participants = Number(await client.readContract({ address: dep.standing, abi: standingAbi, functionName: 'uniqueParticipants' }));
  const totalActs = Number(await client.readContract({ address: dep.gate, abi: wifGateAbi, functionName: 'totalActs' }));

  return {
    version: 1,
    generatedAt: Math.floor(Date.now() / 1000),
    head: Number(head),
    deployment: dep,
    totals: {
      wifBurned: (electionBurned + gateBurned + buybackBurned + BigInt(nominations) * 10n ** 18n).toString(),
      electionBurned: electionBurned.toString(),
      gateBurned: gateBurned.toString(),
      buybackBurned: buybackBurned.toString(),
      votes: totalVotes,
      elections: byId.size,
      gates: gates.size,
      participants,
      acts: totalActs,
    },
    elections: [...byId.values()].sort((a, b) => b.id - a.id),
    gates: [...gates.values()].sort((a, b) => b.id - a.id),
    basket,
    countries,
    voterCountry,
    standing,
  };
}

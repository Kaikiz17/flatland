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
  walletCap: string; // beta safety caps (USDG, 6 dec); 2^256-1 = uncapped
  tvlCap: string;
  governance: Address;
  /** vault actions read from logs: weights applied (TargetsSet), rebalances and the individual Stock Token trades */
  events?: { kind: 'targets' | 'rebalanced' | 'traded'; tx: string; block: number; ts: number; epoch?: number; token?: string; symbol?: string; buy?: boolean; usdg?: string; tokenAmount?: string }[];
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

/** Optional persistence for logs already fetched (edge workers keep it in KV so each pass only scans new blocks). */
export interface LogCache {
  get(key: string): Promise<{ to: string; logs: Log[] } | null>;
  put(key: string, v: { to: string; logs: Log[] }): Promise<void>;
}

export interface ReadOptions {
  fromBlock?: bigint;
  maxRange?: bigint;
  logCache?: LogCache;
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

const REORG_MARGIN = 64n;
/** getLogs with a persistent cursor: only blocks after the cached cursor are scanned, progress is saved even if a chunk fails. */
async function getLogsCached(client: PublicClient, cache: LogCache | undefined, key: string, p: Parameters<typeof getLogsChunked>[1]) {
  if (!cache) return getLogsChunked(client, p);
  const hit = await cache.get(key);
  return scanFrom(client, cache, [key], [hit], p).then((r) => r[0]);
}

/** Several contracts at once: when their cached cursors agree, one multi-address eth_getLogs per chunk serves all of them. */
async function getLogsMany(client: PublicClient, cache: LogCache | undefined, addrs: Address[], mk: (a: Address) => string, p: { from: bigint; to: bigint; maxRange: bigint }): Promise<Log[][]> {
  const single = () => Promise.all(addrs.map((a) => getLogsCached(client, cache, mk(a), { ...p, address: a })));
  if (!cache) return single();
  const hits = await Promise.all(addrs.map((a) => cache.get(mk(a))));
  const tos = new Set(hits.map((h) => (h ? h.to : 'none')));
  if (tos.size !== 1 || hits[0] === null || BigInt(hits[0].to) < p.from - 1n) return single();
  const merged = await scanFrom(client, cache, addrs.map(mk), hits, { ...p, address: addrs }, addrs);
  return merged;
}

async function scanFrom(client: PublicClient, cache: LogCache, keys: string[], hits: ({ to: string; logs: Log[] } | null)[], p: Parameters<typeof getLogsChunked>[1], split?: Address[]): Promise<Log[][]> {
  const hit = hits[0];
  const valid = !!hit && BigInt(hit.to) >= p.from - 1n;
  let cursor = valid ? BigInt(hit!.to) : p.from - 1n;
  const start = cursor;
  const fresh: Log[] = [];
  let failure: unknown;
  // chunks are fetched concurrently (a batching transport folds them into one HTTP request); only the contiguous
  // prefix of successful chunks advances the cursor
  const chunks: [bigint, bigint][] = [];
  for (let a = cursor + 1n; a <= p.to; a += p.maxRange) chunks.push([a, a + p.maxRange - 1n > p.to ? p.to : a + p.maxRange - 1n]);
  for (let i = 0; i < chunks.length && !failure; i += 20) {
    const group = chunks.slice(i, i + 20);
    const res = await Promise.allSettled(group.map(([a, b]) => getLogsChunked(client, { ...p, from: a, to: b })));
    for (let j = 0; j < res.length; j++) {
      const r = res[j];
      if (r.status === 'rejected') { failure = r.reason; break; }
      fresh.push(...r.value);
      cursor = group[j][1];
    }
  }
  // persist everything up to `cursor - margin` (the tip may still reorg); logs in the margin are re-fetched next time
  const safe = cursor - REORG_MARGIN > start ? cursor - REORG_MARGIN : start;
  const lows = split?.map((a) => a.toLowerCase());
  const out: Log[][] = [];
  for (let k = 0; k < keys.length; k++) {
    const mine = (l: Log) => !lows || (l.address ?? '').toLowerCase() === lows[k];
    const all = [...(valid && hits[k] ? hits[k]!.logs : []), ...fresh.filter(mine)];
    // KV writes are scarce on the free plan: persist only when there are new logs, a first scan, or the cursor moved a lot
    if (safe > start && (fresh.length || !valid || safe - start > 2_000n)) await cache.put(keys[k], { to: safe.toString(), logs: all.filter((l) => (l.blockNumber ?? 0n) <= safe) });
    out.push(all);
  }
  if (failure) throw failure;
  const dedupe = (all: Log[]) => { const seen = new Set<string>(); return all.filter((l) => { const x = `${l.blockHash}:${l.logIndex}`; if (seen.has(x)) return false; seen.add(x); return true; }) as Log[]; };
  return out.map(dedupe);
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

/** Fetch many block timestamps concurrently (a batching transport turns this into one HTTP request). */
async function prefetchTs(client: PublicClient, blocks: Iterable<bigint>) {
  const need = [...new Set(blocks)].filter((b) => !blockTsCache.has(b));
  for (let i = 0; i < need.length; i += 100) await Promise.all(need.slice(i, i + 100).map((b) => tsOf(client, b)));
}

export async function readSnapshot(client: PublicClient, dep: Deployment, opts: ReadOptions = {}): Promise<Snapshot> {
  const head = await client.getBlockNumber();
  const from = opts.fromBlock ?? BigInt(dep.deployBlock);
  const maxRange = opts.maxRange ?? 4_000_000n;
  const now = Number((await client.getBlock({ blockNumber: head })).timestamp);
  const hub = { address: dep.flatland, abi: flatlandAbi } as const;

  const [hubRaw, gateRaw, standRaw, vaultRaw] = await getLogsMany(client, opts.logCache, [dep.flatland, dep.gate, dep.standing, dep.basket] as Address[], (a) => `all:${a}`, { from, to: head, maxRange });
  const hubLogs = parseEventLogs({ abi: flatlandAbi, logs: hubRaw as any });
  const gateLogs = parseEventLogs({ abi: wifGateAbi, logs: gateRaw as any });
  const standLogs = parseEventLogs({ abi: standingAbi, logs: standRaw as any });
  const vaultLogs = parseEventLogs({ abi: basketVaultAbi, logs: vaultRaw as any });

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
  await prefetchTs(client, voteLogs.map((l) => l.blockNumber!));
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
    // boxes cannot receive qualifying votes before their election exists: scan from the first creation block
    const firstCreated = hubLogs.filter((l) => l.eventName === 'ElectionCreated').reduce((m, l) => (l.blockNumber! < m ? l.blockNumber! : m), head);
    const depFrom = firstCreated > from ? firstCreated : from;
    for (let i = 0; i < boxes.length; i += 150) {
      const part = boxes.slice(i, i + 150);
      const logs = parseEventLogs({
        abi: erc20Abi,
        logs: (await getLogsCached(client, opts.logCache, `box:${part.length}:${part[0]}`, { address: dep.wif, from: depFrom, to: head, maxRange, event: erc20Abi[6], args: { to: part } })) as any,
      });
      await prefetchTs(client, logs.map((l) => l.blockNumber!));
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
  await prefetchTs(client, gateLogs.filter((l) => l.eventName === 'Acted').map((l) => l.blockNumber!));
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

  // ── basket ──  (batched: a handful of multicalls instead of ~35 sequential eth_calls)
  let basket: BasketView | null = null;
  try {
    const bv = { address: dep.basket, abi: basketVaultAbi } as const;
    const one = (functionName: string, args?: any[]) => ({ ...bv, functionName, ...(args ? { args } : {}) });
    const r = (await client.multicall({
      contracts: [
        one('assetCount'), one('epochCount'), one('targets'), one('pendingFees'), one('totalFeesBurned'), one('totalSupply'),
        one('promoteThreshold'), one('walletCap'), one('tvlCap'), one('governance'), one('totalAssets'),
        { address: dep.buyback, abi: wifBuybackAbi, functionName: 'totalWifBurned' },
      ] as any[],
      allowFailure: true,
    })) as { status: string; result?: any; error?: Error }[];
    const need = (i: number) => { if (r[i].status !== 'success') throw (r[i].error ?? new Error('basket call failed')); return r[i].result; };
    const n = Number(need(0));
    const epochCount = Number(need(1));
    const targets = need(2) as number[];
    const nav: string | null = r[10].status === 'success' ? (r[10].result as bigint).toString() : null;
    const per = n
      ? ((await client.multicall({
          contracts: Array.from({ length: n }, (_, i) => [one('assetAt', [BigInt(i)]), one('backers', [BigInt(epochCount), BigInt(i)])]).flat() as any[],
          allowFailure: false,
        })) as any[])
      : [];
    const assets: BasketView['assets'] = [];
    for (let i = 0; i < n; i++) {
      const a = per[i * 2] as any;
      assets.push({ idx: i, token: a.token, symbol: a.symbol, listed: a.listed, targetBps: Number(targets[i] ?? 0), backers: Number(per[i * 2 + 1]) });
    }
    const epochs: BasketView['epochs'] = [];
    for (const l of vaultLogs) {
      if (l.eventName !== 'EpochOpened') continue;
      const a = l.args as any;
      epochs.push({ epoch: Number(a.epoch), electionId: Number(a.electionId), assets: [...a.assets].map(Number), start: Number(a.start) });
    }
    const evs: NonNullable<BasketView['events']> = [];
    const wanted = vaultLogs.filter((l) => l.eventName === 'TargetsSet' || l.eventName === 'Rebalanced' || l.eventName === 'Traded').slice(-60);
    await prefetchTs(client, wanted.map((l) => l.blockNumber as bigint));
    for (const l of wanted) {
      const a = l.args as any;
      const base = { tx: l.transactionHash as string, block: Number(l.blockNumber), ts: blockTsCache.get(l.blockNumber as bigint) ?? 0 };
      if (l.eventName === 'TargetsSet') evs.push({ kind: 'targets', epoch: Number(a.epoch), ...base });
      else if (l.eventName === 'Rebalanced') evs.push({ kind: 'rebalanced', ...base });
      else { const as = assets.find((x) => x.token.toLowerCase() === String(a.token).toLowerCase()); evs.push({ kind: 'traded', token: a.token, symbol: as?.symbol, buy: a.buy, usdg: a.usdgAmount.toString(), tokenAmount: a.tokenAmount.toString(), ...base }); }
    }
    basket = {
      address: dep.basket, epochs, assets, events: evs,
      pendingFees: need(3).toString(),
      totalFeesBurned: need(4).toString(),
      totalSupply: need(5).toString(),
      navUsdg: nav,
      buybackWifBurned: need(11).toString(),
      round: epochCount,
      promoteThreshold: Number(need(6)),
      walletCap: need(7).toString(),
      tvlCap: need(8).toString(),
      governance: need(9) as Address,
    };
  } catch (e) {
    opts.log?.('basket read failed: ' + (e as Error).message);
  }

  const tot = (await client.multicall({
    contracts: [
      { ...hub, functionName: 'totalBurned' },
      { address: dep.gate, abi: wifGateAbi, functionName: 'totalBurned' },
      { ...hub, functionName: 'totalVotes' },
      { address: dep.standing, abi: standingAbi, functionName: 'uniqueParticipants' },
      { address: dep.gate, abi: wifGateAbi, functionName: 'totalActs' },
    ] as any[],
    allowFailure: false,
  })) as any[];
  const electionBurned = tot[0] as bigint;
  const gateBurned = tot[1] as bigint;
  const buybackBurned = basket ? BigInt(basket.buybackWifBurned) : 0n;
  const nominations = vaultLogs.filter((l) => l.eventName === 'Nominated').length;
  const totalVotes = Number(tot[2]);
  const participants = Number(tot[3]);
  const totalActs = Number(tot[4]);

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

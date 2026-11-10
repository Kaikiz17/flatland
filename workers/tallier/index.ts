/**
 * Flatland vote robot as a Cloudflare Cron Trigger (every minute), free plan.
 * Stateless: every duty (attest deposit votes, collapse sybils, answer challenges, sweep, finalize, seed, claim) is re-derived
 * from chain state each tick, so nothing is lost if a tick is skipped. KV holds only caches/status and a short send-dedupe key.
 *
 * Free-plan budget: 10 ms CPU and 50 subrequests per invocation, so:
 *   • idle fast-path: one multicall of global counters; full pass only when something changed (or every 5 min / while an election is unfinished)
 *   • JSON-RPC batching + multicall; subrequest counter with a hard cap
 *   • transactions are sent WITHOUT waiting for receipts, max 2 per tick, de-duplicated via KV (TTL 120 s)
 *   • attestation is held back while funding-source lookups are incomplete (never guess)
 * Secret: TALLIER_KEY (Worker secret). It is never logged or returned.
 */
import { createPublicClient, http, type Address } from 'viem';
import { robinhood, flatlandAbi, wifGateAbi, standingAbi, basketVaultAbi, wifBuybackAbi, type Deployment } from '@flatland/core';
import { FlatlandService } from '../../packages/indexer/src/service.ts';
import { blockscoutProvider } from '../../packages/indexer/src/funding.ts';
import deploymentJson from '../../deployments/robinhood-mainnet.json';

interface Env {
  KV: KVNamespace;
  TALLIER_KEY?: string;
  RPC_URL?: string;
  BLOCKSCOUT_URL?: string;
  APP_URL?: string;
}

const dep = deploymentJson as unknown as Deployment;
const MAX_SUBREQUESTS = 44; // free plan allows 50 external subrequests per invocation
const MAX_WRITES = 2;
const FULL_EVERY_MS = 5 * 60_000;
const BEAT_EVERY_MS = 10 * 60_000;

// ── subrequest budget (counts every outbound fetch of this invocation) ──
let used = 0;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: any, init?: any) => {
  if (++used > MAX_SUBREQUESTS) return Promise.reject(new Error('subrequest budget exhausted'));
  return realFetch(input, init);
}) as typeof fetch;

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const bigSafe = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

class EdgeService extends FlatlandService {
  writes = 0;
  sent: { fn: string; id: string; tx: string }[] = [];
  constructor(cfg: ConstructorParameters<typeof FlatlandService>[0], private kv: KVNamespace) { super(cfg); }
  protected async write(args: any) {
    if (this.writes >= MAX_WRITES) throw new Error('write cap reached for this tick (continues next minute)');
    if (used > MAX_SUBREQUESTS - 14) throw new Error('not enough subrequest budget left to send a transaction');
    const key = 'sent:' + (await sha(args.functionName + JSON.stringify(args.args ?? [], bigSafe))).slice(0, 40);
    if (await this.kv.get(key)) throw new Error(`${args.functionName} already sent recently, waiting for it to land`);
    this.writes++;
    const hash = await super.write(args);
    await this.kv.put(key, hash, { expirationTtl: 120 });
    this.sent.push({ fn: args.functionName, id: String(args.args?.[0] ?? ''), tx: hash });
    return hash;
  }
}

async function cheapSignature(rpc: string): Promise<{ sig: string; electionCount: number }> {
  const client = createPublicClient({ chain: { ...robinhood, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc, { batch: true }) });
  const r = (await client.multicall({
    contracts: [
      { address: dep.flatland, abi: flatlandAbi, functionName: 'electionCount' },
      { address: dep.flatland, abi: flatlandAbi, functionName: 'totalVotes' },
      { address: dep.flatland, abi: flatlandAbi, functionName: 'totalBurned' },
      { address: dep.gate, abi: wifGateAbi, functionName: 'totalActs' },
      { address: dep.gate, abi: wifGateAbi, functionName: 'totalBurned' },
      { address: dep.standing, abi: standingAbi, functionName: 'uniqueParticipants' },
      { address: dep.basket, abi: basketVaultAbi, functionName: 'totalSupply' },
      { address: dep.basket, abi: basketVaultAbi, functionName: 'totalFeesBurned' },
      { address: dep.buyback, abi: wifBuybackAbi, functionName: 'totalWifBurned' },
    ] as any[],
    allowFailure: false,
  })) as any[];
  return { sig: r.map((x) => x.toString()).join(':'), electionCount: Number(r[0]) };
}

async function tick(env: Env): Promise<void> {
  used = 0;
  const now = Date.now();
  const rpc = env.RPC_URL ?? robinhood.rpcUrls.default.http[0];
  const st: any = (await env.KV.get('state', { type: 'json' })) ?? {};
  const out: any = { at: now, mode: 'full' };
  let newState = { ...st };
  let dirty = false;

  // ── idle fast-path ──
  const cheap = await cheapSignature(rpc);
  const idle = cheap.sig === st.sig && st.allFinal && now - (st.lastFull ?? 0) < FULL_EVERY_MS;
  if (idle) {
    out.mode = 'idle';
    if (now - (st.lastBeat ?? 0) >= BEAT_EVERY_MS) {
      newState.lastBeat = now;
      await env.KV.put('state', JSON.stringify(newState));
      await env.KV.put('status', JSON.stringify({ ...out, elections: cheap.electionCount, note: 'idle: nothing changed on chain' }));
    }
    return;
  }

  // ── full pass ──
  const cache = ((await env.KV.get('funding', { type: 'json' })) ?? {}) as Record<string, any>;
  let deferred = 0;
  const budgetedFetch: typeof fetch = ((i: any, init?: any) => {
    if (used > MAX_SUBREQUESTS - 20) { deferred++; return Promise.reject(new Error('funding lookup deferred (budget)')); }
    return fetch(i, init);
  }) as any;
  const funding = blockscoutProvider(env.BLOCKSCOUT_URL ?? 'https://robinhoodchain.blockscout.com', 3, budgetedFetch);
  const logs: string[] = [];
  const svc = new EdgeService(
    {
      chain: { ...robinhood, rpcUrls: { default: { http: [rpc] } } }, rpc, deployment: dep, funding, dataDir: '/tmp/none',
      publicDataUrl: `${(env.APP_URL ?? '').replace(/\/$/, '')}/data`,
      tallierKey: env.TALLIER_KEY as `0x${string}` | undefined,
      keeper: true, edge: true, canAttest: () => deferred === 0,
      log: (m) => { logs.push(m); console.log(m); },
    },
    env.KV,
  );
  for (const [k, v] of Object.entries(cache)) svc.fundingCache.set(k, v);
  const before = svc.fundingCache.size;

  let err: string | null = null;
  try { await svc.tick(); } catch (e) { err = (e as Error).message.split('\n')[0]; console.log('tick failed: ' + err); }
  const snap = svc.latest;

  if (svc.fundingCache.size !== before) await env.KV.put('funding', JSON.stringify(Object.fromEntries(svc.fundingCache)));

  if (snap) {
    const body = JSON.stringify(snap, bigSafe);
    const stable = JSON.stringify({ ...snap, generatedAt: 0, head: 0 }, bigSafe);
    const h = await sha(stable);
    if (h !== st.snapHash) { await env.KV.put('snapshot', body); newState.snapHash = h; dirty = true; }
    for (const [id, plan] of svc.plans) {
      const a = JSON.stringify(plan.audit, bigSafe);
      const ah = (await sha(a)).slice(0, 16);
      if (st.audits?.[id] !== ah) { await env.KV.put(`audit:${id}`, a); newState.audits = { ...(newState.audits ?? st.audits ?? {}), [id]: ah }; dirty = true; }
    }
    newState.sig = cheap.sig;
    newState.n = snap.elections.length;
    newState.allFinal = snap.elections.every((e) => e.statusRaw === 2 && (e.executed || e.executor === '0x0000000000000000000000000000000000000000') && !(e.drawBlock > 0 && /^0x0+$/.test(e.seed)));
    newState.lastFull = now;
  }

  const beat = now - (st.lastBeat ?? 0) >= BEAT_EVERY_MS || !st.lastBeat;
  const prevErr = st.lastError ?? null;
  if (beat || dirty || svc.sent.length || err !== prevErr || deferred) {
    newState.lastBeat = beat ? now : st.lastBeat;
    newState.lastError = err;
    if (!beat) newState.lastFull = now; // keep API-side freshness
    await env.KV.put('state', JSON.stringify(newState));
    const prev: any = (await env.KV.get('status', { type: 'json' })) ?? {};
    const actions = [...svc.sent.map((s) => ({ ...s, at: now })), ...(prev.actions ?? [])].slice(0, 25);
    await env.KV.put('status', JSON.stringify({
      at: now, mode: 'full', head: snap?.head, elections: snap?.elections.length, tallier: svc.account?.address ?? null,
      tallierActive: snap?.tallier.active, error: err, deferredFundingLookups: deferred, subrequests: used, recent: logs.slice(-10), actions,
    }));
  }
}

export default {
  async scheduled(_ev: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(tick(env).catch(async (e) => {
      const msg = (e as Error).message.split('\n')[0];
      console.log('tick error: ' + msg);
      try { await env.KV.put('status', JSON.stringify({ at: Date.now(), mode: 'error', error: msg })); } catch {}
    }));
  },
};

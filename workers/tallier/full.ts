/**
 * HEAVY half of the vote robot (viem + the indexer service). Loaded by dynamic import only when a full pass is due.
 * Stateless: every duty (attest deposit votes, collapse sybils, answer challenges, sweep, finalize, seed, claim) is re-derived
 * from chain state each pass, so nothing is lost if a tick is skipped. KV holds only caches/status and a short send-dedupe key.
 *   • JSON-RPC batching + multicall + persisted log cursor (KV) so each pass scans only new blocks
 *   • subrequest counter with a hard cap (see shared.ts)
 *   • transactions are sent WITHOUT waiting for receipts, max 2 per pass, de-duplicated via KV (TTL 120 s)
 *   • attestation is held back while funding-source lookups are incomplete (never guess)
 */
import { custom, fallback, http, type Transport } from 'viem';
import { robinhood, isPrizeRulesConfigured, type Deployment, type LogCache } from '@flatland/core';
import { FlatlandService } from '../../packages/indexer/src/service.ts';
import { blockscoutProvider } from '../../packages/indexer/src/funding.ts';
import deploymentJson from '../../deployments/robinhood-mainnet.json';
import { budget, MAX_SUBREQUESTS, rpcList, logsRpcList, getLastGood, setLastGood, type Env } from './shared.ts';

const dep = deploymentJson as unknown as Deployment;
const MAX_WRITES = 2;
const BEAT_EVERY_MS = 10 * 60_000;
const NEVER = 9e15;
const ZERO = '0x0000000000000000000000000000000000000000';

/** per-pass RPC diagnostics (host, HTTP status, first bytes of a JSON-RPC error), surfaced in /api/status */
const diag: string[] = [];
const host = (u: string) => u.replace(/^https?:\/\//, '').split('/')[0];
const redact = (t: string) => t.replace(/(\/v2\/|[?&]api[_-]?key=|\/)[A-Za-z0-9_-]{20,}/gi, '$1<redacted>');
let logsLast = 0;
function fallbackOf(urls: string[], last: () => number, setLast: (i: number) => void): Transport {
  const n = urls.length;
  return fallback(
    Array.from({ length: n }, (_, k) => (last() + k) % n).map((i) =>
      http(urls[i], {
        batch: { batchSize: 20, wait: 8 }, retryCount: 0, timeout: 10_000,
        onFetchResponse: (r) => {
          if (r.ok) setLast(i);
          r.clone().text().then((t) => { if (!r.ok || /"error"/.test(t.slice(0, 300))) diag.push(redact(`${host(urls[i])} ${r.status} ${t.slice(0, 110).replace(/\s+/g, ' ')}`)); }).catch(() => {});
        },
      }),
    ),
    { retryCount: 0, rank: false },
  );
}
/** eth_getLogs goes to `logsUrls` (public endpoints with wide ranges); everything else (calls, blocks, gas, sends, receipts) to `urls` (keyed RPC first). */
function edgeTransport(urls: string[], logsUrls: string[]): Transport {
  const main = fallbackOf(urls, getLastGood, setLastGood);
  const logsT = fallbackOf(logsUrls, () => logsLast, (i) => { logsLast = i; });
  return (opts: any) => {
    const m = main(opts), l = logsT(opts);
    return custom({ request: (a: any) => (a.method === 'eth_getLogs' ? l : m).request(a) })(opts);
  };
}
const chainFor = (rpc: string) => ({ ...robinhood, rpcUrls: { default: { http: [rpc] } } });

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const bigSafe = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
const put = async (kv: KVNamespace, k: string, v: string) => { try { await kv.put(k, v); } catch (e) { console.log('kv put failed ' + k + ': ' + (e as Error).message.slice(0, 80)); } };

/** Log cache in KV (bigint-safe JSON). One bundle key so a pass is 1 read + at most 1 write, not one per contract. */
const enc = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? { $b: x.toString() } : x));
const dec = (t: string) => JSON.parse(t, (_, x) => (x && typeof x === 'object' && '$b' in x ? BigInt(x.$b) : x));
type LogEntry = { to: string; logs: any[] };
function bundledLogCache(kv: KVNamespace): LogCache & { flush(): Promise<void> } {
  let bundle: Record<string, LogEntry> | null = null;
  let dirty = false;
  const load = async () => {
    if (bundle) return bundle;
    const t = await kv.get('logs:bundle');
    bundle = t ? (dec(t) as Record<string, LogEntry>) : {};
    return bundle;
  };
  return {
    get: async (k) => {
      const b = await load();
      if (b[k]) return b[k];
      const t = await kv.get('logs:' + k); // migrate leftover per-contract keys on first miss
      if (!t) return null;
      const v = dec(t) as LogEntry;
      b[k] = v;
      dirty = true; // compact legacy per-contract keys into the bundle on the next flush
      return v;
    },
    put: async (k, v) => {
      const b = await load();
      const prev = b[k];
      if (prev && prev.to === v.to && enc(prev) === enc(v)) return;
      b[k] = v;
      dirty = true;
    },
    flush: async () => {
      if (!dirty || !bundle) return;
      await put(kv, 'logs:bundle', enc(bundle));
      dirty = false;
    },
  };
}


class EdgeService extends FlatlandService {
  writes = 0;
  sent: { fn: string; id: string; tx: string }[] = [];
  constructor(cfg: ConstructorParameters<typeof FlatlandService>[0], private kv: KVNamespace) { super(cfg); }
  protected async write(args: any) {
    if (this.writes >= MAX_WRITES) throw new Error('write cap reached for this pass (continues next minute)');
    if (budget.used > MAX_SUBREQUESTS - 14) throw new Error('not enough subrequest budget left to send a transaction');
    const key = 'sent:' + (await sha(args.functionName + JSON.stringify(args.args ?? [], bigSafe))).slice(0, 40);
    if (await this.kv.get(key)) throw new Error(`${args.functionName} already sent recently, waiting for it to land`);
    this.writes++;
    const hash = await super.write(args);
    await this.kv.put(key, hash, { expirationTtl: 120 });
    this.sent.push({ fn: args.functionName, id: String(args.args?.[0] ?? ''), tx: hash });
    return hash;
  }
}

export async function fullPass(env: Env, st: any, cheap: { sig: string; electionCount: number }, now: number): Promise<void> {
  diag.length = 0;
  const urls = rpcList(env);
  const logCache = bundledLogCache(env.KV);
  const cache = ((await env.KV.get('funding', { type: 'json' })) ?? {}) as Record<string, any>;
  let deferred = 0;
  const budgetedFetch: typeof fetch = ((i: any, init?: any) => {
    if (budget.used > MAX_SUBREQUESTS - 20) { deferred++; return Promise.reject(new Error('funding lookup deferred (budget)')); }
    return fetch(i, init);
  }) as any;
  const funding = blockscoutProvider(env.BLOCKSCOUT_URL ?? 'https://robinhoodchain.blockscout.com', 3, budgetedFetch);
  const logs: string[] = [];
  const svc = new EdgeService(
    {
      chain: chainFor(urls[0]), rpc: urls[0], transport: edgeTransport(urls, logsRpcList(env)), logCache, logRange: 1_000n,
      deployment: dep, funding, dataDir: '/tmp/none',
      publicDataUrl: `${(env.APP_URL ?? '').replace(/\/$/, '')}/data`,
      tallierKey: env.TALLIER_KEY as `0x${string}` | undefined,
      prizeRules: (isPrizeRulesConfigured(env.PRIZE_RULES) ? env.PRIZE_RULES : dep.prizeRules) as `0x${string}` | undefined,
      keeper: true, edge: true, canAttest: () => deferred === 0,
      log: (m) => { logs.push(m); console.log(m); },
    },
    env.KV,
  );
  for (const [k, v] of Object.entries(cache)) svc.fundingCache.set(k, v);
  const before = svc.fundingCache.size;

  let err: string | null = null;
  try { await svc.tick(); } catch (e) { err = redact(((e as any).shortMessage ?? (e as Error).message).split('\n')[0] + ((e as any).details ? ' | ' + String((e as any).details).slice(0, 120) : '')); console.log('tick failed: ' + err); } finally { await logCache.flush(); }
  let snap = svc.latest;
  // the basket section degrades silently to null when an RPC call fails; never park such a snapshot
  if (snap && !snap.basket) { err = err ?? 'basket read incomplete (RPC flaky), retrying'; snap = undefined; }
  const next: any = { ...st };

  if (svc.fundingCache.size !== before) await put(env.KV, 'funding', JSON.stringify(Object.fromEntries(svc.fundingCache)));

  if (snap) {
    const stable = JSON.stringify({ ...snap, generatedAt: 0, head: 0 }, bigSafe);
    const h = await sha(stable);
    if (h !== st.snapHash) { await put(env.KV, 'snapshot', JSON.stringify(snap, bigSafe)); next.snapHash = h; }
    for (const [id, plan] of svc.plans) {
      const a = JSON.stringify(plan.audit, bigSafe);
      const ah = (await sha(a)).slice(0, 16);
      if (st.audits?.[id] !== ah) { await put(env.KV, `audit:${id}`, a); next.audits = { ...(next.audits ?? {}), [id]: ah }; }
    }
    next.sig = cheap.sig;
    next.n = snap.elections.length;
    next.allFinal = snap.elections.every((e) => e.statusRaw === 2 && (e.executed || e.executor === ZERO) && !(e.drawBlock > 0 && /^0x0+$/.test(e.seed)));
    // when may the next full pass be skipped? never if any election needs time-based or follow-up work now
    const nowSec = Math.floor(now / 1000);
    const pending = snap.elections.some((e) => e.statusRaw === 1 && e.end <= nowSec) || snap.elections.some((e) => e.statusRaw === 2 && !(e.executed || e.executor === ZERO));
    const openEnds = snap.elections.filter((e) => e.statusRaw === 1 && e.end > nowSec).map((e) => e.end * 1000);
    next.wakeAt = pending || svc.sent.length || err ? 0 : openEnds.length ? Math.min(...openEnds) : NEVER;
    next.lastFull = now;
  } else {
    next.wakeAt = 0; // failed before a complete chain read: retry next minute
  }
  next.lastError = err;
  const beat = now - (st.lastBeat ?? 0) >= BEAT_EVERY_MS;
  if (beat) next.lastBeat = now;
  // Persist lastFull every successful/attempted full pass so the 5-minute open-election refresh stays accurate.
  await put(env.KV, 'state', JSON.stringify(next));

  const changedErr = err !== (st.lastError ?? null);
  if (beat || svc.sent.length || changedErr || deferred || !st.lastFull) {
    const prev: any = (await env.KV.get('status', { type: 'json' })) ?? {};
    const actions = [...svc.sent.map((s) => ({ ...s, at: now })), ...(prev.actions ?? [])].slice(0, 25);
    const status = {
      at: now, mode: 'full', head: snap?.head, elections: snap?.elections.length, tallier: svc.account?.address ?? null,
      tallierActive: snap?.tallier.active, error: err, deferredFundingLookups: deferred, subrequests: budget.used, recent: logs.slice(-10), rpcDiag: diag.slice(-8), actions,
    };
    const slim = (x: any) => JSON.stringify({ ...x, at: 0, subrequests: 0 });
    if (svc.sent.length || slim(prev) !== slim(status)) await put(env.KV, 'status', JSON.stringify(status));
  }
}

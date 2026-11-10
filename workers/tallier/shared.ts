// Tiny shared bits (no viem): env type, RPC list, subrequest budget. Imported by both the thin cron entry and the heavy full pass.
export interface Env {
  KV: KVNamespace;
  TALLIER_KEY?: string;
  RPC_URL?: string; // optional keyed endpoint(s), comma separated, tried first for everything except eth_getLogs
  LOGS_RPC_URL?: string; // optional endpoint(s) tried first for eth_getLogs only (keyed free tiers often cap log ranges)
  BLOCKSCOUT_URL?: string;
  APP_URL?: string;
  PRIZE_RULES?: string; // optional PrizeRules address; unset → payLucky is a no-op
}

export const MAX_SUBREQUESTS = 44; // free plan allows 50 external subrequests per invocation

/** Cloudflare's shared egress is rate-limited (HTTP 429) by the official public RPC, so use a fallback list. */
export const PUBLIC_RPCS = [
  'https://4663.rpc.thirdweb.com',
  'https://robinhood.api.pocket.network',
  'https://robinhood.drpc.org',
  'https://robinhood-rpc.publicnode.com',
  'https://rpc.mainnet.chain.robinhood.com',
];
const split = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !PUBLIC_RPCS.includes(x));
/** endpoints for reads, gas, sends, receipts (keyed RPC first) */
export function rpcList(env: Env): string[] { return [...split(env.RPC_URL), ...PUBLIC_RPCS]; }
/** endpoints for eth_getLogs: public list (wide ranges allowed) unless LOGS_RPC_URL is set */
export function logsRpcList(env: Env): string[] { return [...split(env.LOGS_RPC_URL), ...PUBLIC_RPCS]; }
let lastGood = 0; // index into rpcList() that answered last (warm isolates reuse it)
export const getLastGood = () => lastGood;
export const setLastGood = (i: number) => { lastGood = i; };

// ── subrequest budget: counts every outbound fetch of this invocation (installed once per isolate) ──
export const budget = { used: 0 };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: any, init?: any) => {
  if (++budget.used > MAX_SUBREQUESTS) return Promise.reject(new Error('subrequest budget exhausted'));
  return realFetch(input, init);
}) as typeof fetch;

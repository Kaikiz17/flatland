/**
 * Flatland vote robot as a Cloudflare Cron Trigger (every minute), free plan. THIN entry.
 *
 * Free-plan budget is 10 ms CPU and 50 subrequests per invocation, so this file imports no viem: an idle tick is one raw JSON-RPC
 * batch (nine counter reads) plus one KV read. Only when something changed, an election needs time-based work, or a periodic refresh is
 * due, it dynamically imports ./full.ts (viem + the indexer service) and runs a full pass.
 *
 * Secret: TALLIER_KEY (Worker secret). It is never logged or returned.
 */
import { budget, rpcList, getLastGood, setLastGood, type Env } from './shared.ts';

const HUB = '0x365c58F9B820990a1c1C1F2f77404ec57207b1C6';
const GATE = '0x0418cfe1D505d665c6F5A56De982EA991259B3e7';
const STANDING = '0x6E4d5caA2886b927660CFC8bb8938e12fa3F57f9';
const BASKET = '0x03B38516816cFeE9bFf2018D8A638a51ABe87b8b';
const BUYBACK = '0x2f8B80C302664Fd81F5c48604F279753487F32c9';
// [contract, 4-byte selector]: electionCount, totalVotes, totalBurned (hub); totalActs, totalBurned (gate); uniqueParticipants;
// basket totalSupply, totalFeesBurned; buyback totalWifBurned. Any of these moving means a full pass is due.
const COUNTERS: [string, string][] = [
  [HUB, '0x997d2830'], [HUB, '0x0d15fd77'], [HUB, '0xd89135cd'], [GATE, '0x498aa422'], [GATE, '0xd89135cd'],
  [STANDING, '0x3255dd19'], [BASKET, '0x18160ddd'], [BASKET, '0x72ccd69e'], [BUYBACK, '0xea4ff0d3'],
];
const FULL_EVERY_QUIET_MS = 30 * 60_000; // everything final: refresh the parked snapshot this often anyway
const FULL_EVERY_OPEN_MS = 5 * 60_000; // an election is running: keep the API snapshot (deposit-path votes) this fresh
const BEAT_EVERY_MS = 10 * 60_000;

const hostOf = (u: string) => u.replace(/^https?:\/\//, '').split('/')[0]; // never log full URLs: keyed endpoints carry the key in the path

async function rawSignature(urls: string[]): Promise<{ sig: string; electionCount: number }> {
  const body = JSON.stringify(COUNTERS.map(([to, data], id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] })));
  let lastErr = 'no rpc';
  for (let k = 0; k < urls.length; k++) {
    const i = (getLastGood() + k) % urls.length;
    try {
      const r = await fetch(urls[i], { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) { lastErr = `${hostOf(urls[i])} HTTP ${r.status}`; continue; }
      const j = (await r.json()) as { id: number; result?: string; error?: unknown }[];
      if (!Array.isArray(j) || j.length !== COUNTERS.length || j.some((x) => typeof x.result !== 'string')) { lastErr = `${hostOf(urls[i])} bad reply`; continue; }
      j.sort((a, b) => a.id - b.id);
      setLastGood(i);
      return { sig: j.map((x) => BigInt(x.result!).toString()).join(':'), electionCount: Number(BigInt(j[0].result!)) };
    } catch (e) { lastErr = `${hostOf(urls[i])} ${(e as Error).message.slice(0, 60).replace(/https?:\/\/\S+/g, '<url>')}`; }
  }
  throw new Error('all RPC endpoints failed: ' + lastErr);
}

async function tick(env: Env): Promise<void> {
  budget.used = 0;
  const now = Date.now();
  const st: any = (await env.KV.get('state', { type: 'json' })) ?? {};
  const cheap = await rawSignature(rpcList(env));
  const refreshEvery = st.allFinal ? FULL_EVERY_QUIET_MS : FULL_EVERY_OPEN_MS;
  const quiet = cheap.sig === st.sig && now < (st.wakeAt ?? 0) && now - (st.lastFull ?? 0) < refreshEvery;
  if (quiet) {
    if (now - (st.lastBeat ?? 0) >= BEAT_EVERY_MS) {
      await env.KV.put('state', JSON.stringify({ ...st, lastBeat: now, lastError: null }));
      await env.KV.put('status', JSON.stringify({ at: now, mode: 'idle', elections: cheap.electionCount, note: 'nothing changed on chain; next wake ' + (st.wakeAt >= 9e15 ? 'on change' : new Date(st.wakeAt).toISOString()), subrequests: budget.used }));
    }
    return;
  }
  const { fullPass } = await import('./full.ts');
  await fullPass(env, st, cheap, now);
}

export default {
  async scheduled(_ev: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      tick(env).catch(async (e) => {
        const msg = (e as Error).message.split('\n')[0];
        console.log('tick error: ' + msg);
        try { await env.KV.put('status', JSON.stringify({ at: Date.now(), mode: 'error', error: msg, subrequests: budget.used })); } catch { /* KV quota: ignore */ }
      }),
    );
  },
};

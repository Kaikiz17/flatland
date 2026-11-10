// Optional: primes the tallier's KV log cache from a machine with a good RPC, so cron passes on keyless public RPCs only scan new blocks.
//   npx tsx workers/prime-log-cache.mts > /tmp/prime.js     then run /tmp/prime.js with the Cloudflare connector's `execute`.
import { createPublicClient, http } from 'viem';
import { robinhood } from '../packages/core/src/chain.ts';
import dep from '../deployments/robinhood-mainnet.json' with { type: 'json' };
const KV_ID = process.env.KV_ID ?? 'e6591923eec1421e99674804fd5e5be0';
const c: any = createPublicClient({ chain: robinhood, transport: http(process.env.RPC) });
const to = (await c.getBlockNumber()) - 128n;
const enc = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? { $b: x.toString() } : x));
const out: Record<string, string> = {};
for (const a of [dep.flatland, dep.gate, dep.standing, dep.basket]) {
  const logs: any[] = [];
  for (let from = BigInt(dep.deployBlock); from <= to; from += 50_000n) logs.push(...(await c.getLogs({ address: a, fromBlock: from, toBlock: from + 49_999n > to ? to : from + 49_999n })));
  out['logs:all:' + a] = enc({ to: to.toString(), logs });
}
console.log(`async () => { const kv = ${JSON.stringify(out)}; const done = []; for (const [k, v] of Object.entries(kv)) { const r = await cloudflare.request({ method: 'PUT', path: \`/accounts/\${accountId}/storage/kv/namespaces/${KV_ID}/values/\${encodeURIComponent(k)}\`, body: v, contentType: 'text/plain' }); done.push([k.slice(0, 20), r.success]); } return done; }`);

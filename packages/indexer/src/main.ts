import { readFileSync, existsSync } from 'node:fs';
import { robinhood, localChain, type Deployment } from '@flatland/core';
import { FlatlandService } from './service.js';
import { startServer } from './server.js';
import { blockscoutProvider, rpcScanProvider } from './funding.js';
import { createPublicClient, http } from 'viem';

const env = process.env;
const rpc = env.RPC ?? 'http://127.0.0.1:8545';
const depPath = env.DEPLOYMENT ?? '../../deployments/local.json';
if (!existsSync(depPath)) throw new Error(`deployment file not found: ${depPath} (set DEPLOYMENT=...)`);
const deployment = JSON.parse(readFileSync(depPath, 'utf8')) as Deployment;
const local = env.LOCAL === '1' || /127\.0\.0\.1|localhost/.test(rpc);
const chain = local ? localChain(rpc) : { ...robinhood, rpcUrls: { default: { http: [rpc] } } };
const port = Number(env.PORT ?? 8787);
const funding = local
  ? rpcScanProvider(createPublicClient({ chain, transport: http(rpc) }) as any, BigInt(deployment.deployBlock))
  : blockscoutProvider(env.BLOCKSCOUT ?? 'https://robinhoodchain.blockscout.com');

const svc = new FlatlandService({
  chain, rpc, deployment, funding,
  dataDir: env.DATA_DIR ?? './data',
  publicDataUrl: env.PUBLIC_DATA_URL ?? `http://127.0.0.1:${port}/data`,
  tallierKey: (env.TALLIER_KEY as `0x${string}`) || undefined,
  keeper: env.KEEPER !== '0',
});

startServer(svc, port);
const every = Number(env.POLL_MS ?? 4000);
let busy = false;
const loop = async () => {
  if (busy) return;
  busy = true;
  try { await svc.tick(); } catch (e) { svc.log('tick failed: ' + (e as Error).message.split('\n')[0]); } finally { busy = false; }
};
await loop();
setInterval(loop, every);
svc.log(`flatland indexer up on :${port} — tallier ${svc.account?.address ?? 'READ-ONLY (set TALLIER_KEY)'}`);

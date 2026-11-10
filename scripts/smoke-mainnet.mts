// Read-only smoke test of the mainnet deployment through the same reader the web app uses.
import { createPublicClient, http } from 'viem';
import { readFileSync } from 'node:fs';
import { readSnapshot, robinhood } from '@flatland/core';
const dep = JSON.parse(readFileSync(new URL('../deployments/robinhood-mainnet.json', import.meta.url), 'utf8'));
const client = createPublicClient({ chain: robinhood, transport: http('https://rpc.mainnet.chain.robinhood.com') });
const snap = await readSnapshot(client as any, dep);
console.log(JSON.stringify({ head: snap.head, elections: snap.elections.length, gates: snap.gates.length, totals: snap.totals, basket: snap.basket && { assets: snap.basket.assets.length, nav: snap.basket.navUsdg, walletCap: snap.basket.walletCap, tvlCap: snap.basket.tvlCap, governance: snap.basket.governance } }, null, 1));

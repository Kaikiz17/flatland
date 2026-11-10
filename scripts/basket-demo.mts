// Demo helper (local fork only): fast-forward the demo so the People's Basket epoch finalizes, rebalances into real Stock Tokens, and burns fees.
// Run AFTER scripts/demo-local.sh is up (the indexer's keeper finalizes the election). Uses MockFeed oracles because time-warping makes real feeds stale.
import { createPublicClient, createTestClient, createWalletClient, http, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basketVaultAbi, localChain } from '@flatland/core';
const rpc = process.env.RPC ?? 'http://127.0.0.1:8545';
const dep = JSON.parse(readFileSync(new URL('../deployments/local.json', import.meta.url), 'utf8'));
const chain = localChain(rpc);
const pub = createPublicClient({ chain, transport: http(rpc) });
const test = createTestClient({ chain, transport: http(rpc), mode: 'anvil' });
const acct = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const w = createWalletClient({ chain, transport: http(rpc), account: acct });
const feedAbi = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const;
const send = async (fn: string, args: any[] = []) => { const h = await w.writeContract({ address: dep.basket, abi: basketVaultAbi, functionName: fn, args, chain, account: acct, gas: 6_000_000n } as any); const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== 'success') throw new Error(fn + ' reverted'); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const warp = async (s: number) => { await test.increaseTime({ seconds: s }); await test.mine({ blocks: 1 }); };
const code = execSync('forge inspect MockFeed deployedBytecode', { cwd: new URL('../contracts', import.meta.url).pathname, encoding: 'utf8' }).trim() as Hex;
const n = Number(await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'assetCount' }));
for (let i = 0; i < n; i++) {
  const a = (await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'assetAt', args: [BigInt(i)] })) as any;
  const r = (await pub.readContract({ address: a.feed as Address, abi: feedAbi, functionName: 'latestRoundData' })) as any;
  await test.setCode({ address: a.feed, bytecode: code });
  await test.setStorageAt({ address: a.feed, index: '0x0', value: ('0x' + BigInt(r[1]).toString(16).padStart(64, '0')) as Hex });
}
await warp(5 * 86_400 + 5); await sleep(8000); await warp(13 * 3600);
for (let i = 0; i < 40; i++) { const t = (await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'targets' })) as number[]; if (t.some((x) => x > 0)) { console.log('weights (bps):', t.join(',')); break; } await sleep(3000); if (i === 39) throw new Error('keeper did not finalize'); }
await send('rebalance'); console.log('rebalanced');
await warp(2 * 3600); await send('buybackAndBurn', [1n]).then(() => console.log('buyback burned'), (e) => console.log('buyback skipped:', e.shortMessage ?? e.message));

/* Seeds a live-looking demo on a local fork: elections, votes (with sybils + deposit-path), rails, basket epoch.
   Run via scripts/demo-local.sh. LIVE=1 keeps casting votes so the live room stays alive. */
import { readFileSync } from 'node:fs';
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, maxUint256, keccak256, encodeAbiParameters, type Address, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { localChain, flatlandAbi, wifGateAbi, standingAbi, erc20Abi, basketVaultAbi, depositAddress, ONE_WIF, type Deployment } from '@flatland/core';

const rpc = process.env.RPC ?? 'http://127.0.0.1:8545';
const dep = JSON.parse(readFileSync(process.env.DEPLOYMENT ?? 'deployments/local.json', 'utf8')) as Deployment;
const chain = localChain(rpc);
const pub = createPublicClient({ chain, transport: http(rpc) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(rpc) });
const mk = (key: Hex) => { const account = privateKeyToAccount(key); return { account, w: createWalletClient({ account, chain, transport: http(rpc) }) }; };
const send = async (u: ReturnType<typeof mk>, address: Address, abi: any, functionName: string, args: any[] = []) => {
  const hash = await u.w.writeContract({ address, abi, functionName, args, chain, account: u.account } as any);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(functionName + ' reverted');
};
const WHALE = '0x8366a39cc670b4001a1121b8f6a443a643e40951' as Address;
const USDG_SRC = '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3' as Address;
async function grant(token: Address, from: Address, to: Address, amt: bigint) {
  await test.impersonateAccount({ address: from });
  await test.setBalance({ address: from, value: parseEther('5') });
  const h = await createWalletClient({ chain, transport: http(rpc), account: from }).writeContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [to, amt], chain, account: from } as any);
  await pub.waitForTransactionReceipt({ hash: h });
  await test.stopImpersonatingAccount({ address: from });
}
const CREATOR = mk('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'); // anvil #2
const COUNTRIES = ['NG', 'NG', 'NG', 'US', 'US', 'BR', 'IN', 'DE', 'JP', 'KE', 'GB', 'FR', 'ZA', 'GH', 'MX', 'ID', 'PH', 'EG', 'TR', 'AR'];
const funders = Array.from({ length: 6 }, () => mk(generatePrivateKey()));
/** Instant demo funding: write the OZ ERC20 balance slot directly (mapping at slot 0). Falls back to a real transfer if the layout differs. */
async function setWif(to: Address, amt: bigint) {
  const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [to, 0n]));
  await test.setStorageAt({ address: dep.wif, index: slot, value: ('0x' + amt.toString(16).padStart(64, '0')) as Hex });
  const bal = (await pub.readContract({ address: dep.wif, abi: erc20Abi, functionName: 'balanceOf', args: [to] })) as bigint;
  if (bal !== amt) await grant(dep.wif, WHALE, to, amt);
}
async function newVoter(opts: { funder?: ReturnType<typeof mk>; country?: boolean; wif?: bigint } = {}) {
  const v = mk(generatePrivateKey());
  if (opts.funder) {
    // real ETH funding transaction => the indexer can see a shared funding source (used for the sybil-farm demo)
    await test.setBalance({ address: opts.funder.account.address, value: parseEther('50') });
    const h = await opts.funder.w.sendTransaction({ to: v.account.address, value: parseEther('0.002'), chain, account: opts.funder.account } as any);
    await pub.waitForTransactionReceipt({ hash: h });
  } else await test.setBalance({ address: v.account.address, value: parseEther('0.01') });
  await setWif(v.account.address, opts.wif ?? 25n * ONE_WIF);
  await send(v, dep.wif, erc20Abi, 'approve', [dep.flatland, maxUint256]);
  if (opts.country !== false && Math.random() < 0.8) {
    const cc = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
    await send(v, dep.standing, standingAbi, 'setCountry', ['0x' + [...cc].map((c) => c.charCodeAt(0).toString(16)).join('')]);
  }
  return v;
}
const weighted = (n: number, bias: number[]) => { const t = bias.reduce((a, b) => a + b, 0); let r = Math.random() * t; for (let i = 0; i < n; i++) { r -= bias[i]; if (r <= 0) return i; } return n - 1; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('seeding demo…');
await test.setBalance({ address: CREATOR.account.address, value: parseEther('50') });
await grant(dep.wif, WHALE, CREATOR.account.address, 1_000n * ONE_WIF);
await send(CREATOR, dep.wif, erc20Abi, 'approve', [dep.flatland, maxUint256]);
const now = Number((await pub.getBlock()).timestamp);
const create = async (title: string, options: string[], dur: number, extra: Partial<Record<string, any>> = {}) => {
  await send(CREATOR, dep.flatland, flatlandAbi, 'createElection', [{ title, options, metaURI: '', start: 0n, end: BigInt(now + dur), voteCost: ONE_WIF, tallier: dep.tallier, executor: '0x0000000000000000000000000000000000000000', challengeWindow: 12n * 3600n, winners: 0, prizeToken: dep.wif, challengeBurn: 0n, ...extra }]);
  return Number(await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'electionCount' }));
};
const e1 = await create('Which Stock Token should the world buy first?', ['NVDA', 'SPY', 'TSLA', 'AAPL'], 7 * 86400, { winners: 3 });
await send(CREATOR, dep.flatland, flatlandAbi, 'fundPrize', [BigInt(e1), 60n * ONE_WIF]);
const e2 = await create('Where should the next World is Flat meetup be?', ['Lagos', 'Nairobi', 'São Paulo', 'Berlin'], 3 * 86400);
const e3 = await create('Should vote cost go up to 5 $WIF in 2027?', ['Yes, burn more', 'No, keep it flat'], 6 * 3600);

const vote = async (v: ReturnType<typeof mk>, id: number, o: number) => send(v, dep.flatland, flatlandAbi, 'vote', [BigInt(id), o]);
const bias1 = [5, 3, 4, 2];
for (let i = 0; i < 12; i++) { const v = await newVoter(); await vote(v, e1, weighted(4, bias1)); process.stdout.write('.'); }
// a sybil farm: same funder
const farm = funders[0];
for (let i = 0; i < 3; i++) { const v = await newVoter({ funder: farm, country: false }); await vote(v, e1, 2); process.stdout.write('s'); }
// deposit-path voters (just send 1 WIF)
for (let i = 0; i < 3; i++) { const v = await newVoter({ country: false }); const o = i % 4; await send(v, dep.wif, erc20Abi, 'transfer', [depositAddress(dep.flatland, dep.boxImpl, e1, o), ONE_WIF]); process.stdout.write('d'); }
for (let i = 0; i < 8; i++) { const v = await newVoter(); await vote(v, e2, weighted(4, [4, 3, 3, 2])); process.stdout.write('.'); }
for (let i = 0; i < 5; i++) { const v = await newVoter(); await vote(v, e3, weighted(2, [3, 2])); process.stdout.write('.'); }

// rails
await send(CREATOR, dep.gate, wifGateAbi, 'createGate', [0, 'Open the markets to everyone: sign the flat-world petition', '', 0n, 0n, ONE_WIF, 0]);
await send(CREATOR, dep.gate, wifGateAbi, 'createGate', [1, 'Lagos holders meetup — Friday 7pm (20 seats)', '', 0n, 0n, ONE_WIF, 20]);
for (let i = 0; i < 9; i++) { const v = await newVoter(); await send(v, dep.wif, erc20Abi, 'approve', [dep.gate, maxUint256]); await send(v, dep.gate, wifGateAbi, 'act', [1n]); if (i < 5) await send(v, dep.gate, wifGateAbi, 'act', [2n]); process.stdout.write('r'); }

// basket
// Beta caps are live: max 100 USDG per wallet, 1,000 USDG total. Four depositors, ~99 USDG each (gross incl. 0.30% fee).
for (let i = 0; i < 4; i++) {
  const d = mk(generatePrivateKey());
  await test.setBalance({ address: d.account.address, value: parseEther('0.05') });
  await grant(dep.usdg, USDG_SRC, d.account.address, 99n * 10n ** 6n);
  await send(d, dep.usdg, erc20Abi, 'approve', [dep.basket, maxUint256]);
  await send(d, dep.basket, basketVaultAbi, 'deposit', [99n * 10n ** 6n, 0n, d.account.address]);
}
await send(CREATOR, dep.basket, basketVaultAbi, 'openEpoch');
const ep = (await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'epochInfo', args: [1n] })) as any;
for (let i = 0; i < 10; i++) { const v = await newVoter(); await vote(v, Number(ep.electionId), weighted(ep.assets.length, [5, 4, 4, 3, 3, 2, 1, 1, 1, 1, 1].slice(0, ep.assets.length))); process.stdout.write('b'); }
console.log(`\nseeded: elections ${e1},${e2},${e3}; basket election ${ep.electionId}; rails 1,2`);

if (process.env.LIVE === '1') {
  console.log('LIVE mode: casting a vote every ~4s (ctrl-c to stop)');
  for (;;) {
    try {
      const id = [e1, e2, e3][Math.floor(Math.random() * 3)];
      const n = id === e1 ? 4 : id === e2 ? 4 : 2;
      const v = await newVoter();
      if (id === e1 && Math.random() < 0.3) await send(v, dep.wif, erc20Abi, 'transfer', [depositAddress(dep.flatland, dep.boxImpl, id, Math.floor(Math.random() * n)), ONE_WIF]);
      else await vote(v, id, Math.floor(Math.random() * n));
      console.log('live vote on', id);
    } catch (e) { console.log('live vote failed', (e as Error).message.split('\n')[0]); }
    await sleep(3000);
  }
}
process.exit(0);

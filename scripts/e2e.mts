/* Full-system scenario on the local fork. Asserts as it goes; exits non-zero on any failure. */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, maxUint256, getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  localChain, buildSponsoredVoteOp, accountAddress, entryPointAbi, ENTRY_POINT_V07, flatPaymasterAbi, flatlandAbi, wifGateAbi, standingAbi, erc20Abi, basketVaultAbi, depositAddress, ONE_WIF, type Deployment, type ElectionView,
} from '@flatland/core';
import { FlatlandService } from '../packages/indexer/src/service.ts';
import { staticProvider } from '../packages/indexer/src/funding.ts';

const rpc = process.env.RPC ?? 'http://127.0.0.1:8545';
const dep = JSON.parse(readFileSync('deployments/local.json', 'utf8')) as Deployment;
const chain = localChain(rpc);
const pub = createPublicClient({ chain, transport: http(rpc) });
const test = createTestClient({ chain, mode: 'anvil', transport: http(rpc) });
const DEV_KEYS = { creator: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', tallier: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' } as const;

let step = 0;
const say = (m: string) => console.log(`\n[${String(++step).padStart(2, '0')}] ${m}`);
const ok = (c: unknown, m: string) => { if (!c) { console.error('✗ ASSERT FAILED: ' + m); process.exit(1); } console.log('   ✓ ' + m); };
const mk = (key: Hex) => { const account = privateKeyToAccount(key); return { account, w: createWalletClient({ account, chain, transport: http(rpc) }) }; };
const send = async (w: ReturnType<typeof mk>, address: Address, abi: any, functionName: string, args: any[] = []) => {
  const hash = await w.w.writeContract({ address, abi, functionName, args, chain, account: w.account } as any);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${functionName} reverted`);
  return rc;
};
const warp = async (sec: number) => { await test.increaseTime({ seconds: sec }); await test.mine({ blocks: 1 }); };
const wifBal = (a: Address) => pub.readContract({ address: dep.wif, abi: erc20Abi, functionName: 'balanceOf', args: [a] }) as Promise<bigint>;
const supply = () => pub.readContract({ address: dep.wif, abi: erc20Abi, functionName: 'totalSupply' }) as Promise<bigint>;

// real WIF whale to bankroll test wallets: the Uniswap v4 PoolManager (holds ~36M WIF); we only impersonate on the local fork
const feedAbi = [{ type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }] }] as const;
/** The e2e warps weeks ahead; real Chainlink feeds would (correctly) read stale. Swap in a fresh-answer mock holding the real last price. */
async function refreshFeeds() {
  const code = execSync('forge inspect MockFeed deployedBytecode', { cwd: 'contracts', encoding: 'utf8' }).trim() as Hex;
  const n = Number(await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'assetCount' }));
  for (let i = 0; i < n; i++) {
    const as = (await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'assetAt', args: [BigInt(i)] })) as any;
    const r = (await pub.readContract({ address: as.feed, abi: feedAbi, functionName: 'latestRoundData' })) as any;
    await test.setCode({ address: as.feed, bytecode: code });
    await test.setStorageAt({ address: as.feed, index: '0x0', value: ('0x' + BigInt(r[1]).toString(16).padStart(64, '0')) as Hex });
  }
}

const WHALE = '0x8366a39cc670b4001a1121b8f6a443a643e40951' as Address;
async function giveWif(to: Address, amt: bigint) {
  await test.impersonateAccount({ address: WHALE });
  await test.setBalance({ address: WHALE, value: parseEther('10') });
  const hash = await createWalletClient({ chain, transport: http(rpc), account: WHALE }).writeContract({ address: dep.wif, abi: erc20Abi, functionName: 'transfer', args: [to, amt], chain, account: WHALE } as any);
  await pub.waitForTransactionReceipt({ hash });
  await test.stopImpersonatingAccount({ address: WHALE });
}

const creator = mk(DEV_KEYS.creator);
const tallier = mk(DEV_KEYS.tallier);
const funders = { f1: mk(generatePrivateKey()), f2: mk(generatePrivateKey()), f3: mk(generatePrivateKey()) };
const mkVoter = async (funder: ReturnType<typeof mk>) => {
  const v = mk(generatePrivateKey());
  const hash = await funder.w.sendTransaction({ to: v.account.address, value: parseEther('0.001'), chain, account: funder.account } as any);
  await pub.waitForTransactionReceipt({ hash });
  await giveWif(v.account.address, 50n * ONE_WIF);
  return v;
};

say('Fund actors with ETH (local fork only) and WIF (real token, transferred from a whale)');
for (const a of [creator, tallier, funders.f1, funders.f2, funders.f3]) await test.setBalance({ address: a.account.address, value: parseEther('10') });
await giveWif(creator.account.address, 500n * ONE_WIF);

say('Creator launches an election: "Which Stock Token should the world buy first?"  (3 options, prize pool 30 WIF, 3 draw slots)');
const start = BigInt((await pub.getBlock()).timestamp);
const params = {
  title: 'Which Stock Token should the world buy first?', options: ['NVDA', 'SPY', 'TSLA'], metaURI: 'ipfs://demo', start: 0n, end: start + 86_400n,
  voteCost: ONE_WIF, tallier: tallier.account.address, executor: '0x0000000000000000000000000000000000000000' as Address, challengeWindow: 6n * 3600n,
  winners: 3, prizeToken: dep.wif, challengeBurn: 0n,
};
await send(creator, dep.wif, erc20Abi, 'approve', [dep.flatland, maxUint256]);
await send(creator, dep.flatland, flatlandAbi, 'createElection', [params]);
const id = 1n;
await send(creator, dep.flatland, flatlandAbi, 'fundPrize', [id, 30n * ONE_WIF]);
// TS deposit address must equal the contract's
for (let o = 0; o < 3; o++) {
  const onchain = (await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'depositAddress', args: [id, o] })) as Address;
  ok(getAddress(onchain) === depositAddress(dep.flatland, dep.boxImpl, id, o), `deposit address for option ${o} matches CREATE2 prediction: ${onchain}`);
}

say('Voters. Honest voters funded by different wallets; a sybil farm funded by ONE wallet (f1) votes on-chain AND via deposit boxes');
const honest1 = await mkVoter(funders.f2);
const honest2 = await mkVoter(funders.f3);
const sybilKeeper = await mkVoter(funders.f1);
const sybilChain = await mkVoter(funders.f1);
const sybilDeposit = await mkVoter(funders.f1);
const depositHonest = await mkVoter(funders.f2.account.address === honest1.account.address ? funders.f3 : funders.f3);
const sup0 = await supply();
for (const [v, opt] of [[honest1, 0], [sybilKeeper, 2], [sybilChain, 2]] as const) {
  await send(v, dep.wif, erc20Abi, 'approve', [dep.flatland, maxUint256]);
  await send(v, dep.flatland, flatlandAbi, 'vote', [id, opt]);
}
// "just send 1 WIF": plain transfers to the option's deposit address — no wallet connect, no signing of anything but a transfer
const box1 = depositAddress(dep.flatland, dep.boxImpl, id, 1);
const box2 = depositAddress(dep.flatland, dep.boxImpl, id, 2);
await send(depositHonest, dep.wif, erc20Abi, 'transfer', [box1, ONE_WIF]);
await send(sybilDeposit, dep.wif, erc20Abi, 'transfer', [box2, 7n * ONE_WIF]); // extra WIF: counts once, still burned
await send(honest2, dep.wif, erc20Abi, 'transfer', [box1, ONE_WIF]);
ok((await wifBal(box1)) === 2n * ONE_WIF, 'boxes hold the transferred WIF (counterfactual addresses, no code yet)');

say('Fairness check BEFORE the election ends (live indexer pass: clustering by funding source)');
const funding = (async () => {
  const m: Record<string, Address> = {};
  for (const v of [sybilKeeper, sybilChain, sybilDeposit]) m[v.account.address.toLowerCase()] = funders.f1.account.address;
  m[honest1.account.address.toLowerCase()] = funders.f2.account.address;
  m[depositHonest.account.address.toLowerCase()] = funders.f3.account.address;
  m[honest2.account.address.toLowerCase()] = funders.f3.account.address; // honest2 & depositHonest share f3 → they are a cluster too (documented false-positive risk class)
  return m;
})();
const svc = new FlatlandService({
  chain, rpc, deployment: dep, dataDir: '/tmp/flatland-e2e', publicDataUrl: 'http://127.0.0.1:8787/data',
  funding: staticProvider(await funding), tallierKey: DEV_KEYS.tallier, keeper: true, log: (m) => console.log('   · indexer:', m),
});
let snap = await svc.tick();
let a = snap.analysis[1];
ok(snap.elections[0].chainVotes.length === 3 && snap.elections[0].depositVotes.length === 3, 'indexer sees 3 connect-wallet votes and 3 deposit-path votes');
ok(a.collapsed >= 2, `sybil cluster detected: ${a.collapsed} wallets collapse into earlier votes`);
console.log('   fairness:', JSON.stringify(a.fairness));

say('Election ends → tallier collapses sybils on-chain, attests deposit votes (Merkle root + published groups), keeper burns deposit boxes');
await warp(86_400 + 5);
await svc.tick();
const el = (await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'getElection', args: [id] })) as any;
ok(el.depositsSubmitted, 'deposit result attested on-chain');
ok((await wifBal(box1)) === 0n && (await wifBal(box2)) === 0n, 'deposit boxes swept: WIF burned');
const tallies = (await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'tallies', args: [id] })) as bigint[];
console.log('   tallies (NVDA,SPY,TSLA):', tallies.map(String).join(','));
ok(tallies.reduce((x, y) => x + y, 0n) <= 4n, '1 wallet = 1 vote: sybil wallets were collapsed (≤4 counted of 6 voters)');
ok(tallies[2] <= 1n, 'the f1 sybil farm counts as ONE vote');

say('Challenge-by-burn: anyone can formally accuse a wallet by burning WIF');
// (election is past its end; challenges are allowed until finalize) — challenge an innocent wallet, tallier rejects
await giveWif(honest1.account.address, 20n * ONE_WIF);
const supBeforeChallenge = await supply();
await send(honest1, dep.flatland, flatlandAbi, 'challenge', [id, honest1.account.address, 'self-challenge demo']);
ok((await supply()) === supBeforeChallenge - 10n * ONE_WIF, 'challenge burned 10 WIF');
await svc.tick();
const ch = (await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'getChallenge', args: [id, 0n] })) as any;
ok(ch.resolved && !ch.upheld, 'tallier resolved the challenge (rejected: wallet is independent)');

say('Challenge window passes → finalize → future-block draw → prize claims with Merkle proofs');
await warp(7 * 3600);
await svc.tick(); // keeper finalizes
const fin = (await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'getElection', args: [id] })) as any;
ok(fin.status === 2, `finalized; winner = option ${fin.winner}`);
await test.mine({ blocks: 12 });
await svc.tick(); // keeper seeds the draw
const seeded = (await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'getElection', args: [id] })) as any;
ok(seeded.seed !== '0x' + '00'.repeat(32), 'draw seeded from a future block hash');
const entries = Number(await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'totalEntries', args: [id] }));
const chainCount = Number(await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'voterCount', args: [id] }));
const plan = svc.plans.get(1)!;
let paid = 0n;
for (let slot = 0; slot < 3; slot++) {
  const idx = Number(await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'winnerIndex', args: [id, BigInt(slot)] }));
  let voter: Address, option = 0, proof: Hex[] = [];
  if (idx < chainCount) voter = (await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'voterAt', args: [id, BigInt(idx)] })) as Address;
  else { const e = plan.entries[idx - chainCount]; voter = e.voter; option = e.option; proof = plan.proofs[idx - chainCount]; }
  const before = await wifBal(voter);
  await send(creator, dep.flatland, flatlandAbi, 'claimPrize', [id, BigInt(slot), BigInt(idx), voter, option, proof]);
  paid += (await wifBal(voter)) - before;
}
ok(paid === 30n * ONE_WIF, `all 3 prize slots claimed through proofs (${entries} entries incl. deposit-path voters)`);

say('Reputation: deposit-path voters get streak credit permissionlessly (keeper claimStanding)');
await svc.tick();
const counted = plan.entries.findIndex((e) => e.voter.toLowerCase() === depositHonest.account.address.toLowerCase());
ok(counted >= 0, 'the honest deposit-path voter is in the attested set');
const proofOk = await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'isEntry', args: [id, BigInt(chainCount + counted), depositHonest.account.address, plan.entries[counted].option, plan.proofs[counted]] });
ok(proofOk === true, 'on-chain Merkle verification accepts the TS-built proof (leaf encoding matches)');
const rec = (await pub.readContract({ address: dep.standing, abi: standingAbi, functionName: 'record', args: [depositHonest.account.address] })) as any;
ok(rec.votes === 1, 'standing credited: deposit-path voter now has 1 vote and a streak');

say('"Send 1 WIF to act" rail: petition gate + widget contract hook');
await send(creator, dep.gate, wifGateAbi, 'createGate', [0, 'Level the ground: open finance for all', 'ipfs://petition', 0n, 0n, ONE_WIF, 0]);
const s2 = await supply();
await send(honest1, dep.wif, erc20Abi, 'approve', [dep.gate, maxUint256]);
await send(honest1, dep.gate, wifGateAbi, 'act', [1n]);
ok((await pub.readContract({ address: dep.gate, abi: wifGateAbi, functionName: 'hasActed', args: [1n, honest1.account.address] })) === true, 'hasActed(gate, wallet) = true');
ok((await supply()) === s2 - ONE_WIF, 'gate act burned 1 WIF');

say("People's Basket: open epoch → vote → finalize → rebalance with real Uniswap swaps → buyback+burn");
const USDG_POOL = '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3' as Address; // v3 NVDA/USDG 0.05% pool (≈231k USDG), impersonated only to source test USDG
await test.impersonateAccount({ address: USDG_POOL });
await test.setBalance({ address: USDG_POOL, value: parseEther('1') });
const whaleW = createWalletClient({ chain, transport: http(rpc), account: USDG_POOL });
const lp = (await pub.readContract({ address: dep.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [USDG_POOL] })) as bigint;
ok(lp > 20_000n * 10n ** 6n, `found real USDG liquidity to borrow on the fork (${lp / 10n ** 6n} USDG)`);
const lpTx = await whaleW.writeContract({ address: dep.usdg, abi: erc20Abi, functionName: 'transfer', args: [creator.account.address, 20_000n * 10n ** 6n], chain, account: USDG_POOL } as any);
await pub.waitForTransactionReceipt({ hash: lpTx });
await test.stopImpersonatingAccount({ address: USDG_POOL });
await send(creator, dep.usdg, erc20Abi, 'approve', [dep.basket, maxUint256]);
{
  // beta safety caps: defaults 100 USDG per wallet / 1,000 USDG TVL
  const rd = (fn: string, args: any[] = []) => pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: fn, args } as any) as Promise<bigint>;
  ok((await rd('walletCap')) === 100n * 10n ** 6n && (await rd('tvlCap')) === 1_000n * 10n ** 6n, 'default beta caps: 100 USDG per wallet, 1,000 USDG total');
  let blocked = false;
  try { await pub.simulateContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'deposit', args: [150n * 10n ** 6n, 0n, creator.account.address], account: creator.account } as any); } catch { blocked = true; }
  ok(blocked, 'a 150 USDG deposit is rejected by the per-wallet cap');
  await send(creator, dep.basket, basketVaultAbi, 'deposit', [99n * 10n ** 6n, 0n, creator.account.address]);
  ok((await rd('maxDeposit', [creator.account.address])) < 2n * 10n ** 6n, 'after a 99 USDG deposit the wallet has <2 USDG of room left');
  // governance (the deployer on this devnet) raises the caps only so the big-basket scenario below can run; a real launch keeps them small
  const gov = mk('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  await send(creator, dep.basket, basketVaultAbi, 'redeem', [await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'balanceOf', args: [creator.account.address] }), 0n, creator.account.address]);
  let nonGov = false;
  try { await pub.simulateContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'setCaps', args: [1n, 1n], account: creator.account } as any); } catch { nonGov = true; }
  ok(nonGov, 'only governance can change the caps');
  await send(gov, dep.basket, basketVaultAbi, 'setCaps', [100_000n * 10n ** 6n, 100_000n * 10n ** 6n]);
}
await send(creator, dep.basket, basketVaultAbi, 'deposit', [19_900n * 10n ** 6n, 0n, creator.account.address]);
await send(creator, dep.basket, basketVaultAbi, 'openEpoch');
const epoch = (await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'epochInfo', args: [1n] })) as any;
const bid = epoch.electionId as bigint;
const picks = [2, 2, 2, 1, 1, 0, 3];
for (const p of picks) {
  const v = await mkVoter(funders.f2);
  await send(v, dep.wif, erc20Abi, 'approve', [dep.flatland, maxUint256]);
  await send(v, dep.flatland, flatlandAbi, 'vote', [bid, p]);
}
await warp(5 * 86_400 + 5);
await svc.tick(); // tallier attests (no deposit votes) and keeper tends the election
await warp(13 * 3600); // challenge window
await svc.tick(); // keeper finalizes → basket executor applies the people's weights
const tg = (await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'targets' })) as number[];
console.log('   target weights (bps):', tg.join(','));
ok(tg.reduce((x, y) => x + y, 0) === 10_000, 'people-chosen weights sum to 100%');
await refreshFeeds();
await send(creator, dep.basket, basketVaultAbi, 'rebalance');
const nAssets = Number(await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'assetCount' }));
let holdings = 0;
for (let i = 0; i < nAssets; i++) {
  const as = (await pub.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'assetAt', args: [BigInt(i)] })) as any;
  const b = (await pub.readContract({ address: as.token, abi: erc20Abi, functionName: 'balanceOf', args: [dep.basket] })) as bigint;
  if (b > 0n) { holdings++; console.log(`   holds ${as.symbol}: ${Number(b) / 1e18}`); }
}
ok(holdings >= 3, `basket now holds ${holdings} real Stock Tokens bought on Uniswap, weighted by 1-wallet-1-vote`);
await warp(3600 * 2);
const sBefore = await supply();
await send(creator, dep.basket, basketVaultAbi, 'buybackAndBurn', [1n]);
const burned = sBefore - (await supply());
ok(burned > 0n, `vault fees bought and BURNED ${Number(burned / 10n ** 18n).toLocaleString()} WIF on Uniswap v4`);

say('Gasless first vote: a newcomer with ZERO ETH votes through the real ERC-4337 EntryPoint, gas paid by the capped paymaster');
const gId = Number(await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'electionCount' })) + 1;
await send(creator, dep.flatland, flatlandAbi, 'createElection', [{ ...params, title: 'Gasless demo', end: BigInt((await pub.getBlock()).timestamp) + 86_400n, winners: 0, tallier: '0x0000000000000000000000000000000000000000' }]);
{
  const hash = await creator.w.writeContract({ address: dep.paymaster, abi: flatPaymasterAbi, functionName: 'fund', args: [], value: parseEther('0.05'), chain, account: creator.account } as any);
  await pub.waitForTransactionReceipt({ hash });
}
const newbie = privateKeyToAccount(generatePrivateKey());
const acct = await accountAddress(pub as any, dep, newbie.address, 1n);
await giveWif(acct, 5n * ONE_WIF);
ok((await pub.getBalance({ address: acct })) === 0n, `smart account ${acct} holds 5 WIF and exactly 0 ETH`);
const supG = await supply();
const op = await buildSponsoredVoteOp({ client: pub as any, dep, owner: newbie.address, salt: 1n, electionId: gId, option: 1, sign: (h) => newbie.signMessage({ message: { raw: h } }) });
const bh = await creator.w.writeContract({ address: ENTRY_POINT_V07, abi: entryPointAbi, functionName: 'handleOps', args: [[op], creator.account.address], chain, account: creator.account, gas: 3_000_000n } as any); // the bundler is just any EOA
await pub.waitForTransactionReceipt({ hash: bh });
ok((await pub.getBalance({ address: acct })) === 0n, 'newcomer still has 0 ETH after voting');
ok((await pub.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'hasVoted', args: [BigInt(gId), acct] })) === true, 'gasless vote recorded for the smart account');
ok((await supply()) === supG - ONE_WIF, 'the sponsored vote still burned 1 real WIF');
// the same account cannot be sponsored twice
let second = false;
try {
  const op2 = await buildSponsoredVoteOp({ client: pub as any, dep, owner: newbie.address, salt: 1n, electionId: gId, option: 0, sign: (h) => newbie.signMessage({ message: { raw: h } }) });
  const h2 = await creator.w.writeContract({ address: ENTRY_POINT_V07, abi: entryPointAbi, functionName: 'handleOps', args: [[op2], creator.account.address], chain, account: creator.account, gas: 3_000_000n } as any);
  second = (await pub.waitForTransactionReceipt({ hash: h2 })).status === 'success';
} catch { /* expected: paymaster rejects */ }
ok(!second, 'second sponsored op for the same account is rejected (abuse-resistant)');

say('Done. Final snapshot totals');
snap = await svc.tick();
console.log(JSON.stringify(snap.totals, null, 2));
console.log(`\nWIF supply moved ${((sup0 - (await supply())) / ONE_WIF)} WIF since the election started (all burned).`);
console.log('\n✅ E2E PASSED');
process.exit(0);

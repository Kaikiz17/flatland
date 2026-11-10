import { maxUint256, type Address, type Hex } from 'viem';
import { erc20Abi, flatlandAbi, wifGateAbi, basketVaultAbi, standingAbi, ONE_WIF, isPrizeRulesConfigured, prizeRulesAbi, type Deployment } from '@flatland/core';
import { getState } from './store';
import { ensureChain, walletClient, getWallet } from './wallet';

export type TxStep = { label: string; hash?: Hex };

function ctx() {
  const { cfg, dep, client } = getState();
  if (!cfg || !dep || !client) throw new Error('App not ready');
  const addr = getWallet().address;
  if (!addr) throw new Error('Connect a wallet first');
  return { cfg, dep, client, addr };
}

async function write(args: { address: Address; abi: any; functionName: string; args?: any[] }, onStep?: (s: TxStep) => void, label?: string) {
  const { cfg, client } = ctx();
  await ensureChain(cfg);
  const wc = walletClient(cfg);
  onStep?.({ label: label ?? 'Confirm in your wallet…' });
  const hash = await wc.writeContract({ ...args, chain: wc.chain, account: wc.account! } as any);
  onStep?.({ label: 'Waiting for the chain…', hash });
  const rc = await client.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error('Transaction reverted');
  return hash;
}

async function ensureAllowance(spender: Address, amount: bigint, token: Address, onStep?: (s: TxStep) => void) {
  const { client, addr } = ctx();
  const cur = (await client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [addr, spender] })) as bigint;
  if (cur >= amount) return;
  await write({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] }, onStep, 'Approve $WIF (exact amount, one time per action)…');
}

export const wifBalance = async (who: Address) => {
  const { client, dep } = ctx();
  return (await client.readContract({ address: dep.wif, abi: erc20Abi, functionName: 'balanceOf', args: [who] })) as bigint;
};

export async function vote(electionId: number, option: number, cost: bigint, onStep?: (s: TxStep) => void) {
  const { dep, addr } = ctx();
  const bal = await wifBalance(addr);
  if (bal < cost) throw new Error(`You need ${Number(cost) / 1e18} $WIF to vote — you have ${Number(bal) / 1e18}.`);
  await ensureAllowance(dep.flatland, cost, dep.wif, onStep);
  return write({ address: dep.flatland, abi: flatlandAbi, functionName: 'vote', args: [BigInt(electionId), option] }, onStep, 'Confirm your vote (burns $WIF)…');
}

/** Plain WIF transfer to the option's deposit box — the "just send 1 WIF" path, signed from the connected wallet. */
export async function sendToBox(box: Address, amount: bigint, onStep?: (s: TxStep) => void) {
  const { dep } = ctx();
  return write({ address: dep.wif, abi: erc20Abi, functionName: 'transfer', args: [box, amount] }, onStep, 'Confirm the 1 $WIF transfer…');
}

export interface CreateArgs { title: string; options: string[]; metaURI: string; end: number; voteCost: bigint; tallier: Address; executor: Address; challengeWindow: number; winners: number; prize: bigint }
export async function createElection(a: CreateArgs, onStep?: (s: TxStep) => void) {
  const { dep, client } = ctx();
  const before = (await client.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'electionCount' })) as bigint;
  const params = {
    title: a.title, options: a.options, metaURI: a.metaURI, start: 0n, end: BigInt(a.end), voteCost: a.voteCost, tallier: a.tallier, executor: a.executor,
    challengeWindow: BigInt(a.challengeWindow), winners: a.winners, prizeToken: dep.wif, challengeBurn: 0n,
  };
  await write({ address: dep.flatland, abi: flatlandAbi, functionName: 'createElection', args: [params] }, onStep, 'Confirm: create election…');
  const id = Number(before) + 1; // ids are sequential from 1
  if (a.prize > 0n) {
    await ensureAllowance(dep.flatland, a.prize, dep.wif, onStep);
    await write({ address: dep.flatland, abi: flatlandAbi, functionName: 'fundPrize', args: [BigInt(id), a.prize] }, onStep, 'Confirm: fund prize pool…');
  }
  return id;
}

export async function fundPrize(id: number, amount: bigint, onStep?: (s: TxStep) => void) {
  const { dep } = ctx();
  await ensureAllowance(dep.flatland, amount, dep.wif, onStep);
  return write({ address: dep.flatland, abi: flatlandAbi, functionName: 'fundPrize', args: [BigInt(id), amount] }, onStep);
}

export interface PrizeRulesInput {
  first: bigint;
  last: bigint;
  randomPool: bigint;
  randomSlots: number;
  luckyPositions: bigint[];
  luckyAmounts: bigint[];
  total: bigint;
}

/** Fund PrizeRules after the election exists. Only the election creator, only while open. Multiple lucky spots allowed. */
export async function fundPrizeRules(id: number, a: PrizeRulesInput, onStep?: (s: TxStep) => void) {
  const { dep, cfg, addr } = ctx();
  const prizes = ((cfg as { prizeRules?: string }).prizeRules || (dep as { prizeRules?: string }).prizeRules) as `0x${string}` | undefined;
  if (!isPrizeRulesConfigured(prizes)) throw new Error('Prize contract is not configured');
  const total = a.total > 0n ? a.total : a.first + a.last + a.randomPool + a.luckyAmounts.reduce((s, x) => s + x, 0n);
  if (total <= 0n) throw new Error('Add at least one prize amount');
  const bal = await wifBalance(addr);
  if (bal < total) throw new Error(`You need ${Number(total) / 1e18} $WIF to fund prizes — you have ${Number(bal) / 1e18}.`);
  await ensureAllowance(prizes, total, dep.wif, onStep);
  return write({
    address: prizes,
    abi: prizeRulesAbi,
    functionName: 'create',
    args: [BigInt(id), a.first, a.last, a.luckyPositions, a.luckyAmounts, a.randomPool, a.randomSlots],
  }, onStep, 'Confirm: fund first / last / lucky prizes…');
}


export const finalize = (id: number, onStep?: (s: TxStep) => void) => write({ address: ctx().dep.flatland, abi: flatlandAbi, functionName: 'finalize', args: [BigInt(id)] }, onStep);
export const seedDraw = (id: number, onStep?: (s: TxStep) => void) => write({ address: ctx().dep.flatland, abi: flatlandAbi, functionName: 'seedDraw', args: [BigInt(id)] }, onStep);
export const sweep = (id: number, option: number, onStep?: (s: TxStep) => void) => write({ address: ctx().dep.flatland, abi: flatlandAbi, functionName: 'sweepDeposits', args: [BigInt(id), option] }, onStep);

export async function challenge(id: number, accused: Address, evidence: string, burn: bigint, onStep?: (s: TxStep) => void) {
  const { dep } = ctx();
  await ensureAllowance(dep.flatland, burn, dep.wif, onStep);
  return write({ address: dep.flatland, abi: flatlandAbi, functionName: 'challenge', args: [BigInt(id), accused, evidence] }, onStep, 'Confirm challenge (burns $WIF)…');
}

export async function claimPrize(id: number, slot: number, index: number, voter: Address, option: number, proof: Hex[], onStep?: (s: TxStep) => void) {
  return write({ address: ctx().dep.flatland, abi: flatlandAbi, functionName: 'claimPrize', args: [BigInt(id), BigInt(slot), BigInt(index), voter, option, proof] }, onStep);
}

export async function act(gateId: number, cost: bigint, onStep?: (s: TxStep) => void) {
  const { dep } = ctx();
  await ensureAllowance(dep.gate, cost, dep.wif, onStep);
  return write({ address: dep.gate, abi: wifGateAbi, functionName: 'act', args: [BigInt(gateId)] }, onStep, 'Confirm (burns $WIF)…');
}
export async function createGate(kind: number, title: string, metaURI: string, start: number, end: number, cost: bigint, cap: number, onStep?: (s: TxStep) => void) {
  return write({ address: ctx().dep.gate, abi: wifGateAbi, functionName: 'createGate', args: [kind, title, metaURI, BigInt(start), BigInt(end), cost, cap] }, onStep);
}

export async function setCountry(code: string, onStep?: (s: TxStep) => void) {
  const { dep } = ctx();
  const hex = ('0x' + [...code.toUpperCase()].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(4, '0')) as Hex;
  return write({ address: dep.standing, abi: standingAbi, functionName: 'setCountry', args: [hex] }, onStep, 'Confirm: share my country (public, optional)…');
}

// ── basket ──
export async function basketDeposit(usdgAmount: bigint, onStep?: (s: TxStep) => void) {
  const { dep, addr } = ctx();
  await ensureAllowance(dep.basket, usdgAmount, dep.usdg, onStep);
  return write({ address: dep.basket, abi: basketVaultAbi, functionName: 'deposit', args: [usdgAmount, 0n, addr] }, onStep, 'Confirm deposit…');
}
export async function basketRedeem(shares: bigint, inKind: boolean, onStep?: (s: TxStep) => void) {
  const { dep, addr } = ctx();
  return write({ address: dep.basket, abi: basketVaultAbi, functionName: inKind ? 'redeemInKind' : 'redeem', args: inKind ? [shares, addr] : [shares, 0n, addr] }, onStep, 'Confirm redeem…');
}
export const basketNominate = async (assetIdx: number, cost: bigint, onStep?: (s: TxStep) => void) => {
  const { dep } = ctx();
  await ensureAllowance(dep.basket, cost, dep.wif, onStep);
  return write({ address: dep.basket, abi: basketVaultAbi, functionName: 'nominate', args: [BigInt(assetIdx)] }, onStep, 'Confirm nomination (burns $WIF)…');
};
export const basketCall = (fn: 'openEpoch' | 'rebalance', onStep?: (s: TxStep) => void) => write({ address: ctx().dep.basket, abi: basketVaultAbi, functionName: fn, args: [] }, onStep);
export const basketBuyback = (onStep?: (s: TxStep) => void) => write({ address: ctx().dep.basket, abi: basketVaultAbi, functionName: 'buybackAndBurn', args: [1n] }, onStep, 'Confirm: buy back & burn $WIF…');

export const ONE = ONE_WIF;
export { maxUint256 };
export type { Deployment };

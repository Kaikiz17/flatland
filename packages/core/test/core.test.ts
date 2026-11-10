import { describe, expect, it } from 'vitest';
import { parseVoteText, voteLinks, transferCalldata, optionLetter } from '../src/votelink';
import { clusterVoters } from '../src/cluster';
import { fairnessScore } from '../src/fairness';
import { buildDepositTree } from '../src/merkle';
import { depositAddress } from '../src/deposit';
import { decodeFunctionData } from 'viem';
import { erc20Abi } from '../src/abis';

const A = (n: number) => ('0x' + n.toString(16).padStart(40, '0')) as `0x${string}`;

describe('vote parsing', () => {
  it.each([
    ['vote B', 3, 1],
    ['Vote b!', 3, 1],
    ['@FlatlandBot vote C', 3, 2],
    ['I vote for option 2', 3, 1],
    ['b', 3, 1],
    ['#3', 3, 2],
    ['pick A', 2, 0],
  ])('%s -> %s', (t, n, want) => expect(parseVoteText(t as string, n as number)).toBe(want));
  it('rejects out-of-range and junk', () => {
    expect(parseVoteText('vote D', 3)).toBeNull();
    expect(parseVoteText('vote 9', 3)).toBeNull();
    expect(parseVoteText('hello world', 3)).toBeNull();
    expect(parseVoteText('vote 0', 3)).toBeNull();
  });
  it('matches option labels', () => {
    expect(parseVoteText('vote for Elon', 3, ['Vlad', 'Elon', 'Satoshi'])).toBe(1);
  });
});

describe('vote links', () => {
  it('builds a ready-to-send 1 WIF transfer', () => {
    const l = voteLinks({ appUrl: 'https://flatland.app/', electionId: 7, option: 1, deposit: A(0xbeef) });
    expect(l.eip681).toBe(`ethereum:0x5173b8eA6923c2d40267890D45C46a3480954773@4663/transfer?address=${l.depositAddress}&uint256=1000000000000000000`);
    expect(l.web).toBe('https://flatland.app/#/e/7?vote=1');
    const c = transferCalldata(l.depositAddress);
    const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
    expect(d.functionName).toBe('transfer');
    expect((d.args as any)[1]).toBe(10n ** 18n);
    expect(optionLetter(2)).toBe('C');
  });
});

describe('clustering', () => {
  const funder = A(0xf00d);
  const provider = async (w: string) => ({ source: BigInt(w) % 2n === 0n ? funder : A(Number(BigInt(w)) + 1000) });
  it('collapses same-source wallets to the earliest voter', async () => {
    const voters = [2, 4, 6, 3].map((n, i) => ({ voter: A(n), option: i % 2, at: 100 - n, path: 'deposit' as const }));
    const r = await clusterVoters(voters, provider);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].keeper).toBe(A(6)); // earliest 'at'
    expect(r.collapsed.size).toBe(2);
    expect(r.uniqueSources).toBe(2);
  });
  it('does not collapse a popular source (exchange hot wallet)', async () => {
    const voters = Array.from({ length: 30 }, (_, i) => ({ voter: A(2 * (i + 1)), option: 0, at: i, path: 'deposit' as const }));
    const r = await clusterVoters(voters, provider, { popularLimit: 25 });
    expect(r.collapsed.size).toBe(0);
    expect(r.clusters[0].popular).toBe(true);
  });
  it('unknown sources count as their own source', async () => {
    const r = await clusterVoters([{ voter: A(1), option: 0, at: 1, path: 'chain' }], async () => ({ source: null }));
    expect(r.uniqueSources).toBe(1);
  });
});

describe('fairness score', () => {
  const base = { tallies: [10, 8, 6], rawVoters: 24, collapsed: 0, counted: 24, uniqueSources: 24, hasAttestation: true, openChallenges: 0, upheldChallenges: 0 };
  it('healthy election scores A', () => expect(fairnessScore(base).grade).toBe('A'));
  it('sybil farm scores poorly', () => {
    const s = fairnessScore({ ...base, tallies: [24, 0, 0], collapsed: 20, counted: 4, uniqueSources: 1 });
    expect(s.score).toBeLessThan(55);
    expect(s.notes.join()).toMatch(/collapsed/);
  });
  it('empty election is n/a', () => expect(fairnessScore({ ...base, tallies: [0, 0], rawVoters: 0, counted: 0, uniqueSources: 0 }).grade).toBe('n/a'));
  it('is monotone in independence', () => {
    const a = fairnessScore({ ...base, collapsed: 2 }).score;
    const b = fairnessScore({ ...base, collapsed: 10 }).score;
    expect(a).toBeGreaterThan(b);
  });
});

describe('merkle + deposit address', () => {
  it('builds verifiable proofs', () => {
    const { root, tree, proofs } = buildDepositTree([{ voter: A(1), option: 0 }, { voter: A(2), option: 1 }, { voter: A(3), option: 1 }]);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(tree!.verify(1, proofs[1])).toBe(true);
    expect(proofs[0].length).toBeGreaterThan(0);
  });
  it('deposit addresses are stable and unique per option', () => {
    const a = depositAddress(A(0x11), A(0x22), 1, 0);
    expect(depositAddress(A(0x11), A(0x22), 1, 0)).toBe(a);
    expect(depositAddress(A(0x11), A(0x22), 1, 1)).not.toBe(a);
    expect(depositAddress(A(0x11), A(0x22), 2, 0)).not.toBe(a);
  });
});

import { toBundlerOp } from '../src/gasless';
import { concat, pad, toHex } from 'viem';
describe('gasless toBundlerOp', () => {
  const u128 = (n: bigint) => pad(toHex(n), { size: 16 });
  const base = {
    sender: '0x00000000000000000000000000000000000000aa' as const, nonce: 5n, callData: '0x1234' as const,
    accountGasLimits: concat([u128(600_000n), u128(400_000n)]), preVerificationGas: 60_000n,
    gasFees: concat([u128(7n), u128(9n)]),
    paymasterAndData: concat(['0x00000000000000000000000000000000000000bb', u128(200_000n), u128(100_000n), '0xdead']),
    signature: '0xbeef' as const,
  };
  it('unpacks gas limits, fees and paymaster fields', () => {
    const o: any = toBundlerOp({ ...base, initCode: '0x' });
    expect(BigInt(o.verificationGasLimit)).toBe(600_000n);
    expect(BigInt(o.callGasLimit)).toBe(400_000n);
    expect(BigInt(o.maxPriorityFeePerGas)).toBe(7n);
    expect(BigInt(o.maxFeePerGas)).toBe(9n);
    expect(o.paymaster.toLowerCase()).toBe('0x00000000000000000000000000000000000000bb');
    expect(BigInt(o.paymasterVerificationGasLimit)).toBe(200_000n);
    expect(BigInt(o.paymasterPostOpGasLimit)).toBe(100_000n);
    expect(o.paymasterData).toBe('0xdead');
    expect(o.factory).toBeUndefined();
  });
  it('splits initCode into factory + factoryData', () => {
    const o: any = toBundlerOp({ ...base, initCode: concat(['0x00000000000000000000000000000000000000cc', '0xabcdef']) });
    expect(o.factory.toLowerCase()).toBe('0x00000000000000000000000000000000000000cc');
    expect(o.factoryData).toBe('0xabcdef');
  });
});

import { concat, encodeAbiParameters, encodeFunctionData, getAddress, numberToHex, pad, toHex, type Address, type Hex, type PublicClient } from 'viem';
import { flatAccountAbi, flatAccountFactoryAbi, flatlandAbi } from './abis.js';
import type { Deployment } from './deployment.js';

export const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;

export const entryPointAbi = [
  { type: 'function', name: 'getNonce', stateMutability: 'view', inputs: [{ name: 'sender', type: 'address' }, { name: 'key', type: 'uint192' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'getUserOpHash', stateMutability: 'view', outputs: [{ type: 'bytes32' }],
    inputs: [{ name: 'userOp', type: 'tuple', components: [
      { name: 'sender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'initCode', type: 'bytes' }, { name: 'callData', type: 'bytes' },
      { name: 'accountGasLimits', type: 'bytes32' }, { name: 'preVerificationGas', type: 'uint256' }, { name: 'gasFees', type: 'bytes32' },
      { name: 'paymasterAndData', type: 'bytes' }, { name: 'signature', type: 'bytes' } ] }],
  },
  {
    type: 'function', name: 'handleOps', stateMutability: 'nonpayable', outputs: [],
    inputs: [
      { name: 'ops', type: 'tuple[]', components: [
        { name: 'sender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'initCode', type: 'bytes' }, { name: 'callData', type: 'bytes' },
        { name: 'accountGasLimits', type: 'bytes32' }, { name: 'preVerificationGas', type: 'uint256' }, { name: 'gasFees', type: 'bytes32' },
        { name: 'paymasterAndData', type: 'bytes' }, { name: 'signature', type: 'bytes' } ] },
      { name: 'beneficiary', type: 'address' },
    ],
  },
] as const;

export interface PackedUserOp {
  sender: Address; nonce: bigint; initCode: Hex; callData: Hex; accountGasLimits: Hex; preVerificationGas: bigint; gasFees: Hex; paymasterAndData: Hex; signature: Hex;
}
export type Signer = (userOpHash: Hex) => Promise<Hex>; // must produce an EIP-191 personal_sign over the raw 32-byte hash

const u128 = (n: bigint) => pad(toHex(n), { size: 16 });

export async function accountAddress(client: PublicClient, dep: Deployment, owner: Address, salt: bigint): Promise<Address> {
  return (await client.readContract({ address: dep.accountFactory, abi: flatAccountFactoryAbi, functionName: 'getAddress', args: [owner, salt] })) as Address;
}

/**
 * A sponsored "first vote" UserOp: [WIF.approve(hub, max), hub.vote(id, option)] through FlatAccount.executeBatch, gas paid by FlatPaymaster.
 * The paymaster only sponsors exactly this shape for brand-new accounts (once), and the vote still burns >= 1 WIF from the account.
 */
export async function buildSponsoredVoteOp(args: {
  client: PublicClient; dep: Deployment; owner: Address; salt: bigint; electionId: number; option: number; sign: Signer; gasPrice?: bigint;
}): Promise<PackedUserOp> {
  const { client, dep, owner, salt } = args;
  const sender = await accountAddress(client, dep, owner, salt);
  const code = await client.getCode({ address: sender });
  const deployed = !!code && code !== '0x';
  const nonce = (await client.readContract({ address: ENTRY_POINT_V07, abi: entryPointAbi, functionName: 'getNonce', args: [sender, 0n] })) as bigint;
  const approve = encodeFunctionData({ abi: [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }], functionName: 'approve', args: [dep.flatland, 2n ** 256n - 1n] });
  const vote = encodeFunctionData({ abi: flatlandAbi, functionName: 'vote', args: [BigInt(args.electionId), args.option] });
  const callData = encodeFunctionData({ abi: flatAccountAbi, functionName: 'executeBatch', args: [[dep.wif, dep.flatland], [0n, 0n], [approve, vote]] });
  const initCode = deployed ? '0x' : concat([dep.accountFactory, encodeFunctionData({ abi: flatAccountFactoryAbi, functionName: 'createAccount', args: [owner, salt] })]);
  const fee = args.gasPrice ?? 100_000_000n; // 0.1 gwei is plenty on this L2; bundlers may overwrite
  const op: PackedUserOp = {
    sender: getAddress(sender), nonce, initCode: initCode as Hex, callData,
    accountGasLimits: concat([u128(600_000n), u128(400_000n)]),
    preVerificationGas: 60_000n,
    gasFees: concat([u128(fee), u128(fee)]),
    paymasterAndData: concat([dep.paymaster, u128(200_000n), u128(100_000n)]),
    signature: '0x',
  };
  const hash = (await client.readContract({ address: ENTRY_POINT_V07, abi: entryPointAbi, functionName: 'getUserOpHash', args: [op] })) as Hex;
  op.signature = await args.sign(hash);
  return op;
}

/** JSON-RPC shape (v0.7, unpacked) for a standard bundler's eth_sendUserOperation. */
export function toBundlerOp(op: PackedUserOp) {
  const hasInit = op.initCode !== '0x';
  const split = (b: Hex) => ({ hi: BigInt('0x' + b.slice(2, 34)), lo: BigInt('0x' + b.slice(34, 66)) });
  const agl = split(op.accountGasLimits), fees = split(op.gasFees);
  const pm = op.paymasterAndData;
  return {
    sender: op.sender, nonce: numberToHex(op.nonce),
    ...(hasInit ? { factory: ('0x' + op.initCode.slice(2, 42)) as Hex, factoryData: ('0x' + op.initCode.slice(42)) as Hex } : {}),
    callData: op.callData, verificationGasLimit: numberToHex(agl.hi), callGasLimit: numberToHex(agl.lo), preVerificationGas: numberToHex(op.preVerificationGas),
    maxPriorityFeePerGas: numberToHex(fees.hi), maxFeePerGas: numberToHex(fees.lo),
    paymaster: ('0x' + pm.slice(2, 42)) as Hex, paymasterVerificationGasLimit: numberToHex(BigInt('0x' + pm.slice(42, 74))), paymasterPostOpGasLimit: numberToHex(BigInt('0x' + pm.slice(74, 106))), paymasterData: ('0x' + pm.slice(106)) as Hex,
    signature: op.signature,
  };
}
void encodeAbiParameters;

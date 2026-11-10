import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { Address, Hex } from 'viem';

/** Leaf = keccak256(bytes.concat(keccak256(abi.encode(index, voter, option)))) — identical to Flatland.leafOf + OZ MerkleProof. */
export interface DepositEntry {
  voter: Address;
  option: number;
}

export function buildDepositTree(entries: DepositEntry[]) {
  const values = entries.map((e, i) => [BigInt(i), e.voter, e.option] as [bigint, Address, number]);
  if (values.length === 0) return { root: ('0x' + '00'.repeat(32)) as Hex, tree: null, proofs: [] as Hex[][] };
  const tree = StandardMerkleTree.of(values, ['uint256', 'address', 'uint8']);
  const proofs = values.map((_, i) => tree.getProof(i) as Hex[]);
  return { root: tree.root as Hex, tree, proofs };
}

/** Public audit export for one election: everything needed to re-verify the result offline. */
export function auditExport(args: {
  electionId: number;
  root: Hex;
  entries: DepositEntry[];
  proofs: Hex[][];
  chainVoters: { voter: Address; option: number }[];
  clusters: unknown;
}) {
  return {
    version: 1,
    electionId: args.electionId,
    depositRoot: args.root,
    leafEncoding: 'keccak256(bytes.concat(keccak256(abi.encode(uint256 index,address voter,uint8 option)))) , OZ sorted-pair tree',
    chainEntries: args.chainVoters.map((v) => ({ voter: v.voter, option: v.option })), // read order from Flatland.voterAt(id, i)
    depositEntries: args.entries.map((e, i) => ({
      index: args.chainVoters.length + i,
      leafIndex: i,
      voter: e.voter,
      option: e.option,
      proof: args.proofs[i],
    })),
    clusters: args.clusters,
  };
}

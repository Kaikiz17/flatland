import { encodeAbiParameters, getAddress, getContractAddress, keccak256, type Address, type Hex } from 'viem';

/** Predicts the CREATE2 deposit address exactly like OZ Clones.predictDeterministicAddress(boxImpl, salt, hub). */
export function depositAddress(hub: Address, boxImpl: Address, electionId: bigint | number, option: number): Address {
  const salt = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint8' }], [BigInt(electionId), option]));
  const impl = boxImpl.toLowerCase().slice(2);
  const bytecode = ('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + impl + '5af43d82803e903d91602b57fd5bf3') as Hex;
  return getAddress(getContractAddress({ bytecode, from: hub, opcode: 'CREATE2', salt }));
}

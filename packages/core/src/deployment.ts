import type { Address } from 'viem';

export interface Deployment {
  chainId: number;
  deployBlock: number;
  wif: Address;
  usdg: Address;
  tallier: Address;
  entropy: Address;
  standing: Address;
  flatland: Address;
  boxImpl: Address;
  gate: Address;
  participation: Address;
  buyback: Address;
  basket: Address;
  accountFactory: Address;
  paymaster: Address;
  /** Set after PrizeRules is deployed. Unset → tallier payLucky is a no-op. */
  prizeRules?: Address;
}

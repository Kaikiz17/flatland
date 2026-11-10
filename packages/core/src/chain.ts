import { defineChain } from 'viem';

/** Robinhood Chain mainnet (Arbitrum Orbit L2). ETH is the gas token. */
export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

/** Local anvil fork of Robinhood Chain keeps chain id 4663 but a local RPC. */
export function localChain(rpc = 'http://127.0.0.1:8545') {
  return defineChain({ ...robinhood, name: 'Flatland local fork', rpcUrls: { default: { http: [rpc] } } });
}

export const WIF = '0x5173b8eA6923c2d40267890D45C46a3480954773' as const;
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
export const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as const;
export const ONE_WIF = 10n ** 18n;

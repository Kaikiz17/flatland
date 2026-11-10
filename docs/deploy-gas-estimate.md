# Deploy gas estimate (Robinhood Chain mainnet, chain id 4663)

Measured 2026-11-10 against https://rpc.mainnet.chain.robinhood.com. Not deployed; nothing was spent.

- Gas price: `eth_gasPrice` = 0.02002 gwei (base fee 0.02 gwei, priority 0). forge's max-fee estimate is 0.0405 gwei.
- ETH price: about $2,101 (CoinGecko, same day).
- Gas per contract is from `eth_estimateGas` on the real RPC (matches forge's simulation divided by its 1.3x pad).
- L1 data fee: ArbGasInfo `getPricesInWei()` reports 2e7 wei per calldata unit and 4.0e11 wei per tx. About 70 kB of creation calldata is roughly 0.00002 ETH (about $0.05), so the L1 part is small.

| Contract | Gas |
|---|---:|
| Standing | 627k |
| ArbEntropy | 169k |
| Flatland (hub) | 4,003k |
| WifGate | 780k |
| ParticipationVault | 935k |
| WifBuyback | 813k |
| BasketVault | 5,090k |
| FlatAccountFactory | 660k |
| FlatPaymaster | ~1,122k (estimate failed offline; forge sim 1,459k / 1.3) |
| Standing.lock call | 23k |
| **Total (full stack)** | **~14.2M** |

| Scenario | Gas price | ETH | USD |
|---|---:|---:|---:|
| Full stack, estimate | 0.02 gwei | 0.00029 | $0.60 |
| Full stack, forge padded (18.5M) | 0.02 gwei | 0.00037 | $0.78 |
| Full stack, forge padded, forge max fee | 0.0405 gwei | 0.00075 | $1.57 |
| Full stack, 5x price spike | 0.1 gwei | 0.0014 | $3.00 |

The full stack fits the $5 budget (about 0.0024 ETH). Subsets: core elections (Standing, ArbEntropy, Flatland, WifGate, ParticipationVault) about 6.5M gas, $0.27; basket (WifBuyback + BasketVault) about 5.9M, $0.25; gasless (factory + paymaster) about 1.8M, $0.08.
The paymaster needs a funded EntryPoint deposit (`fund()`), which is optional. A sponsored vote costs about 0.00001 to 0.00003 ETH at today's price, so 0.001 ETH ($2.10) funds dozens of first votes. Skip it if the budget is tight.
Not included: bridging ETH onto the chain (Ethereum L1 fees), post-deploy transactions (createElection, createGate, openEpoch are each cheap), and WIF for seeding votes.

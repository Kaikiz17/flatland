#!/usr/bin/env bash
# Fork tests against the REAL chain state (real WIF, USDG, Stock Tokens, Uniswap v3/v4, Chainlink, EntryPoint v0.7).
# Public RPC is non-archive and rejects the very latest block, so we pin head-20 (override with FORK_BLOCK).
set -euo pipefail
cd "$(dirname "$0")/../contracts"
export PATH="$PATH:$HOME/.foundry/bin"
RPC=${RPC:-https://rpc.mainnet.chain.robinhood.com}
B=${FORK_BLOCK:-$(( $(cast block-number --rpc-url "$RPC") - 20 ))}
echo "forking $RPC at block $B"
forge test --match-path 'test/Fork*' --fork-url "$RPC" --fork-block-number "$B" "$@"

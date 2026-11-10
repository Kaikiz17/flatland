#!/usr/bin/env bash
# End-to-end on a local anvil FORK of Robinhood Chain (real WIF, USDG, Stock Tokens, Uniswap, Chainlink).
# Spends nothing: all keys are anvil's well-known dev keys; nothing is broadcast to a real network.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.foundry/bin"
RPC_UP=${RPC_UP:-https://rpc.mainnet.chain.robinhood.com}
PORT=${ANVIL_PORT:-8545}
PK0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil #0 (deployer)
TALLIER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8                      # anvil #1 (indexer attester)
FORKARG=""; [ -n "${FORK_BLOCK:-}" ] && FORKARG="--fork-block-number $FORK_BLOCK"
echo "▶ forking Robinhood Chain (latest${FORK_BLOCK:+ / pinned $FORK_BLOCK})"
anvil --fork-url "$RPC_UP" $FORKARG --port "$PORT" --chain-id 4663 --silent --no-rate-limit >/tmp/anvil.log 2>&1 &
APID=$!
trap 'kill $APID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do cast block-number --rpc-url http://127.0.0.1:$PORT >/dev/null 2>&1 && break; sleep 1; done
BLOCK=$(cast block-number --rpc-url http://127.0.0.1:$PORT)
echo "▶ forked at L2 block $BLOCK; deploying contracts (local fork only)"
rm -f deployments/local.json
(cd contracts && TALLIER=$TALLIER ENTROPY=local OUT=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:$PORT --private-key $PK0 --broadcast 2>&1 | grep -E "Flatland|Basket|written|Error")
[ -f deployments/local.json ] || { echo "deploy failed"; exit 1; }
python3 - <<PY
import json;p="deployments/local.json";d=json.load(open(p));d["deployBlock"]=$BLOCK;json.dump(d,open(p,"w"),indent=2)
PY
echo "▶ running scenario"
RPC=http://127.0.0.1:$PORT npx tsx scripts/e2e.mts

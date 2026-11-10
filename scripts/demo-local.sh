#!/usr/bin/env bash
# One-command local demo: anvil FORK of the real chain + deploy + seeded activity + indexer/tallier + the web app.
# Zero funds, zero keys of yours. Open http://127.0.0.1:5173 and add the anvil network to a wallet (or just watch).
#   LIVE=1 scripts/demo-local.sh      keep casting votes so the live rooms animate
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.foundry/bin"
RPC_UP=${RPC_UP:-https://rpc.mainnet.chain.robinhood.com}
PORT=8545; IDX=8787; WEB=5173
PK0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
TALLIER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
TALLIER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
mkdir -p .demo; PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
anvil --fork-url "$RPC_UP" --port $PORT --chain-id 4663 --silent --no-rate-limit >.demo/anvil.log 2>&1 & PIDS+=($!)
for i in $(seq 1 60); do cast block-number --rpc-url http://127.0.0.1:$PORT >/dev/null 2>&1 && break; sleep 1; done
BLOCK=$(cast block-number --rpc-url http://127.0.0.1:$PORT)
rm -f deployments/local.json
(cd contracts && TALLIER=$TALLIER ENTROPY=local OUT=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:$PORT --private-key $PK0 --broadcast >/dev/null 2>&1)
python3 - <<PY
import json;p="deployments/local.json";d=json.load(open(p));d["deployBlock"]=$BLOCK;json.dump(d,open(p,"w"),indent=2)
PY
echo "▶ deployed; seeding…"
RPC=http://127.0.0.1:$PORT LIVE=0 npx tsx scripts/seed.mts
echo "▶ starting indexer/tallier on :$IDX"
(cd packages/indexer && RPC=http://127.0.0.1:$PORT DEPLOYMENT=../../deployments/local.json TALLIER_KEY=$TALLIER_KEY DATA_DIR=../../.demo/data PORT=$IDX npx tsx src/main.ts >../../.demo/indexer.log 2>&1) & PIDS+=($!)
echo "▶ building web"
(cd apps/web && npx vite build --outDir ../../.demo/web --emptyOutDir >/dev/null 2>&1)
cp deployments/local.json .demo/web/deployment.json
cat > .demo/web/config.json <<CFG
{ "chainId": 4663, "chainName": "Flatland local fork", "rpc": "http://127.0.0.1:$PORT", "indexerUrl": "http://127.0.0.1:$IDX", "deploymentUrl": "./deployment.json", "explorer": "http://127.0.0.1:$PORT", "dexUrl": "https://worldisflat.fun", "pollMs": 3000 }
CFG
(cd .demo/web && python3 -m http.server $WEB >/dev/null 2>&1) & PIDS+=($!)
echo "✅ demo up:  web http://127.0.0.1:$WEB   indexer http://127.0.0.1:$IDX/health   rpc http://127.0.0.1:$PORT (chain 4663)"
if [ "${LIVE:-0}" = "1" ]; then RPC=http://127.0.0.1:$PORT LIVE=1 npx tsx scripts/seed.mts >/dev/null 2>&1 & PIDS+=($!); fi
wait

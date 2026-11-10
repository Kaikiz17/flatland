# Flatland

**An open, permissionless voting protocol for $WIF, with outcomes that execute onchain and a "send 1 $WIF to act" rail any app can plug into.**

Built on the World is Fair rules (1 wallet = 1 vote, every vote burns real $WIF, a verifiable random draw), open to everyone. World is Fair is a single event run by the $WIF team. Flatland is the protocol underneath: anyone can run an election, bind its result to an onchain action, or gate anything behind a burn.

Target network: Robinhood Chain (Arbitrum Orbit L2, chain id 4663, ETH gas). $WIF is `0x5173b8eA6923c2d40267890D45C46a3480954773`.

> **Status: deploy-ready, unaudited, not deployed.** Everything below was run on a local anvil fork of the real chain with no funds. See "Go-live checklist".

## Three pillars

1. **Election kit.** Anyone creates an election (options, start/end, vote cost of at least 1 WIF, optional prize pool, optional winner draw). One wallet gets one vote and the cost is burned. A winner draw uses future-block randomness that anyone can verify. The participation vault, public audit export (Merkle root and every entry) and sybil groups are all published. Two ways to vote:
   - **Connect wallet**: `approve` + `vote`, fully onchain.
   - **Just send 1 $WIF** from Phantom, Trust or any wallet to the election's deposit address (an EIP-1167 clone at a CREATE2 address). The indexer/tallier attests these votes.
2. **Executable outcomes.** An election can bind to an `executor` contract that runs on finalize. The flagship is the **People's Stock Token Basket** (`BasketVault`): a USDG vault whose Stock Token weights are decided each epoch by a 1-wallet-1-vote WIF-burn election. Rebalances use real Uniswap v3 swaps, with Chainlink price bounds and staleness checks. **Beta safety caps:** max 100 USDG per wallet position and 1,000 USDG total NAV (`walletCap` / `tvlCap`), adjustable only by `governance` (deployer by default, or `GOVERNANCE=<multisig>` at deploy; set to address(0) to freeze them). Governance cannot touch funds, weights, fees or assets, and exits are never capped. Caps are a position-value guard per receiving wallet, not identity (shares can be transferred). A 0.30% vault fee is routed to `WifBuyback`, which buys WIF on Uniswap v4 and burns it. Anyone can propose a basket by burning 1 WIF (`nominate`).
3. **"Send 1 $WIF to act" rails.** `WifGate` is a reusable contract: anyone registers a gate, a wallet calls `act` to burn 1 WIF, and `hasActed(gate, wallet)` is readable by any contract (`WifGated` / `onlyActed`). `apps/web/public/flatland-widget.js` is a vanilla-JS widget (no build step) for petitions, RSVPs, allowlists and access gates. It fires a `flatland:acted` DOM event.

Extras: voter map (opt-in, country-level only), per-election fairness score (A–F), gasless first vote (capped ERC-4337 paymaster), Telegram/X vote-bot code (dry-run only, no live accounts), streaks and standing, OG share cards, live election rooms (real-time vote feed, burned counter, map), and an agent API with MCP.

## The flywheel

```
        more elections / petitions / basket epochs
                         │
                         ▼
   every vote, act, nomination and challenge BURNS $WIF  ──► supply down
                         ▲                                      │
                         │                                      ▼
   Basket TVL earns a 0.30% fee ──► USDG ──► buys $WIF on Uniswap v4 ──► burned
                         ▲
   people-chosen Stock Token weights attract deposits
```

Demand is utility-driven. You need WIF to vote, to act, to propose a basket and to challenge a bad tally. Every one of those burns it, and the basket turns TVL into continuous buy pressure.

## Architecture

```
contracts/   Foundry. Flatland.sol (hub), Standing, WifGate, ParticipationVault, DepositBox,
             WifBuyback, Entropy (ArbSys-based), basket/BasketVault, aa/ (FlatAccount, factory, paymaster)
packages/core     viem client, ABIs, snapshot reader, Merkle, funding clustering, fairness score, gasless UserOp builder
packages/indexer  tallier + keeper service, HTTP + SSE (`/snapshot.json`, `/stream`, `/api/elections/:id/audit`)
packages/bot      Telegram + X vote-bot handler (dry-run, link generator)
apps/web          Vite + React static app (hash routing), mobile tab bar, wallet via EIP-6963 + deep links
api/              Web-standard handler: JSON API, MCP (JSON-RPC), OG PNG cards, share pages
                  wrapped for Vercel (`api/[...path].ts`) and Cloudflare Pages (`functions/`)
scripts/          deploy-adjacent, local demo, e2e, fork tests, UI e2e
```

The web app is **static**. With no `indexerUrl` it reads straight from chain RPC (Multicall3, polling). With an indexer it uses `/snapshot.json` plus SSE for live rooms and the sybil analysis.

## Trust model (hybrid, and honest about it)

- **Connect-wallet votes are fully onchain.** The contract counts them. Nobody can change them.
- **Deposit-box votes are attested.** The tallier (an address you set per election) posts a Merkle root of `(leafIndex, voter, option)`. The audit export and TS proof builder are public, so anyone can recompute it. The leaf encoding is compatible with OpenZeppelin `StandardMerkleTree`.
- **Challenge-by-burn.** Within `challengeWindow` (1h to 7d) anyone can burn WIF to challenge the root. A challenge forces resolution. Onchain votes always stand, whatever the tallier does.
- **Sybil resistance.** Voters funded from the same source are clustered. Groups are published (`/data/groups/N.json`) and collapse to one counted vote, with the fairness score showing how much was collapsed. A popular-source exemption (exchanges and bridges) limits false positives.
- **Randomness.** The winner draw uses `arbBlockHash` of a future block via ArbSys. The sequencer can influence that, so it is fine for prize draws and not for high-stakes money. Say so when you use it.

## Positioning vs World is Fair

| | World is Fair | Flatland |
|---|---|---|
| Scope | one event | any number of elections, by anyone |
| Outcome | a result | a result that can **execute onchain** (basket, allowlist, payout) |
| Integration | none | `WifGate` + embeddable widget + JSON/MCP API |
| Voting | event UI | wallet, or send 1 WIF from any wallet |

## Run it locally (no keys, no funds)

Requires Foundry, Node 20+. Needs an RPC that serves the chain (`RPC_UP`, default is the public RPC).

```bash
npm install
npm test                      # offline Solidity (50) + all TS suites
npm run test:fork             # fork tests vs real WIF, Uniswap, EntryPoint (pins head-20)
npm run e2e                   # full scenario on an anvil fork (docs/e2e-transcript.txt)
bash scripts/demo-local.sh    # anvil fork + deploy + seed + indexer :8787 + web :5173  (LIVE=1 keeps voting)
node scripts/ui-e2e.mjs       # Playwright + injected wallet against the demo (needs Chrome)
```

**Stale-fork caveat.** The public RPC is not an archive node. An anvil fork lazily fetches state, and after some minutes you may see "historical state not available". Run the e2e/demo promptly after starting, or point `RPC_UP` at an archive RPC.

**Local-only helpers.** `ENTROPY=local` (`LocalEntropy`) and `MockFeed` (oracle override via `anvil_setCode`) exist only so a time-warped fork can run. The real deploy uses `ArbEntropy` and the real Chainlink feeds. Never set `ENTROPY=local` for a live deploy.

## Deploy

1. Contracts (needs a deployer key with ETH for gas and a TALLIER address):
   ```bash
   cd contracts
   TALLIER=0x... OUT=mainnet forge script script/Deploy.s.sol --rpc-url $RPC --private-key $DEPLOYER_PK --broadcast
   ```
   Optional: `GOVERNANCE=0x...` (who may adjust the basket's beta caps; default is the deployer). Writes `deployments/mainnet.json`. Copy it to `apps/web/public/deployment.json`. Optional: `MAX_BUYBACK` (per-buyback USDG cap).
   Then fund the paymaster (`FlatPaymaster.fund()` with a little ETH) if you want gasless first votes.
2. Indexer/tallier (always-on host, for example Fly, Railway or a VPS):
   ```bash
   cd packages/indexer
   RPC=... DEPLOYMENT=../../deployments/mainnet.json TALLIER_KEY=0x... DATA_DIR=./data PORT=8787 KEEPER=1 npx tsx src/main.ts
   ```
   `TALLIER_KEY` is the funded key for the tallier address. `KEEPER=1` also sweeps deposits, finalizes and seeds draws. Anyone can run a keeper.
3. Web, either static host:
   - **Vercel**: import the repo. `vercel.json` sets the build to `npm run build:web`, output `apps/web/dist`, and rewrites `/share/:id`. Env: `INDEXER_URL`, `RPC_URL`, `APP_URL`, `DEPLOYMENT_URL`.
   - **Cloudflare Pages**: build command `npm run build:web`, output `apps/web/dist`. `functions/` provides `/api/*` and `/share/*` (PNG OG falls back to SVG on the edge).
   - **Pure static** (GitHub Pages / IPFS): upload `apps/web/dist`. The `api/` routes will not exist, so OG cards and MCP are unavailable.
   Edit `config.json` (`indexerUrl`, `rpc`, `appUrl`, `bundlerUrl`).

## Known limitations

- **Unaudited.** Do not put real money in before an audit.
- **Shared-funder false positives.** Honest voters funded by one wallet can be collapsed. Mitigations: popular-source exemption, published groups, challenge-by-burn.
- **Trust in the tallier** for deposit-box votes (bounded by the challenge window; onchain votes always count).
- **Randomness** is sequencer-influenced (see above).
- **Serverless wrappers** (Vercel, Cloudflare) are unit-tested through the shared handler but have not been run on those platforms. The Cloudflare PNG path is untested.
- **Gasless panel** needs a bundler URL that supports EntryPoint v0.7. The contracts path is proven on a fork with a local bundler step. No hosted bundler was used.
- **Stock Tokens** may be restricted in some jurisdictions, and the basket depends on thin DEX liquidity. Rebalances have slippage and oracle bounds, and revert if the oracle is stale (by design).
- The bots never post anywhere. Reply handlers and link generators only.

## Go-live checklist (what the owner must supply)

- [ ] Deployer wallet with ETH for gas (full stack is about 14M gas, roughly 0.0003 ETH at 0.02 gwei; budget ~0.001 ETH incl. headroom. L1 bridge fees to get ETH onto the chain are extra) and some WIF (to seed a first election)
- [ ] Always-on host for the indexer/tallier and a funded `TALLIER_KEY`
- [ ] A GitHub repo (none is configured) and a host (Vercel or Cloudflare Pages)
- [ ] Optional: bundler URL for gasless; ETH to fund the paymaster
- [ ] Demo video (use `scripts/demo-local.sh` with `LIVE=1`)
- [ ] Decide: audit, tallier identity, and Stock Token jurisdiction messaging

## Pitch

Flatland turns World is Fair from one event into a protocol: anyone can run a 1-wallet-1-vote election that burns real $WIF, and the result can execute onchain. The flagship is a People's Stock Token Basket whose holdings are chosen by WIF-burn votes and whose fees buy back and burn $WIF, plus a "send 1 $WIF to act" rail any app can plug in. Every action in it burns WIF, so usage drives demand.

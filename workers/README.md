# Cloudflare deployment (free plan)

Live: **https://flatland.flatland.workers.dev** (account workers.dev subdomain `flatland`).

Two Workers share one KV namespace (`flatland`, id in the wrangler.toml files):

| Worker | What | Triggers |
|---|---|---|
| `flatland` (`workers/web`) | The static web app (embedded in the script) + JSON API, MCP, OG cards, share pages, `/api/status`, audit exports (`/api/elections/:id/audit`, `/data/groups/:id.json`) | HTTP (workers.dev) |
| `flatland-tallier` (`workers/tallier`) | The vote robot: tallier + keeper duties from `packages/indexer/src/service.ts`, run statelessly | Cron `* * * * *`, no HTTP surface |

The browser reads the chain directly over RPC (live rooms poll every 6 s). The API reads a snapshot the tallier parks in KV and falls back to a direct (batched) RPC read when the snapshot is missing or older than 30 min.

## Free-plan design (10 ms CPU, 50 subrequests, 1,000 KV writes/day, 100k requests/day)

- **Idle fast path.** Each tick makes one multicall of global counters (election count, votes, burns, acts, basket supply, ...). If nothing changed, all elections are final and the last full pass was under 5 min ago, it exits. Otherwise it does a full pass (about 10 subrequests).
- **Stateless duties.** Attest deposit votes (Merkle root), collapse sybils, answer challenges, sweep+burn deposit boxes, finalize, seed draws and claim standing are all re-derived from chain state every tick, so a skipped tick loses nothing.
- **Bounded work.** JSON-RPC batching and multicall (`snapshot.ts` now reads the basket and totals in a few multicalls and prefetches block timestamps concurrently). A subrequest counter caps each invocation at 44. Transactions are sent without waiting for receipts, at most 2 per tick, and de-duplicated through a 120 s KV key.
- **Never guess.** If Blockscout funding lookups could not finish inside the budget, attestation is held back until they can.
- **KV writes only on change** (snapshot hash, audit hash, funding cache, send-dedupe keys) plus a 10-minute heartbeat.

## Secret

`TALLIER_KEY` is a Worker secret on `flatland-tallier` only (`secret_text`). It is not in this repo, not in any var, not logged and not returned by any endpoint. `FLATLAND_DEPLOYER_KEY` is not used by any worker.

## Build and deploy

```bash
npm run build:workers          # web build + embed dist + esbuild both workers -> workers/dist/
# A) wrangler (needs `wrangler login`):
cd workers/web && npx wrangler deploy
cd workers/tallier && npx wrangler deploy && npx wrangler secret put TALLIER_KEY
# B) what was actually used: the Cloudflare API through the connector (no wrangler login)
node workers/make-payload.mjs web      <KV_ID> > /tmp/deploy-web.js        # then run it with the connector's `execute`
node workers/make-payload.mjs tallier  <KV_ID> https://flatland.flatland.workers.dev > /tmp/deploy-tallier.js
# secret: PUT /accounts/{id}/workers/scripts/flatland-tallier/secrets {name:"TALLIER_KEY",type:"secret_text",text:...}
# cron:   PUT /accounts/{id}/workers/scripts/flatland-tallier/schedules [{cron:"* * * * *"}]
# route:  POST /accounts/{id}/workers/scripts/flatland/subdomain {enabled:true}
```

## Why static files are embedded instead of using Workers Assets

The Workers Assets upload API needs the upload-session JWT as a bearer token. The connector sandbox sends that request but the API answers `401 Unauthorized`, so the static files are embedded in the Worker script and served from it (`workers/build-assets.mjs`). Cost: each file request invokes the Worker and counts against the free 100k requests/day; hashed assets are sent with `immutable` cache headers. With wrangler you can switch `workers/web` to a normal `[assets]` binding.

## Limits and known gaps

- **OG PNG.** Rasterising a 1200x630 card does not fit in 10 ms CPU. `/api/og/:id.png` returns the live SVG card (Telegram and Discord render it); share pages set `twitter:image` to the static `/og-default.png` because X ignores SVG.
- **No SSE `/stream`.** Live rooms use RPC polling (6 s).
- **Cron granularity** is 1 minute, so a deposit-path vote is recorded on-chain at the next election end (that is when the Merkle root is attested), not instantly. Sweeps and finalize happen within about a minute of becoming possible.
- Free-plan CPU limit: if a very large election makes a full pass exceed 10 ms, the tick is killed and retried next minute; the upgrade is the $5 Workers Paid plan (not done).

## RPC notes (keyless public RPCs from Cloudflare egress)

Findings from the live deploy (Nov 2026):
- The official RPC (`rpc.mainnet.chain.robinhood.com`) returns HTTP 429 to Cloudflare's shared egress IPs; publicnode needs a token for older blocks; drpc free rejects `eth_getLogs` ranges it considers too wide; thirdweb caps `eth_getLogs` at **1000 blocks** and rate-limits bursts. Blockscout is behind a Cloudflare challenge, so funding-source lookups return null.
- The tallier therefore scans logs in 1000-block chunks, fetched concurrently (one batched HTTP request), with a KV cursor so only new blocks are read, and walks a fallback list of endpoints.
- Passes still occasionally hit 429s; the next minute's tick retries (all duties are re-derived from chain state, so nothing is lost).
- **For production reliability set a keyed RPC** (e.g. an Alchemy/Infura-style URL for chain 4663) as the `RPC_URL` secret on `flatland-tallier` (comma-separated list allowed); it is tried first.

Free-plan CPU caveat: the idle tick (raw JSON-RPC counter read + KV) is tiny; a full pass (viem + snapshot) can exceed the 10 ms CPU budget occasionally. It runs only when counters change, a deadline is reached, or every 30 min (5 min while any election is not final). Cron changes can take up to ~15 min to propagate.

### Keyed RPC (Alchemy) routing
- `RPC_URL` (Worker secret on `flatland-tallier`, never in the repo): keyed endpoint(s) used first for `eth_call`, blocks, gas, `sendRawTransaction` and receipts, with the public list as fallback.
- `eth_getLogs` is routed separately: Alchemy's free tier caps it at 10 blocks, so logs use the public list (1000-block chunks, one multi-address request per chunk, KV cursor). Set `LOGS_RPC_URL` (secret/var) to put a log-capable endpoint first.
- Error/diagnostic strings are redacted (only hostnames are logged), because keyed URLs carry the key in the path.
- The `flatland` web worker needs no RPC secret: it only serves the KV snapshot (its direct-RPC fallback uses public endpoints).
```
set secret:  PUT /accounts/<id>/workers/scripts/flatland-tallier/secrets  {name:"RPC_URL", type:"secret_text", text:"https://…"}
```

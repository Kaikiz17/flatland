# Flatland — build progress (survives interruptions)

Last updated: 2026-11-10 (Lagos, 13:20).

## Done & committed
- contracts (Flatland hub, Standing, WifGate, ParticipationVault, WifBuyback, BasketVault, FlatAccount/FlatPaymaster, Deploy script): 39 offline tests + 13 fork tests pass (`npm run test:sol`, `npm run test:fork`)
- packages/core (TS: abis, snapshot reader, merkle, clustering, fairness, votelink, analysis): 19 vitest
- packages/indexer (tallier/keeper service + HTTP/SSE): 5 vitest; scripts/e2e-local.sh = full anvil-fork scenario PASSED (docs/e2e-transcript.txt)
- apps/web (Vite+React static build, hash routes): home, elections, election live room, create, rails, basket, leaderboard, me, build; widget public/flatland-widget.js
- api/ (Vercel + Cloudflare wrappers; JSON API, MCP, OG PNG cards, share page): 12 vitest
- packages/bot (Telegram + X dry-run handler, link generator): 7 vitest
- scripts/demo-local.sh (anvil fork + seed + indexer + web), scripts/seed.mts

## Finished this session
- UI e2e (Playwright + injected wallet, mobile no-overflow) PASSED
- Gasless first vote: core builder (gasless.ts, vitest), e2e step on the real EntryPoint (zero-ETH account votes, WIF burned, second sponsorship rejected), UI panel on /me
- README written; branding grep clean (Robinhood only in RPC/explorer URLs and the wallet add-chain name)

## Remaining
- Final full test rerun, then report. Nothing pushed, nothing deployed.

## Beta caps (this session)
- BasketVault: walletCap 100 USDG, tvlCap 1,000 USDG, governance-adjustable (setCaps/setGovernance), maxDeposit view; UI banner + per-wallet room; 11 offline + 1 fork test; e2e asserts caps

## Mainnet (10 Nov 2026)
- Full stack deployed to chain 4663, WifSwapper deployed, ~$1 ETH swapped to ~750 WIF. See deployments/robinhood-mainnet.json. Verification pending (Cloudflare blocks API).

## Cloudflare deploy (10 Nov 2026) — resume notes
- Account workers.dev subdomain `flatland` created. KV namespace `flatland` id `e6591923eec1421e99674804fd5e5be0`.
- Worker `flatland` (web+API, static embedded) live at https://flatland.flatland.workers.dev. Worker `flatland-tallier` (cron `* * * * *`, secret `TALLIER_KEY` set via API, no HTTP surface).
- Deployed through the Cloudflare connector, not wrangler (not logged in): `npm run build:workers`, then `node workers/make-payload.mjs web|tallier ...` and run the output with the connector's `execute`. See `workers/README.md`.
- Workers Assets upload via the connector sandbox returns 401 (JWT bearer), so static files are embedded in the Worker.
- Free-plan limits drove the design: 10 ms CPU, 50 subrequests, 1k KV writes/day. OG PNG is not possible on free; SVG + static `/og-default.png` for X.
- Cron changes can take up to ~15 min to propagate on a new schedule. Status: `GET /api/status` (reads KV heartbeat, max 10 min old).
- Secret hygiene: key only in Worker secret; payload file with the key was mode 600 in /tmp and shredded; repo + built bundles scanned for the key (0 hits).
- No elections exist on mainnet yet, so tallier duties are idle until the first election is created.

## Cloudflare status (final)
- Live: https://flatland.flatland.workers.dev (Worker `flatland`, static embedded; assets upload 401'd from connector). Tallier: `flatland-tallier`, cron `* * * * *`, secret `TALLIER_KEY`, KV `flatland`.
- Thin idle path + lazy full pass; KV log cursor; 1000-block concurrent log chunks (thirdweb cap). Full pass verified: error null, tallierActive true, 11 subrequests.
- 0 elections on mainnet yet, so no on-chain tallier action has been exercised end-to-end.
- TODO: keyed RPC as `RPC_URL` secret for reliability; watch CPU on full passes.

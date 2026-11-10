# Flatland — build progress (survives interruptions)

Last updated: 2026-11-10 (Lagos).

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

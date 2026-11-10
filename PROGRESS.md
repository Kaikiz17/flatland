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

## In progress / remaining
1. scripts/ui-e2e.mjs (Playwright + injected wallet) — debug wallet modal step (uses /workspace/shots/node_modules/playwright-core)
2. Gasless first-vote UI (contracts+tests done; web panel + TS userOp builder + e2e step missing)
3. README (architecture, flywheel, trust model, deploy for Vercel/Cloudflare, known limitations, go-live checklist)
4. Final: rerun all tests, branding grep (no Robinhood in UI), commit, report

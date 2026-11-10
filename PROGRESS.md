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

## Keyed RPC (Alchemy) – done
- `RPC_URL` secret on `flatland-tallier` (Alchemy, reads/gas/sends/receipts first). `eth_getLogs` stays on public endpoints (Alchemy free = 10-block cap), via one multi-address request per 1000-block chunk. Optional `LOGS_RPC_URL`.
- Verified: forced full passes with `error null`, 8 subrequests, no 429s in rpcDiag; idle CPU p50 ≈ 2 ms (was ≈ 48 ms), full-pass p99 ≈ 80 ms.

## Phase 1 (10 Nov 2026, ~16:05 Lagos): burn counter + option images — LIVE
- Home `BurnHero` (total $WIF burned through Flatland, voters, votes, elections; polls `/api/stats` every 5 s and merges, max-wise, with the browser's own chain read) + `BurnPill` in the header on every page.
- Optional image per option on Create ("🖼 Add image", file picker, no URLs): client center-crops square, <=512px, WebP (JPEG fallback) <=80 KB, then strips the ICC profile (`apps/web/src/lib/strip.ts`); canvas re-encode already drops EXIF/XMP/GPS/comments.
- Worker routes (`api/_lib/media.ts`): `POST /api/img` (validates type/size and REJECTS any metadata chunk, stores in KV `img:<sha256>`, deduped), `GET /img/<hash>` (immutable, nosniff, CSP sandbox), `POST /api/meta` -> `meta:<sha256>` JSON `{v:1,images:{"<optionIndex>":"<hash>"},details?}`, `GET /m/<hash>`. The election's on-chain `metaURI` is `<origin>/m/<hash>` (no contract change); the user's Details link rides inside the blob (`details`) and is shown in the room.
- KV write budget (1,000/day): only NEW objects cost writes (2 each: object + counters). Global cap 150 new objects/UTC day + 12/IP/day (+ per-isolate burst limit of 20/min). Duplicates cost reads only.
- Rendering with graceful fallback (no image -> nothing): room picture cards, election list/home cards (thumb strip), API (`options[].image`, `details`), share page (`twitter:card=summary` + the option image when images exist; else the existing large card). The rails widget has no options, so it is unchanged.
- Tests: `api/test/media.test.ts` (validation incl. EXIF/comment/ICC/XMP/oversize/trailing bytes, dedupe, caps, stripper); UI: `node scripts/ui-images.mjs <url> [shots]` against `scripts/demo-local.sh` + `scripts/dev-edge.mts` (creates an election with images through the UI, checks served bytes contain no EXIF/XMP, picture cards, share page, mobile no-overflow).
- Deployed through the connector (web worker only; tallier untouched). Live test image deleted from KV.

## Phase 2 (10 Nov 2026, ~16:20 Lagos): vote from X + Telegram webhook — LIVE
- `/v/<id>/<opt>` one-tap vote page (rich OG: option title + live tally in the description, option image when present; redirects to `/#/e/<id>?vote=<opt>`); 404 on a bad option. API options now carry `voteUrl`.
- Election room: "Share on X" composer (editable prefilled "Reply or tap to vote: A … B …" + live %), Post/Copy per option.
- Telegram: `POST /api/telegram` on the `flatland` worker (`api/_lib/telegram.ts`, pure brain + route glue). /start /elections /vote <id> <opt> (one-tap link + deposit address, https buttons only) /results <id> + inline mode (`@bot [id]`). Token = Worker secret `TELEGRAM_BOT_TOKEN` (NOT set; route returns 503 and sends nothing until it is); optional `TELEGRAM_WEBHOOK_SECRET` is checked against `X-Telegram-Bot-Api-Secret-Token`. `workers/make-payload.mjs web` now sets `keep_bindings: ['secret_text']` so redeploys keep the secrets.
- To enable (user): create the bot with @BotFather (/setinline for inline mode), then set the secret on `flatland` (`PUT /accounts/<id>/workers/scripts/flatland/secrets {name:"TELEGRAM_BOT_TOKEN",type:"secret_text",text:...}`) and register the webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://flatland.flatland.workers.dev/api/telegram` (add `&secret_token=...` + the matching secret).
- Tests: `api/test/telegram.test.ts` (6), `node scripts/ui-share.mjs <web> <id>`; verified live on election #1.

## Phase 3 + 4 + wording + "I voted" (live)
- GOAT rematch template `#/create?template=goat` (32 World is Fair candidates, 7 days); home feature slot reads `goatElectionId` in config.json (0 = shows create CTA).
- Flat Score `#/score/<addr>`, `/api/score/<addr>`, `/share/score/<addr>`, SVG card; linked from /me and leaderboard.
- "I voted" card after a vote, `/share/voted/<id>/<opt>`.
- Stock Pot showcase (executed-on-chain moment from vault logs), `?template=basket`, plain wording for Stock Pot and Send-to-act with 3-step strips. Steps to run: docs/stock-pot-run.md
- Not done on purpose: tallier redeploy.

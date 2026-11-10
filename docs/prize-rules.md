# PrizeRules add-on (code + tests only, NOT deployed)

Contract: `contracts/src/PrizeRules.sol`. Tests: `contracts/test/PrizeRules.t.sol` (10 tests incl. a 512-run fuzz, all pass: `cd contracts && forge test --match-contract PrizeRulesTest`).
No hub change. Pays in $WIF (the hub's token).

## What the creator sets (before the election ends, locked after `create`)
- First voter prize, last voter prize.
- Lucky voter spots: any number (max 20) of (voter position N, $WIF amount). Positions are 1-based.
- Random draw: a pool split equally across R winners (max 50), drawn from a future block hash with the same entropy source as the hub.
- `create` pulls the full amount from the creator; only the election's creator may call it, only while the election is open.

## Order of voters
Same as the hub: chain voters in vote order (`voterAt`), then deposit-path entries in Merkle order. Deposit-path votes count once the tallier has recorded them.

## Lucky voter payout
The hub has no vote hook, so a payout in the very same transaction as the Nth vote would need a hub change. Instead:
- `payLucky(id, slot)` is permissionless and instant: it reads `hub.voterAt` and pays that voter inside the call. It reverts until the Nth vote exists on-chain. The tallier/bot fires it within a minute of each vote (poll `voterCount`, or listen for the hub's vote event). Emits `LuckyHit(id, slot, position, voter, amount)` for the "You hit lucky voter #172, paid X $WIF" moment, with the tx link.
- Deposit-path voters (known only after the tallier submits the Merkle root) are paid with `claim(...)` and a proof. Same event.
- First-voter prize is claimable right away; last and random prizes after `settle` (hub finalized) and, for random, `seed`.
- Prizes always go to the voter address, whoever sends the tx.
- Unclaimed or forfeited spots (position larger than the final voter count) return to the creator via `reclaim` 30 days after `settle`, or immediately if nobody voted.

## Privacy note
Lucky positions and amounts are stored on-chain and readable with `getLucky(id)`. The UI never lists them; it only shows "lucky voter prizes: N hidden spots". Anyone reading the chain can see them.

## UI
The create page has a checkbox, “Add first, last, lucky and random prizes” (also opens with `#/create?prizes=1`). Inputs + total to fund. Funding stays disabled until the contract is deployed and its address is configured. After a vote, the election room reads the `LuckyHit` event and shows “You hit lucky voter #N!”.

## Tallier `payLucky` auto-trigger
The tallier (`packages/indexer` + `flatland-tallier` worker) calls permissionless `payLucky(id, slot)` as soon as `hub.voterCount` reaches that lucky number. It is gated on a `PRIZE_RULES` address (`ServiceConfig.prizeRules`, Worker env `PRIZE_RULES`, or `prizeRules` in the deployment JSON). While that address is unset or zero, the duty is a no-op (no extra RPC, no transactions).

## How to switch on lucky payouts after deploy (NOT done; needs the owner’s go)
1. Deploy `PrizeRules` with the hub address (≈1.97M gas, about 0.00006 ETH / $0.13). Do not do this until the owner says go.
2. Put the new address in `deployments/robinhood-mainnet.json` as `prizeRules`, and in `apps/web/public/config.json` as `prizeRules` (so the UI can read `LuckyHit` and enable funding).
3. Set the `PRIZE_RULES` binding on Worker `flatland-tallier` (plain text or secret): `PUT /accounts/<id>/workers/scripts/flatland-tallier/secrets` (or a `plain_text` binding) `{name:"PRIZE_RULES", type:"plain_text", text:"0x…"}`.
4. Redeploy the `flatland` web worker and `flatland-tallier` (keep_bindings preserves `TALLIER_KEY` and `RPC_URL`). After that, creators can fund prizes from the create panel; the tallier pays lucky spots within about a minute of voter #N, and the voter sees the pop-up.

## Deploy cost on 4663 (NOT deployed, nothing spent)
- Creation bytecode: 9,073 bytes (incl. constructor arg).
- `eth_estimateGas` on the real RPC: 1,974,241 gas.
- Gas price 0.02036 gwei, plus about 0.00002 ETH L1 data fee: about 0.00006 ETH, roughly $0.13 at $2,101/ETH.
- Per-call gas (create, payLucky, claim) was not separately measured; the test suite's whole-flow runs cost about 0.7-3.3M gas including election setup and votes.

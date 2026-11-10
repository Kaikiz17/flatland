# PrizeRules add-on (deployed on Robinhood Chain)

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
The create page has a checkbox, “Add first, last, lucky and random prizes” (also opens with `#/create?prizes=1`). Inputs + total to fund. Lucky spots are an add/remove list (max 20), each with its own voter number and amount. After a vote, the election room reads the `LuckyHit` event and shows “You hit lucky voter #N!”.

## Tallier `payLucky` auto-trigger
The tallier (`packages/indexer` + `flatland-tallier` worker) calls permissionless `payLucky(id, slot)` as soon as `hub.voterCount` reaches that lucky number. It is gated on a `PRIZE_RULES` address (`ServiceConfig.prizeRules`, Worker env `PRIZE_RULES`, or `prizeRules` in the deployment JSON). While that address is unset or zero, the duty is a no-op (no extra RPC, no transactions).

## Deployed on Robinhood Chain (4663)
- Address: [`0x0687847DdD19B924a1304347F02D2ed25CF6E159`](https://robinhoodchain.blockscout.com/address/0x0687847DdD19B924a1304347F02D2ed25CF6E159)
- Deploy tx: [`0x1cdc4725f2b9e8bc41212b01eed00a522310ac4e6f47d7d92a77dfd0e294240d`](https://robinhoodchain.blockscout.com/tx/0x1cdc4725f2b9e8bc41212b01eed00a522310ac4e6f47d7d92a77dfd0e294240d)
- Constructor arg: Flatland hub `0x365c58F9B820990a1c1C1F2f77404ec57207b1C6`. `hub()` and `WIF()` read back correctly. Runtime codesize 8,681 bytes.
- Gas used: 1,957,540. Actual cost: 0.00003969 ETH (about $0.08 at $2,100/ETH). Only this deploy tx was sent; no prize pot was funded.
- Address is in `deployments/robinhood-mainnet.json` and `apps/web/public/config.json` as `prizeRules`. `PRIZE_RULES` is a `plain_text` binding on `flatland-tallier`.
- Creators fund from the create page (checkbox or `#/create?prizes=1`): add/remove as many lucky rows as they like (max 20), each with its own voter number and $WIF amount. Publishing the election is followed by a second wallet signature to fund.

## Previous estimate (for the record)
- Creation bytecode: 9,073 bytes (incl. constructor arg).
- `eth_estimateGas` on the real RPC: 1,974,241 gas.
- Gas price ~0.02025 gwei; conservative script estimate was 0.000104 ETH at 2× max fee. Actual L2 + L1 spend was 0.00003969 ETH.

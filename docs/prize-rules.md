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
`#/create?prizes=1` shows a preview panel (inputs + total to fund). Funding is disabled until the contract is deployed and its address added to the deployment file.

## Deploy cost on 4663 (NOT deployed, nothing spent)
- Creation bytecode: 9,073 bytes (incl. constructor arg).
- `eth_estimateGas` on the real RPC: 1,974,241 gas.
- Gas price 0.02036 gwei, plus about 0.00002 ETH L1 data fee: about 0.00006 ETH, roughly $0.13 at $2,101/ETH.
- Per-call gas (create, payLucky, claim) was not separately measured; the test suite's whole-flow runs cost about 0.7-3.3M gas including election setup and votes.

# Flatland — World is Flat hackathon submission

**Live:** https://flatland.flatland.workers.dev  
**Repo:** https://github.com/Kaikiz17/flatland  
**Demo video:** _(attach the 90-second cut; shot list is in `docs/DEMO-SCRIPT.md`)_  
**Chain:** Robinhood Chain (chain id 4663)

Flatland is an open 1-wallet-1-vote election kit for anyone. It is not affiliated with, endorsed by, or officially connected to Robinhood Markets, Inc. The name and logo do not use the Robinhood brand.

## How Flatland fits with World is Fair

[World is Fair](https://worldisflat.fun/fair/) is $WIF’s official Decentralized Voting Layer, run by the WIF team ([@WIFonRH](https://x.com/WIFonRH)). It is not self-serve — only the WIF team runs official events, and there has been one so far: “Who is the G.O.A.T.?” (closed 14 Sep 2026, about 1,454 wallets; Vlad Tenev won with 297 votes). Fair runs WIF’s official votes; Flatland lets any project or DAO run its own — plus Sign, Stocks, auto lucky prizes and shareable cards. The two are complementary, not competing.

## The pitch

Anyone can open an election in a minute: a question, options, a deadline, and a vote cost of at least 1 $WIF. One wallet gets one vote. Every vote burns $WIF. Voters can use a connected wallet or just send 1 $WIF to an option’s deposit address from any wallet app. Results are public, shareable, and collectible — an “I voted” card after you cast, with a landscape preview for X.

Two more ways to put $WIF to work, in the same app:

- **Stocks** — the community stock pot. People pool $WIF toward a basket; the vote decides what the pot does next.
- **Sign** — petitions, RSVPs, allowlists and access gates in one contract. Each act burns $WIF, is capped at one per wallet, and builds the actor’s on-chain streak.

## Why $WIF

$WIF is not a badge. It is the action.

- **Burn per vote / per Sign act.** Participation is a permanent sink. Spam is expensive; a real vote costs real $WIF.
- **Stocks buys.** The stock pot is a reason to move $WIF into a shared, on-chain decision — not just to hold it.
- **One flywheel.** Using Flatland takes $WIF out of supply (burns) or into a community pot (Stocks). Shared cards and links pull the next person in. They need $WIF to act, which takes them back to $WIF. The same token is the ballot, the gate fee, and the pot.

## How it works

1. Create an election (permissionless). Optional prize pool and lucky-number prizes can be set before it goes live.
2. Share the live room or a one-tap `/v/<id>/<option>` link. Fairness scoring and sybil grouping run in the open.
3. Vote: wallet or a plain $WIF transfer. The burn happens in the same flow.
4. After you vote or sign, download a 1:1 collectible card (or share the page — X gets a 1200×630 preview).
5. When the election ends, a verifiable future-block draw can pay prize slots. Sign builds a public streak.

A People’s Pick template at `#/create?template=peoples-pick` prefills a community vote on the World is Flat hackathon entries (plus Flatland).

## Mainnet contracts

From `deployments/robinhood-mainnet.json`. Explorer: https://robinhoodchain.blockscout.com

| Contract | Address | Deploy transaction |
|---|---|---|
| Flatland (hub) | `0x365c58F9B820990a1c1C1F2f77404ec57207b1C6` | `0x59929501b9b6297844ebc2f925810d4e89f9395a1417728844fe0ea915213674` |
| WifGate (Sign) | `0x0418cfe1D505d665c6F5A56De982EA991259B3e7` | `0x4114beed811b7df6bf2f693e906287ff8a6ad039bcfb85af056caf495a2b8564` |
| BasketVault (Stocks) | `0x03B38516816cFeE9bFf2018D8A638a51ABe87b8b` | `0x8274d5f5847c27e7f55842405b2de5bbe7b579924c939a0cbac62ba5713811c5` |
| Standing | `0x6E4d5caA2886b927660CFC8bb8938e12fa3F57f9` | `0xdb31189acbcaab54d576bb379b2b72315228671f5812ff2a9696033cd7435811` |
| ParticipationVault | `0x2BAB6b4C125cD888F36CF9Db84d2F73EBFBf2558` | `0x836e02b8353a43d3838989aa5c156c1ba106b6a2c6cf0159e1ae9cb3a075fab4` |
| WifBuyback | `0x2f8B80C302664Fd81F5c48604F279753487F32c9` | `0x54ca4344d6d06dffdf8409f1329c9a325fb150dbe47febc15465ea12e6511435` |
| ArbEntropy | `0xda21A3C248282B1974f372bb82bE1F71C1B4C17C` | `0xf324abf68133fde347e9ef6e450e1258eaea6de8990e7c54eb1637ac3227f49e` |
| FlatAccountFactory | `0x0d3302a1A902e363cc5d7BC4663FD2098BC2776f` | `0x87938c6eddcb2b457310c4cb9f7bdae629f41716a143ac3cf7e30723cabffdba` |
| FlatPaymaster | `0x13b452C867D89F907A56550A5C2744Aff8998e30` | `0x4cef28ec6ce88dce1eb48d2713c9e7e59e243138e3719ce947b0119dcf87099a` |
| WifSwapper | `0xd53Fb1dEE195beba25dae1937e28d65252230DcD` | `0xc088b78e74ac63b5fad443e81c5c78cce30880ff2d62f04e800db92bac700194` |

Also in that deploy: StandingLockWriters `0x0f5307e507d199537288777c8e454392ad2c5861a7ceaedb950033c667e511b4`, SwapEthForWif `0x74424b4dba9ba705a12efaae5565bdcf047e7a6c945c94cc75f0ab7933185a72`. Deploy block `110814875`. $WIF `0x5173b8eA6923c2d40267890D45C46a3480954773`. USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.

## Live proof — election #1

- Room: https://flatland.flatland.workers.dev/#/e/1  
- Title: “What would be the price of bitcoin before the end of 2026?”  
- On the hub above: 1 counted vote, 1 $WIF burned, 50 $WIF prize pool, 5 winner slots, status open.  
- Hub explorer: https://robinhoodchain.blockscout.com/address/0x365c58F9B820990a1c1C1F2f77404ec57207b1C6

## Beta / unaudited

Flatland is beta software. The contracts are unaudited. Use only what you can afford to lose. $WIF has no intrinsic value and no promise of return. Nothing here is financial, legal or tax advice, or a recommendation to buy, sell or hold any asset. Digital assets and smart contracts can fail; on-chain losses are usually permanent.

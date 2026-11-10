# Run the Stock Pot live (5-10 USDG)

Page: https://flatland.flatland.workers.dev/#/basket  (BasketVault 0x03B38516816cFeE9bFf2018D8A638a51ABe87b8b, chain 4663)
Beta caps: 100 USDG per wallet, 1,000 USDG total. Min trade per stock: 2 USDG.

1. **Deposit.** Connect wallet, "Deposit USDG", put in 10 USDG (approve, then deposit). A 0.30% fee funds the $WIF buyback and burn. 10 USDG is enough for up to 5 buys above the 2 USDG minimum, 5 USDG only supports 1-2 stocks.
2. **Open the vote.** Press "Start this week's Stock Pot vote" (calls `openEpoch()`; the vault creates the hub election itself, executor = the vault, vote window 5 days). No vote may be running yet.
3. **Vote.** On the election, burn 1 $WIF per wallet to pick a stock (SPY, QQQ, NVDA, AAPL, MSFT, TSLA). Ask a few people to vote too. With 5-10 USDG, a clear winner gets up to 40% of the pot (the 40% cap, 1% stays cash), so with a 10 USDG pot a single stock gets 4 USDG, and only stocks above 2 USDG are bought.
4. **Wait** for the voting to end (5 days after step 2), plus the 12 hour challenge window. Opening on 10 Nov ends 15 Nov, lockable about 15 Nov evening, before the 16 Nov final.
5. **Lock in the result.** Press "Lock in the result" (hub `finalize`, anyone). The vault's `onFinalize` sets the target weights.
6. **Buy.** Press "Buy what the people chose" (`rebalance()`, anyone). The vault swaps USDG for the winning Stock Tokens on Uniswap.
7. **See it.** The "Executed on-chain" block on the page shows the buy tx links and the holdings change.
8. **Exit any time:** "Redeem" returns your share.

Notes
- The page's "template" opens the election through the vault, because `BasketVault.onFinalize` only accepts its own epoch election (`WrongElection`). A hub election created from the normal Create form with the vault as executor would never execute.
- The tallier KV snapshot does not yet carry the vault logs; the page reads the chain directly in the browser, so the Executed block works without redeploying the tallier.

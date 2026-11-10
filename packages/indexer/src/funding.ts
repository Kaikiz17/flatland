import type { Address, PublicClient } from 'viem';
import { getAddress } from 'viem';
import type { FundingInfo, FundingProvider } from '@flatland/core';

/** Funding source = who first sent value (ETH) to the wallet. Cached; failures degrade to "unknown" (never collapse on doubt). */
export function cached(inner: FundingProvider, cache: Map<string, FundingInfo>): FundingProvider {
  return async (w) => {
    const k = w.toLowerCase();
    const hit = cache.get(k);
    if (hit) return hit;
    const v = await inner(w);
    if (v.source) cache.set(k, v);
    return v;
  };
}

/** Production: Blockscout REST v2 (earliest inbound transaction with value, falling back to earliest token transfer in). */
export function blockscoutProvider(base = 'https://robinhoodchain.blockscout.com', maxPages = 6): FundingProvider {
  return async (wallet) => {
    try {
      let params = '';
      let earliest: { from: string; hash: string } | null = null;
      for (let page = 0; page < maxPages; page++) {
        const r = await fetch(`${base}/api/v2/addresses/${wallet}/transactions?filter=to${params}`, { headers: { accept: 'application/json', 'user-agent': 'flatland-indexer/1.0' } });
        if (!r.ok) return { source: null };
        const j: any = await r.json();
        for (const t of j.items ?? []) if (t.from?.hash && t.value !== '0' && t.from.hash.toLowerCase() !== wallet.toLowerCase()) earliest = { from: t.from.hash, hash: t.hash };
        if (!j.next_page_params) break;
        params = '&' + new URLSearchParams(j.next_page_params).toString();
      }
      return earliest ? { source: getAddress(earliest.from), tx: earliest.hash } : { source: null };
    } catch {
      return { source: null };
    }
  };
}

/** Local anvil/devnet: scan blocks [from, head] for the first value transfer into the wallet. */
export function rpcScanProvider(client: PublicClient, fromBlock: bigint): FundingProvider {
  let index: Map<string, { from: Address; tx: string }> | null = null;
  let scannedTo = fromBlock - 1n;
  return async (wallet) => {
    const head = await client.getBlockNumber();
    if (!index) index = new Map();
    for (let b = scannedTo + 1n; b <= head; b++) {
      const blk = await client.getBlock({ blockNumber: b, includeTransactions: true });
      for (const t of blk.transactions) {
        if (t.to && t.value > 0n) {
          const k = t.to.toLowerCase();
          if (!index.has(k)) index.set(k, { from: t.from, tx: t.hash });
        }
      }
    }
    scannedTo = head;
    const f = index.get(wallet.toLowerCase());
    return f ? { source: getAddress(f.from), tx: f.tx } : { source: null };
  };
}

export function staticProvider(map: Record<string, Address>): FundingProvider {
  return async (w) => ({ source: map[w.toLowerCase()] ?? null });
}

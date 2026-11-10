import { encodeFunctionData, getAddress, type Address } from 'viem';
import { erc20Abi } from './abis.js';
import { ONE_WIF, WIF } from './chain.js';

/** "vote B" / "Vote option 2" / "b" / "#3" → option index (0-based), or null. Letters A..Z or numbers 1..32. */
export function parseVoteText(text: string, optionCount: number, labels?: string[]): number | null {
  const t = text.trim().replace(/@\w+/g, ' ').replace(/[.!?,:;]+$/g, '').trim();
  const m = /^(?:i\s+)?(?:vote|pick|choose|voting)?\s*(?:for\s+)?(?:option\s+|#)?([a-z]|\d{1,2})$/i.exec(t.replace(/\s+/g, ' '));
  if (m) {
    const tok = m[1];
    if (/^\d+$/.test(tok)) {
      const n = parseInt(tok, 10) - 1;
      return n >= 0 && n < optionCount ? n : null;
    }
    const n = tok.toUpperCase().charCodeAt(0) - 65;
    return n >= 0 && n < optionCount ? n : null;
  }
  if (labels) {
    const low = t.toLowerCase().replace(/^(i\s+)?(vote|pick|choose)\s+(for\s+)?/, '');
    const i = labels.findIndex((l) => l.toLowerCase() === low);
    if (i >= 0) return i;
  }
  return null;
}

export interface VoteLinks {
  /** EIP-681 payment request: opens in Trust Wallet, MetaMask mobile, Rainbow, Coinbase Wallet… = ready-to-send 1 WIF transfer. */
  eip681: string;
  /** Wallet-specific deep links for the same transfer. */
  metamask: string;
  trust: string;
  /** The Flatland web page with the option pre-selected (connect-wallet path). */
  web: string;
  depositAddress: Address;
  amount: string;
}

export function voteLinks(args: {
  appUrl: string;
  electionId: number;
  option: number;
  deposit: Address;
  voteCost?: bigint;
  chainId?: number;
}): VoteLinks {
  const cost = args.voteCost ?? ONE_WIF;
  const chainId = args.chainId ?? 4663;
  const dep = getAddress(args.deposit);
  const eip681 = `ethereum:${WIF}@${chainId}/transfer?address=${dep}&uint256=${cost.toString()}`;
  return {
    eip681,
    metamask: `https://link.metamask.io/send/${WIF}@${chainId}/transfer?address=${dep}&uint256=${cost.toString()}`,
    trust: `https://link.trustwallet.com/send?asset=c${chainId}_t${WIF}&address=${dep}&amount=${Number(cost) / 1e18}`,
    web: `${args.appUrl.replace(/\/$/, '')}/#/e/${args.electionId}?vote=${args.option}`,
    depositAddress: dep,
    amount: `${Number(cost) / 1e18} WIF`,
  };
}

/** Raw calldata for the same transfer, for wallets/bots that build transactions themselves. */
export function transferCalldata(deposit: Address, amount: bigint = ONE_WIF) {
  return { to: WIF, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [deposit, amount] }), value: 0n };
}

export const optionLetter = (i: number) => String.fromCharCode(65 + i);

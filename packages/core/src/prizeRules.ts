import type { Address } from 'viem';

/** Minimal ABI for the PrizeRules add-on. */
export const prizeRulesAbi = [
  {
    type: 'function', name: 'create', stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'firstPrize', type: 'uint128' },
      { name: 'lastPrize', type: 'uint128' },
      { name: 'luckyPositions', type: 'uint256[]' },
      { name: 'luckyAmounts', type: 'uint128[]' },
      { name: 'randomPool', type: 'uint128' },
      { name: 'randomSlots', type: 'uint32' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'getLucky', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'positions', type: 'uint256[]' },
      { name: 'amounts', type: 'uint128[]' },
    ],
  },
  {
    type: 'function', name: 'getPrize', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'creator', type: 'address' },
        { name: 'first', type: 'uint128' },
        { name: 'last', type: 'uint128' },
        { name: 'randomPool', type: 'uint128' },
        { name: 'luckyCount', type: 'uint32' },
        { name: 'randomSlots', type: 'uint32' },
        { name: 'settled', type: 'bool' },
        { name: 'reclaimed', type: 'bool' },
        { name: 'settledAt', type: 'uint64' },
        { name: 'drawBlock', type: 'uint64' },
        { name: 'total', type: 'uint32' },
        { name: 'seed', type: 'bytes32' },
        { name: 'funded', type: 'uint256' },
        { name: 'paid', type: 'uint256' },
        { name: 'randomEach', type: 'uint128' },
      ],
    }],
  },
  {
    type: 'function', name: 'claimed', stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'kind', type: 'uint8' },
      { name: 'slot', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'payLucky', stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'slot', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event', name: 'LuckyHit',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'slot', type: 'uint256', indexed: false },
      { name: 'position', type: 'uint256', indexed: false },
      { name: 'voter', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const PRIZE_KIND_LUCKY = 2;

const ZERO = '0x0000000000000000000000000000000000000000';

/** True when a PrizeRules address is configured (unset / zero / junk → tallier and UI no-op). */
export function isPrizeRulesConfigured(addr?: string | null): addr is Address {
  return !!addr && /^0x[0-9a-fA-F]{40}$/.test(addr) && addr.toLowerCase() !== ZERO;
}

/** Petition / RSVP / allowlist / access headline for the "I signed" card. */
export function signedHeadline(kind: number, title: string): string {
  const t = title.trim();
  if (kind === 1) return "I'm on the RSVP list";
  if (kind === 2) return "I'm on the allow list";
  if (kind === 3) return "I'm on the access list";
  if (/^\s*(for|against)\b/i.test(t)) return `I signed ${t}`;
  if (/\bagainst\b/i.test(t) || /\b(stop|oppose|ban|reject)\b/i.test(t)) return `I signed against ${t}`;
  return t ? `I signed for ${t}` : 'I signed';
}

export function signedKindLabel(kind: number): string {
  return kind === 1 ? 'RSVP' : kind === 2 ? 'Allowlist' : kind === 3 ? 'Access list' : 'Petition';
}

import { formatUnits, type Address } from 'viem';

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const wif = (wei: string | bigint, dp = 0) => {
  const n = Number(formatUnits(BigInt(wei), 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
};
export const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const compactWif = (wei: string | bigint) => compact(Number(formatUnits(BigInt(wei), 18)));
export const usdg = (v: string | bigint | null, dp = 2) => (v == null ? '—' : Number(formatUnits(BigInt(v), 6)).toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp }));

export function ago(ts: number, now = Date.now() / 1000) {
  const d = Math.max(0, Math.floor(now - ts));
  if (d < 5) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
export function until(ts: number, now = Date.now() / 1000) {
  const d = Math.floor(ts - now);
  if (d <= 0) return 'ended';
  const days = Math.floor(d / 86400), h = Math.floor((d % 86400) / 3600), m = Math.floor((d % 3600) / 60), s = d % 60;
  if (days > 0) return `${days}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}
export const flag = (cc: string) => cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
export const isAddr = (a: string): a is Address => /^0x[0-9a-fA-F]{40}$/.test(a);
export const ZERO = '0x0000000000000000000000000000000000000000' as const;
export const BAR_COLORS = ['#ff5a36', '#0fa3a3', '#f2b705', '#4f5bd5', '#c13584', '#2e9e5b', '#8a5a44', '#10203a'];

/** Query string for share/card URLs: wallet + unix seconds. */
export function cardQuery(wallet?: string | null, ts?: number): string {
  const p = new URLSearchParams();
  if (wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet)) p.set('w', wallet);
  if (ts && Number.isFinite(ts) && ts > 0) p.set('t', String(Math.floor(ts > 1e12 ? ts / 1000 : ts)));
  const s = p.toString();
  return s ? `?${s}` : '';
}

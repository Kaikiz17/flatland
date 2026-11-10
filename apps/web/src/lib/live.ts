// Live burn counter: polls the Worker's /api/stats (fast, cached KV snapshot) and merges it with the browser's own chain read,
// taking the max of each field so the number only ever ticks up.
import { useEffect, useSyncExternalStore } from 'react';
import { useApp } from './store';

export interface LiveTotals { wifBurned: bigint; votes: number; elections: number; participants: number; acts: number; at: number }
let live: LiveTotals | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function poll() {
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const r = await fetch('/api/stats', { cache: 'no-store' });
    if (!r.ok) return;
    const s = await r.json();
    if (s.wifBurned == null) return;
    live = {
      wifBurned: BigInt(s.wifBurned), votes: Number(s.votes ?? 0), elections: Number(s.elections ?? 0), participants: Number(s.participants ?? 0), acts: Number(s.acts ?? 0), at: Date.now(),
    };
    emit();
  } catch {}
}

export function useLiveTotals(): LiveTotals | null {
  const { snap } = useApp();
  useEffect(() => {
    users++;
    if (users === 1) { void poll(); timer = setInterval(poll, 5000); }
    return () => { users--; if (users === 0 && timer) { clearInterval(timer); timer = null; } };
  }, []);
  const l = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => live);
  const t = snap?.totals;
  if (!l && !t) return null;
  const mb = (a: bigint, b: bigint) => (a > b ? a : b);
  return {
    wifBurned: mb(l?.wifBurned ?? 0n, t ? BigInt(t.wifBurned) : 0n),
    votes: Math.max(l?.votes ?? 0, t?.votes ?? 0),
    elections: Math.max(l?.elections ?? 0, t?.elections ?? 0),
    participants: Math.max(l?.participants ?? 0, t?.participants ?? 0),
    acts: Math.max(l?.acts ?? 0, t?.acts ?? 0),
    at: Math.max(l?.at ?? 0, 0),
  };
}

export const burnedNumber = (wei: bigint) => Number(wei / 10n ** 12n) / 1e6; // WIF with 6 decimals

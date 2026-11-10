import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Hex } from 'viem';
import { refresh, useApp } from '../lib/store';
import type { TxStep } from '../lib/actions';
import { BAR_COLORS } from '../lib/format';
import { connectModal } from './Wallet';
import { useWallet } from '../lib/wallet';

export const Logo = ({ size = 34 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#10203a" /><circle cx="32" cy="30" r="14" fill="#f3eee1" /><rect x="6" y="30" width="52" height="5" fill="#ff5a36" /></svg>
);

export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <div className="stat"><b>{value}</b><span>{label}</span>{sub ? <div className="small muted">{sub}</div> : null}</div>
);

export function cleanError(e: unknown): string {
  const x = e as any;
  const m: string = x?.shortMessage ?? x?.message ?? String(e);
  if (/User rejected|rejected the request|denied/i.test(m)) return 'You cancelled the request in your wallet.';
  if (/insufficient funds/i.test(m)) return 'Not enough ETH for gas on this chain.';
  return m.split('\n')[0].slice(0, 240);
}

export function useTx() {
  const [step, setStep] = useState<TxStep | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<Hex | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: (onStep: (s: TxStep) => void) => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setErr(null); setHash(null);
    try {
      const r = await fn((s) => { setStep(s); if (s.hash) setHash(s.hash); });
      setStep(null);
      void refresh();
      return r;
    } catch (e) {
      setErr(cleanError(e)); setStep(null);
    } finally { setBusy(false); }
  }, []);
  return { run, step, err, hash, busy, reset: () => { setErr(null); setHash(null); } };
}

export function TxStatus({ tx }: { tx: ReturnType<typeof useTx> }) {
  const { cfg } = useApp();
  return (
    <>
      {tx.step ? <div className="small muted" style={{ marginTop: 8 }}>⏳ {tx.step.label}</div> : null}
      {tx.hash && !tx.busy && cfg ? <div className="small ok" style={{ marginTop: 8 }}>✓ Done · <a href={`${cfg.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">view transaction</a></div> : null}
      {tx.err ? <div className="err">{tx.err}</div> : null}
    </>
  );
}

/** A button that asks for a wallet first, then runs `onRun` through useTx. */
export function ActionButton({ children, onRun, tx, className = 'btn', disabled, requireWallet = true }: { children: ReactNode; onRun: (onStep: (s: TxStep) => void) => Promise<unknown>; tx: ReturnType<typeof useTx>; className?: string; disabled?: boolean; requireWallet?: boolean }) {
  const w = useWallet();
  return (
    <button className={className} disabled={disabled || tx.busy} onClick={() => (requireWallet && !w.address ? connectModal.open() : void tx.run(onRun))}>
      {tx.busy ? 'Working…' : children}
    </button>
  );
}

export function Copy({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="btn ghost sm" onClick={() => { void navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1400); }}>
      {ok ? '✓ Copied' : label ?? 'Copy'}
    </button>
  );
}

export const letter = (i: number) => String.fromCharCode(65 + i);
export const color = (i: number) => BAR_COLORS[i % BAR_COLORS.length];

export function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setN(Date.now() / 1000), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const from = shown, to = value, t0 = performance.now();
    if (from === to) return;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setShown(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{format(shown)}</>;
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="card flat muted" style={{ textAlign: 'center', padding: 30 }}>{children}</div>;

/** Option picture; renders nothing when there is no image or it fails to load (graceful degrade). */
export function OptImg({ src, size = 56, alt = '' }: { src: string | null; size?: number; alt?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return null;
  return <img className="pic" src={src} alt={alt} width={size} height={size} loading="lazy" decoding="async" onError={() => setBad(true)} style={{ width: size, height: size }} />;
}

import { useState } from 'react';
import { useWallet } from '../lib/wallet';
import { downloadPng } from '../lib/download';

type Role = 'voted' | 'bought' | 'sold' | 'cashed' | 'profit';

/** Public Stocks share cards (emerald / gold ticker-tape). No private pass. */
export function StocksCard({ role, title, detail, tx, ts, profit }: { role: Role; title?: string; detail?: string; tx?: string; ts?: number; profit?: { value: string; cost: string; pct: string } }) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const q = new URLSearchParams();
  if (w.address) q.set('w', w.address);
  if (ts) q.set('t', String(ts));
  if (tx) q.set('x', tx);
  if (title) q.set('title', title);
  if (detail) q.set('detail', detail);
  if (profit) { q.set('value', profit.value); q.set('cost', profit.cost); q.set('pct', profit.pct); }
  const qs = q.toString() ? `?${q.toString()}` : '';
  const poster = `/api/card/stocks/${role}.svg${qs}`;
  return (
    <div className="poster-wrap" data-testid={`stocks-card-${role}`}>
      <img className="poster" src={poster} alt={role} width={1080} height={1080} />
      <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
        <button className="btn sm ghost" disabled={busy} onClick={() => { setBusy(true); void downloadPng(poster, `flatland-stocks-${role}.png`).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : 'Download'}</button>
      </div>
    </div>
  );
}

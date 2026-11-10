import { useState } from 'react';
import type { ElectionView } from '@flatland/core';
import { Copy, letter } from './ui';
import { useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { cardQuery } from '../lib/format';
import { appBase } from './ShareComposer';
import { downloadPng } from '../lib/download';

export function voterNumber(e: ElectionView, addr?: string | null): number | undefined {
  if (!addr) return undefined;
  const lc = addr.toLowerCase();
  const i = e.chainVotes.findIndex((v) => v.voter.toLowerCase() === lc);
  if (i >= 0) return i + 1;
  const j = e.depositVotes.findIndex((v) => v.voter.toLowerCase() === lc);
  if (j >= 0) return e.chainVotes.length + j + 1;
  return undefined;
}

function voteEvent(e: ElectionView, addr?: string | null) {
  if (!addr) return undefined;
  const lc = addr.toLowerCase();
  return e.chainVotes.find((x) => x.voter.toLowerCase() === lc) ?? e.depositVotes.find((x) => x.voter.toLowerCase() === lc);
}

/** Collectible 1:1 "I voted" poster + Share on X (landscape OG) + Download PNG. Public only; unique motif from the vote tx. */
export function VotedCard({ e, opt }: { e: ElectionView; opt: number }) {
  const { cfg } = useApp();
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const base = appBase(cfg?.appUrl);
  const ev = voteEvent(e, w.address);
  const no = voterNumber(e, w.address);
  const ts = ev?.ts ?? Math.floor(Date.now() / 1000);
  const qs = cardQuery(w.address, w.address ? ts : undefined) + (ev?.tx ? `${cardQuery(w.address, w.address ? ts : undefined) ? '&' : '?'}x=${ev.tx}` : '');
  const tail = `${e.id}/${opt}${no ? `/${no}` : ''}`;
  const url = `${base}/share/voted/${tail}${qs}`;
  const poster = `/api/card/voted/${tail}.svg${qs}`;
  const text = `I voted ${letter(opt)} — ${e.options[opt]} on “${e.title.slice(0, 90)}”${no ? ` · voter #${no}` : ''} 🔥 My vote burned $WIF. 1 wallet = 1 vote. Cast yours:`;
  return (
    <div className="poster-wrap" data-testid="voted-card">
      <img className="poster" src={poster} alt={`I voted ${e.options[opt]}`} width={1080} height={1080} />
      <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
        <a className="btn sm" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Share on X</a>
        <button className="btn sm ghost" disabled={busy} onClick={() => { setBusy(true); void downloadPng(poster, `flatland-i-voted-${e.id}.png`).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : 'Download'}</button>
        <Copy text={url} label="Copy link" />
      </div>
    </div>
  );
}

import { useState } from 'react';
import { signedHeadline, type GateView } from '@flatland/core';
import { Copy } from './ui';
import { useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { cardQuery } from '../lib/format';
import { appBase } from './ShareComposer';
import { downloadPng } from '../lib/download';

/** Collectible 1:1 "I signed" poster + Share on X (landscape OG) + Download PNG. */
export function SignedCard({ g, position }: { g: GateView; position?: number }) {
  const { cfg } = useApp();
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const base = appBase(cfg?.appUrl);
  const mine = w.address ? g.actors.find((a) => a.who.toLowerCase() === w.address!.toLowerCase()) : undefined;
  const wallet = w.address ?? mine?.who;
  const ts = mine?.ts ?? Math.floor(Date.now() / 1000);
  const qs = cardQuery(wallet, wallet ? ts : undefined);
  const tail = `${g.id}${position ? `/${position}` : ''}`;
  const url = `${base}/share/signed/${tail}${qs}`;
  const poster = `/api/card/signed/${tail}.svg${qs}`;
  const headline = signedHeadline(g.kind, g.title);
  const text = g.kind === 0
    ? `${headline} ✍️ Each act burns $WIF, one per wallet. Sign too:`
    : `${headline} for “${g.title.slice(0, 90)}” on Flatland Sign. Each act burns $WIF, one per wallet:`;
  return (
    <div className="poster-wrap" data-testid="signed-card">
      <img className="poster" src={poster} alt={headline} width={1080} height={1080} />
      <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
        <a className="btn sm teal" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Share on X</a>
        <button className="btn sm ghost" disabled={busy} onClick={() => { setBusy(true); void downloadPng(poster, `flatland-i-signed-${g.id}.png`).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : 'Download'}</button>
        <Copy text={url} label="Copy link" />
      </div>
    </div>
  );
}

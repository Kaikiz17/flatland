import { signedHeadline, signedKindLabel, type GateView } from '@flatland/core';
import { Copy } from './ui';
import { useApp } from '../lib/store';
import { appBase } from './ShareComposer';
import { wif } from '../lib/format';

/** Shown after a Sign act lands: a designed "I signed" card + Share on X. */
export function SignedCard({ g, position }: { g: GateView; position?: number }) {
  const { cfg } = useApp();
  const base = appBase(cfg?.appUrl);
  const url = `${base}/share/signed/${g.id}`;
  const headline = signedHeadline(g.kind, g.title);
  const kind = signedKindLabel(g.kind);
  const text = g.kind === 0
    ? `${headline} ✍️ Each act burns $WIF, one per wallet. Sign too:`
    : `${headline} for “${g.title.slice(0, 90)}” on Flatland Sign. Each act burns $WIF, one per wallet:`;
  const pos = position && position > 0 ? position : undefined;
  return (
    <div className="sharecard signedcard" data-testid="signed-card">
      <div className="sharecard-art" aria-hidden="true">
        <div className="sharecard-sky teal">
          <div className="sharecard-disc" />
          <div className="sharecard-seal signed">I<br />SIGNED</div>
        </div>
        <div className="sharecard-panel">
          <div className="sharecard-kicker teal"><span>I SIGNED</span><b>{kind}{pos ? ` · #${pos}` : ''}</b></div>
          <h3>{headline}</h3>
          {g.kind !== 0 ? <p className="sharecard-sub">{g.title}</p> : null}
          <div className="sharecard-burn"><span>$WIF burned</span><b>{wif(g.cost, 2)}</b></div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <a className="btn sm teal" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Share on X</a>
        <Copy text={url} label="Copy link" />
      </div>
    </div>
  );
}

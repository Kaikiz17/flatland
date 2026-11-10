import type { ElectionView } from '@flatland/core';
import { Copy, letter } from './ui';
import { useApp } from '../lib/store';
import { appBase } from './ShareComposer';

/** Shown right after a vote lands: an "I voted" image card (server-rendered SVG, same card people see on X/Telegram) + share buttons. */
export function VotedCard({ e, opt }: { e: ElectionView; opt: number }) {
  const { cfg } = useApp();
  const base = appBase(cfg?.appUrl);
  const url = `${base}/share/voted/${e.id}/${opt}`;
  const text = `I voted ${letter(opt)} — ${e.options[opt]} on “${e.title.slice(0, 90)}” 🔥 My vote burned $WIF. 1 wallet = 1 vote. Cast yours:`;
  return (
    <div className="votedcard" data-testid="voted-card">
      <div className="small" style={{ fontWeight: 800, margin: '0 0 6px' }}>🎉 Vote counted — share it</div>
      <img src={`/api/og/voted/${e.id}/${opt}.svg`} alt={`I voted ${e.options[opt]}`} style={{ width: '100%', height: 'auto', border: '2px solid var(--ink)', borderRadius: 12, display: 'block' }} onError={(ev) => { (ev.target as HTMLElement).style.display = 'none'; }} />
      <div className="row" style={{ marginTop: 8 }}>
        <a className="btn sm" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Share on X</a>
        <Copy text={url} label="Copy link" />
      </div>
    </div>
  );
}

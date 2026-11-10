import { useEffect, useState } from 'react';
import type { ElectionView } from '@flatland/core';
import { Copy, letter } from './ui';
import { useApp } from '../lib/store';

export const appBase = (appUrl?: string) => (appUrl ?? location.origin).replace(/\/$/, '');
const intent = (text: string, url: string) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

/** "Share on X" composer: one prefilled, editable post ("Reply or tap to vote: A … B …") + one-tap vote links per option (/v/<id>/<opt>). */
export function ShareComposer({ e, tallies }: { e: ElectionView; tallies: number[] }) {
  const { cfg } = useApp();
  const base = appBase(cfg?.appUrl);
  const shareUrl = `${base}/share/${e.id}`;
  const total = tallies.reduce((a, b) => a + b, 0);
  const opts = e.options.slice(0, 6).map((n, i) => `${letter(i)} ${n.length > 22 ? n.slice(0, 21) + '…' : n}${total ? ` ${Math.round(((tallies[i] ?? 0) / total) * 100)}%` : ''}`).join(' · ');
  const auto = `🗳 ${e.title.length > 90 ? e.title.slice(0, 89) + '…' : e.title}\nReply or tap to vote: ${opts}\n1 wallet = 1 vote, every vote burns $WIF 🔥`;
  const [text, setText] = useState(auto);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setText(auto); }, [auto, dirty]);
  return (
    <div className="card" id="share">
      <h3>Share on X</h3>
      <textarea aria-label="Post text" rows={4} value={text} maxLength={240} onChange={(ev) => { setText(ev.target.value); setDirty(true); }} />
      <div className="row" style={{ marginTop: 8 }}>
        <a className="btn sm" href={intent(text, shareUrl)} target="_blank" rel="noreferrer">Post on X</a>
        <Copy text={shareUrl} label="Copy link" />
        {dirty ? <button className="btn ghost sm" onClick={() => setDirty(false)}>Reset text</button> : null}
      </div>
      <p className="small muted" style={{ margin: '10px 0 6px' }}>One-tap vote link per option (opens this room with the option preselected):</p>
      {e.options.map((n, i) => {
        const link = `${base}/v/${e.id}/${i}`;
        return (
          <div key={i} className="row between" style={{ marginBottom: 6, flexWrap: 'nowrap' }}>
            <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b>{letter(i)}</b> · {n}</span>
            <span className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <a className="btn ghost sm" href={intent(`I'm voting ${letter(i)} — ${n} on “${e.title.slice(0, 80)}”. Tap to vote (1 wallet = 1 vote):`, link)} target="_blank" rel="noreferrer">Post</a>
              <Copy text={link} label="Copy" />
            </span>
          </div>
        );
      })}
      <p className="small muted" style={{ marginBottom: 0 }}>Bot-friendly: replying “vote {letter(Math.min(1, e.options.length - 1))}” to the Flatland bot{cfg?.botName ? <> (<a href={`https://t.me/${cfg.botName}`} target="_blank" rel="noreferrer">@{cfg.botName}</a>)</> : null} returns a ready-to-send 1 $WIF transfer link.</p>
    </div>
  );
}

import type { ElectionView } from '@flatland/core';
import { analysisFor, useApp } from '../lib/store';
import { compact, wif } from '../lib/format';
import { OptImg, color, letter, useNow } from './ui';
import { imgUrl, useMedia } from '../lib/media';
import { until } from '../lib/format';

export function ElectionCard({ e }: { e: ElectionView }) {
  const { snap } = useApp();
  const now = useNow(1000);
  const a = snap ? analysisFor(snap, e) : null;
  const t = a?.liveTallies ?? e.tallies;
  const total = t.reduce((x, y) => x + y, 0);
  const lead = total ? t.indexOf(Math.max(...t)) : -1;
  const isBasket = e.metaURI === 'flatland:basket';
  const media = useMedia(e.metaURI);
  const pics = e.options.map((n, i) => ({ n, i, src: imgUrl(media, i) })).filter((x) => x.src).slice(0, 5);
  return (
    <a className="card" href={`#/e/${e.id}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className={`tag ${e.status}`}>{e.status}</span>
        <span className="small muted mono">{e.status === 'open' ? until(e.end, now) : `#${e.id}`}</span>
      </div>
      <h3 style={{ minHeight: 44 }}>{isBasket ? '🧺 ' : ''}{e.title}</h3>
      {pics.length ? <div className="pics">{pics.map((x) => <span key={x.i} className="picwrap" title={`${letter(x.i)} · ${x.n}`}><OptImg src={x.src} size={48} alt={x.n} /><b style={{ background: color(x.i) }}>{letter(x.i)}</b></span>)}{e.options.length > pics.length ? <span className="small muted">+{e.options.length - pics.length}</span> : null}</div> : null}
      <div style={{ display: 'flex', height: 12, border: '2px solid var(--ink)', borderRadius: 99, overflow: 'hidden', background: '#fff', margin: '10px 0' }}>
        {t.map((n, i) => (n ? <div key={i} style={{ width: `${(n / total) * 100}%`, background: color(i) }} /> : null))}
      </div>
      <div className="row between small">
        <span className="muted">{total ? <>Leading: <b>{letter(lead)} · {e.options[lead]}</b></> : 'No votes yet — be the first'}</span>
        <span className="mono"><b>{compact(total)}</b> votes · 🔥 {wif(e.burned)}</span>
      </div>
    </a>
  );
}

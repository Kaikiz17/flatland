import { flatScore } from '@flatland/core';
import { useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { Copy, Empty } from '../components/ui';
import { appBase } from '../components/ShareComposer';
import { isAddr, short, wif } from '../lib/format';

/** Public per-wallet Flat Score card: /#/score/<address>. */
export function Score({ address }: { address?: string }) {
  const { snap, cfg } = useApp();
  const w = useWallet();
  const addr = address && isAddr(address) ? address : w.address ?? undefined;
  if (!snap) return <div className="skeleton" style={{ minHeight: 240 }} />;
  if (!addr) return <Empty>Connect a wallet or open <code>#/score/0x…</code> to see a Flat Score.</Empty>;
  const f = flatScore(snap, addr);
  const url = `${appBase(cfg?.appUrl)}/share/score/${addr}`;
  const text = `My Flat Score is ${f.score}${f.rank ? ` (rank #${f.rank} of ${f.of})` : ''} — ${f.tierName} tier, ${f.votes + f.acts} votes, ${f.streak}-week streak, ${wif(f.burned, 1)} $WIF burned on Flatland. What's yours?`;
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <a href="#/leaderboard" className="small muted">← Leaderboard</a>
      <div className="card dark" style={{ marginTop: 8 }}>
        <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>Flat Score</div>
        <div className="burn" style={{ fontSize: 'clamp(3rem, 14vw, 5.5rem)' }}>{f.score}</div>
        <div className="row"><span className="tag" style={{ background: 'var(--gold)', color: 'var(--ink)' }}>{f.tierName === '—' ? 'No tier yet' : f.tierName}</span>{f.rank ? <span className="tag">rank #{f.rank} of {f.of}</span> : <span className="tag">not ranked yet</span>}</div>
        <p className="addr" style={{ marginTop: 10, marginBottom: 0 }}>{short(addr)}</p>
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="stat"><b>{f.votes + f.acts}</b><span>Votes &amp; acts</span></div>
        <div className="stat"><b>🔥 {wif(f.burned, 1)}</b><span>$WIF burned</span></div>
        <div className="stat"><b>{f.created}</b><span>Elections created</span></div>
        <div className="stat"><b>{f.streak}<small style={{ fontSize: '.5em' }}> wk</small></b><span>Streak (best {f.bestStreak})</span></div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <a className="btn" href={xHref} target="_blank" rel="noreferrer">Share on X</a>
        <Copy text={url} label="Copy link" />
      </div>
      <p className="hint">Score = 10 per vote + 5 per act + 20 per election created + 25 per streak week. Public on-chain counts, recomputable by anyone.</p>
    </div>
  );
}

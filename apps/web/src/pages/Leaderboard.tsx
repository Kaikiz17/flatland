import { useMemo, useState } from 'react';
import { tierName } from '@flatland/core';
import { useApp } from '../lib/store';
import { compactWif, short, flag, wif } from '../lib/format';
import { Empty, Stat } from '../components/ui';
import { WorldMap } from '../components/WorldMap';
import { COUNTRIES } from '@flatland/core';

export function Leaderboard() {
  const { snap } = useApp();
  const [by, setBy] = useState<'streak' | 'votes' | 'burned'>('streak');
  const rows = useMemo(() => {
    if (!snap) return [];
    return Object.entries(snap.standing)
      .map(([who, s]) => ({ who, ...s, cc: snap.voterCountry[who] }))
      .sort((a, b) => (by === 'burned' ? Number(BigInt(b.burned) - BigInt(a.burned)) : by === 'votes' ? b.votes + b.acts - (a.votes + a.acts) : b.streak - a.streak || b.bestStreak - a.bestStreak))
      .slice(0, 50);
  }, [snap, by]);
  const topElections = useMemo(() => [...(snap?.elections ?? [])].sort((a, b) => BigInt(b.burned) > BigInt(a.burned) ? 1 : -1).slice(0, 5), [snap]);
  const cc = snap ? Object.entries(snap.countries).sort((a, b) => b[1] - a[1]).slice(0, 10) : [];
  if (!snap) return <div className="skeleton" style={{ minHeight: 300 }} />;
  const t = snap.totals;
  return (
    <>
      <h2>Leaderboard &amp; stats</h2>
      <div className="grid g4">
        <Stat label="$WIF burned" value={`🔥 ${compactWif(t.wifBurned)}`} />
        <Stat label="Elections burn" value={compactWif(t.electionBurned)} />
        <Stat label="Sign burn" value={compactWif(t.gateBurned)} />
        <Stat label="Buyback burn" value={compactWif(t.buybackBurned)} sub="from basket fees" />
      </div>
      <div className="grid g2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card">
          <div className="row between"><h3 style={{ margin: 0 }}>Most consistent</h3>
            <div className="tabs" style={{ margin: 0 }}>{(['streak', 'votes', 'burned'] as const).map((k) => <button key={k} className={by === k ? 'on' : ''} onClick={() => setBy(k)}>{k}</button>)}</div></div>
          <p className="small muted">Streak = consecutive weeks with at least one vote or act. On-chain counts only — no NFT, nothing to buy.</p>
          {rows.length === 0 ? <Empty>No activity yet.</Empty> : (
            <table className="t"><thead><tr><th>#</th><th>Wallet</th><th>Tier</th><th>Streak</th><th>Votes</th><th>Burned</th></tr></thead><tbody>
              {rows.map((r, i) => (
                <tr key={r.who}><td>{i + 1}</td><td className="addr">{r.cc ? flag(r.cc) + ' ' : ''}<a href={`#/score/${r.who}`}>{short(r.who)}</a></td><td>{tierName(r.tier)}</td><td className="mono">{r.streak}{r.bestStreak > r.streak ? <span className="muted"> (best {r.bestStreak})</span> : ''}</td><td className="mono">{r.votes + r.acts}</td><td className="mono">{wif(r.burned)}</td></tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="grid">
          <div className="card"><h3>Biggest burns</h3>
            {topElections.length === 0 ? <p className="muted">—</p> : topElections.map((e) => <a key={e.id} href={`#/e/${e.id}`} className="row between" style={{ textDecoration: 'none', padding: '6px 0', borderBottom: '1px dashed var(--line)' }}><span>{e.title}</span><b className="mono">🔥 {wif(e.burned)}</b></a>)}
          </div>
          <div className="card"><h3>Where voters are</h3><WorldMap counts={snap.countries} />
            <div className="row small" style={{ marginTop: 8 }}>{cc.map(([c, n]) => <span key={c}>{flag(c)} {COUNTRIES[c]?.[0] ?? c} · {n}</span>)}</div></div>
        </div>
      </div>
    </>
  );
}

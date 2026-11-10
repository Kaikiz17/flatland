import { useMemo } from 'react';
import { useApp } from '../lib/store';
import { ElectionCard } from '../components/ElectionCard';
import { CountUp, Empty, Stat } from '../components/ui';
import { WorldMap } from '../components/WorldMap';
import { compact, compactWif } from '../lib/format';
import { formatUnits } from 'viem';

export function Home() {
  const { snap, cfg } = useApp();
  const open = useMemo(() => (snap?.elections ?? []).filter((e) => e.status === 'open').sort((a, b) => b.chainVotes.length + b.depositVotes.length - (a.chainVotes.length + a.depositVotes.length)), [snap]);
  const t = snap?.totals;
  return (
    <>
      <section className="hero">
        <div className="kicker">Open protocol · built on the World is Fair rules, open to everyone</div>
        <h1>The world is flat.<br /><em>So is every vote.</em></h1>
        <p className="lead">One wallet, one vote — and every vote <b>burns real $WIF</b>. Run an election, bind it to an on-chain outcome, or plug “send 1 $WIF to act” into any app. Nobody’s vote weighs more than yours.</p>
        <div className="row" style={{ marginTop: 18 }}>
          <a className="btn" href="#/elections">Vote now</a>
          <a className="btn ghost" href="#/create">Start an election</a>
          <a className="btn ghost" href="#/basket">The People’s Basket 🧺</a>
        </div>
      </section>
      <div className="horizon" />
      <section className="grid g4" aria-label="Live totals">
        <Stat label="$WIF burned" value={t ? <>🔥 <CountUp value={Number(formatUnits(BigInt(t.wifBurned), 18))} format={(n) => compact(n)} /></> : '—'} sub="every vote, every act, every buyback" />
        <Stat label="Votes cast" value={t ? <CountUp value={t.votes} format={(n) => Math.round(n).toLocaleString()} /> : '—'} />
        <Stat label="Elections" value={t?.elections ?? '—'} sub={`${t?.gates ?? 0} rails live`} />
        <Stat label="Wallets" value={t?.participants ?? '—'} sub={`${t?.acts ?? 0} “send 1 $WIF” acts`} />
      </section>

      <h2 style={{ marginTop: 36 }}>Live now</h2>
      {!snap ? <div className="skeleton" /> : open.length === 0 ? (
        <Empty>No open elections yet. <a href="#/create"><b>Start the first one →</b></a></Empty>
      ) : (
        <div className="grid g3">{open.slice(0, 6).map((e) => <ElectionCard key={e.id} e={e} />)}</div>
      )}
      {snap && snap.elections.length > open.length ? <p style={{ marginTop: 14 }}><a href="#/elections"><b>All elections →</b></a></p> : null}

      <h2 style={{ marginTop: 40 }}>Three things, one flat rule</h2>
      <div className="grid g3">
        <div className="card"><h3>① Elections for everyone</h3><p>Anyone creates an election: options, deadline, vote cost (≥1 $WIF), optional prize pool. 1 wallet = 1 vote. A verifiable future-block draw rewards voters. Vote with your wallet <i>or</i> just send 1 $WIF to an option’s address from any wallet app.</p><a href="#/create"><b>Create →</b></a></div>
        <div className="card"><h3>② Votes that execute</h3><p>An election can be bound to an on-chain action. Flagship: <b>the People’s Stock Token Basket</b> — a USDG vault whose holdings are chosen each week by 1-wallet-1-vote burns, not by who has the most money. Vault fees buy back &amp; burn $WIF.</p><a href="#/basket"><b>See the basket →</b></a></div>
        <div className="card"><h3>③ “Send 1 $WIF to act”</h3><p>Petitions, RSVPs, allowlists, access gates. One contract, one embeddable widget. Other apps plug in instead of building their own token economy — each act burns $WIF and builds the actor’s on-chain streak.</p><a href="#/rails"><b>Browse rails →</b></a></div>
      </div>

      <h2 style={{ marginTop: 40 }}>The flywheel</h2>
      <div className="card dark">
        <div className="row" style={{ gap: 8, fontWeight: 700, fontSize: '1.02rem' }}>
          {['People vote', '→', '1+ $WIF burned', '→', 'Supply shrinks, outcomes execute', '→', 'Basket attracts USDG', '→', 'Fees buy $WIF', '→', 'Burned again', '↺'].map((s, i) => <span key={i} style={s.length < 3 ? { color: 'var(--gold)' } : { background: '#ffffff18', padding: '5px 10px', borderRadius: 10 }}>{s}</span>)}
        </div>
        <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>Streaks and reputation (on-chain counts, no NFT) bring people back every week; the gasless first vote brings newcomers in without any ETH.</p>
      </div>

      <h2 style={{ marginTop: 40 }}>Voters around the world</h2>
      {snap ? <WorldMap counts={snap.countries} /> : <div className="skeleton" />}
      <p className="small muted" style={{ marginTop: 8 }}>Opt-in, country-level only — a wallet that chooses to share a country appears as one dot among its neighbours. {cfg ? '' : ''}</p>
      {t ? <p className="small muted">Total burned across Flatland: <b>{compactWif(t.wifBurned)} $WIF</b>.</p> : null}
    </>
  );
}

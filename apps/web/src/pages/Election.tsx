import { useEffect, useMemo, useState } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import { flatlandAbi, tierName, voteLinks, type ElectionView } from '@flatland/core';
import { analysisFor, feedFor, getState, useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { useRoute } from '../lib/route';
import { challenge, claimPrize, finalize, fundPrize, seedDraw, vote, setCountry } from '../lib/actions';
import { ActionButton, CountUp, Copy, OptImg, TxStatus, color, letter, useNow, useTx, Empty } from '../components/ui';
import { imgUrl, useMedia } from '../lib/media';
import { DepositPanel } from '../components/DepositPanel';
import { FairnessCard } from '../components/Fairness';
import { WorldMap } from '../components/WorldMap';
import { ago, compact, short, until, wif, ZERO } from '../lib/format';

export function ElectionPage({ id }: { id: number }) {
  const { snap, cfg } = useApp();
  const e = snap?.elections.find((x) => x.id === id);
  if (!snap) return <div className="skeleton" style={{ minHeight: 300 }} />;
  if (!e) return <Empty>Election #{id} not found. <a href="#/elections">Back to all elections</a></Empty>;
  return <Room e={e} />;
}

function Room({ e }: { e: ElectionView }) {
  const { snap, cfg, fresh, mode, updatedAt } = useApp();
  const w = useWallet();
  const now = useNow(1000);
  const a = analysisFor(snap!, e);
  const { query } = useRoute();
  const pre = Number(query.get('vote'));
  const [sel, setSel] = useState<number | null>(Number.isInteger(pre) && query.get('vote') !== null && pre >= 0 && pre < e.options.length ? pre : null);
  const preParam = query.get('vote');
  useEffect(() => { // a shared ?vote=N link should preselect even when navigating within the app
    const n = Number(preParam);
    if (preParam !== null && Number.isInteger(n) && n >= 0 && n < e.options.length) setSel(n);
  }, [preParam, e.options.length]);
  const [tab, setTab] = useState<'wallet' | 'send'>('wallet');
  const tx = useTx();
  const open = e.status === 'open';
  const cost = BigInt(e.voteCost);
  const total = a.liveTallies.reduce((x, y) => x + y, 0);
  const myVote = useMemo(() => {
    if (!w.address) return null;
    const lc = w.address.toLowerCase();
    const c = e.chainVotes.find((v) => v.voter.toLowerCase() === lc);
    if (c) return { option: c.option, path: 'wallet' as const };
    const d = e.depositVotes.find((v) => v.voter.toLowerCase() === lc);
    return d ? { option: d.option, path: 'deposit' as const } : null;
  }, [w.address, e]);
  const collapsedMe = w.address ? a.collapsedMap[w.address.toLowerCase()] : undefined;
  const feed = useMemo(() => feedFor(snap!, e, fresh), [snap, e, fresh]);
  const isBasket = e.metaURI === 'flatland:basket';
  const winnerIdx = e.statusRaw === 2 ? e.winner : -1;
  const media = useMedia(e.metaURI);

  // map data: only voters who opted in to share a country
  const { counts, pulses } = useMemo(() => {
    const c: Record<string, number> = {};
    const p: string[] = [];
    const voters = [...e.chainVotes.map((v) => ({ v: v.voter, k: `${e.id}:c:${v.tx}:${v.logIndex}` })), ...e.depositVotes.map((v) => ({ v: v.voter, k: `${e.id}:d:${v.tx}:${v.logIndex}` }))];
    for (const { v, k } of voters) {
      const cc = snap!.voterCountry[v.toLowerCase()];
      if (!cc) continue;
      c[cc] = (c[cc] ?? 0) + 1;
      if (fresh[k]) p.push(cc);
    }
    return { counts: c, pulses: p };
  }, [e, snap, fresh]);

  const shareUrl = (cfg?.appUrl ? `${cfg.appUrl.replace(/\/$/, '')}/share/${e.id}` : location.href.split('#')[0] + `#/e/${e.id}`);
  const top = a.liveTallies.indexOf(Math.max(...a.liveTallies));
  const shareText = total ? `“${e.title}” — ${e.options[top]} is leading. 1 wallet = 1 vote, every vote burns $WIF. Cast yours:` : `“${e.title}” — 1 wallet = 1 vote, every vote burns $WIF. Be first:`;
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

  return (
    <div>
      <a href="#/elections" className="small muted">← All elections</a>
      <div className="row between" style={{ margin: '8px 0 4px' }}>
        <div className="row"><span className={`tag ${e.status}`}>{e.status}</span>{isBasket ? <span className="tag">basket epoch</span> : null}{open ? <span className="live"><i />LIVE ROOM</span> : null}</div>
        <span className="mono small">{open ? until(e.end, now) : e.status === 'upcoming' ? `starts ${ago(e.start, now)}` : `#${e.id}`}</span>
      </div>
      <h1 style={{ fontSize: 'clamp(1.7rem, 5vw, 2.8rem)' }}>{e.title}</h1>
      <p className="small muted">by <span className="mono">{short(e.creator)}</span> · {wif(e.voteCost, 2)} $WIF per vote · {e.tallier === ZERO ? 'fully on-chain (no tallier)' : `attested by ${short(e.tallier)}`}{e.executor !== ZERO ? <> · <b>executes on-chain on finalize</b></> : null}{media?.details && /^https?:\/\//.test(media.details) ? <> · <a href={media.details} target="_blank" rel="noreferrer noopener">Details ↗</a></> : null}</p>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', alignItems: 'start' }} data-stack>
        <div className="grid">
          <div className="card dark">
            <div className="row between"><span className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>$WIF burned in this election</span><span className="small muted mono">{mode === 'indexer' ? 'live' : 'polling'} · updated {ago(updatedAt / 1000, now)}</span></div>
            <div className="burn"><span className="flame">🔥</span> <CountUp value={Number(formatUnits(BigInt(e.burned), 18))} format={(n) => Math.round(n).toLocaleString()} /></div>
            <div className="small muted">{compact(total)} counted votes from {a.rawVoters} wallets. Includes deposit boxes already swept &amp; burned.</div>
          </div>

          <div className="card">
            <h3>{open ? 'Pick an option' : e.status === 'upcoming' ? 'Not started' : 'Results'}</h3>
            {e.options.map((name, i) => {
              const n = a.liveTallies[i] ?? 0;
              const pct = total ? (n / total) * 100 : 0;
              return (
                <div key={i} role={open ? 'button' : undefined} tabIndex={open ? 0 : -1} className={'opt' + (winnerIdx === i ? ' win' : '') + (myVote?.option === i ? ' mine' : '')} style={{ ['--c' as string]: color(i), cursor: open ? 'pointer' : 'default' }}
                  onClick={() => open && setSel(i)} onKeyDown={(ev) => open && (ev.key === 'Enter' || ev.key === ' ') && setSel(i)} aria-pressed={sel === i}>
                  <div className="bar" style={{ width: `${pct}%` }} />
                  <div className="in">
                    <OptImg src={imgUrl(media, i)} size={64} alt={name} />
                    <div className="letter">{letter(i)}</div>
                    <div className="name">{name}{winnerIdx === i ? ' 🏆' : ''}{myVote?.option === i ? <span className="tag" style={{ marginLeft: 8 }}>you</span> : null}{sel === i && open ? <span className="tag" style={{ marginLeft: 8, background: 'var(--gold)' }}>selected</span> : null}</div>
                    <div className="n">{n} <span className="muted small">({pct.toFixed(0)}%)</span></div>
                  </div>
                </div>
              );
            })}
            {myVote ? <p className="ok small" style={{ margin: '10px 0 0' }}>✓ You voted {letter(myVote.option)} ({myVote.path === 'wallet' ? 'wallet' : 'deposit'}). One wallet, one vote.{collapsedMe ? ' ⚠ This wallet was grouped with another by funding source — see the fairness card.' : ''}</p> : null}
            {open && !myVote ? (
              <>
                <hr />
                <div className="tabs">
                  <button className={tab === 'wallet' ? 'on' : ''} onClick={() => setTab('wallet')}>Connect &amp; vote</button>
                  <button className={tab === 'send' ? 'on' : ''} onClick={() => setTab('send')}>Just send {wif(e.voteCost, 0)} $WIF</button>
                </div>
                {sel === null ? <p className="muted">👆 Tap an option above first.</p> : tab === 'wallet' ? (
                  <>
                    <ActionButton className="btn block" tx={tx} onRun={(s) => vote(e.id, sel, cost, s)}>Burn {wif(e.voteCost, 0)} $WIF · vote {letter(sel)} — {e.options[sel]}</ActionButton>
                    <TxStatus tx={tx} />
                    <p className="hint">Your {wif(e.voteCost, 0)} $WIF is permanently burned (supply shrinks). One vote per wallet. We approve the exact amount only.</p>
                  </>
                ) : <DepositPanel e={e} option={sel} canVote={!!w.address} />}
              </>
            ) : null}
            {!open && e.status === 'ended' && !e.depositsSubmitted && e.tallier !== ZERO ? <p className="small muted">Voting closed. Waiting for the deposit-path attestation (or its grace period) before finalizing.</p> : null}
          </div>

          <Lifecycle e={e} />
          {e.winners > 0 || BigInt(e.prizePool) > 0n ? <PrizePanel e={e} /> : null}
          {e.tallier !== ZERO && e.status !== 'finalized' ? <ChallengePanel e={e} /> : null}
          {e.challenges.length ? (
            <div className="card"><h3>Challenges</h3>
              {e.challenges.map((c) => <div key={c.cid} className="small" style={{ margin: '6px 0' }}>#{c.cid} · {short(c.challenger)} accused <span className="mono">{short(c.accused)}</span> — {c.resolved ? (c.upheld ? <b className="ok">upheld (collapsed)</b> : <b>rejected</b>) : <b style={{ color: 'var(--accent)' }}>open</b>}{c.evidence ? <span className="muted"> · “{c.evidence}”</span> : null}</div>)}
            </div>
          ) : null}
        </div>

        <div className="grid">
          <div className="card">
            <div className="row between"><h3 style={{ margin: 0 }}>Live feed</h3>{open ? <span className="live"><i />LIVE</span> : null}</div>
            <div className="feed">
              {feed.length === 0 ? <p className="muted">Waiting for the first vote…</p> : (
                <ul>
                  {feed.slice(0, 40).map((f) => (
                    <li key={f.key} className={f.isNew ? 'new' : ''}>
                      <span className="chip" style={{ background: color(f.option) }}>{letter(f.option)}</span>
                      <span className="mono">{short(f.voter)}</span>
                      <span className="muted small" style={{ marginLeft: 'auto' }}>{f.path === 'deposit' ? 'sent 1 WIF · ' : ''}{ago(f.ts, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="card"><h3>Voter map</h3><WorldMap counts={counts} pulses={pulses} /><CountryOptIn /></div>
          <FairnessCard e={e} a={a} />
          <div className="card">
            <h3>Share</h3>
            <div className="row"><a className="btn sm" href={xHref} target="_blank" rel="noreferrer">Post on X</a><Copy text={shareUrl} label="Copy link" /></div>
            <p className="small muted" style={{ marginBottom: 0 }}>Bot-friendly: replying “vote {letter(Math.min(1, e.options.length - 1))}” to the Flatland bot returns a ready-to-send 1 $WIF transfer link.</p>
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 860px) { [data-stack] { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}

function CountryOptIn() {
  const w = useWallet();
  const { snap } = useApp();
  const tx = useTx();
  const [cc, setCc] = useState('');
  const mine = w.address ? snap?.voterCountry[w.address.toLowerCase()] : undefined;
  return (
    <details style={{ marginTop: 10 }}>
      <summary className="small"><b>Show my country on the map</b> (optional)</summary>
      <p className="hint">Public on-chain, country level only, no tracking. You can remove it any time.{mine ? ` Currently shared: ${mine}.` : ''}</p>
      <div className="row"><input style={{ width: 90 }} maxLength={2} placeholder="NG" value={cc} onChange={(e) => setCc(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} aria-label="Two-letter country code" />
        <ActionButton className="btn sm" tx={tx} disabled={cc.length !== 2} onRun={(s) => setCountry(cc, s)}>Share</ActionButton>
        {mine ? <ActionButton className="btn ghost sm" tx={tx} onRun={(s) => setCountry('', s)}>Remove</ActionButton> : null}
      </div>
      <TxStatus tx={tx} />
    </details>
  );
}

/** Permissionless lifecycle buttons: the indexer does these automatically, but anyone can if it is offline. */
function Lifecycle({ e }: { e: ElectionView }) {
  const { client, dep } = getState();
  const [can, setCan] = useState(false);
  const tx = useTx();
  const now = useNow(5000);
  useEffect(() => {
    if (!client || !dep || e.statusRaw !== 1 || now < e.end) { setCan(false); return; }
    client.readContract({ address: dep.flatland, abi: flatlandAbi, functionName: 'canFinalize', args: [BigInt(e.id)] }).then((v) => setCan(!!v)).catch(() => setCan(false));
  }, [client, dep, e.id, e.end, e.statusRaw, now]);
  if (!can && !(e.statusRaw === 2 && e.drawBlock > 0 && /^0x0*$/.test(e.seed))) return null;
  return (
    <div className="card flat">
      <h3>Anyone can keep this election moving</h3>
      <div className="row">
        {can ? <ActionButton className="btn sm" tx={tx} onRun={(s) => finalize(e.id, s)}>Finalize</ActionButton> : null}
        {e.statusRaw === 2 && e.drawBlock > 0 && /^0x0*$/.test(e.seed) ? <ActionButton className="btn sm" tx={tx} onRun={(s) => seedDraw(e.id, s)}>Seed the draw</ActionButton> : null}
      </div>
      <TxStatus tx={tx} />
      <p className="hint">Finalize and the draw are permissionless — the indexer runs them automatically when online.</p>
    </div>
  );
}

function ChallengePanel({ e }: { e: ElectionView }) {
  const tx = useTx();
  const [who, setWho] = useState('');
  const [ev, setEv] = useState('');
  const ok = /^0x[0-9a-fA-F]{40}$/.test(who);
  return (
    <details className="card flat">
      <summary><b>Challenge a wallet</b> <span className="small muted">— suspect a fake or duplicate voter?</span></summary>
      <p className="small">Burn $WIF to formally accuse a wallet of being a duplicate identity. The tallier must answer on-chain; if upheld, the wallet is collapsed into its group. Challenges cost burn, so they can’t be spammed.</p>
      <div className="field"><label>Accused wallet</label><input value={who} onChange={(x) => setWho(x.target.value.trim())} placeholder="0x…" /></div>
      <div className="field"><label>Evidence (short)</label><input value={ev} maxLength={140} onChange={(x) => setEv(x.target.value)} placeholder="same funder as 0x… / same tx pattern" /></div>
      <ActionButton className="btn sm" tx={tx} disabled={!ok} onRun={(s) => challenge(e.id, who as Address, ev, 10n * 10n ** 18n, s)}>Burn 10 $WIF &amp; challenge</ActionButton>
      <TxStatus tx={tx} />
    </details>
  );
}

function PrizePanel({ e }: { e: ElectionView }) {
  const { client, dep, cfg } = getState();
  const tx = useTx();
  const [rows, setRows] = useState<{ slot: number; index: number; voter: Address; option: number; proof: Hex[]; claimed: boolean }[] | null>(null);
  const [amt, setAmt] = useState('10');
  const seeded = e.seed && !/^0x0*$/.test(e.seed);
  useEffect(() => {
    if (!client || !dep || !seeded) { setRows(null); return; }
    let dead = false;
    (async () => {
      const hub = { address: dep.flatland, abi: flatlandAbi } as const;
      const n = Number(await client.readContract({ ...hub, functionName: 'voterCount', args: [BigInt(e.id)] }));
      let audit: any = null;
      const out: NonNullable<typeof rows> = [];
      for (let slot = 0; slot < e.winners; slot++) {
        const index = Number(await client.readContract({ ...hub, functionName: 'winnerIndex', args: [BigInt(e.id), BigInt(slot)] }));
        const claimed = (await client.readContract({ ...hub, functionName: 'slotClaimed', args: [BigInt(e.id), BigInt(slot)] })) as boolean;
        if (index < n) {
          const voter = (await client.readContract({ ...hub, functionName: 'voterAt', args: [BigInt(e.id), BigInt(index)] })) as Address;
          const o = e.chainVotes.find((v) => v.voter.toLowerCase() === voter.toLowerCase());
          out.push({ slot, index, voter, option: o?.option ?? 0, proof: [], claimed });
        } else {
          if (!audit && (cfg?.auditUrl ?? cfg?.indexerUrl)) audit = await fetch(`${(cfg?.auditUrl ?? cfg?.indexerUrl)!.replace(/\/$/, '')}/api/elections/${e.id}/audit`).then((r) => r.json()).catch(() => null);
          const ent = audit?.depositEntries?.find((x: any) => x.index === index);
          out.push({ slot, index, voter: (ent?.voter ?? ZERO) as Address, option: ent?.option ?? 0, proof: ent?.proof ?? [], claimed });
        }
      }
      if (!dead) setRows(out);
    })().catch(() => !dead && setRows([]));
    return () => { dead = true; };
  }, [client, dep, e.id, e.winners, seeded, e.chainVotes, cfg]);
  const share = e.winners ? BigInt(e.prizePool) / BigInt(e.winners) : 0n;
  return (
    <div className="card">
      <div className="row between"><h3 style={{ margin: 0 }}>🎁 Voter prize draw</h3><span className="mono"><b>{wif(e.prizePool)}</b> $WIF pool</span></div>
      <p className="small muted">{e.winners} slot(s) drawn from <b>everyone who voted</b> using the hash of a block that did not exist when voting closed — nobody (creator included) can steer it, and anyone can re-verify.</p>
      {e.statusRaw !== 2 ? <p className="small">The draw happens after the election is finalized.</p> : !seeded ? <p className="small">Finalized — waiting for the draw block. Seeding is permissionless.</p> : rows === null ? <div className="skeleton" style={{ minHeight: 40 }} /> : (
        <table className="t"><thead><tr><th>Slot</th><th>Winner</th><th>Prize</th><th /></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.slot}><td>#{r.slot + 1}</td><td className="addr">{r.voter === ZERO ? 'see audit export' : short(r.voter)}</td><td className="mono">{wif(share, 2)}</td>
              <td>{r.claimed ? <span className="ok small">paid ✓</span> : r.voter !== ZERO ? <ActionButton className="btn sm" tx={tx} onRun={(s) => claimPrize(e.id, r.slot, r.index, r.voter, r.option, r.proof, s)}>Send prize</ActionButton> : null}</td></tr>
          ))}
        </tbody></table>
      )}
      <TxStatus tx={tx} />
      {e.statusRaw === 1 ? (
        <details style={{ marginTop: 10 }}><summary className="small"><b>Add to the prize pool</b></summary>
          <div className="row" style={{ marginTop: 8 }}><input style={{ width: 120 }} value={amt} onChange={(x) => setAmt(x.target.value.replace(/[^0-9.]/g, ''))} aria-label="Amount of WIF" />
            <ActionButton className="btn sm" tx={tx} disabled={!amt || Number(amt) <= 0} onRun={(s) => fundPrize(e.id, BigInt(Math.round(Number(amt) * 1e6)) * 10n ** 12n, s)}>Fund with $WIF</ActionButton></div></details>
      ) : null}
    </div>
  );
}
export { tierName, voteLinks };

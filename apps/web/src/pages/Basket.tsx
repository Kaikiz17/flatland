import { useEffect, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { basketVaultAbi, erc20Abi } from '@flatland/core';
import { getState, useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { basketBuyback, basketCall, basketDeposit, basketNominate, basketRedeem } from '../lib/actions';
import { ActionButton, TxStatus, color, useNow, useTx, Stat, Empty } from '../components/ui';
import { compactWif, usdg, until } from '../lib/format';

export function Basket() {
  const { snap, cfg } = useApp();
  const b = snap?.basket;
  const now = useNow(1000);
  const tx = useTx();
  if (!snap) return <div className="skeleton" style={{ minHeight: 300 }} />;
  if (!b) return <Empty>The basket isn’t live on this network yet.</Empty>;
  const listed = b.assets.filter((a) => a.listed);
  const alloc = listed.filter((a) => a.targetBps > 0);
  const last = b.epochs[b.epochs.length - 1];
  const lastEl = last ? snap.elections.find((e) => e.id === last.electionId) : undefined;
  const nav = b.navUsdg ? BigInt(b.navUsdg) : null;
  const supply = BigInt(b.totalSupply);
  const pps = nav !== null ? Number((nav + 1n) * 10n ** 18n / (supply + 10n ** 12n)) / 1e6 : null;
  const nextOpen = lastEl ? last.start + 7 * 86400 : 0;
  const canOpen = !last || now >= nextOpen;
  const unlisted = b.assets.filter((a) => !a.listed);

  return (
    <>
      <div className="hero" style={{ paddingTop: 6 }}>
        <div className="kicker">Executable outcome · flagship</div>
        <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3.4rem)' }}>The People’s <em style={{ fontStyle: 'normal', background: 'var(--teal)', color: '#fff', padding: '0 .15em', borderRadius: 8, boxShadow: '4px 4px 0 var(--ink)' }}>Stock Token</em> Basket 🧺</h1>
        <p className="lead">A USDG vault that holds Stock Tokens. <b>What it holds is decided by 1-wallet-1-vote $WIF burns each week — not by who has the most money.</b> A small vault fee buys back and burns $WIF.</p>
      </div>
      <div className="grid g4">
        <Stat label="Basket NAV (USDG)" value={nav !== null ? `$${usdg(nav, 0)}` : 'oracle paused'} sub={nav === null ? 'market closed or feed stale' : undefined} />
        <Stat label="Share price" value={pps !== null ? `$${pps.toFixed(4)}` : '—'} sub="PEOPLE token" />
        <Stat label="$WIF burned by fees" value={`🔥 ${compactWif(b.buybackWifBurned)}`} sub={`$${usdg(b.pendingFees)} waiting to burn`} />
        <Stat label="Epoch" value={`#${b.round || '—'}`} sub={lastEl ? (lastEl.status === 'open' ? until(lastEl.end, now) : lastEl.status) : 'not started'} />
      </div>

      <div className="grid g2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card">
          <h3>What the people chose</h3>
          {alloc.length === 0 ? <p className="muted">No weights set yet — the first vote decides. {last ? <a href={`#/e/${last.electionId}`}><b>Vote in epoch #{last.epoch} →</b></a> : null}</p> : (
            <>
              <div className="alloc">{alloc.map((a, i) => <div key={a.idx} style={{ width: `${a.targetBps / 100}%`, background: color(i) }} title={`${a.symbol} ${(a.targetBps / 100).toFixed(1)}%`}>{a.targetBps >= 600 ? a.symbol : ''}</div>)}</div>
              <table className="t" style={{ marginTop: 10 }}><thead><tr><th>Asset</th><th>Target</th></tr></thead><tbody>
                {alloc.map((a, i) => <tr key={a.idx}><td><span className="chip" style={{ background: color(i), display: 'inline-grid', marginRight: 8 }}> </span><b>{a.symbol}</b></td><td className="mono">{(a.targetBps / 100).toFixed(1)}%</td></tr>)}
              </tbody></table>
            </>
          )}
          <p className="hint">Top 5 vote-getters, each capped at 40%, 1% cash buffer. Tokens are bought on Uniswap with Chainlink price bounds.</p>
        </div>
        <div className="card">
          <h3>This week’s vote</h3>
          {lastEl ? (
            <>
              <p>Epoch <b>#{last.epoch}</b> — <span className={`tag ${lastEl.status}`}>{lastEl.status}</span></p>
              <a className="btn block" href={`#/e/${lastEl.id}`}>{lastEl.status === 'open' ? 'Vote on the weights →' : 'View result →'}</a>
            </>
          ) : <p className="muted">No epoch yet.</p>}
          <hr />
          <div className="row">
            <ActionButton className="btn ghost sm" tx={tx} disabled={!canOpen} onRun={(s) => basketCall('openEpoch', s)}>{canOpen ? 'Open next epoch' : `Next epoch ${until(nextOpen, now).replace(' left', '')}`}</ActionButton>
            <ActionButton className="btn ghost sm" tx={tx} onRun={(s) => basketCall('rebalance', s)}>Rebalance to the people’s weights</ActionButton>
            <ActionButton className="btn ghost sm" tx={tx} disabled={BigInt(b.pendingFees) === 0n} onRun={(s) => basketBuyback(s)}>🔥 Burn fees into $WIF</ActionButton>
          </div>
          <TxStatus tx={tx} />
          <p className="hint">All three are permissionless — anyone can poke the vault; it only ever follows the vote.</p>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 18, alignItems: 'start' }}>
        <Position pps={pps} />
        <Nominate unlisted={unlisted} threshold={b.promoteThreshold} round={b.round} />
      </div>
      <div className="banner small" style={{ marginTop: 18 }}>
        <b>Read this:</b> experimental software, unaudited. Stock Tokens are tokenised securities exposure and may be unavailable or restricted in your jurisdiction; you are responsible for your own compliance. Nothing here is investment advice. If an oracle is paused (markets closed) deposits and fee-burns pause, but <b>redeem-in-kind always works</b>. {cfg ? '' : ''}
      </div>
    </>
  );
}

function Position({ pps }: { pps: number | null }) {
  const w = useWallet();
  const { client, dep, snap } = useApp();
  const [mode, setMode] = useState<'in' | 'out'>('in');
  const [amt, setAmt] = useState('');
  const [inKind, setInKind] = useState(false);
  const [bal, setBal] = useState<{ usdg: bigint; shares: bigint } | null>(null);
  const [prev, setPrev] = useState<bigint | null>(null);
  const tx = useTx();
  useEffect(() => {
    if (!w.address || !client || !dep) { setBal(null); return; }
    let dead = false;
    Promise.all([
      client.readContract({ address: dep.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [w.address] }),
      client.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'balanceOf', args: [w.address] }),
    ]).then(([u, s]) => !dead && setBal({ usdg: u as bigint, shares: s as bigint })).catch(() => {});
    return () => { dead = true; };
  }, [w.address, client, dep, snap?.generatedAt]);
  let raw = 0n;
  try { raw = mode === 'in' ? parseUnits(amt || '0', 6) : parseUnits(amt || '0', 18); } catch {}
  useEffect(() => {
    setPrev(null);
    if (mode !== 'in' || raw === 0n || !client || !dep) return;
    client.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'previewDeposit', args: [raw] }).then((r: any) => setPrev(r[0])).catch(() => setPrev(null));
  }, [raw, mode, client, dep]);
  const over = bal ? (mode === 'in' ? raw > bal.usdg : raw > bal.shares) : false;
  return (
    <div className="card">
      <div className="tabs"><button className={mode === 'in' ? 'on' : ''} onClick={() => { setMode('in'); setAmt(''); }}>Deposit USDG</button><button className={mode === 'out' ? 'on' : ''} onClick={() => { setMode('out'); setAmt(''); }}>Redeem</button></div>
      <div className="field"><label>{mode === 'in' ? 'USDG to deposit' : 'PEOPLE shares to redeem'}</label>
        <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.0" />
        <div className="hint">{bal ? (mode === 'in' ? <>Balance: <b>{usdg(bal.usdg)}</b> USDG · <a href="#" onClick={(e) => { e.preventDefault(); setAmt(formatUnits(bal.usdg, 6)); }}>max</a></> : <>You hold <b>{Number(formatUnits(bal.shares, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}</b> shares{pps ? ` ≈ $${(Number(formatUnits(bal.shares, 18)) * pps).toFixed(2)}` : ''} · <a href="#" onClick={(e) => { e.preventDefault(); setAmt(formatUnits(bal.shares, 18)); }}>max</a></>) : 'Connect a wallet to see balances.'}</div></div>
      {mode === 'in' ? <p className="small muted">{prev !== null ? <>You receive ≈ <b>{Number(formatUnits(prev, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}</b> shares after the 0.30% fee (which buys back &amp; burns $WIF).</> : 'A 0.30% deposit fee funds the $WIF buyback & burn.'}</p> : (
        <label className="row small" style={{ fontWeight: 600 }}><input type="checkbox" style={{ width: 18 }} checked={inKind} onChange={(e) => setInKind(e.target.checked)} /> Redeem in kind (get the Stock Tokens themselves — works even when oracles are paused)</label>
      )}
      <ActionButton className="btn block" tx={tx} disabled={raw === 0n || over} onRun={(s) => (mode === 'in' ? basketDeposit(raw, s) : basketRedeem(raw, inKind, s))}>{over ? 'Amount exceeds balance' : mode === 'in' ? 'Deposit' : 'Redeem'}</ActionButton>
      <TxStatus tx={tx} />
    </div>
  );
}

function Nominate({ unlisted, threshold, round }: { unlisted: { idx: number; symbol: string; backers: number }[]; threshold: number; round: number }) {
  const tx = useTx();
  return (
    <div className="card">
      <h3>Nominate a Stock Token</h3>
      <p className="small muted">Burn 1 $WIF to back a token that isn’t on the ballot yet. One backing per wallet per round, so it’s decided by headcount, not capital. <b>{threshold} distinct backers</b> promote it to next epoch’s vote.</p>
      {unlisted.length === 0 ? <p className="muted">Every registered token is already on the ballot.</p> : unlisted.map((a) => (
        <div key={a.idx} className="row between" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
          <span><b>{a.symbol}</b> <span className="muted small mono">{a.backers}/{threshold} backers</span></span>
          <ActionButton className="btn sm" tx={tx} onRun={(s) => basketNominate(a.idx, 10n ** 18n, s)}>Back · 1 $WIF</ActionButton>
        </div>
      ))}
      <TxStatus tx={tx} />
      <p className="hint">Round {round || 0}.</p>
    </div>
  );
}
export { getState };

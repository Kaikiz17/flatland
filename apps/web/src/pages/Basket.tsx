import { useEffect, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { basketVaultAbi, erc20Abi } from '@flatland/core';
import { getState, useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { basketBuyback, basketCall, basketDeposit, basketNominate, basketRedeem } from '../lib/actions';
import { ActionButton, TxStatus, color, useNow, useTx, Stat, Empty } from '../components/ui';
import { compactWif, usdg, until } from '../lib/format';
import { Steps } from '../components/Steps';
import { BasketShowcase } from '../components/BasketShowcase';

const UNCAPPED = (1n << 255n);
function CapBanner() {
  const { snap } = useApp();
  const b = snap?.basket;
  if (!b?.walletCap) return <div className="banner small" role="note"><b>Beta, unaudited.</b> Deposits are capped while the contracts are unaudited.</div>;
  const wc = BigInt(b.walletCap), tc = BigInt(b.tvlCap);
  const nav = b.navUsdg ? BigInt(b.navUsdg) : 0n;
  const lifted = wc >= UNCAPPED && tc >= UNCAPPED;
  const pct = tc > 0n && tc < UNCAPPED ? Math.min(100, Number(nav * 100n / tc)) : 0;
  return (
    <div className="banner" role="note" style={{ marginTop: 6 }}>
      {lifted ? <><b>Beta, unaudited.</b> Deposit caps have been lifted by governance. Only deposit what you can afford to lose.</> : (
        <>
          <b>Beta: max ${usdg(wc, 0)} per wallet, unaudited.</b> The basket also holds at most ${usdg(tc, 0)} in total while we launch. Only deposit what you can afford to lose; you can always exit.
          <div className="row small" style={{ marginTop: 8, gap: 10 }}>
            <div style={{ flex: 1, height: 10, border: '2px solid var(--ink)', borderRadius: 8, background: '#fff', overflow: 'hidden' }} aria-label={`Basket ${pct}% full`}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} /></div>
            <span className="mono">${usdg(nav, 0)} / ${usdg(tc, 0)} filled</span>
          </div>
        </>
      )}
    </div>
  );
}

export function Basket() {
  const { snap, cfg } = useApp();
  const b = snap?.basket;
  const now = useNow(1000);
  const tx = useTx();
  if (!snap) return <div className="skeleton" style={{ minHeight: 300 }} />;
  if (!b) return <Empty>The Community Stock Pot isn’t live on this network yet.</Empty>;
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
        <div className="kicker">People’s Basket · the community stock pot</div>
        <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3.4rem)' }}>The People’s Basket <em style={{ fontStyle: 'normal', background: 'var(--teal)', color: '#fff', padding: '0 .15em', borderRadius: 8, boxShadow: '4px 4px 0 var(--ink)' }}>Community Stock Pot</em> 🧺</h1>
        <p className="lead"><b>Put in dollars. $WIF holders vote which stock it buys. Withdraw your share anytime.</b> One wallet = one vote, so a small holder counts as much as a whale. No fund manager: the contract buys what the internet picked.</p>
        <Steps items={[['Put in dollars', 'Deposit USDG and own a share of the pot.'], ['Holders vote', 'Burn 1 $WIF to pick which stocks it buys.'], ['Pot buys, you withdraw', 'The contract buys the winners. Take your share out anytime.']]} />
      </div>
      <BasketShowcase />
      <CapBanner />
      <div className="grid g4">
        <Stat label="Pot value (USD)" value={nav !== null ? `$${usdg(nav, 0)}` : 'oracle paused'} sub={nav === null ? 'market closed or feed stale' : undefined} />
        <Stat label="Share price" value={pps !== null ? `$${pps.toFixed(4)}` : '—'} sub="per share" />
        <Stat label="$WIF burned by pot fees" value={`🔥 ${compactWif(b.buybackWifBurned)}`} sub={`$${usdg(b.pendingFees)} waiting to burn`} />
        <Stat label="This week’s vote" value={b.round ? `#${b.round}` : '—'} sub={lastEl ? (lastEl.status === 'open' ? until(lastEl.end, now) : lastEl.status) : 'not started'} />
      </div>

      <div className="grid g2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card">
          <h3>What the pot buys (chosen by voters)</h3>
          {alloc.length === 0 ? <p className="muted">Nothing chosen yet — the first vote decides. {last ? <a href={`#/e/${last.electionId}`}><b>Vote now →</b></a> : null}</p> : (
            <>
              <div className="alloc">{alloc.map((a, i) => <div key={a.idx} style={{ width: `${a.targetBps / 100}%`, background: color(i) }} title={`${a.symbol} ${(a.targetBps / 100).toFixed(1)}%`}>{a.targetBps >= 600 ? a.symbol : ''}</div>)}</div>
              <table className="t" style={{ marginTop: 10 }}><thead><tr><th>Asset</th><th>Target</th></tr></thead><tbody>
                {alloc.map((a, i) => <tr key={a.idx}><td><span className="chip" style={{ background: color(i), display: 'inline-grid', marginRight: 8 }}> </span><b>{a.symbol}</b></td><td className="mono">{(a.targetBps / 100).toFixed(1)}%</td></tr>)}
              </tbody></table>
            </>
          )}
          <p className="hint">The top 5 stocks get money, none more than 40%, and 1% stays in cash. Bought on Uniswap with price checks.</p>
        </div>
        <div className="card">
          <h3>This week’s vote</h3>
          {lastEl ? (
            <>
              <p>Week <b>#{last.epoch}</b> — <span className={`tag ${lastEl.status}`}>{lastEl.status}</span></p>
              <a className="btn block" href={`#/e/${lastEl.id}`}>{lastEl.status === 'open' ? 'Vote on which stocks →' : 'View result →'}</a>
            </>
          ) : <p className="muted">No vote yet. <a href="#/create?template=basket"><b>Start the first one →</b></a></p>}
          <hr />
          <div className="row">
            <ActionButton className="btn ghost sm" tx={tx} disabled={!canOpen} onRun={(s) => basketCall('openEpoch', s)}>{canOpen ? 'Start next weekly vote' : `Next vote can start in ${until(nextOpen, now).replace(' left', '')}`}</ActionButton>
            <ActionButton className="btn ghost sm" tx={tx} onRun={(s) => basketCall('rebalance', s)}>Buy what the people chose</ActionButton>
            <ActionButton className="btn ghost sm" tx={tx} disabled={BigInt(b.pendingFees) === 0n} onRun={(s) => basketBuyback(s)}>🔥 Use pot fees to burn $WIF</ActionButton>
          </div>
          <TxStatus tx={tx} />
          <p className="hint">All three are permissionless — anyone can press them; the pot only ever follows the vote.</p>
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
  const [room, setRoom] = useState<bigint | null>(null); // gross USDG this wallet may still deposit under the beta caps
  const tx = useTx();
  useEffect(() => {
    if (!w.address || !client || !dep) { setBal(null); return; }
    let dead = false;
    Promise.all([
      client.readContract({ address: dep.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [w.address] }),
      client.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'balanceOf', args: [w.address] }),
    ]).then(([u, s]) => !dead && setBal({ usdg: u as bigint, shares: s as bigint })).catch(() => {});
    client.readContract({ address: dep.basket, abi: basketVaultAbi, functionName: 'maxDeposit', args: [w.address] }).then((r) => !dead && setRoom(r as bigint)).catch(() => {});
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
  const capped = mode === 'in' && room !== null && raw > room;
  return (
    <div className="card">
      <div className="tabs"><button className={mode === 'in' ? 'on' : ''} onClick={() => { setMode('in'); setAmt(''); }}>Deposit USDG</button><button className={mode === 'out' ? 'on' : ''} onClick={() => { setMode('out'); setAmt(''); }}>Redeem</button></div>
      <div className="field"><label>{mode === 'in' ? 'USDG to deposit' : 'Pot shares to withdraw'}</label>
        <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.0" />
        <div className="hint">{bal ? (mode === 'in' ? <>Balance: <b>{usdg(bal.usdg)}</b> USDG · <a href="#" onClick={(e) => { e.preventDefault(); setAmt(formatUnits(bal.usdg, 6)); }}>max</a></> : <>You hold <b>{Number(formatUnits(bal.shares, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}</b> shares{pps ? ` ≈ $${(Number(formatUnits(bal.shares, 18)) * pps).toFixed(2)}` : ''} · <a href="#" onClick={(e) => { e.preventDefault(); setAmt(formatUnits(bal.shares, 18)); }}>max</a></>) : 'Connect a wallet to see balances.'}</div></div>
      {mode === 'in' ? <p className="small muted">{prev !== null ? <>You receive ≈ <b>{Number(formatUnits(prev, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}</b> shares after the 0.30% fee (which buys back &amp; burns $WIF).</> : 'A 0.30% deposit fee funds the $WIF buyback & burn.'}</p> : (
        <label className="row small" style={{ fontWeight: 600 }}><input type="checkbox" style={{ width: 18 }} checked={inKind} onChange={(e) => setInKind(e.target.checked)} /> Redeem in kind (get the Stock Tokens themselves — works even when oracles are paused)</label>
      )}
      {mode === 'in' && room !== null && room < (1n << 200n) ? <p className="small" style={{ fontWeight: 650 }}>Beta cap: you can deposit up to <b>${usdg(room)}</b> more{capped ? <span className="err"> — that amount is over your limit.</span> : '.'}</p> : null}
      <ActionButton className="btn block" tx={tx} disabled={raw === 0n || over || capped} onRun={(s) => (mode === 'in' ? basketDeposit(raw, s) : basketRedeem(raw, inKind, s))}>{over ? 'Amount exceeds balance' : capped ? 'Over the beta deposit cap' : mode === 'in' ? 'Deposit' : 'Redeem'}</ActionButton>
      <TxStatus tx={tx} />
    </div>
  );
}

function Nominate({ unlisted, threshold, round }: { unlisted: { idx: number; symbol: string; backers: number }[]; threshold: number; round: number }) {
  const tx = useTx();
  return (
    <div className="card">
      <h3>Suggest a new stock</h3>
      <p className="small muted">Burn 1 $WIF to back a stock that isn’t on the ballot yet. One backing per wallet per round, so it’s decided by headcount, not capital. <b>{threshold} distinct backers</b> promote it to next epoch’s vote.</p>
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

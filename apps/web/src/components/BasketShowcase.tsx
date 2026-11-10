import { formatUnits } from 'viem';
import { useApp } from '../lib/store';
import { useNow, useTx, ActionButton, TxStatus, color } from './ui';
import { basketCall, finalize } from '../lib/actions';
import { until, usdg } from '../lib/format';

/** "The internet votes, the chain buys": live vote -> lock in -> buy, then a big "Executed on-chain" moment with the real tx links. */
export function BasketShowcase() {
  const { snap, cfg } = useApp();
  const now = useNow(1000);
  const tx = useTx();
  const b = snap?.basket;
  if (!b) return null;
  const last = b.epochs[b.epochs.length - 1];
  const el = last ? snap!.elections.find((e) => e.id === last.electionId) : undefined;
  const evs = b.events ?? [];
  const applied = last ? evs.find((x) => x.kind === 'targets' && x.epoch === last.epoch) : undefined;
  const buys = applied ? evs.filter((x) => x.kind === 'traded' && x.buy && x.block >= applied.block) : [];
  const rebal = applied ? evs.find((x) => x.kind === 'rebalanced' && x.block >= applied.block) : undefined;
  const explorer = cfg?.explorer ?? '';
  const ended = !!el && (el.status === 'ended' || el.status === 'finalized' || now >= el.end);
  const finalized = el?.status === 'finalized';
  const stage = !el ? 0 : !ended ? 1 : !finalized ? 2 : !rebal ? 3 : 4;
  const tl = (h: string, n: number) => ({ cls: 'stage' + (stage > n ? ' done' : stage === n ? ' now' : ''), h });
  const st = [tl('1 · The internet votes', 1), tl('2 · Lock in the result', 2), tl('3 · The chain buys', 3)];
  const net: Record<string, { sym: string; usdg: bigint; tokens: bigint }> = {};
  for (const x of evs.filter((e) => e.kind === 'traded')) {
    const k = x.symbol ?? x.token!;
    net[k] ??= { sym: k, usdg: 0n, tokens: 0n };
    net[k].usdg += (x.buy ? 1n : -1n) * BigInt(x.usdg!); net[k].tokens += (x.buy ? 1n : -1n) * BigInt(x.tokenAmount!);
  }
  const holdings = Object.values(net).filter((h) => h.tokens > 0n);
  return (
    <section className="showcase" aria-label="The internet votes, the chain buys">
      <h2 style={{ marginBottom: 4 }}>The internet votes. The chain buys.</h2>
      <p className="muted" style={{ marginTop: 0 }}>No manager decides. When voting ends, the Stock Pot’s contract buys the winning stocks by itself.</p>
      {!el ? <p className="muted">No vote is running yet. <a href="#/create?template=basket"><b>Start this week’s vote →</b></a></p> : (
        <>
          <div className="row between"><b>{el.title}</b><span className={`tag ${el.status}`}>{el.status}</span></div>
          <div className="stages">
            <div className={st[0].cls}><div className="k">{st[0].h}</div>{!ended ? <><div className="burn" style={{ fontSize: '1.6rem' }}>{until(el.end, now)}</div><a href={`#/e/${el.id}`}>Vote with $WIF →</a></> : <div>Voting closed</div>}</div>
            <div className={st[1].cls}><div className="k">{st[1].h}</div>{finalized ? <div>✓ Result locked in</div> : ended ? <><div className="small muted">Anyone can lock it in once the challenge window ends.</div><ActionButton className="btn sm" tx={tx} onRun={(s) => finalize(el.id, s)}>Lock in the result</ActionButton></> : <div className="muted small">After voting ends</div>}</div>
            <div className={st[2].cls}><div className="k">{st[2].h}</div>{rebal ? <div>✓ Bought on-chain</div> : applied || finalized ? <><div className="small muted">Weights are set. Anyone can trigger the buy.</div><ActionButton className="btn sm" tx={tx} onRun={(s) => basketCall('rebalance', s)}>Buy what the people chose</ActionButton></> : <div className="muted small">After the result is locked in</div>}</div>
          </div>
          <TxStatus tx={tx} />
        </>
      )}
      {stage === 4 || buys.length ? (
        <div className="executed" data-testid="executed">
          <div className="small" style={{ letterSpacing: '.12em', fontWeight: 800 }}>THE CHAIN JUST DID THIS BY ITSELF</div>
          <h2>✅ Executed on-chain</h2>
          <p style={{ margin: '8px 0' }}>{rebal ? <>Rebalance <a href={`${explorer}/tx/${rebal.tx}`} target="_blank" rel="noreferrer noopener">{rebal.tx.slice(0, 10)}…</a></> : null}{applied ? <> · weights set <a href={`${explorer}/tx/${applied.tx}`} target="_blank" rel="noreferrer noopener">{applied.tx.slice(0, 10)}…</a></> : null}</p>
          {buys.length ? <div className="small" style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto' }}>{buys.map((x, i) => <div key={i}>🛒 Bought <b>${usdg(x.usdg!)}</b> of <b style={{ color: color(i) }}>{x.symbol}</b> · <a href={`${explorer}/tx/${x.tx}`} target="_blank" rel="noreferrer noopener">tx</a></div>)}</div> : null}
        </div>
      ) : null}
      <h3 style={{ marginTop: 16 }}>What the pot holds</h3>
      {holdings.length ? (
        <table className="t"><thead><tr><th>Stock</th><th>Bought with (USDG)</th><th>Tokens</th></tr></thead><tbody>
          {holdings.map((h) => <tr key={h.sym}><td><b>{h.sym}</b></td><td className="mono">${usdg(h.usdg)}</td><td className="mono">{Number(formatUnits(h.tokens, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td></tr>)}
        </tbody></table>
      ) : <p className="muted small">Before the first buy: the pot holds only dollars (USDG). After it, this table shows the stocks the internet picked.</p>}
    </section>
  );
}

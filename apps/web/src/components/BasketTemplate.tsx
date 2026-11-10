import { useApp } from '../lib/store';
import { ActionButton, TxStatus, color, letter, useNow, useTx } from './ui';
import { basketCall } from '../lib/actions';
import { until } from '../lib/format';
import { go } from '../lib/route';
import { Steps } from './Steps';

/** /#/create?template=basket. The Stock Pot opens its OWN election (openEpoch): options = the stocks it supports, executor = the vault. A custom
 *  election could not execute: the vault only applies the result of the election it created itself. */
export function BasketTemplate() {
  const { snap } = useApp();
  const tx = useTx();
  const now = useNow(1000);
  const b = snap?.basket;
  if (!b) return <div className="skeleton" style={{ minHeight: 200 }} />;
  const listed = b.assets.filter((a) => a.listed);
  const last = b.epochs[b.epochs.length - 1];
  const lastEl = last ? snap!.elections.find((e) => e.id === last.electionId) : undefined;
  const next = lastEl ? last!.start + 7 * 86400 : 0;
  const canOpen = !last || now >= next;
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h2>The internet votes, the chain buys</h2>
      <p className="muted">Start the Stock Pot’s vote. <b>$WIF holders pick which stocks it buys</b> (1 wallet = 1 vote, every vote burns $WIF). When voting ends, the contract buys the winners itself.</p>
      <Steps items={[['Start the vote', 'One click below. The Stock Pot opens a 5-day election.'], ['Everyone votes', 'Burn 1 $WIF per wallet on the stocks you want.'], ['Chain buys', 'Lock in the result, then trigger the buy. No manager.']]} />
      <div className="card">
        <h3>Stocks on the ballot (set by the contract)</h3>
        <div className="row" style={{ gap: 8 }}>{listed.map((a, i) => <span key={a.idx} className="tag" style={{ borderColor: 'var(--ink)', background: '#fff' }}><span style={{ color: color(i) }}>{letter(i)}</span> {a.symbol}</span>)}</div>
        <p className="hint">Why no custom form: the vault only carries out the election it opens itself, so it always lists exactly the stocks it can really buy and the result can’t be faked.</p>
        {lastEl?.status === 'open' ? <p>A vote is already live. <a href={`#/e/${lastEl.id}`}><b>Go to it →</b></a></p> : null}
        <ActionButton className="btn block" tx={tx} disabled={!canOpen} onRun={async (s) => { await basketCall('openEpoch', s); setTimeout(() => go('/basket'), 1500); }}>
          {canOpen ? 'Start this week’s Stock Pot vote' : `Next vote can start in ${until(next, now).replace(' left', '')}`}
        </ActionButton>
        <TxStatus tx={tx} />
        <p className="hint">Costs only gas. Anyone can press this; the contract enforces the weekly schedule.</p>
      </div>
    </div>
  );
}

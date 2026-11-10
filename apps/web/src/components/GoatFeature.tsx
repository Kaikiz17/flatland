import { useApp } from '../lib/store';
import { ElectionCard } from './ElectionCard';

/** Home feature slot for "Who is the GOAT? — the rematch": shows the live election once it exists (config.json `goatElectionId`, else the newest election with GOAT in its title), otherwise a call to create it. */
export function GoatFeature() {
  const { snap, cfg } = useApp();
  if (!snap) return null;
  const byCfg = cfg?.goatElectionId ? snap.elections.find((e) => e.id === cfg.goatElectionId) : undefined;
  const e = byCfg ?? [...snap.elections].reverse().find((x) => /\bgoat\b/i.test(x.title));
  return (
    <section className="goatfeat" aria-label="Featured: the GOAT rematch">
      <div className="small" style={{ fontFamily: 'var(--mono)', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>🐐 Featured · the rematch</div>
      <h2 style={{ margin: '4px 0 6px' }}>Who is the GOAT?</h2>
      {e ? (
        <div style={{ maxWidth: 520 }}><p className="muted" style={{ marginTop: 0 }}>The vote is live on Flatland: 1 wallet = 1 vote, every vote burns $WIF.</p><ElectionCard e={e} /></div>
      ) : (
        <><p className="muted" style={{ marginTop: 0, maxWidth: 560 }}>World is Fair crowned a GOAT once. Run the rematch here: 32 candidates, 7 days, 1 $WIF per vote.</p><a className="btn" href="#/create?template=goat">Set up the GOAT rematch →</a></>
      )}
    </section>
  );
}

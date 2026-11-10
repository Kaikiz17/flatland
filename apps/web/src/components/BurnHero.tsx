import { useLiveTotals, burnedNumber } from '../lib/live';
import { CountUp } from './ui';
import { useNow } from './ui';

const fmt = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Prominent home-page counter: total $WIF burned through Flatland, plus voters and elections; ticks up live (polls /api/stats every 5s + the chain read). */
export function BurnHero() {
  const t = useLiveTotals();
  const now = useNow(1000);
  return (
    <section className="burnhero" aria-label="Live burn counter">
      <div className="lbl"><span className="live"><i />LIVE</span> $WIF burned through Flatland{t?.at ? <span style={{ textTransform: 'none', letterSpacing: 0 }}>· updated {Math.max(0, Math.floor(now - t.at / 1000))}s ago</span> : null}</div>
      <div className="big"><span className="flame">🔥</span> {t ? <CountUp value={burnedNumber(t.wifBurned)} format={fmt} /> : '—'}<small>$WIF</small></div>
      <div className="sub">
        <div>{t ? <CountUp value={t.participants} format={(n) => Math.round(n).toLocaleString()} /> : '—'}<span>Voters</span></div>
        <div>{t ? <CountUp value={t.votes} format={(n) => Math.round(n).toLocaleString()} /> : '—'}<span>Votes cast</span></div>
        <div>{t ? t.elections : '—'}<span>Elections</span></div>
      </div>
    </section>
  );
}

/** Small header version. */
export function BurnPill() {
  const t = useLiveTotals();
  if (!t) return null;
  return <a className="burnpill" href="#/" title="Total $WIF burned through Flatland">🔥 <CountUp value={burnedNumber(t.wifBurned)} format={fmt} /> $WIF</a>;
}

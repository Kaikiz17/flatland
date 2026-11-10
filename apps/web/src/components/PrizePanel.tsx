import { useState } from 'react';

/** Behind ?prizes=1. Collects prize rules for the PrizeRules add-on contract (docs/prize-rules.md).
 *  The contract is code + tests only (not deployed), so this panel only previews; funding stays disabled until an address is configured. */
export function PrizePanel() {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [pool, setPool] = useState('');
  const [slots, setSlots] = useState('');
  const [lucky, setLucky] = useState<{ pos: string; amt: string }[]>([]);
  const n = (s: string) => (Number(s) > 0 ? Number(s) : 0);
  const total = n(first) + n(last) + n(pool) + lucky.reduce((a, l) => a + n(l.amt), 0);
  const dup = new Set(lucky.map((l) => l.pos)).size !== lucky.length || lucky.some((l) => !(Number(l.pos) >= 1) || !(n(l.amt) > 0));
  return (
    <div className="card" data-testid="prize-panel" style={{ marginBottom: 12 }}>
      <h3>Prizes (preview)</h3>
      <p className="small muted">Fund a $WIF prize: first voter, last voter, lucky voter spots and a random draw. Set before the election goes live; locked once created. Preview only: the prize contract is not deployed yet.</p>
      <div className="grid g2">
        <div className="field"><label>First voter ($WIF)</label><input inputMode="decimal" value={first} onChange={(e) => setFirst(e.target.value)} /></div>
        <div className="field"><label>Last voter ($WIF)</label><input inputMode="decimal" value={last} onChange={(e) => setLast(e.target.value)} /></div>
        <div className="field"><label>Random pool ($WIF)</label><input inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value)} /></div>
        <div className="field"><label>Random winners</label><input inputMode="numeric" value={slots} onChange={(e) => setSlots(e.target.value)} /></div>
      </div>
      <div className="field"><label>Lucky voter spots</label>
        {lucky.map((l, i) => (
          <div className="row" key={i} style={{ gap: 8, marginBottom: 6 }}>
            <input placeholder="voter # (e.g. 172)" inputMode="numeric" value={l.pos} onChange={(e) => setLucky(lucky.map((x, j) => (j === i ? { ...x, pos: e.target.value } : x)))} />
            <input placeholder="$WIF" inputMode="decimal" value={l.amt} onChange={(e) => setLucky(lucky.map((x, j) => (j === i ? { ...x, amt: e.target.value } : x)))} />
            <button className="btn ghost sm" onClick={() => setLucky(lucky.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={() => setLucky([...lucky, { pos: '', amt: '' }])}>+ Add lucky spot</button>
        <div className="hint">Shown to voters as “lucky voter prizes: {lucky.length} hidden spots”. The numbers are stored on-chain, so they are readable by anyone who looks.</div>
      </div>
      <p className="small"><b>Total to fund: {total} $WIF</b>{dup ? <span className="err"> · lucky spots need unique voter numbers and an amount</span> : null}</p>
      <button className="btn block" disabled>Fund prize (available when the prize contract is deployed)</button>
    </div>
  );
}

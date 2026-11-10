import { parseUnits } from 'viem';
import { isPrizeRulesConfigured } from '@flatland/core';
import { useApp } from '../lib/store';
import type { PrizeRulesInput } from '../lib/actions';

const MAX_LUCKY = 20;
const MAX_RANDOM = 50;

function wei(s: string): bigint {
  try {
    const t = s.trim();
    if (!t || Number(t) <= 0) return 0n;
    return parseUnits(t, 18);
  } catch { return 0n; }
}

export type PrizeDraft = PrizeRulesInput & { ok: boolean; error?: string };

export function buildDraft(first: string, last: string, pool: string, slots: string, lucky: { pos: string; amt: string }[]): PrizeDraft {
  const firstW = wei(first), lastW = wei(last), poolW = wei(pool);
  const randomSlots = slots.trim() ? Number(slots) : 0;
  const positions: bigint[] = [];
  const amounts: bigint[] = [];
  const seen = new Set<string>();
  if (lucky.length > MAX_LUCKY) return emptyDraft(`Max ${MAX_LUCKY} lucky spots`);
  for (const l of lucky) {
    const pos = l.pos.trim();
    const amt = wei(l.amt);
    if (!pos && amt === 0n) return emptyDraft('Lucky spots need a voter number and an amount');
    if (!/^[1-9]\d*$/.test(pos) || amt <= 0n) return emptyDraft('Lucky spots need unique voter numbers and an amount');
    if (seen.has(pos)) return emptyDraft('Lucky spots need unique voter numbers and an amount');
    seen.add(pos);
    positions.push(BigInt(pos));
    amounts.push(amt);
  }
  if (!Number.isInteger(randomSlots) || randomSlots < 0 || randomSlots > MAX_RANDOM) {
    return emptyDraft(`Random winners must be 0–${MAX_RANDOM}`);
  }
  if ((randomSlots === 0) !== (poolW === 0n)) {
    return emptyDraft('Random pool and random winners must both be set, or both empty');
  }
  const total = firstW + lastW + poolW + amounts.reduce((a, b) => a + b, 0n);
  return { first: firstW, last: lastW, randomPool: poolW, randomSlots, luckyPositions: positions, luckyAmounts: amounts, total, ok: total > 0n };
}

function emptyDraft(error: string): PrizeDraft {
  return { first: 0n, last: 0n, randomPool: 0n, randomSlots: 0, luckyPositions: [], luckyAmounts: [], total: 0n, ok: false, error };
}

/** Create-page panel for the PrizeRules add-on. Multiple lucky voter rows (max 20), each with its own amount. */
export function PrizePanel({ first, last, pool, slots, lucky, onChange }: {
  first: string; last: string; pool: string; slots: string;
  lucky: { pos: string; amt: string }[];
  onChange: (next: { first?: string; last?: string; pool?: string; slots?: string; lucky?: { pos: string; amt: string }[] }) => void;
}) {
  const { cfg, dep } = useApp();
  const addr = (cfg?.prizeRules || (dep as { prizeRules?: string } | null)?.prizeRules) as string | undefined;
  const live = isPrizeRulesConfigured(addr);
  const draft = buildDraft(first, last, pool, slots, lucky);
  const totalLabel = draft.ok || draft.total > 0n ? String(Number(draft.total) / 1e18) : ((first || last || pool || lucky.some((l) => l.amt)) ? '—' : '0');
  return (
    <div className="card" data-testid="prize-panel" style={{ marginBottom: 12 }}>
      <h3>Prizes</h3>
      <p className="small muted">{live
        ? 'Fund a $WIF prize: first voter, last voter, as many lucky voter spots as you like (each with its own amount), and a random draw. Set before the election goes live; locked once funded. You will sign a second transaction after the election is created.'
        : 'Fund a $WIF prize: first voter, last voter, lucky voter spots and a random draw. Set before the election goes live; locked once created.'}</p>
      <div className="grid g2">
        <div className="field"><label>First voter ($WIF)</label><input inputMode="decimal" value={first} onChange={(e) => onChange({ first: e.target.value })} /></div>
        <div className="field"><label>Last voter ($WIF)</label><input inputMode="decimal" value={last} onChange={(e) => onChange({ last: e.target.value })} /></div>
        <div className="field"><label>Random pool ($WIF)</label><input inputMode="decimal" value={pool} onChange={(e) => onChange({ pool: e.target.value })} /></div>
        <div className="field"><label>Random winners</label><input inputMode="numeric" value={slots} onChange={(e) => onChange({ slots: e.target.value })} /></div>
      </div>
      <div className="field"><label>Lucky voter spots</label>
        {lucky.map((l, i) => (
          <div className="row" key={i} style={{ gap: 8, marginBottom: 6 }}>
            <input placeholder="voter # (e.g. 172)" inputMode="numeric" value={l.pos} onChange={(e) => onChange({ lucky: lucky.map((x, j) => (j === i ? { ...x, pos: e.target.value } : x)) })} />
            <input placeholder="$WIF" inputMode="decimal" value={l.amt} onChange={(e) => onChange({ lucky: lucky.map((x, j) => (j === i ? { ...x, amt: e.target.value } : x)) })} />
            <button type="button" className="btn ghost sm" onClick={() => onChange({ lucky: lucky.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button type="button" className="btn ghost sm" disabled={lucky.length >= MAX_LUCKY} onClick={() => onChange({ lucky: [...lucky, { pos: '', amt: '' }] })}>+ Add lucky spot</button>
        <div className="hint">Shown to voters as “lucky voter prizes: {lucky.length} hidden spots”. The numbers are stored on-chain, so they are readable by anyone who looks. Max {MAX_LUCKY} spots.</div>
      </div>
      <p className="small"><b>Total to fund: {totalLabel} $WIF</b>{draft.error ? <span className="err"> · {draft.error}</span> : null}</p>
      <button type="button" className="btn block" disabled={!live || !draft.ok} data-testid="fund-prize">{live ? (draft.ok ? 'Fund prize after you publish the election' : 'Fund prize') : 'Fund prize (available when the prize contract is deployed)'}</button>
    </div>
  );
}

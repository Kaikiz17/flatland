import type { Analysis, ElectionView } from '@flatland/core';
import { useApp } from '../lib/store';
import { short } from '../lib/format';

const LABELS: Record<string, string> = { spread: 'Vote spread', independence: 'Independent wallets', sources: 'Unique funding sources', openness: 'Verifiability' };

export function FairnessCard({ e, a }: { e: ElectionView; a: Analysis }) {
  const { cfg } = useApp();
  const f = a.fairness;
  const auditBase = cfg?.auditUrl ?? cfg?.indexerUrl;
  const audit = auditBase ? `${auditBase.replace(/\/$/, '')}/api/elections/${e.id}/audit` : null;
  return (
    <div className="card">
      <div className="row between"><h3>Fairness score</h3><span className={`tag ${f.grade}`}>grade {f.grade}</span></div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
        <div className="score">{f.grade === 'n/a' ? '—' : f.score}</div>
        <div className="small muted" style={{ paddingBottom: 4 }}>/ 100 · public, recomputable from the audit export</div>
      </div>
      <div style={{ marginTop: 12 }}>
        {Object.entries(f.parts).map(([k, v]) => (
          <div key={k} style={{ marginBottom: 8 }}>
            <div className="row between small"><span>{LABELS[k] ?? k}</span><b className="mono">{Math.round(v)}</b></div>
            <div className="meter"><i style={{ width: `${v}%` }} /></div>
          </div>
        ))}
      </div>
      <hr />
      <div className="small">
        <b>{a.counted}</b> counted of <b>{a.rawVoters}</b> wallets · <b>{a.collapsed}</b> collapsed as same-person clusters · <b>{a.uniqueSources}</b> unique funding sources.
      </div>
      {f.notes.map((n, i) => <div key={i} className="small muted">• {n}</div>)}
      {a.clusters.length ? (
        <details style={{ marginTop: 8 }}>
          <summary className="small"><b>Published groups ({a.clusters.length})</b></summary>
          {a.clusters.map((c, i) => (
            <div key={i} className="small mono" style={{ margin: '6px 0' }}>
              funder {short(c.source)} → keeps {short(c.keeper)}{c.popular ? ' (popular source: not collapsed)' : ''}; {c.members.length} wallets
            </div>
          ))}
        </details>
      ) : null}
      {audit ? <p className="small" style={{ marginTop: 8, marginBottom: 0 }}><a href={audit} target="_blank" rel="noreferrer">Download audit export (JSON) ↗</a></p> : <p className="small muted" style={{ marginBottom: 0 }}>Audit export is served by the indexer.</p>}
    </div>
  );
}

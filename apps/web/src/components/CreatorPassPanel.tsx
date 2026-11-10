import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { provePass } from '../lib/passClient';
import { Copy } from './ui';
import {
  KIND_LABELS, LEDGER_WARN, type LedgerList, type LedgerRow,
  lagosStamp, rowName, ledgerCsv, ledgerHtml, downloadBlob, downloadLedgerPngs,
} from '../lib/ledgerExport';

async function lookupEns(addr: string): Promise<string | undefined> {
  try {
    const r = await fetch(`https://api.ensdata.net/${addr}`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return;
    const j = await r.json() as { ens?: string; name?: string };
    return (j.ens || j.name || '').trim() || undefined;
  } catch { return; }
}

/** Creator-only Sign ledger: polished list, verify box, CSV + HTML + PNG export. */
export function CreatorPassPanel({ kind, id, creator }: { kind: 'gate'; id: string; creator: string }) {
  const { cfg } = useApp();
  const w = useWallet();
  const mine = w.address && creator && w.address.toLowerCase() === creator.toLowerCase();
  const [list, setList] = useState<LedgerList | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [qid, setQid] = useState('');
  const [hit, setHit] = useState('');
  const [q, setQ] = useState('');

  const load = async () => {
    if (!cfg) return;
    setBusy(true); setErr(''); setHit('');
    try {
      const { message, signature } = await provePass(cfg, `creator:${kind}:${id}`);
      const r = await fetch('/api/pass/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature, kind, id }) });
      const j = await r.json() as LedgerList & { error?: string };
      if (!r.ok) throw new Error(j.error ?? 'list failed');
      setList({ ...j, rows: j.rows ?? [] });
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!list?.rows.length) return;
    let dead = false;
    const missing = list.rows.filter((r) => !r.ens);
    const run = async () => {
      for (const row of missing) {
        const ens = await lookupEns(row.wallet);
        if (dead || !ens) continue;
        setList((cur) => cur && { ...cur, rows: cur.rows.map((x) => x.wallet === row.wallet ? { ...x, ens } : x) });
      }
    };
    void run();
    return () => { dead = true; };
  }, [list?.id, list?.rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const verify = async () => {
    if (!cfg || !list) return;
    setBusy(true); setHit(''); setErr('');
    try {
      const { message, signature } = await provePass(cfg, `creator:${kind}:${id}`);
      const r = await fetch('/api/pass/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature, id: qid.trim().toUpperCase() }) });
      const j = await r.json() as { valid?: boolean; wallet?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? 'verify failed');
      setHit(j.valid && j.wallet ? `Valid — ${j.wallet}` : j.valid ? 'Valid, but this ID is not from your Sign.' : 'Invalid — this pass ID does not match.');
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => {
    const rows = list?.rows ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [rowName(r), r.wallet, r.passId, String(r.no)].join(' ').toLowerCase().includes(s));
  }, [list, q]);

  if (!mine) return null;

  const csv = () => { if (list) downloadBlob(`flatland-sign-${id}-passes.csv`, new Blob([ledgerCsv(list, filtered)], { type: 'text/csv' })); };
  const html = () => { if (list) downloadBlob(`flatland-sign-${id}-passes.html`, new Blob([ledgerHtml(list, filtered)], { type: 'text/html;charset=utf-8' })); };
  const printDoc = () => {
    if (!list) return;
    const wdw = window.open('', '_blank');
    if (!wdw) return html();
    wdw.document.write(ledgerHtml(list, filtered));
    wdw.document.close();
    wdw.focus();
    setTimeout(() => wdw.print(), 250);
  };
  const png = async () => {
    if (!list) return;
    setBusy(true); setErr('');
    try { await downloadLedgerPngs(list, filtered); }
    catch (e) { setErr((e as Error).message.split('\n')[0]); }
    finally { setBusy(false); }
  };

  const kindLabel = KIND_LABELS[list?.signKind ?? 0] ?? 'Sign';

  return (
    <div className="ledger" data-testid="creator-pass-panel">
      <p className="pass-warn"><b>{LEDGER_WARN}</b></p>
      {!list ? <button className="btn sm" disabled={busy} onClick={() => void load()}>{busy ? 'Check your wallet…' : 'Sign in to open the signer ledger'}</button> : null}
      {err ? <p className="err small">{err}</p> : null}
      {list ? (
        <>
          <div className="ledger-toolbar">
            <input className="ledger-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, wallet or pass ID" />
            <div className="ledger-verify">
              <input value={qid} onChange={(e) => setQid(e.target.value.toUpperCase())} placeholder="FLAT-XXXX-XXXX-XXXX" maxLength={22} />
              <button className="btn sm" disabled={busy || !qid.trim()} onClick={() => void verify()}>Verify ID</button>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm ghost" onClick={csv}>CSV</button>
              <button className="btn sm ghost" onClick={html}>HTML export</button>
              <button className="btn sm ghost" onClick={printDoc}>Print / PDF</button>
              <button className="btn sm" disabled={busy} onClick={() => void png()}>{busy ? 'Rendering…' : 'Download as image'}</button>
            </div>
          </div>
          {hit ? <p className="small ok" style={{ marginTop: 8 }}>{hit}</p> : null}
          <header className="ledger-head">
            <div className="kicker">FLATLAND · SIGN · PRIVATE LEDGER</div>
            <h3>{list.title} <span className="ledger-badge">{kindLabel}</span></h3>
          </header>
          <div className="ledger-info">
            <div><b>Creator</b><span className="mono">{list.creator}</span></div>
            <div><b>Contract / gate</b><span className="mono">{list.contract} · #{list.id}</span></div>
            <div><b>Created</b><span>{lagosStamp(list.created)} Lagos (UTC+1)</span></div>
            <div><b>Total signers</b><span>{list.total}</span></div>
            <div><b>$WIF burned</b><span>{list.burnedWif}</span></div>
            <div><b>Export time</b><span>{lagosStamp(list.exportedAt)} Lagos (UTC+1)</span></div>
          </div>
          <div className="ledger-wrap">
            <table className="ledger-table">
              <thead><tr><th>No.</th><th>Name</th><th>Wallet address</th><th>Pass ID</th><th>Time (Lagos / UTC+1)</th></tr></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} className="muted">No signers match.{list.rows.length === 0 ? ' IDs appear once the act has a transaction hash (usually within a minute).' : ''}</td></tr>
                ) : filtered.map((r: LedgerRow) => (
                  <tr key={r.passId + r.wallet}>
                    <td className="mono">{r.no}</td>
                    <td>{rowName(r)}</td>
                    <td className="mono">{r.wallet} <Copy text={r.wallet} label="Copy" /></td>
                    <td className="mono">{r.passId} <Copy text={r.passId} label="Copy" /></td>
                    <td>{lagosStamp(r.ts)} Lagos</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

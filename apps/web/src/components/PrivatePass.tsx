import { useState } from 'react';
import { useApp } from '../lib/store';
import { downloadPng } from '../lib/download';
import { provePass } from '../lib/passClient';

/** Unlock and show a PRIVATE PASS card. The public card never includes this ID. */
export function PrivatePass({ src, filename, purpose = 'private-pass', gateId }: { src: string; filename: string; purpose?: string; gateId?: string | number }) {
  const { cfg } = useApp();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [named, setNamed] = useState('');
  const unlock = async () => {
    if (!cfg) return;
    setBusy(true); setErr('');
    try {
      const { qs } = await provePass(cfg, purpose);
      const join = src.includes('?') ? '&' : '?';
      setUrl(`${src}${join}${qs}`);
      setOpen(true);
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
    finally { setBusy(false); }
  };

  const saveName = async () => {
    if (!cfg || !gateId || !name.trim()) return;
    setBusy(true); setErr('');
    try {
      const { message, signature } = await provePass(cfg, 'private-pass');
      const r = await fetch('/api/pass/name', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature, gateId: String(gateId), name: name.trim() }) });
      const j = await r.json() as { error?: string; name?: string };
      if (!r.ok) throw new Error(j.error ?? 'Could not save name');
      setNamed(j.name ?? name.trim());
    } catch (e) { setErr((e as Error).message.split('\n')[0]); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 12 }}>
      {!open ? (
        <button className="btn sm ghost" disabled={busy} onClick={() => void unlock()}>{busy ? 'Check your wallet…' : 'View private pass'}</button>
      ) : null}
      {err ? <p className="err small">{err}</p> : null}
      {open && url ? (
        <div className="private-pass" data-testid="private-pass">
          <p className="pass-warn"><b>Don't share this publicly. Share it privately for verification only.</b></p>
          <img className="poster" src={url} alt="Private pass" width={1080} height={1080} />
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <button className="btn sm" disabled={busy} onClick={() => { setBusy(true); void downloadPng(url, filename).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : 'Download'}</button>
            <button className="btn sm ghost" onClick={() => { setOpen(false); setUrl(''); }}>Hide</button>
          </div>
            {gateId ? (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Optional display name on the creator’s list (ENS is used if you have one)</label>
                <div className="row">
                  <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="A name, if you want one" />
                  <button className="btn sm ghost" disabled={busy || !name.trim()} onClick={() => void saveName()}>Save name</button>
                </div>
                {named ? <p className="ok small">Saved as {named}.</p> : null}
              </div>
            ) : null}
        </div>
      ) : null}
    </div>
  );
}

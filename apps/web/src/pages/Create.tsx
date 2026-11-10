import { useRef, useState } from 'react';
import { parseUnits, type Address } from 'viem';
import { useApp } from '../lib/store';
import { ActionButton, TxStatus, useTx, color, letter } from '../components/ui';
import { createElection } from '../lib/actions';
import { go } from '../lib/route';
import { ZERO, isAddr } from '../lib/format';
import { processImage, uploadImage, uploadMeta } from '../lib/media';

type Img = { blob: Blob; url: string } | null;

const DURATIONS: [string, number][] = [['1 hour', 3600], ['6 hours', 6 * 3600], ['1 day', 86400], ['3 days', 3 * 86400], ['7 days', 7 * 86400], ['30 days', 30 * 86400]];

export function Create() {
  const { dep } = useApp();
  const tx = useTx();
  const [title, setTitle] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [imgs, setImgs] = useState<Img[]>([null, null]);
  const [imgErr, setImgErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef(0);
  const onFile = async (f?: File | null) => {
    if (!f) return;
    setImgErr('');
    try { const r = await processImage(f); const i = pickFor.current; setImgs((cur) => cur.map((x, j) => (j === i ? r : x))); } catch (e) { setImgErr((e as Error).message); }
  };
  const [dur, setDur] = useState(86400);
  const [cost, setCost] = useState('1');
  const [prize, setPrize] = useState('0');
  const [winners, setWinners] = useState('0');
  const [trust, setTrust] = useState<'default' | 'none' | 'custom'>('default');
  const [custom, setCustom] = useState('');
  const [cw, setCw] = useState(12);
  const [meta, setMeta] = useState('');
  const [executor, setExecutor] = useState('');

  const cleaned = opts.map((o) => o.trim()).filter(Boolean);
  let costWei = 0n, prizeWei = 0n;
  try { costWei = parseUnits(cost || '0', 18); prizeWei = parseUnits(prize || '0', 18); } catch {}
  const w = Number(winners) || 0;
  const problems: string[] = [];
  if (!title.trim()) problems.push('Add a question or title.');
  if (cleaned.length < 2) problems.push('At least 2 options.');
  if (new Set(cleaned.map((o) => o.toLowerCase())).size !== cleaned.length) problems.push('Options must be different.');
  if (costWei < 10n ** 18n) problems.push('Vote cost must be at least 1 $WIF.');
  if (prizeWei > 0n && w < 1) problems.push('A prize pool needs at least 1 winner slot.');
  if (w > 100) problems.push('Max 100 winner slots.');
  if (trust === 'custom' && !isAddr(custom)) problems.push('Enter a valid tallier address.');
  if (meta.trim() && !/^(https?:\/\/|ipfs:\/\/)/i.test(meta.trim())) problems.push('Details link must start with https:// or ipfs://');
  if (executor && !isAddr(executor)) problems.push('Executor must be an address (or empty).');
  const tallier: Address = trust === 'none' ? ZERO : trust === 'custom' ? (custom as Address) : dep!.tallier;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h2>Start an election</h2>
      <p className="muted">Permissionless. 1 wallet = 1 vote, every vote burns $WIF. Share the link and watch the live room fill up.</p>
      <div className="card">
        <div className="field"><label>Question</label><input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="Which Stock Token should the world buy first?" /></div>
        <div className="field"><label>Options</label>
          <input ref={fileRef} type="file" accept="image/*" hidden data-testid="img-input" onChange={(ev) => { void onFile(ev.target.files?.[0]); ev.target.value = ''; }} />
          {opts.map((o, i) => (
            <div key={i} className="row" style={{ marginBottom: 8, flexWrap: 'nowrap' }}>
              <span className="chip" style={{ background: color(i), width: 32, height: 32, fontSize: '.95rem' }}>{letter(i)}</span>
              <input value={o} maxLength={60} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${letter(i)}`} />
              {imgs[i] ? (
                <span className="thumb-edit"><img src={imgs[i]!.url} alt={`Option ${letter(i)} image`} /><button className="x" aria-label="Remove image" onClick={() => setImgs(imgs.map((x, j) => (j === i ? null : x)))}>✕</button></span>
              ) : <button className="btn ghost sm" style={{ whiteSpace: 'nowrap' }} onClick={() => { pickFor.current = i; fileRef.current?.click(); }}>🖼 Add image</button>}
              {opts.length > 2 ? <button className="btn ghost sm" aria-label="Remove option" onClick={() => { setOpts(opts.filter((_, j) => j !== i)); setImgs(imgs.filter((_, j) => j !== i)); }}>✕</button> : null}
            </div>
          ))}
          {imgErr ? <div className="err">{imgErr}</div> : null}
          <div className="hint">Images are optional. Pick a photo from your device: it is cropped square, shrunk to 512px / under 80 KB and stripped of all metadata in your browser before upload.</div>
          {opts.length < 32 ? <button className="btn ghost sm" onClick={() => { setOpts([...opts, '']); setImgs([...imgs, null]); }}>+ Add option</button> : null}
        </div>
        <div className="grid g2">
          <div className="field"><label>Voting stays open for</label>
            <select value={dur} onChange={(e) => setDur(Number(e.target.value))}>{DURATIONS.map(([l, s]) => <option key={s} value={s}>{l}</option>)}</select></div>
          <div className="field"><label>Cost per vote ($WIF)</label><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))} /><div className="hint">Minimum 1. Burned, not paid to anyone.</div></div>
        </div>
        <div className="grid g2">
          <div className="field"><label>Prize pool ($WIF, optional)</label><input inputMode="decimal" value={prize} onChange={(e) => setPrize(e.target.value.replace(/[^0-9.]/g, ''))} /><div className="hint">Paid to randomly drawn voters.</div></div>
          <div className="field"><label>Prize winner slots</label><input inputMode="numeric" value={winners} onChange={(e) => setWinners(e.target.value.replace(/[^0-9]/g, ''))} /><div className="hint">Drawn with a future block hash. 0 = no draw.</div></div>
        </div>
        <div className="field"><label>Trust mode</label>
          <select value={trust} onChange={(e) => setTrust(e.target.value as any)}>
            <option value="default">Recommended — reference indexer (adds “just send 1 $WIF” votes + sybil groups)</option>
            <option value="none">Fully on-chain — wallet votes only, no tallier</option>
            <option value="custom">Bring my own tallier address</option>
          </select>
          {trust === 'custom' ? <input style={{ marginTop: 8 }} placeholder="0x… tallier" value={custom} onChange={(e) => setCustom(e.target.value.trim())} /> : null}
          <div className="hint">With a tallier, anyone can challenge a duplicate wallet by burning $WIF, and the tallier’s groups are published. On-chain wallet votes always stand.</div>
        </div>
        <details>
          <summary className="small"><b>Advanced</b></summary>
          <div className="grid g2" style={{ marginTop: 10 }}>
            <div className="field"><label>Challenge window (hours)</label><input inputMode="numeric" value={cw} onChange={(e) => setCw(Math.min(168, Math.max(1, Number(e.target.value.replace(/[^0-9]/g, '')) || 1)))} /></div>
            <div className="field"><label>Details link (ipfs:// or https://)</label><input value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="optional" /></div>
          </div>
          <div className="field"><label>Outcome executor contract</label><input value={executor} onChange={(e) => setExecutor(e.target.value.trim())} placeholder="optional: 0x… implements onFinalize(id, winner, tally)" /><div className="hint">Binds the result to an on-chain action when the election finalizes (the People’s Basket uses this). Gas-capped and retryable.</div></div>
        </details>
        {problems.length ? <ul className="small err" style={{ paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
        <ActionButton className="btn block" tx={tx} disabled={problems.length > 0} onRun={async (s) => {
          // upload images first (no gas, no wallet): then a small JSON blob maps option index -> image and becomes the on-chain metaURI
          const map: Record<number, string> = {};
          let k = 0;
          for (let i = 0; i < opts.length; i++) {
            if (!opts[i].trim()) continue;
            const im = imgs[i];
            if (im) { s({ label: `Uploading image ${letter(i)}…` }); map[k] = await uploadImage(im.blob); }
            k++;
          }
          let metaURI = meta.trim();
          if (Object.keys(map).length) { s({ label: 'Saving image map…' }); metaURI = await uploadMeta(map, meta.trim()); }
          const id = await createElection({
            title: title.trim(), options: cleaned, metaURI, end: Math.floor(Date.now() / 1000) + dur, voteCost: costWei, tallier, executor: (executor || ZERO) as Address,
            challengeWindow: cw * 3600, winners: w, prize: prizeWei,
          }, s);
          setTimeout(() => go(`/e/${id}`), 1200);
        }}>Create election{prizeWei > 0n ? ' & fund prize' : ''}</ActionButton>
        <TxStatus tx={tx} />
        <p className="hint">Creating costs only gas. Voting starts immediately and the election gets its own live room.</p>
      </div>
    </div>
  );
}

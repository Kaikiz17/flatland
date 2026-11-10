import { useState } from 'react';
import { parseUnits } from 'viem';
import type { GateView } from '@flatland/core';
import { useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { act, createGate } from '../lib/actions';
import { ActionButton, Copy, Empty, TxStatus, useTx } from '../components/ui';
import { ago, short, wif } from '../lib/format';
import { Steps } from '../components/Steps';
import { SignedCard } from '../components/SignedCard';
import { CreatorPassPanel } from '../components/CreatorPassPanel';

const KINDS = ['Petition', 'RSVP', 'Allowlist', 'Access gate'];
const KIND_ICON = ['✍️', '🎟️', '📜', '🔑'];

export function Rails({ focus }: { focus?: number }) {
  const { snap } = useApp();
  const [show, setShow] = useState(false);
  const gates = [...(snap?.gates ?? [])].reverse();
  return (
    <>
      <div className="row between"><h2>Sign</h2><button className="btn" onClick={() => setShow(!show)}>{show ? 'Close' : '+ New link'}</button></div>
      <p className="lead" style={{ maxWidth: 680 }}><b>Sign for Petitions, RSVPs, allowlists and access gates in one contract. Each act burns $WIF, is capped at one per wallet, and builds the actor’s on-chain streak.</b></p>
      <Steps items={[['Pick a link', 'Petition, RSVP, list or access pass.'], ['Send 1 $WIF', 'From any wallet app to the address on the card.'], ['You’re counted', 'It’s recorded on-chain and burns your $WIF. One per wallet.']]} />
      <p className="small muted" style={{ maxWidth: 680 }}>For developers: apps can read <code>hasActed(gateId, wallet)</code> or embed the <a href="#/build">widget</a>.</p>
      {show ? <NewGate onDone={() => setShow(false)} /> : null}
      {!snap ? <div className="skeleton" /> : gates.length === 0 ? <Empty>No send-to-act links yet. Create the first one: a petition, an RSVP, a list or an access pass.</Empty> : (
        <div className="grid g2">{gates.map((g) => <GateCard key={g.id} g={g} focus={focus === g.id} />)}</div>
      )}
    </>
  );
}

function GateCard({ g, focus }: { g: GateView; focus: boolean }) {
  const w = useWallet();
  const tx = useTx();
  const [open, setOpen] = useState(focus);
  const mine = w.address ? g.actors.find((a) => a.who.toLowerCase() === w.address!.toLowerCase()) : undefined;
  const now = Date.now() / 1000;
  const closed = (g.end > 0 && now >= g.end) || (g.cap > 0 && g.count >= g.cap) || (g.start > 0 && now < g.start);
  const label = g.kind === 1 ? 'RSVP' : g.kind === 0 ? 'Sign' : g.kind === 2 ? 'Join allowlist' : 'Unlock access';
  return (
    <div className="card" id={`gate-${g.id}`}>
      <div className="row between"><span className="tag">{KIND_ICON[g.kind]} {KINDS[g.kind]}</span><span className="small muted mono">#{g.id}</span></div>
      <h3 style={{ marginTop: 8 }}>{g.title}</h3>
      <div className="row between small"><span><b className="mono">{g.count}</b>{g.cap ? ` / ${g.cap}` : ''} {g.kind === 1 ? 'seats taken' : 'signed'}</span><span className="muted">🔥 {wif(g.cost)} $WIF each</span></div>
      {g.cap ? <div className="meter" style={{ margin: '8px 0' }}><i style={{ width: `${(g.count / g.cap) * 100}%` }} /></div> : null}
      {mine ? (
        <>
          <p className="ok small" style={{ margin: '8px 0' }}>✓ You’re #{mine.position + 1}.</p>
          <SignedCard g={g} position={mine.position + 1} />
        </>
      ) : (
        <>
          <ActionButton className="btn block" tx={tx} disabled={closed} onRun={(s) => act(g.id, BigInt(g.cost), s)}>{closed ? 'Closed' : `${label} · burn ${wif(g.cost)} $WIF`}</ActionButton>
          <TxStatus tx={tx} />
        </>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Who acted'} ({g.count})</button>
        <Copy text={`<script src="${location.origin}${location.pathname.replace(/[^/]*$/, '')}flatland-widget.js" data-gate="${g.id}"></script>`} label="Copy embed" />
      </div>
      {open ? (
        <div style={{ marginTop: 10, maxHeight: 220, overflow: 'auto' }}>
          {g.actors.length === 0 ? <p className="muted small">No one yet.</p> : [...g.actors].reverse().map((a) => <div key={a.position} className="small row between" style={{ borderBottom: '1px dashed var(--line)', padding: '4px 0' }}><span className="mono">#{a.position + 1} {short(a.who)}</span><span className="muted">{ago(a.ts)}</span></div>)}
        </div>
      ) : null}
      <CreatorPassPanel kind="gate" id={String(g.id)} creator={g.creator} />
    </div>
  );
}

function NewGate({ onDone }: { onDone: () => void }) {
  const tx = useTx();
  const [kind, setKind] = useState(0);
  const [title, setTitle] = useState('');
  const [cost, setCost] = useState('1');
  const [cap, setCap] = useState('0');
  const [days, setDays] = useState('0');
  const [meta, setMeta] = useState('');
  let costWei = 0n; try { costWei = parseUnits(cost || '0', 18); } catch {}
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="tabs">{KINDS.map((k, i) => <button key={k} className={kind === i ? 'on' : ''} onClick={() => setKind(i)}>{KIND_ICON[i]} {k}</button>)}</div>
      <div className="field"><label>Title</label><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 1 ? 'Lagos meetup — Friday 7pm' : 'Open the markets to everyone'} /></div>
      <div className="grid g3">
        <div className="field"><label>$WIF per act</label><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
        <div className="field"><label>Cap (0 = unlimited)</label><input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9]/g, ''))} /></div>
        <div className="field"><label>Open for days (0 = forever)</label><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))} /></div>
      </div>
      <div className="field"><label>Details link (optional)</label><input value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="https://… or ipfs://…" /></div>
      <ActionButton className="btn" tx={tx} disabled={!title.trim() || costWei < 10n ** 18n} onRun={async (s) => { await createGate(kind, title.trim(), meta, 0, Number(days) ? Math.floor(Date.now() / 1000) + Number(days) * 86400 : 0, costWei, Number(cap) || 0, s); onDone(); }}>Create Sign</ActionButton>
      <TxStatus tx={tx} />
    </div>
  );
}

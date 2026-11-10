import { useEffect, useState } from 'react';
import { connect, disconnect, initWallets, mobileLinks, useWallet } from '../lib/wallet';
import { useApp } from '../lib/store';
import { short } from '../lib/format';

const listeners = new Set<(o: boolean) => void>();
export const connectModal = { open: () => listeners.forEach((f) => f(true)), close: () => listeners.forEach((f) => f(false)) };

export function WalletButton() {
  const w = useWallet();
  const { cfg } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => { listeners.add(setOpen); return () => void listeners.delete(setOpen); }, []);
  useEffect(() => { if (cfg) initWallets(cfg); }, [cfg]);
  const wrong = w.address && cfg && w.chainId !== cfg.chainId;
  return (
    <>
      {w.address ? (
        <button className="btn ghost sm" onClick={() => setOpen(true)} title={w.address}>
          <span className={'dot' + (wrong ? ' off' : '')} />{short(w.address)}
        </button>
      ) : (
        <button className="btn sm" onClick={() => setOpen(true)}>Connect wallet</button>
      )}
      {open ? (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {w.address ? (
              <>
                <h3>Connected</h3>
                <p className="addr">{w.address}</p>
                {wrong ? <div className="banner small">Your wallet is on another network. We'll ask it to switch when you take an action.</div> : null}
                <div className="row"><button className="btn ghost" onClick={() => { disconnect(); setOpen(false); }}>Disconnect</button><button className="btn ink" onClick={() => setOpen(false)}>Close</button></div>
              </>
            ) : (
              <>
                <h3>Connect a wallet</h3>
                <p className="muted small">Any EVM wallet works — Phantom, Trust, MetaMask, Rabby… Voting only ever asks to burn your own $WIF.</p>
                {w.injected.length === 0 ? (
                  <>
                    <div className="banner small">No wallet detected in this browser. On your phone, open Flatland inside your wallet app:</div>
                    {mobileLinks().map((l) => <a key={l.name} className="wl" href={l.href}>Open in {l.name} →</a>)}
                    <p className="hint">Or skip the connection entirely: every election has a “just send 1 $WIF” deposit address you can pay from any wallet.</p>
                  </>
                ) : (
                  w.injected.map((i) => (
                    <button key={i.uuid} className="wl" disabled={w.connecting} onClick={async () => { await connect(i); setOpen(false); }}>
                      {i.icon ? <img src={i.icon} alt="" /> : <span>🔌</span>}{i.name}
                    </button>
                  ))
                )}
                {w.error ? <div className="err">{w.error}</div> : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

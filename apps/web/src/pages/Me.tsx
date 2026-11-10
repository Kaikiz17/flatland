import { useEffect, useState } from 'react';
import { standingAbi, tierName, TIERS } from '@flatland/core';
import { getState, useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { connectModal } from '../components/Wallet';
import { wif } from '../lib/format';
import { Empty } from '../components/ui';
import { GaslessPanel } from '../components/GaslessPanel';

export function Me() {
  const w = useWallet();
  const { client, dep } = useApp();
  const [rec, setRec] = useState<any>(null);
  const [tier, setTier] = useState(0);
  useEffect(() => {
    if (!w.address || !client || !dep) return;
    void client.readContract({ address: dep.standing, abi: standingAbi, functionName: 'record', args: [w.address] }).then(setRec);
    void client.readContract({ address: dep.standing, abi: standingAbi, functionName: 'tier', args: [w.address] }).then((t) => setTier(Number(t)));
  }, [w.address, client, dep]);
  if (!w.address) return <><Empty><p>Connect a wallet to see your streak and standing.</p><button className="btn" onClick={() => connectModal.open()}>Connect wallet</button></Empty><GaslessPanel /></>;
  return (
    <><div className="card" style={{ maxWidth: 560 }}>
      <h2>Your standing</h2>
      <p className="addr">{w.address}</p>
      {!rec ? <div className="skeleton" /> : (
        <>
          <div className="row" style={{ gap: 24 }}>
            <div><div className="score">{rec.streak}</div><div className="small muted">week streak (best {rec.bestStreak})</div></div>
            <div><div className="score">{rec.votes + rec.acts}</div><div className="small muted">votes &amp; acts</div></div>
            <div><div className="score">{wif(rec.burned)}</div><div className="small muted">$WIF burned</div></div>
          </div>
          <hr />
          <p><b>Tier: {tierName(tier)}</b> <span className="muted small">({TIERS.slice(1).join(' → ')})</span></p>
          <p className="small muted">Vote or act at least once each week to extend your streak. It lives on-chain as plain counts — no NFT, nothing to buy or sell.</p>
        </>
      )}
    </div>
    <GaslessPanel />
    </>
  );
}
export { getState };

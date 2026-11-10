import { useEffect, useState } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import { isPrizeRulesConfigured, prizeRulesAbi, type ElectionView } from '@flatland/core';
import { getState, useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { short } from '../lib/format';

type Hit = { position: number; amount: string; tx?: Hex };

/** Celebratory pop-up when PrizeRules emits LuckyHit for the connected wallet. No-op if prizeRules is unset. */
export function LuckyHit({ e }: { e: ElectionView }) {
  const { cfg, dep } = useApp();
  const w = useWallet();
  const addr = (cfg?.prizeRules || (dep as { prizeRules?: string } | null)?.prizeRules) as string | undefined;
  const [hit, setHit] = useState<Hit | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!isPrizeRulesConfigured(addr) || !w.address) { setHit(null); return; }
    const { client } = getState();
    if (!client) return;
    let dead = false;
    const key = `luckyhit:${e.id}:${w.address.toLowerCase()}`;
    const run = async () => {
      try {
        const event = prizeRulesAbi.find((x) => x.type === 'event' && x.name === 'LuckyHit') as Extract<typeof prizeRulesAbi[number], { type: 'event' }>;
        const logs = await client.getLogs({
          address: addr as Address,
          event,
          args: { id: BigInt(e.id) },
          fromBlock: dep?.deployBlock ? BigInt(dep.deployBlock) : undefined,
        });
        const mine = [...logs].reverse().find((l) => (l.args as { voter?: string }).voter?.toLowerCase() === w.address!.toLowerCase());
        if (!mine || dead) return;
        const args = mine.args as { position: bigint; amount: bigint };
        const rec: Hit = { position: Number(args.position), amount: formatUnits(args.amount, 18), tx: mine.transactionHash };
        if (sessionStorage.getItem(key) === 'dismissed') return;
        setHit(rec);
      } catch { /* RPC range limits: stay quiet until PrizeRules is live */ }
    };
    void run();
    const t = setInterval(run, 12_000);
    return () => { dead = true; clearInterval(t); };
  }, [addr, e.id, w.address, dep?.deployBlock]);

  if (!hit || gone) return null;
  const dismiss = () => {
    try { sessionStorage.setItem(`luckyhit:${e.id}:${w.address!.toLowerCase()}`, 'dismissed'); } catch {}
    setGone(true);
  };
  const txUrl = hit.tx && cfg?.explorer ? `${cfg.explorer.replace(/\/$/, '')}/tx/${hit.tx}` : null;
  return (
    <div className="luckyhit" data-testid="lucky-hit" role="dialog" aria-label={`You hit lucky voter #${hit.position}`}>
      <div className="luckyhit-card">
        <div className="sharecard-seal voted" style={{ position: 'relative', margin: '0 auto 12px' }}>★</div>
        <div className="kicker" style={{ color: 'var(--gold)', textAlign: 'center' }}>Lucky voter</div>
        <h2 style={{ textAlign: 'center', margin: '0 0 8px' }}>You hit lucky voter #{hit.position}!</h2>
        <p style={{ textAlign: 'center', fontSize: '1.2rem', margin: '0 0 14px' }}><b>{Number(hit.amount).toLocaleString()} $WIF</b> paid to {w.address ? short(w.address) : 'you'}.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {txUrl ? <a className="btn sm" href={txUrl} target="_blank" rel="noreferrer">View transaction</a> : null}
          <button className="btn ghost sm" onClick={dismiss}>Nice</button>
        </div>
      </div>
    </div>
  );
}

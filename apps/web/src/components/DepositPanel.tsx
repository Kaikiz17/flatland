import { voteLinks, ONE_WIF, type ElectionView } from '@flatland/core';
import { sendToBox } from '../lib/actions';
import { ActionButton, Copy, TxStatus, useTx, letter } from './ui';
import { formatUnits } from 'viem';
import { useApp } from '../lib/store';

/** "Just send 1 WIF": no connection required — any wallet app can pay this address. */
export function DepositPanel({ e, option, canVote }: { e: ElectionView; option: number; canVote: boolean }) {
  const { cfg, dep } = useApp();
  const tx = useTx();
  const cost = BigInt(e.voteCost);
  const box = e.depositAddresses[option];
  const human = formatUnits(cost, 18);
  const links = dep ? voteLinks({ appUrl: location.origin + location.pathname, electionId: e.id, option, deposit: box }) : null;
  if (e.tallier === '0x0000000000000000000000000000000000000000') return <p className="muted">This election has no tallier, so it only accepts connected-wallet votes.</p>;
  return (
    <div>
      <p style={{ marginBottom: 8 }}>No wallet connection needed. From <b>any</b> wallet app (Phantom, Trust, …) send exactly <b>{human} $WIF</b> to option <b>{letter(option)} · {e.options[option]}</b>:</p>
      <div className="card flat" style={{ background: '#fff' }}>
        <div className="addr" style={{ wordBreak: 'break-all' }}>{box}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <Copy text={box} label="Copy address" />
          <Copy text={human} label={`Copy ${human}`} />
          {links ? <a className="btn ghost sm" href={links.eip681}>Open in wallet</a> : null}
          <ActionButton className="btn sm" tx={tx} disabled={!canVote} onRun={(s) => sendToBox(box, cost, s)}>Pay from connected wallet</ActionButton>
        </div>
        <TxStatus tx={tx} />
      </div>
      <ul className="small muted" style={{ paddingLeft: 18, marginBottom: 0 }}>
        <li>The <b>sending wallet</b> is your vote. Send from a wallet you control, <b>not an exchange</b> (a shared exchange address can’t vote as you).</li>
        <li>One vote per wallet. Extra $WIF still burns but counts once; sending to two options keeps your earliest.</li>
        <li>Deposits are swept and <b>burned</b> on-chain, then counted by the indexer’s attested Merkle root (published for anyone to verify, with a challenge window).</li>
        <li>Only the $WIF token is accepted here — {cfg ? <>network <b>{cfg.chainName}</b> (chain {cfg.chainId})</> : null}.</li>
      </ul>
    </div>
  );
}
export { ONE_WIF };

import type { ElectionView } from '@flatland/core';
import { Copy, color, letter } from './ui';
import { useApp } from '../lib/store';
import { useWallet } from '../lib/wallet';
import { appBase } from './ShareComposer';
import { wif } from '../lib/format';

export function voterNumber(e: ElectionView, addr?: string | null): number | undefined {
  if (!addr) return undefined;
  const lc = addr.toLowerCase();
  const i = e.chainVotes.findIndex((v) => v.voter.toLowerCase() === lc);
  if (i >= 0) return i + 1;
  const j = e.depositVotes.findIndex((v) => v.voter.toLowerCase() === lc);
  if (j >= 0) return e.chainVotes.length + j + 1;
  return undefined;
}

/** Shown right after a vote lands: a collectible "I voted" card + Share on X. */
export function VotedCard({ e, opt }: { e: ElectionView; opt: number }) {
  const { cfg } = useApp();
  const w = useWallet();
  const base = appBase(cfg?.appUrl);
  const no = voterNumber(e, w.address);
  const path = `/voted/${e.id}/${opt}${no ? `/${no}` : ''}`;
  const url = `${base}/share${path}`;
  const text = `I voted ${letter(opt)} — ${e.options[opt]} on “${e.title.slice(0, 90)}”${no ? ` · voter #${no}` : ''} 🔥 My vote burned $WIF. 1 wallet = 1 vote. Cast yours:`;
  const burn = wif(e.voteCost, 2);
  return (
    <div className="sharecard votedcard" data-testid="voted-card">
      <div className="sharecard-art" aria-hidden="true">
        <div className="sharecard-sky">
          <div className="sharecard-disc" />
          <div className="sharecard-seal voted">I<br />VOTED</div>
        </div>
        <div className="sharecard-panel">
          <div className="sharecard-kicker"><span>I VOTED</span>{no ? <b>Voter #{no}</b> : null}</div>
          <h3>{e.title}</h3>
          <div className="sharecard-label">My pick</div>
          <div className="sharecard-pick"><span className="chip" style={{ background: color(opt) }}>{letter(opt)}</span> {e.options[opt]}</div>
          <div className="sharecard-burn"><span>$WIF burned</span><b>{burn}</b></div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <a className="btn sm" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Share on X</a>
        <Copy text={url} label="Copy link" />
      </div>
    </div>
  );
}

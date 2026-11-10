/**
 * Per-election public fairness score (0-100). Transparent, reproducible, computed only from public data.
 *
 *  - spread     (25): how un-lopsided the vote is. 1 - HHI-normalised concentration across options that got votes.
 *                      (A landslide is not "unfair", so this component is intentionally the smallest.)
 *  - independence (35): share of raw participating wallets that were NOT collapsed into someone else's vote
 *                      (1 - collapsed/raw). 100% = no detected sybils or all already removed.
 *  - sources    (30): unique funding sources / counted voters. 1 funder behind many voters drags this down.
 *  - openness   (10): both vote paths available + attested root published + no unresolved challenge.
 */
export interface FairnessInput {
  tallies: number[];
  rawVoters: number; // wallets seen voting (before collapse)
  collapsed: number; // wallets collapsed into a group keeper
  counted: number; // counted voters (1 per cluster)
  uniqueSources: number; // distinct funding sources among counted voters
  hasAttestation: boolean;
  openChallenges: number;
  upheldChallenges: number;
}

export interface FairnessScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'n/a';
  parts: { spread: number; independence: number; sources: number; openness: number };
  notes: string[];
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

export function fairnessScore(i: FairnessInput): FairnessScore {
  const total = i.tallies.reduce((a, b) => a + b, 0);
  if (total === 0 && i.rawVoters === 0) {
    return { score: 0, grade: 'n/a', parts: { spread: 0, independence: 0, sources: 0, openness: 0 }, notes: ['no votes yet'] };
  }
  const notes: string[] = [];
  const active = i.tallies.filter((t) => t > 0).length;
  let hhi = 1;
  if (total > 0) hhi = i.tallies.reduce((a, t) => a + (t / total) ** 2, 0);
  const minHhi = active > 0 ? 1 / Math.max(i.tallies.length, 2) : 1;
  const spread = clamp((1 - hhi) / (1 - minHhi || 1));
  const independence = i.rawVoters > 0 ? clamp(1 - i.collapsed / i.rawVoters) : 1;
  const sources = i.counted > 0 ? clamp(i.uniqueSources / i.counted) : 1;
  const openness = clamp(0.4 + (i.hasAttestation ? 0.3 : 0) + (i.openChallenges === 0 ? 0.3 : 0));
  if (i.collapsed > 0) notes.push(`${i.collapsed} wallet(s) collapsed into existing votes`);
  if (sources < 0.6 && i.counted > 4) notes.push('many voters share a funding source');
  if (i.openChallenges > 0) notes.push(`${i.openChallenges} unresolved challenge(s)`);
  if (i.upheldChallenges > 0) notes.push(`${i.upheldChallenges} challenge(s) upheld`);
  const score = Math.round(100 * (0.25 * spread + 0.35 * independence + 0.3 * sources + 0.1 * openness));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';
  return {
    score,
    grade,
    parts: {
      spread: Math.round(spread * 100),
      independence: Math.round(independence * 100),
      sources: Math.round(sources * 100),
      openness: Math.round(openness * 100),
    },
    notes,
  };
}

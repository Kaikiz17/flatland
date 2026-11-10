import { describe, expect, it } from 'vitest';
import { planElection } from '../src/tally.js';
import { staticProvider } from '../src/funding.js';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { ElectionView } from '@flatland/core';

const A = (n: number) => ('0x' + n.toString(16).padStart(40, '0')) as `0x${string}`;
const F1 = A(0xf1), F2 = A(0xf2);

function election(over: Partial<ElectionView> = {}): ElectionView {
  return {
    id: 1, title: 't', options: ['a', 'b', 'c'], start: 0, end: 100, status: 'ended', statusRaw: 1,
    chainVotes: [{ voter: A(1), option: 0, block: 10, logIndex: 0 }, { voter: A(2), option: 2, block: 11, logIndex: 0 }, { voter: A(3), option: 2, block: 12, logIndex: 0 }],
    depositVotes: [{ voter: A(4), option: 1, block: 13, logIndex: 0 }, { voter: A(5), option: 2, block: 14, logIndex: 0 }],
    collapsed: [], challenges: [], chainTally: [1, 0, 2], depositTally: [0, 0, 0], depositCount: 0, depositsSubmitted: false,
    tallier: A(0xaa), depositAddresses: [A(100), A(101), A(102)], ...over,
  } as unknown as ElectionView;
}

describe('planElection (tallier brain)', () => {
  // wallets 2,3,5 share funder F1 → one person; 1 and 4 are independent
  const prov = staticProvider({ [A(1)]: F2, [A(2)]: F1, [A(3)]: F1, [A(4)]: A(0xf4), [A(5)]: F1 });

  it('keeps the earliest wallet of a cluster and collapses the rest, across both vote paths', async () => {
    const p = await planElection(election(), prov);
    expect(p.chainCollapses.map((c) => c.loser)).toEqual([A(3)]);
    expect(p.chainCollapses[0].keeper).toBe(A(2));
    expect(p.entries.map((e) => e.voter)).toEqual([A(4)]); // wallet 5 (deposit) collapsed into 2
    expect(p.counts).toEqual([0, 1, 0]);
    expect(p.analysis.collapsed).toBe(2);
    expect(p.analysis.liveTallies).toEqual([1, 1, 1]); // 1 wallet = 1 vote after the collapse
  });

  it('merkle root is the OpenZeppelin StandardMerkleTree over (index, voter, option) and proofs verify', async () => {
    const p = await planElection(election({ depositVotes: [{ voter: A(4), option: 1, block: 13, logIndex: 0 }, { voter: A(6), option: 0, block: 15, logIndex: 0 }] }), staticProvider({}));
    const tree = StandardMerkleTree.of(p.entries.map((e, i) => [i, e.voter, e.option]), ['uint256', 'address', 'uint8']);
    expect(p.root).toBe(tree.root);
    p.entries.forEach((e, i) => expect(StandardMerkleTree.verify(p.root, ['uint256', 'address', 'uint8'], [i, e.voter, e.option], p.proofs[i])).toBe(true));
  });

  it('is deterministic: same inputs, same root (so resubmits are no-ops)', async () => {
    const a = await planElection(election(), prov);
    const b = await planElection(election(), prov);
    expect(a.root).toBe(b.root);
  });

  it('unknown funding sources never collapse anyone (fail open on missing data)', async () => {
    const p = await planElection(election(), staticProvider({}));
    expect(p.chainCollapses).toHaveLength(0);
    expect(p.counts).toEqual([0, 1, 1]);
  });

  it('audit export publishes groups so anyone can recompute', async () => {
    const p = await planElection(election(), prov);
    expect(p.audit.clusters.length).toBeGreaterThan(0);
    expect(p.audit.depositRoot).toBe(p.root);
  });
});

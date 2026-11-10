import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Chain, type PublicClient, type WalletClient, type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  analyzeElection, flatlandAbi, readSnapshot, type Deployment, type Snapshot, type ElectionView, type FundingProvider, type Analysis,
} from '@flatland/core';
import { planElection, type ElectionPlan } from './tally.js';
import { cached } from './funding.js';

export interface ServiceConfig {
  chain: Chain;
  rpc: string;
  deployment: Deployment;
  dataDir: string;
  publicDataUrl: string; // where groups/audit JSON is served from (later: IPFS)
  funding: FundingProvider;
  tallierKey?: `0x${string}`;
  keeper?: boolean; // finalize/sweep/seed/claimStanding with the same key
  log?: (m: string) => void;
}

export type IndexedSnapshot = Snapshot & { analysis: Record<number, Analysis>; tallier: { address: Address | null; active: boolean } };

export class FlatlandService {
  client: PublicClient;
  wallet?: WalletClient;
  account?: Account;
  fundingCache = new Map<string, any>();
  funding: FundingProvider;
  latest?: IndexedSnapshot;
  plans = new Map<number, ElectionPlan>();
  log: (m: string) => void;

  constructor(public cfg: ServiceConfig) {
    this.client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) }) as PublicClient;
    this.log = cfg.log ?? ((m) => console.log(new Date().toISOString(), m));
    if (cfg.tallierKey) {
      this.account = privateKeyToAccount(cfg.tallierKey);
      this.wallet = createWalletClient({ account: this.account, chain: cfg.chain, transport: http(cfg.rpc) });
    }
    const cachePath = join(cfg.dataDir, 'funding-cache.json');
    if (existsSync(cachePath)) {
      try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(cachePath, 'utf8')))) this.fundingCache.set(k, v); } catch {}
    }
    this.funding = cached(cfg.funding, this.fundingCache);
  }

  private persistCache() {
    mkdirSync(this.cfg.dataDir, { recursive: true });
    writeFileSync(join(this.cfg.dataDir, 'funding-cache.json'), JSON.stringify(Object.fromEntries(this.fundingCache)));
  }

  private async write(args: any) {
    if (!this.wallet) throw new Error('no tallier key configured (read-only mode)');
    const hash = await this.wallet.writeContract({ ...args, chain: this.cfg.chain, account: this.account! });
    const rc = await this.client.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') throw new Error('tx reverted ' + hash);
    return hash;
  }

  /** One full pass: read chain → analyse → (if tallier) attest/collapse/resolve → (if keeper) sweep/finalize/seed/claim. */
  async tick(): Promise<IndexedSnapshot> {
    const dep = this.cfg.deployment;
    const snap = await readSnapshot(this.client, dep, { log: this.log });
    const analysis: Record<number, Analysis> = {};
    for (const e of snap.elections) {
      const plan = await planElection(e, this.funding);
      this.plans.set(e.id, plan);
      analysis[e.id] = plan.analysis;
      this.publish(e, plan);
    }
    this.persistCache();
    const isTallier = !!this.account && this.account.address.toLowerCase() === dep.tallier.toLowerCase();
    this.latest = { ...snap, analysis, tallier: { address: this.account?.address ?? null, active: isTallier } };
    this.publishSnapshot();

    if (this.wallet) {
      for (const e of snap.elections) {
        try {
          if (isTallier && e.tallier.toLowerCase() === this.account!.address.toLowerCase()) await this.tallierDuties(e, this.plans.get(e.id)!);
          if (this.cfg.keeper !== false) await this.keeperDuties(e);
        } catch (err) {
          this.log(`election ${e.id}: ${(err as Error).message.split('\n')[0]}`);
        }
      }
    }
    return this.latest;
  }

  private publish(e: ElectionView, plan: ElectionPlan) {
    const dir = join(this.cfg.dataDir, 'groups');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${e.id}.json`), JSON.stringify(plan.audit, null, 2));
  }

  private publishSnapshot() {
    mkdirSync(this.cfg.dataDir, { recursive: true });
    writeFileSync(join(this.cfg.dataDir, 'snapshot.json'), JSON.stringify(this.latest));
  }

  private async tallierDuties(e: ElectionView, plan: ElectionPlan) {
    const hub = this.cfg.deployment.flatland;
    const now = Math.floor(Date.now() / 1000);
    const nowChain = Number((await this.client.getBlock()).timestamp);
    void now;
    if (e.statusRaw !== 1) return;
    const uri = `${this.cfg.publicDataUrl.replace(/\/$/, '')}/groups/${e.id}.json`;

    // 1. collapse connect-wallet sybils (any time before finalize)
    for (const c of plan.chainCollapses) {
      const voted = await this.client.readContract({ address: hub, abi: flatlandAbi, functionName: 'hasVoted', args: [e.id as any, c.loser] } as any);
      if (!voted) continue;
      await this.write({ address: hub, abi: flatlandAbi, functionName: 'collapse', args: [BigInt(e.id), c.loser, c.keeper, uri] });
      this.log(`election ${e.id}: collapsed ${c.loser} into ${c.keeper}`);
    }

    // 2. answer challenges: upheld iff the funding-source analysis agrees the accused was collapsed
    for (const ch of e.challenges) {
      if (ch.resolved) continue;
      const upheld = !!plan.analysis.collapsedMap[ch.accused.toLowerCase()];
      await this.write({ address: hub, abi: flatlandAbi, functionName: 'resolveChallenge', args: [BigInt(e.id), BigInt(ch.cid), upheld] });
      this.log(`election ${e.id}: challenge ${ch.cid} ${upheld ? 'upheld' : 'rejected'}`);
    }

    // 3. attest deposit-path result once the election ended
    if (nowChain >= e.end) {
      const fresh = (await this.client.readContract({ address: hub, abi: flatlandAbi, functionName: 'getElection', args: [BigInt(e.id)] })) as any;
      const sameRoot = fresh.depositsSubmitted && fresh.depositRoot.toLowerCase() === plan.root.toLowerCase();
      const resubmitsLeft = fresh.depositsSubmitted ? 3 - Number(fresh.resubmits) : 4;
      const nothing = plan.entries.length === 0 && !fresh.depositsSubmitted && e.depositVotes.length === 0 && plan.counts.every((c) => c === 0);
      if (!sameRoot && resubmitsLeft > 0 && !nothing) {
        await this.write({ address: hub, abi: flatlandAbi, functionName: 'submitDeposits', args: [BigInt(e.id), plan.counts, plan.root, uri] });
        this.log(`election ${e.id}: attested ${plan.entries.length} deposit voters, root ${plan.root}`);
      } else if (nothing && !fresh.depositsSubmitted) {
        await this.write({ address: hub, abi: flatlandAbi, functionName: 'submitDeposits', args: [BigInt(e.id), plan.counts, plan.root, uri] });
      }
    }
  }

  private async keeperDuties(e: ElectionView) {
    const hub = this.cfg.deployment.flatland;
    const base = { address: hub, abi: flatlandAbi } as any;
    // sweep (burn) deposit boxes that hold WIF
    for (let o = 0; o < e.options.length; o++) {
      const box = e.depositAddresses[o];
      const bal = (await this.client.readContract({ address: this.cfg.deployment.wif, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [box] })) as bigint;
      if (bal > 0n) {
        await this.write({ ...base, functionName: 'sweepDeposits', args: [BigInt(e.id), o] });
        this.log(`election ${e.id}: swept+burned ${bal} wei WIF from option ${o} box`);
      }
    }
    if (e.statusRaw === 1) {
      const can = await this.client.readContract({ ...base, functionName: 'canFinalize', args: [BigInt(e.id)] });
      if (can) {
        await this.write({ ...base, functionName: 'finalize', args: [BigInt(e.id)] });
        this.log(`election ${e.id}: finalized`);
      }
    } else if (e.statusRaw === 2) {
      if (e.drawBlock > 0 && e.seed === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        try { await this.write({ ...base, functionName: 'seedDraw', args: [BigInt(e.id)] }); this.log(`election ${e.id}: draw seeded`); } catch { /* too early */ }
      }
      if (!e.executed && e.executor !== '0x0000000000000000000000000000000000000000') {
        try { await this.write({ ...base, functionName: 'retryOutcome', args: [BigInt(e.id)] }); this.log(`election ${e.id}: outcome retried`); } catch { /* still failing */ }
      }
      // credit streaks to deposit-path voters
      const plan = this.plans.get(e.id);
      if (plan && e.depositsSubmitted && plan.root.toLowerCase() === e.depositRoot.toLowerCase()) {
        const chainCount = (await this.client.readContract({ ...base, functionName: 'voterCount', args: [BigInt(e.id)] })) as bigint;
        for (let i = 0; i < plan.entries.length; i++) {
          const ent = plan.entries[i];
          const claimed = await this.client.readContract({ ...base, functionName: 'standingClaimed', args: [BigInt(e.id), ent.voter] });
          if (claimed) continue;
          try {
            await this.write({ ...base, functionName: 'claimStanding', args: [BigInt(e.id), chainCount + BigInt(i), ent.voter, ent.option, plan.proofs[i]] });
          } catch { /* already counted via chain path */ }
        }
      }
    }
  }
}

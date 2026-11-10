import { defineChain } from 'viem';
import { robinhood, type Deployment } from '@flatland/core';

export interface AppConfig {
  chainId: number;
  chainName: string;
  rpc: string;
  indexerUrl: string;
  /** where /api/elections/:id/audit lives when there is no full indexer (e.g. the edge worker); defaults to indexerUrl */
  auditUrl?: string;
  deploymentUrl: string;
  explorer: string;
  bundlerUrl?: string;
  dexUrl: string;
  pollMs: number;
  appUrl?: string;
  botName?: string;
  /** featured home slot: the GOAT rematch election id. 0/unset = auto-detect the newest election titled "…GOAT…". */
  goatElectionId?: number;
}

const DEFAULTS: AppConfig = {
  chainId: 4663,
  chainName: 'Robinhood Chain', // technical name required by wallets' add-chain prompt; not used in product copy
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  indexerUrl: '',
  deploymentUrl: './deployment.json',
  explorer: 'https://robinhoodchain.blockscout.com',
  dexUrl: 'https://worldisflat.fun',
  pollMs: 6000,
};

export async function loadConfig(): Promise<{ cfg: AppConfig; dep: Deployment | null }> {
  let cfg = { ...DEFAULTS };
  try {
    const r = await fetch('./config.json', { cache: 'no-store' });
    if (r.ok) cfg = { ...cfg, ...(await r.json()) };
  } catch {}
  // allow ?indexer=... & ?rpc=... overrides for demos
  const q = new URLSearchParams(location.search);
  if (q.get('indexer') != null) cfg.indexerUrl = q.get('indexer')!;
  if (q.get('rpc')) cfg.rpc = q.get('rpc')!;
  let dep: Deployment | null = null;
  try {
    const r = await fetch(cfg.deploymentUrl, { cache: 'no-store' });
    if (r.ok) dep = (await r.json()) as Deployment;
  } catch {}
  return { cfg, dep };
}

export const chainFor = (cfg: AppConfig) =>
  defineChain({ ...robinhood, id: cfg.chainId, name: cfg.chainName, rpcUrls: { default: { http: [cfg.rpc] } }, blockExplorers: { default: { name: 'Explorer', url: cfg.explorer } } });

import { useSyncExternalStore } from 'react';
import { createPublicClient, http, type PublicClient } from 'viem';
import { analyzeElection, readSnapshot, type Analysis, type Deployment, type ElectionView, type Snapshot } from '@flatland/core';
import { chainFor, loadConfig, type AppConfig } from './config';

export type FullSnapshot = Snapshot & { analysis?: Record<number, Analysis>; tallier?: { address: string | null; active: boolean } };

export interface FeedItem { key: string; electionId: number; voter: string; option: number; path: 'wallet' | 'deposit'; ts: number; isNew: boolean }
export interface AppState {
  ready: boolean;
  cfg: AppConfig | null;
  dep: Deployment | null;
  client: PublicClient | null;
  snap: FullSnapshot | null;
  mode: 'indexer' | 'direct';
  error: string | null;
  updatedAt: number;
  /** keys of votes first seen after the page loaded (live room pulses) */
  fresh: Record<string, number>;
}

let state: AppState = { ready: false, cfg: null, dep: null, client: null, snap: null, mode: 'direct', error: null, updatedAt: 0, fresh: {} };
const subs = new Set<() => void>();
const set = (p: Partial<AppState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const getState = () => state;
export const useApp = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);

const seen = new Set<string>();
let firstLoad = true;
let busy = false;

export async function refresh() {
  const { cfg, dep, client } = state;
  if (!cfg || !dep || !client || busy) return;
  busy = true;
  try {
    let snap: FullSnapshot;
    let mode: AppState['mode'] = 'direct';
    if (cfg.indexerUrl) {
      try {
        const r = await fetch(cfg.indexerUrl.replace(/\/$/, '') + '/snapshot.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('indexer ' + r.status);
        snap = await r.json();
        mode = 'indexer';
      } catch {
        snap = await readSnapshot(client, dep); // graceful fallback: the chain is the source of truth
      }
    } else snap = await readSnapshot(client, dep);
    const fresh = { ...state.fresh };
    const now = Date.now();
    for (const e of snap.elections) {
      for (const v of e.chainVotes) { const k = `${e.id}:c:${v.tx}:${v.logIndex}`; if (!seen.has(k)) { seen.add(k); if (!firstLoad) fresh[k] = now; } }
      for (const v of e.depositVotes) { const k = `${e.id}:d:${v.tx}:${v.logIndex}`; if (!seen.has(k)) { seen.add(k); if (!firstLoad) fresh[k] = now; } }
    }
    for (const k of Object.keys(fresh)) if (now - fresh[k] > 20_000) delete fresh[k];
    firstLoad = false;
    set({ snap, mode, error: null, updatedAt: now, fresh });
  } catch (e) {
    set({ error: (e as Error).message.split('\n')[0] });
  } finally {
    busy = false;
  }
}

export async function boot() {
  const { cfg, dep } = await loadConfig();
  const client = createPublicClient({ chain: chainFor(cfg), transport: http(cfg.rpc), batch: { multicall: true } }) as PublicClient;
  set({ cfg, dep, client, ready: true });
  if (!dep) return;
  await refresh();
  setInterval(refresh, cfg.pollMs);
  // live rooms: SSE pulse from the indexer triggers an immediate refresh (polling remains the fallback)
  if (cfg.indexerUrl && typeof EventSource !== 'undefined') {
    try {
      const es = new EventSource(cfg.indexerUrl.replace(/\/$/, '') + '/stream');
      es.addEventListener('snapshot', () => void refresh());
    } catch {}
  }
}

export const analysisFor = (s: FullSnapshot, e: ElectionView): Analysis => s.analysis?.[e.id] ?? analyzeElection(e);

export function feedFor(s: FullSnapshot, e: ElectionView, fresh: Record<string, number>): FeedItem[] {
  const items: FeedItem[] = [];
  for (const v of e.chainVotes) { const key = `${e.id}:c:${v.tx}:${v.logIndex}`; items.push({ key, electionId: e.id, voter: v.voter, option: v.option, path: 'wallet', ts: v.ts, isNew: !!fresh[key] }); }
  for (const v of e.depositVotes) { const key = `${e.id}:d:${v.tx}:${v.logIndex}`; items.push({ key, electionId: e.id, voter: v.voter, option: v.option, path: 'deposit', ts: v.ts, isNew: !!fresh[key] }); }
  return items.sort((a, b) => b.ts - a.ts);
}

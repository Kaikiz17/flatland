import { useSyncExternalStore } from 'react';
import { createWalletClient, custom, numberToHex, type Address, type WalletClient } from 'viem';
import { chainFor, type AppConfig } from './config';

export interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<any>; on?(e: string, f: (...a: any[]) => void): void; removeListener?(e: string, f: (...a: any[]) => void): void }
export interface Injected { uuid: string; name: string; icon: string; rdns: string; provider: Eip1193 }

interface WState { injected: Injected[]; active: Injected | null; address: Address | null; chainId: number | null; connecting: boolean; error: string | null }
let w: WState = { injected: [], active: null, address: null, chainId: null, connecting: false, error: null };
const subs = new Set<() => void>();
const set = (p: Partial<WState>) => { w = { ...w, ...p }; subs.forEach((f) => f()); };
export const useWallet = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => w);
export const getWallet = () => w;

let inited = false;
export function initWallets(cfg: AppConfig) {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  window.addEventListener('eip6963:announceProvider', ((e: CustomEvent) => {
    const d = e.detail as { info: Omit<Injected, 'provider'>; provider: Eip1193 };
    if (w.injected.some((i) => i.uuid === d.info.uuid)) return;
    set({ injected: [...w.injected, { ...d.info, provider: d.provider }] });
    if (localStorage.getItem('flatland:wallet') === d.info.rdns && !w.active) void silentReconnect(d.info.uuid, cfg);
  }) as EventListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  // legacy single-provider fallback
  setTimeout(() => {
    const eth = (window as any).ethereum as Eip1193 | undefined;
    if (eth && w.injected.length === 0) set({ injected: [{ uuid: 'legacy', name: 'Browser wallet', icon: '', rdns: 'legacy', provider: eth }] });
  }, 400);
}

function bind(i: Injected) {
  i.provider.on?.('accountsChanged', (a: string[]) => set({ address: (a[0] as Address) ?? null }));
  i.provider.on?.('chainChanged', (c: string) => set({ chainId: Number(c) }));
}

async function silentReconnect(uuid: string, _cfg: AppConfig) {
  const i = w.injected.find((x) => x.uuid === uuid);
  if (!i) return;
  try {
    const accts: string[] = await i.provider.request({ method: 'eth_accounts' });
    if (accts[0]) {
      const chainId = Number(await i.provider.request({ method: 'eth_chainId' }));
      set({ active: i, address: accts[0] as Address, chainId });
      bind(i);
    }
  } catch {}
}

export async function connect(i: Injected) {
  set({ connecting: true, error: null });
  try {
    const accts: string[] = await i.provider.request({ method: 'eth_requestAccounts' });
    const chainId = Number(await i.provider.request({ method: 'eth_chainId' }));
    set({ active: i, address: accts[0] as Address, chainId, connecting: false });
    localStorage.setItem('flatland:wallet', i.rdns);
    bind(i);
  } catch (e) {
    set({ connecting: false, error: (e as Error).message.split('\n')[0] });
  }
}
export function disconnect() { localStorage.removeItem('flatland:wallet'); set({ active: null, address: null, chainId: null }); }

export async function ensureChain(cfg: AppConfig) {
  const i = w.active;
  if (!i) throw new Error('Connect a wallet first');
  const hex = numberToHex(cfg.chainId);
  if (w.chainId === cfg.chainId) return;
  try {
    await i.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e: any) {
    if (e?.code === 4902 || /unrecognized|not added|Unrecognized/i.test(e?.message ?? '')) {
      await i.provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, chainName: cfg.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: [cfg.explorer] }],
      });
    } else throw e;
  }
  set({ chainId: Number(await i.provider.request({ method: 'eth_chainId' })) });
}

export function walletClient(cfg: AppConfig): WalletClient {
  const i = w.active;
  if (!i || !w.address) throw new Error('Connect a wallet first');
  return createWalletClient({ account: w.address, chain: chainFor(cfg), transport: custom(i.provider) });
}

/** Deep links for mobile browsers with no injected wallet: open this page inside the wallet's in-app browser. */
export function mobileLinks(url = location.href) {
  const enc = encodeURIComponent(url);
  const noProto = url.replace(/^https?:\/\//, '');
  return [
    { name: 'Phantom', href: `https://phantom.app/ul/browse/${enc}?ref=${encodeURIComponent(location.origin)}` },
    { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${enc}` },
    { name: 'MetaMask', href: `https://metamask.app.link/dapp/${noProto}` },
  ];
}

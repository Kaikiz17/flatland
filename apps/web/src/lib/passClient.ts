import type { AppConfig } from './config';
import { getWallet, walletClient } from './wallet';

export async function provePass(cfg: AppConfig, purpose: string): Promise<{ message: string; signature: string; qs: string }> {
  const addr = getWallet().address;
  if (!addr) throw new Error('Connect a wallet first');
  const r = await fetch(`/api/pass/challenge?address=${addr}&purpose=${encodeURIComponent(purpose)}`);
  const j = await r.json() as { error?: string; message?: string };
  if (!r.ok || !j.message) throw new Error(j.error ?? 'Could not start the pass proof');
  const signature = await walletClient(cfg).signMessage({ message: j.message, account: addr });
  const qs = `message=${encodeURIComponent(j.message)}&signature=${encodeURIComponent(signature)}`;
  return { message: j.message, signature, qs };
}

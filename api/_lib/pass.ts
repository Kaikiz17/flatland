/** Verifiable Flatland pass IDs: HMAC-SHA256(PASS_SECRET, chainId|contract|scope|wallet|txHash). Never log the secret. */
export const PASS_RE = /^FLAT-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

const enc = new TextEncoder();

async function hmac(secret: string, material: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(material)));
}

const hex = (u: Uint8Array, n?: number) => [...u.slice(0, n ?? u.length)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function passMaterial(chainId: number, contract: string, scope: string, wallet: string, txHash: string): string {
  return `${chainId}|${contract.toLowerCase()}|${scope}|${wallet.toLowerCase()}|${txHash.toLowerCase()}`;
}

export function formatPassId(bytes: Uint8Array): string {
  const h = hex(bytes, 6).toUpperCase();
  return `FLAT-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}

export async function makePassId(secret: string, chainId: number, contract: string, scope: string, wallet: string, txHash: string): Promise<string> {
  return formatPassId(await hmac(secret, passMaterial(chainId, contract, scope, wallet, txHash)));
}

export function challengeMessage(address: string, purpose: string, issued: number, nonce: string): string {
  return `Flatland pass proof\nAddress: ${address}\nPurpose: ${purpose}\nIssued: ${issued}\nNonce: ${nonce}`;
}

export async function issueChallenge(secret: string, address: string, purpose: string, now = Math.floor(Date.now() / 1000)): Promise<{ message: string; issued: number }> {
  const issued = now;
  const nonce = hex(await hmac(secret, `challenge|${purpose}|${address.toLowerCase()}|${issued}`), 16);
  return { message: challengeMessage(address, purpose, issued, nonce), issued };
}

export async function checkChallenge(secret: string, message: string, maxAge = 600): Promise<{ address: string; purpose: string } | null> {
  const m = /^Flatland pass proof\nAddress: (0x[0-9a-fA-F]{40})\nPurpose: ([a-z0-9:.-]+)\nIssued: (\d+)\nNonce: ([0-9a-f]{32})$/.exec(message);
  if (!m) return null;
  const address = m[1], purpose = m[2], issued = Number(m[3]), nonce = m[4];
  const now = Math.floor(Date.now() / 1000);
  if (issued > now + 30 || now - issued > maxAge) return null;
  const expect = hex(await hmac(secret, `challenge|${purpose}|${address.toLowerCase()}|${issued}`), 16);
  if (expect !== nonce) return null;
  return { address, purpose };
}

export const shortTx = (h: string) => (h && h.length >= 12 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h ?? '');

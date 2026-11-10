// Option images, no contract change: images live in the worker's KV (content-addressed), the election's `metaURI` points at a small
// JSON blob (/m/<hash>) holding {options index -> image hash} (+ the user's optional details link).
import { useEffect, useSyncExternalStore } from 'react';
import { stripMetadata } from './strip';

export interface Media { images: Record<string, string>; details?: string }
export const MAX_BYTES = 80 * 1024;
export const IMG_PX = 512;

const metaHash = (uri: string) => /\/m\/([0-9a-f]{64})$/.exec(uri ?? '')?.[1] ?? null;
const cache = new Map<string, Media | null>();
const pending = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const bump = () => { version++; subs.forEach((f) => f()); };

/** Fetch (once) the blobs for these elections. Always same-origin: only the hash is taken from the on-chain URI. */
export function prefetchMedia(uris: string[]) {
  for (const u of uris) {
    const h = metaHash(u);
    if (!h || cache.has(h) || pending.has(h)) continue;
    pending.add(h);
    fetch(`/m/${h}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      cache.set(h, j && j.v === 1 && j.images ? { images: j.images, details: j.details } : null);
    }).catch(() => cache.set(h, null)).finally(() => { pending.delete(h); bump(); });
  }
}

export const mediaOf = (uri: string): Media | null => { const h = metaHash(uri); return h ? cache.get(h) ?? null : null; };
export const imgUrl = (m: Media | null, i: number): string | null => (m?.images?.[i] ? `/img/${m.images[i]}` : null);

/** Subscribe to cache updates; call with the election's metaURI. */
export function useMedia(uri: string): Media | null {
  useEffect(() => { prefetchMedia([uri]); }, [uri]);
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  return mediaOf(uri);
}

/** Center-crop to a square, scale down to <=512px, flatten on white, re-encode to WebP (or JPEG). Re-encoding through a canvas drops ALL
 *  metadata (EXIF/GPS/XMP/ICC/comments/C2PA); the server additionally rejects any image that still carries some. */
export async function processImage(file: File): Promise<{ blob: Blob; url: string; type: string }> {
  if (!/^image\//.test(file.type)) throw new Error('Pick an image file.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is too large (max 25 MB).');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any).catch(() => { throw new Error('Could not read that image.'); });
  const side = Math.min(bmp.width, bmp.height);
  let px = Math.min(IMG_PX, side);
  const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  const enc = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));
  for (let attempt = 0; attempt < 8; attempt++) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, px, px);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, sx, sy, side, side, 0, 0, px, px);
    const probe = await enc(c, 'image/webp', 0.8);
    const type = probe && probe.type === 'image/webp' ? 'image/webp' : 'image/jpeg'; // old Safari silently falls back to PNG
    for (const q of [0.86, 0.78, 0.7, 0.6, 0.5, 0.4, 0.3]) {
      const b = await enc(c, type, q);
      if (b && b.type === type) {
        const clean = new Blob([stripMetadata(new Uint8Array(await b.arrayBuffer())) as BlobPart], { type });
        if (clean.size <= MAX_BYTES) { bmp.close?.(); return { blob: clean, url: URL.createObjectURL(clean), type }; }
      }
    }
    px = Math.max(96, Math.floor(px * 0.8));
  }
  bmp.close?.();
  throw new Error('Could not shrink that image under 80 KB — try a simpler picture.');
}

async function j(r: Response) {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `upload failed (${r.status})`);
  return body;
}
export const uploadImage = async (blob: Blob): Promise<string> => (await j(await fetch('/api/img', { method: 'POST', headers: { 'content-type': blob.type }, body: blob }))).hash;
export const uploadMeta = async (images: Record<number, string>, details?: string): Promise<string> =>
  (await j(await fetch('/api/meta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ images, details: details || undefined }) }))).url;

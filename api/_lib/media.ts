/**
 * Optional option images for elections, with NO contract change.
 *   POST /api/img   raw WebP/JPEG bytes (browser already downscaled to <=512px, <=80KB) -> stored in KV under sha256 (immutable, deduped)
 *   GET  /img/<h>   the bytes, with long immutable cache headers
 *   POST /api/meta  {images:{"<optionIndex>":"<imgHash>"}, details?:"<url>"} -> canonical JSON stored under its sha256
 *   GET  /m/<h>     the JSON blob; the election's on-chain `metaURI` is `<origin>/m/<h>`
 * Safety: the server REJECTS (never trusts) anything carrying metadata: it parses JPEG segments / WebP RIFF chunks and only accepts
 * pixel-data chunks (no EXIF, XMP, ICC, comments, C2PA/JUMBF, animation, trailing bytes).
 * Free-plan KV budget (1,000 writes/day): only NEW objects cost writes; a global daily cap and a per-IP daily cap bound them.
 */
export interface KVLike {
  get(key: string, opts?: any): Promise<any>;
  put(key: string, value: any, opts?: any): Promise<void>;
}

export const MAX_IMG_BYTES = 80 * 1024;
export const MAX_DIM = 512;
export const MIN_DIM = 16;
export const DAILY_GLOBAL_CAP = 150; // new objects per UTC day, whole app
export const DAILY_IP_CAP = 12; // new objects per UTC day per client
const HASH = /^[0-9a-f]{64}$/;
export const isHash = (s: string) => HASH.test(s);

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const sha256 = async (b: BufferSource | string) => hex(await crypto.subtle.digest('SHA-256', typeof b === 'string' ? new TextEncoder().encode(b) : b));

export type ImgKind = 'jpeg' | 'webp';
export interface Checked { kind: ImgKind; width: number; height: number }

/** Accepts only pixel data. Throws a short reason otherwise. */
export function checkImage(u: Uint8Array): Checked {
  if (u.length < 32) throw new Error('image too small');
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return checkJpeg(u);
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return checkWebp(u);
  throw new Error('only WebP or JPEG images are accepted');
}

function checkJpeg(u: Uint8Array): Checked {
  let i = 2, w = 0, h = 0, sos = 0;
  const L = u.length;
  while (i < L) {
    if (u[i] !== 0xff) throw new Error('bad JPEG structure');
    while (u[i] === 0xff) i++; // fill bytes
    const m = u[i++];
    if (m === 0xd9) { // EOI
      if (i !== L) throw new Error('trailing data after JPEG');
      if (!w || !h || !sos) throw new Error('bad JPEG');
      if (w > MAX_DIM || h > MAX_DIM || w < MIN_DIM || h < MIN_DIM) throw new Error(`image must be ${MIN_DIM}-${MAX_DIM}px`);
      return { kind: 'jpeg', width: w, height: h };
    }
    if (m >= 0xd0 && m <= 0xd8) continue; // standalone markers
    if (i + 2 > L) throw new Error('truncated JPEG');
    const len = (u[i] << 8) | u[i + 1];
    if (len < 2 || i + len > L) throw new Error('truncated JPEG');
    const seg = i + 2;
    if (m === 0xe0) { // JFIF only, no thumbnail payload
      if (!(len >= 16 && len <= 18 && u[seg] === 0x4a && u[seg + 1] === 0x46 && u[seg + 2] === 0x49 && u[seg + 3] === 0x46 && u[seg + 4] === 0)) throw new Error('JPEG metadata segment rejected');
    } else if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      h = (u[seg + 1] << 8) | u[seg + 2]; w = (u[seg + 3] << 8) | u[seg + 4];
    } else if (m === 0xdb || m === 0xc4 || m === 0xdd) { /* tables */ }
    else if (m === 0xda) { // SOS: skip the entropy-coded data up to the next real marker
      sos++;
      i += len;
      while (i < L) {
        if (u[i] === 0xff && u[i + 1] !== 0 && !(u[i + 1] >= 0xd0 && u[i + 1] <= 0xd7) && u[i + 1] !== 0xff) break;
        i++;
      }
      continue;
    } else throw new Error('JPEG metadata/unsupported segment rejected');
    i += len;
  }
  throw new Error('truncated JPEG');
}

function checkWebp(u: Uint8Array): Checked {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (dv.getUint32(4, true) + 8 !== u.length) throw new Error('bad WebP size / trailing data');
  let i = 12, w = 0, h = 0, pixels = 0;
  const tag = (o: number) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
  while (i + 8 <= u.length) {
    const t = tag(i), n = dv.getUint32(i + 4, true), d = i + 8;
    if (d + n > u.length) throw new Error('truncated WebP');
    if (t === 'VP8X') {
      if (u[d] & (0x20 | 0x08 | 0x04 | 0x02)) throw new Error('WebP with ICC/EXIF/XMP/animation rejected');
      w = 1 + (u[d + 4] | (u[d + 5] << 8) | (u[d + 6] << 16)); h = 1 + (u[d + 7] | (u[d + 8] << 8) | (u[d + 9] << 16));
    } else if (t === 'VP8 ') {
      if (!(u[d + 3] === 0x9d && u[d + 4] === 0x01 && u[d + 5] === 0x2a)) throw new Error('bad WebP');
      w = dv.getUint16(d + 6, true) & 0x3fff; h = dv.getUint16(d + 8, true) & 0x3fff; pixels++;
    } else if (t === 'VP8L') {
      if (u[d] !== 0x2f) throw new Error('bad WebP');
      const b = dv.getUint32(d + 1, true); w = (b & 0x3fff) + 1; h = ((b >>> 14) & 0x3fff) + 1; pixels++;
    } else if (t === 'ALPH') { /* alpha plane belongs to pixel data */ }
    else throw new Error('WebP metadata chunk rejected');
    i = d + n + (n & 1);
  }
  if (i !== u.length || pixels !== 1 || !w || !h) throw new Error('bad WebP');
  if (w > MAX_DIM || h > MAX_DIM || w < MIN_DIM || h < MIN_DIM) throw new Error(`image must be ${MIN_DIM}-${MAX_DIM}px`);
  return { kind: 'webp', width: w, height: h };
}

export const imgType = (kind: ImgKind) => (kind === 'webp' ? 'image/webp' : 'image/jpeg');

// ───────────────────────────── routes ─────────────────────────────
const J = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

const day = () => new Date().toISOString().slice(0, 10);
const burst = new Map<string, number[]>(); // per-isolate, free: rejects floods before any KV work
function burstLimited(ip: string, max = 20, ms = 60_000) {
  const now = Date.now();
  const arr = (burst.get(ip) ?? []).filter((t) => now - t < ms);
  if (burst.size > 500) burst.clear();
  arr.push(now); burst.set(ip, arr);
  return arr.length > max;
}

/** Reserve one new-object slot (global + per-IP daily caps). KV writes: 2 per new object, only when something is actually stored. */
async function reserve(kv: KVLike, ip: string): Promise<string | null> {
  const d = day();
  const gk = `q:g:${d}`, ik = `q:i:${d}:${(await sha256(ip)).slice(0, 16)}`;
  const [g, i] = await Promise.all([kv.get(gk), kv.get(ik)]);
  if (Number(g ?? 0) >= DAILY_GLOBAL_CAP) return 'Daily upload budget reached for the whole app. Try again tomorrow (UTC).';
  if (Number(i ?? 0) >= DAILY_IP_CAP) return 'Daily upload limit reached for your connection. Try again tomorrow (UTC).';
  await Promise.all([kv.put(gk, String(Number(g ?? 0) + 1), { expirationTtl: 2 * 86400 }), kv.put(ik, String(Number(i ?? 0) + 1), { expirationTtl: 2 * 86400 })]);
  return null;
}

const TTL = 400 * 86400;

export async function handleMedia(req: Request, kv: KVLike, p: string): Promise<Response | null> {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

  if (p === '/api/img' && req.method === 'POST') {
    if (burstLimited(ip)) return J({ error: 'slow down' }, 429);
    const ct = (req.headers.get('content-type') ?? '').split(';')[0].trim();
    if (ct !== 'image/webp' && ct !== 'image/jpeg') return J({ error: 'send image/webp or image/jpeg' }, 415);
    const cl = Number(req.headers.get('content-length') ?? 0);
    if (cl > MAX_IMG_BYTES + 512) return J({ error: `max ${MAX_IMG_BYTES / 1024} KB` }, 413);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length > MAX_IMG_BYTES) return J({ error: `max ${MAX_IMG_BYTES / 1024} KB` }, 413);
    let info: Checked;
    try { info = checkImage(buf); } catch (e) { return J({ error: (e as Error).message }, 422); }
    if (imgType(info.kind) !== ct) return J({ error: 'content-type does not match the image' }, 415);
    const hash = await sha256(buf);
    const key = `img:${hash}`;
    const have = await kv.get(key, { type: 'arrayBuffer' });
    if (have) return J({ hash, url: `/img/${hash}`, bytes: buf.length, width: info.width, height: info.height, duplicate: true });
    const why = await reserve(kv, ip);
    if (why) return J({ error: why }, 429);
    try { await kv.put(key, buf, { expirationTtl: TTL }); } catch (e) { return J({ error: 'storage budget reached, try again later' }, 503); }
    return J({ hash, url: `/img/${hash}`, bytes: buf.length, width: info.width, height: info.height, duplicate: false }, 201);
  }

  let m = /^\/img\/([0-9a-f]{64})$/.exec(p);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    const etag = `"${m[1]}"`;
    const headers: Record<string, string> = { 'cache-control': 'public, max-age=31536000, immutable', etag, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' };
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    const b: ArrayBuffer | null = await kv.get(`img:${m[1]}`, { type: 'arrayBuffer', cacheTtl: 3600 });
    if (!b) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });
    const u = new Uint8Array(b);
    headers['content-type'] = u[0] === 0xff ? 'image/jpeg' : 'image/webp';
    return new Response(req.method === 'HEAD' ? null : b, { headers });
  }

  if (p === '/api/meta' && req.method === 'POST') {
    if (burstLimited(ip)) return J({ error: 'slow down' }, 429);
    const raw = await req.text();
    if (raw.length > 4096) return J({ error: 'too large' }, 413);
    let b: any;
    try { b = JSON.parse(raw); } catch { return J({ error: 'bad json' }, 400); }
    const images: Record<string, string> = {};
    const src = b?.images && typeof b.images === 'object' ? b.images : {};
    for (const k of Object.keys(src).sort((a, c) => Number(a) - Number(c))) {
      if (!/^\d{1,2}$/.test(k) || Number(k) > 31 || typeof src[k] !== 'string' || !isHash(src[k])) return J({ error: 'bad images map' }, 400);
      images[k] = src[k];
    }
    const hs = [...new Set(Object.values(images))];
    if (!hs.length) return J({ error: 'no images' }, 400);
    const present = await Promise.all(hs.map((h) => kv.get(`img:${h}`, { type: 'arrayBuffer' }).then((x) => !!x)));
    if (present.some((x) => !x)) return J({ error: 'an image has not been uploaded' }, 400);
    let details = '';
    if (typeof b.details === 'string' && b.details.trim()) {
      details = b.details.trim();
      if (details.length > 300 || !/^(https?:\/\/|ipfs:\/\/)/i.test(details)) return J({ error: 'details must be an https:// or ipfs:// link' }, 400);
    }
    const canon = JSON.stringify(details ? { v: 1, images, details } : { v: 1, images });
    const hash = await sha256(canon);
    const have = await kv.get(`meta:${hash}`);
    const origin = new URL(req.url).origin;
    if (have) return J({ hash, url: `${origin}/m/${hash}`, duplicate: true });
    const why = await reserve(kv, ip);
    if (why) return J({ error: why }, 429);
    try { await kv.put(`meta:${hash}`, canon, { expirationTtl: TTL }); } catch { return J({ error: 'storage budget reached, try again later' }, 503); }
    return J({ hash, url: `${origin}/m/${hash}`, duplicate: false }, 201);
  }

  m = /^\/m\/([0-9a-f]{64})$/.exec(p);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    const body: string | null = await kv.get(`meta:${m[1]}`, { cacheTtl: 3600 });
    if (!body) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } });
    return new Response(req.method === 'HEAD' ? null : body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
  }
  return null;
}

// ───────────────────────────── server-side lookup (API / share cards) ─────────────────────────────
export interface Media { images: Record<string, string>; details?: string }
const memo = new Map<string, Media | null>();
export const metaHashOf = (metaURI: string) => /\/m\/([0-9a-f]{64})$/.exec(metaURI)?.[1] ?? null;
export async function loadMedia(kv: KVLike | undefined, metaURI: string): Promise<Media | null> {
  const h = metaHashOf(metaURI ?? '');
  if (!h || !kv) return null;
  if (memo.has(h)) return memo.get(h)!;
  let v: Media | null = null;
  try {
    const s = await kv.get(`meta:${h}`, { cacheTtl: 3600 });
    const j = s ? JSON.parse(s) : null;
    if (j?.v === 1 && j.images) v = { images: j.images, details: j.details };
  } catch {}
  if (v && memo.size < 200) memo.set(h, v);
  return v;
}

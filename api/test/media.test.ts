import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleMedia, checkImage, loadMedia, DAILY_IP_CAP, sha256 } from '../_lib/media.ts';

const fx = (n: string) => new Uint8Array(readFileSync(new URL('./fixtures/' + n, import.meta.url)));
const kvMem = () => { const m = new Map<string, any>(); return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: any) => { m.set(k, v); } }; };
const post = (kv: any, path: string, body: any, ct: string, ip = '1.1.1.1') => handleMedia(new Request('https://x.test' + path, { method: 'POST', headers: { 'content-type': ct, 'cf-connecting-ip': ip }, body }), kv, path) as Promise<Response>;

describe('image validation (metadata is rejected, never stored)', () => {
  it('accepts clean WebP and JPEG', () => {
    expect(checkImage(fx('clean.webp'))).toMatchObject({ kind: 'webp', width: 128, height: 128 });
    expect(checkImage(fx('clean.jpg'))).toMatchObject({ kind: 'jpeg', width: 128, height: 128 });
  });
  it('rejects EXIF / comment / ICC / XMP / oversized / junk', () => {
    expect(() => checkImage(fx('exif.jpg'))).toThrow(/metadata/);
    expect(() => checkImage(fx('comment.jpg'))).toThrow(/metadata/);
    expect(() => checkImage(fx('icc.webp'))).toThrow(/ICC|metadata/);
    expect(() => checkImage(fx('xmp.webp'))).toThrow(/XMP|metadata/);
    expect(() => checkImage(fx('big.webp'))).toThrow(/px/);
    expect(() => checkImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'.padEnd(64, ' ')))).toThrow(/WebP or JPEG/);
    const withTrail = new Uint8Array([...fx('clean.jpg'), 1, 2, 3]);
    expect(() => checkImage(withTrail)).toThrow();
  });
});

describe('media routes', () => {
  it('upload -> dedupe -> serve with immutable cache; meta blob links images', async () => {
    const kv = kvMem();
    const r1 = await post(kv, '/api/img', fx('clean.webp'), 'image/webp');
    expect(r1.status).toBe(201);
    const { hash } = (await r1.json()) as any;
    expect(hash).toBe(await sha256(fx('clean.webp')));
    const writes = kv.m.size;
    const r2 = await post(kv, '/api/img', fx('clean.webp'), 'image/webp');
    expect(((await r2.json()) as any).duplicate).toBe(true);
    expect(kv.m.size).toBe(writes); // no new KV writes for a duplicate
    const g = (await handleMedia(new Request('https://x.test/img/' + hash), kv, '/img/' + hash)) as Response;
    expect(g.headers.get('content-type')).toBe('image/webp');
    expect(g.headers.get('cache-control')).toContain('immutable');
    expect(g.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await g.arrayBuffer()).length).toBe(fx('clean.webp').length);
    expect(((await handleMedia(new Request('https://x.test/img/' + '0'.repeat(64)), kv, '/img/' + '0'.repeat(64))) as Response).status).toBe(404);

    const m = await post(kv, '/api/meta', JSON.stringify({ images: { 1: hash, 0: hash }, details: 'https://example.com/x' }), 'application/json');
    expect(m.status).toBe(201);
    const { url } = (await m.json()) as any;
    expect(url).toMatch(/^https:\/\/x\.test\/m\/[0-9a-f]{64}$/);
    const med = await loadMedia(kv, url);
    expect(med).toEqual({ images: { '0': hash, '1': hash }, details: 'https://example.com/x' });
    const bad = await post(kv, '/api/meta', JSON.stringify({ images: { 0: 'f'.repeat(64) } }), 'application/json');
    expect(bad.status).toBe(400); // image not uploaded
    expect((await post(kv, '/api/meta', JSON.stringify({ images: { 0: hash }, details: 'javascript:alert(1)' }), 'application/json')).status).toBe(400);
  });
  it('rejects wrong type, metadata, oversize and enforces the per-IP daily cap', async () => {
    const kv = kvMem();
    expect((await post(kv, '/api/img', fx('clean.webp'), 'image/png')).status).toBe(415);
    expect((await post(kv, '/api/img', fx('exif.jpg'), 'image/jpeg')).status).toBe(422);
    expect((await post(kv, '/api/img', new Uint8Array(90_000), 'image/webp')).status).toBe(413);
    let last = 0;
    for (let i = 0; i <= DAILY_IP_CAP; i++) {
      const u = fx('clean.webp').slice(); // vary pixel-irrelevant trailing padding inside RIFF? use distinct jpeg instead
      const jpg = fx('clean.jpg').slice();
      jpg[jpg.length - 10] ^= i; // different bytes -> different hash (still structurally valid)
      last = (await post(kv, '/api/img', jpg, 'image/jpeg', '9.9.9.9')).status;
      void u;
    }
    expect(last).toBe(429);
    expect((await post(kv, '/api/img', fx('clean.webp'), 'image/webp', '8.8.8.8')).status).toBe(201); // another IP still works
  });
});

import { stripMetadata } from '../../apps/web/src/lib/strip.ts';
describe('client stripper', () => {
  it('turns a browser-style WebP (VP8X+ICCP) / JPEG (APP2 ICC) into a server-acceptable file', () => {
    const icc = fx('icc.webp'); // PIL writes VP8X + ICCP
    expect(() => checkImage(icc)).toThrow();
    const s = stripMetadata(icc);
    expect(checkImage(s)).toMatchObject({ kind: 'webp', width: 128 });
    expect(new TextDecoder('latin1').decode(s)).not.toContain('ICCP');
    const x = stripMetadata(fx('xmp.webp')); expect(checkImage(x).kind).toBe('webp');
    for (const f of ['exif.jpg', 'comment.jpg']) { const j = stripMetadata(fx(f)); expect(checkImage(j).kind).toBe('jpeg'); expect(new TextDecoder('latin1').decode(j)).not.toMatch(/Exif|secret/); }
    expect(checkImage(stripMetadata(fx('clean.jpg'))).kind).toBe('jpeg');
  });
});

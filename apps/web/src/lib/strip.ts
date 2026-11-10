// Remove everything that is not pixel data from a freshly canvas-encoded image. Browsers add an sRGB ICC profile (WebP ICCP chunk /
// JPEG APP2) even though canvas re-encoding already drops EXIF/XMP/GPS/comments; the standing rule is "strip ALL metadata", so we also
// drop the profile. The server independently rejects any image that still carries a metadata chunk (api/_lib/media.ts).
export function stripMetadata(u: Uint8Array): Uint8Array {
  if (u[0] === 0xff && u[1] === 0xd8) return stripJpeg(u);
  if (u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57) return stripWebp(u);
  throw new Error('unsupported image type');
}

function stripJpeg(u: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < u.length) {
    if (u[i] !== 0xff) throw new Error('bad JPEG');
    while (u[i] === 0xff) i++;
    const m = u[i++];
    if (m === 0xd9) { out.push(0xff, 0xd9); break; }
    if (m >= 0xd0 && m <= 0xd8) { out.push(0xff, m); continue; }
    const len = (u[i] << 8) | u[i + 1];
    const keep = m === 0xdb || m === 0xc4 || m === 0xdd || m === 0xc0 || m === 0xc1 || m === 0xc2 || m === 0xda || (m === 0xe0 && u[i + 2] === 0x4a && u[i + 3] === 0x46);
    if (m === 0xda) { // header + entropy-coded data up to the next real marker
      let j = i + len;
      while (j < u.length && !(u[j] === 0xff && u[j + 1] !== 0 && !(u[j + 1] >= 0xd0 && u[j + 1] <= 0xd7) && u[j + 1] !== 0xff)) j++;
      for (let k = i - 2; k < j; k++) out.push(u[k]);
      i = j;
      continue;
    }
    if (keep) for (let k = i - 2; k < i + len; k++) out.push(u[k]);
    i += len;
  }
  return Uint8Array.from(out);
}

function stripWebp(u: Uint8Array): Uint8Array {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const tag = (o: number) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
  const chunks: { t: string; d: Uint8Array }[] = [];
  let x: Uint8Array | null = null;
  for (let i = 12; i + 8 <= u.length;) {
    const t = tag(i), n = dv.getUint32(i + 4, true);
    const d = u.subarray(i + 8, i + 8 + n);
    if (t === 'VP8X') x = d; else if (t === 'VP8 ' || t === 'VP8L' || t === 'ALPH') chunks.push({ t, d });
    i += 8 + n + (n & 1);
  }
  const hasAlpha = chunks.some((c) => c.t === 'ALPH');
  const parts: Uint8Array[] = [];
  const chunk = (t: string, d: Uint8Array) => { const h = new Uint8Array(8); for (let k = 0; k < 4; k++) h[k] = t.charCodeAt(k); new DataView(h.buffer).setUint32(4, d.length, true); parts.push(h, d); if (d.length & 1) parts.push(new Uint8Array(1)); };
  if (hasAlpha && x) { const nx = x.slice(0, 10); nx[0] = 0x10; chunk('VP8X', nx); }
  for (const c of chunks) chunk(c.t, c.d);
  const body = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(u.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  let o = 12; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

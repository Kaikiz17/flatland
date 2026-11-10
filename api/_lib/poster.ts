/** 1:1 holographic collectible share posters (1080²) plus a landscape 1200×630 OG sibling for X. */
import { signedHeadline, signedKindLabel } from '../../packages/core/src/prizeRules.ts';

const wrap = (text: string, max: number, lines: number): string[] => {
  const words = text.trim().split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) { const keep = out.slice(0, lines); keep[lines - 1] = keep[lines - 1].replace(/.{1,2}$/, '') + '…'; return keep; }
  return out;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const burnTxt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US');

export const shortWallet = (a: string): string => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
};

/** '10 NOV 2026' in Africa/Lagos. `ts` is unix seconds. */
export const formatCardDate = (ts: number): string => {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const sec = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(new Date(sec * 1000));
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const mon = (parts.find((p) => p.type === 'month')?.value ?? '').toUpperCase();
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return [day, mon, year].filter(Boolean).join(' ');
};

export const padSerial = (n: number) => `#${String(n).padStart(4, '0')}`;

export interface VotedCardInput {
  title: string;
  letter: string;
  option: string;
  burnedWif: number;
  votes?: number;
  voterNo?: number;
  wallet?: string;
  ts?: number;
  /** Option image as a data URI or same-origin / absolute href (/img/<hash>). */
  image?: string;
  /** Public uniqueness seed: vote tx hash (preferred) or wallet. Never a pass ID. */
  seed?: string;
}
export interface SignedCardInput {
  kind: number;
  title: string;
  burnedWif: number;
  position?: number;
  headline?: string;
  wallet?: string;
  ts?: number;
  seed?: string;
}

type Theme = { bg: string; glow: string; accent: string; ink: string; foil: string; tag: string; mid: string };

const VOTED: Theme = { bg: '#070512', glow: '#f2b705', accent: '#ff5a36', ink: '#fffaf0', foil: '#f2b705', tag: 'VOTED', mid: '#1a0a28' };
const SIGN_THEMES: Theme[] = [
  { bg: '#140306', glow: '#ff6a3d', accent: '#ff5a36', ink: '#fffaf0', foil: '#f2b705', tag: 'PETITION', mid: '#3a0a10' },
  { bg: '#140814', glow: '#ff7ab6', accent: '#f2b705', ink: '#fffaf0', foil: '#ffd36a', tag: 'RSVP', mid: '#3a1028' },
  { bg: '#070614', glow: '#8b7cff', accent: '#8b7cff', ink: '#fffaf0', foil: '#d4c4ff', tag: 'ALLOWLIST', mid: '#16103a' },
  { bg: '#031210', glow: '#00e0c0', accent: '#00e0c0', ink: '#fffaf0', foil: '#7dffd0', tag: 'ACCESS', mid: '#062822' },
];

const STARS: [number, number, number][] = [
  [70, 50, 1.6], [150, 110, 2.2], [230, 40, 1.2], [310, 90, 1.8], [400, 30, 2], [490, 80, 1.3],
  [580, 45, 2.4], [670, 100, 1.5], [760, 35, 1.8], [850, 88, 2], [940, 50, 1.4], [1010, 120, 2.1],
  [90, 200, 1.3], [180, 260, 1.7], [880, 210, 1.5], [970, 260, 2], [40, 320, 1.2], [1040, 300, 1.6],
  [120, 160, 1], [520, 20, 1.4], [800, 160, 1.1], [300, 200, 1], [640, 170, 1.8], [200, 40, 1.2],
];

const FONT = 'Montserrat, Liberation Sans, Helvetica, Arial, sans-serif';
const MONO = 'DM Mono, Roboto Mono, ui-monospace, Liberation Mono, Courier New, monospace';

export function seedBytes(seed: string): number[] {
  const t = seed.startsWith('0x') ? seed.slice(2) : seed;
  const b: number[] = [];
  if (/^[0-9a-fA-F]{16,}$/.test(t)) {
    for (let i = 0; i + 1 < t.length && b.length < 32; i += 2) b.push(parseInt(t.slice(i, i + 2), 16));
    while (b.length < 32) b.push(b[b.length % 16] ^ b.length);
    return b;
  }
  let h = 2166136261;
  for (let i = 0; i < 32; i++) b.push(0);
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); b[i % 32] ^= (h >>> (i % 24)) & 255; }
  return b;
}

/** Unique public-card flourish derived from a tx hash or wallet. Never renders a pass ID. */
export function uniqueMotif(seed: string | undefined, id: string, w: number, h: number): string {
  if (!seed) return '';
  const b = seedBytes(seed);
  const hue = b[0] * 1.4;
  const stars = Array.from({ length: 10 }, (_, i) => {
    const x = 80 + ((b[i] * 17 + b[(i + 3) % 32] * 3) % Math.max(40, w - 160));
    const y = 90 + ((b[i + 8] * 13 + b[(i + 11) % 32]) % Math.max(40, Math.floor(h * 0.42)));
    const r = 1.4 + (b[i] % 5) * 0.5;
    const rot = (b[i] * 11) % 360;
    return `<path d="M${x} ${y - r * 2.2} L${x + r * 0.5} ${y - r * 0.3} L${x + r * 2} ${y} L${x + r * 0.5} ${y + r * 0.3} L${x} ${y + r * 2.2} L${x - r * 0.5} ${y + r * 0.3} L${x - r * 2} ${y} L${x - r * 0.5} ${y - r * 0.3} Z" fill="hsl(${(hue + i * 18) % 360} 90% 70%)" opacity=".85" transform="rotate(${rot} ${x} ${y})"/>`;
  }).join('');
  const pts = Array.from({ length: 6 }, (_, i) => {
    const x = (w * 0.18) + (b[16 + i] / 255) * w * 0.64;
    const y = (h * 0.22) + (b[22 + i] / 255) * h * 0.28;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `<polyline points="${pts.join(' ')}" fill="none" stroke="hsl(${hue} 90% 65%)" stroke-width="1.4" opacity=".45"/>`;
  const dots = pts.map((p, i) => { const [x, y] = p.split(','); return `<circle cx="${x}" cy="${y}" r="${2 + (b[i] % 3)}" fill="hsl(${(hue + 40 + i * 20) % 360} 90% 75%)" opacity=".9"/>`; }).join('');
  return `<g id="motif-${id}" pointer-events="none">${line}${dots}${stars}</g>`;
}


function stars(w: number, h: number) {
  const sx = w / 1080, sy = Math.min(1, h / 1080);
  return STARS.map(([x, y, r]) => `<circle cx="${(x * sx).toFixed(1)}" cy="${(y * sy).toFixed(1)}" r="${r}" fill="#fffaf0" opacity="${0.4 + (r % 2) * 0.35}"/>`).join('');
}

function confetti(kind: number, w: number, h: number) {
  if (!(kind === 1 || kind < 0)) return '';
  const cols = kind === 1 ? ['#f2b705', '#ff7ab6', '#fffaf0', '#ff5a36'] : ['#f2b705', '#ff5a36', '#0fa3a3', '#fffaf0'];
  const bits: [number, number, number, number][] = [
    [70, 360, 14, 18], [150, 430, -18, 24], [990, 350, 25, 16], [1030, 440, -12, 22],
    [50, 700, 8, 14], [1020, 720, 20, 16], [190, 330, -30, 12], [910, 320, 16, 14],
  ];
  return bits.map(([x, y, rot, s], i) => {
    const xx = x * (w / 1080);
    const yy = h < 800 ? y * (h / 1080) : y;
    return `<rect x="${xx}" y="${yy}" width="${s}" height="${s * 0.55}" rx="2" fill="${cols[i % cols.length]}" opacity=".85" transform="rotate(${rot} ${xx} ${yy})"/>`;
  }).join('');
}

function grid(w: number, h: number, color: string) {
  const step = 48;
  const lines: string[] = [];
  for (let x = 0; x <= w; x += step) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${color}" stroke-width="1" opacity=".06"/>`);
  for (let y = 0; y <= h; y += step) lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${color}" stroke-width="1" opacity=".06"/>`);
  return `<g pointer-events="none">${lines.join('')}</g>`;
}

function topo(cx: number, cy: number, r: number, color: string) {
  return [1.15, 1.32, 1.5, 1.7].map((k, i) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${r * k}" ry="${r * k * 0.78}" fill="none" stroke="${color}" stroke-width="1.2" opacity="${0.14 - i * 0.025}"/>`
  ).join('');
}

function defs(id: string, w: number, h: number, t: Theme) {
  return `<defs>
    <linearGradient id="holo-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7dffd0"/><stop offset=".18" stop-color="#7ab8ff"/><stop offset=".36" stop-color="#c77dff"/>
      <stop offset=".54" stop-color="#ff7ab6"/><stop offset=".72" stop-color="#f2b705"/><stop offset="1" stop-color="#7dffd0"/>
    </linearGradient>
    <linearGradient id="shine-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".42" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".28"/>
      <stop offset=".56" stop-color="#9cf0ff" stop-opacity=".1"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="hero-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffef8"/><stop offset=".4" stop-color="#ffe9a8"/><stop offset=".72" stop-color="${t.glow}"/><stop offset="1" stop-color="#fff6d0"/>
    </linearGradient>
    <radialGradient id="sky-${id}" cx="50%" cy="38%" r="72%">
      <stop offset="0" stop-color="${t.glow}" stop-opacity=".55"/><stop offset=".35" stop-color="${t.mid}" stop-opacity=".7"/><stop offset="1" stop-color="${t.bg}" stop-opacity="1"/>
    </radialGradient>
    <radialGradient id="orb-${id}" cx="50%" cy="58%" r="42%">
      <stop offset="0" stop-color="${t.glow}" stop-opacity=".45"/><stop offset=".55" stop-color="${t.accent}" stop-opacity=".12"/><stop offset="1" stop-color="${t.bg}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="earth-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#14325a"/><stop offset=".28" stop-color="#3ec6d4"/><stop offset=".46" stop-color="#9be7e0"/>
      <stop offset=".495" stop-color="#ffe38a"/><stop offset=".515" stop-color="#f2b705"/><stop offset=".56" stop-color="#c4a574"/><stop offset="1" stop-color="#3a1e0c"/>
    </linearGradient>
    <radialGradient id="halo-${id}" cx="50%" cy="50%" r="50%">
      <stop offset=".55" stop-color="${t.glow}" stop-opacity="0"/><stop offset=".78" stop-color="${t.glow}" stop-opacity=".55"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow-${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="grain-${id}"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" result="n"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.16"/></feComponentTransfer></filter>
    <clipPath id="clip-${id}"><circle cx="0" cy="0" r="1"/></clipPath>
  </defs>
  <rect width="${w}" height="${h}" fill="${t.bg}"/>
  <rect width="${w}" height="${h}" fill="url(#sky-${id})"/>
  ${grid(w, h, t.foil)}
  ${stars(w, h)}
  <rect width="${w}" height="${h}" filter="url(#grain-${id})" opacity=".45"/>
  <rect width="${w}" height="${h}" fill="url(#shine-${id})" pointer-events="none"/>
  <g pointer-events="none" opacity=".22">
    <rect x="${-w * 0.15}" y="${h * 0.08}" width="${w * 0.18}" height="${h * 1.2}" fill="#fff" transform="rotate(-28 ${w / 2} ${h / 2})" opacity=".35"/>
    <rect x="${w * 0.02}" y="${h * 0.08}" width="${w * 0.06}" height="${h * 1.2}" fill="#c8f7ff" transform="rotate(-28 ${w / 2} ${h / 2})" opacity=".5"/>
  </g>`;
}

function foil(w: number, h: number, id: string) {
  const m = 22, r = Math.min(w, h) * 0.05;
  const inner = m + 16;
  const tick = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x} ${y + dy * 52}V${y}H${x + dx * 52}" fill="none" stroke="url(#holo-${id})" stroke-width="7" stroke-linecap="round"/>`;
  return `
  <rect x="${m}" y="${m}" width="${w - m * 2}" height="${h - m * 2}" rx="${r}" fill="none" stroke="url(#holo-${id})" stroke-width="8"/>
  <rect x="${inner}" y="${inner}" width="${w - inner * 2}" height="${h - inner * 2}" rx="${r - 10}" fill="none" stroke="#fffaf0" stroke-width="1.25" opacity=".3"/>
  ${tick(m + 18, m + 18, 1, 1)}${tick(w - m - 18, m + 18, -1, 1)}
  ${tick(m + 18, h - m - 18, 1, -1)}${tick(w - m - 18, h - m - 18, -1, -1)}`;
}

function disc(id: string, cx: number, cy: number, r: number, image?: string) {
  const img = image
    ? `<g transform="translate(${cx} ${cy})">
        <clipPath id="dclip-${id}"><circle r="${r - 8}"/></clipPath>
        <image href="${esc(image)}" xlink:href="${esc(image)}" x="${-(r - 8)}" y="${-(r - 8)}" width="${(r - 8) * 2}" height="${(r - 8) * 2}" clip-path="url(#dclip-${id})" preserveAspectRatio="xMidYMid slice"/>
      </g>`
    : `<circle cx="${cx}" cy="${cy}" r="${r - 8}" fill="url(#earth-${id})"/>
       <ellipse cx="${cx}" cy="${cy}" rx="${r - 10}" ry="${Math.max(10, r / 14)}" fill="#ffe38a" opacity=".55"/>
       <line x1="${cx - r + 16}" y1="${cy}" x2="${cx + r - 16}" y2="${cy}" stroke="#f2b705" stroke-width="${Math.max(10, r / 18)}" stroke-linecap="round"/>
       <circle cx="${cx + r * 0.28}" cy="${cy - r * 0.06}" r="${r * 0.07}" fill="#fff6c8" opacity=".95"/>
       <circle cx="${cx + r * 0.28}" cy="${cy - r * 0.06}" r="${r * 0.16}" fill="#ffb347" opacity=".25"/>
       <path d="M${cx - r * 0.62} ${cy + r * 0.22} C${cx - r * 0.2} ${cy + r * 0.1}, ${cx + r * 0.2} ${cy + r * 0.3}, ${cx + r * 0.64} ${cy + r * 0.16}" fill="none" stroke="#5a3218" stroke-width="4" opacity=".4"/>
       <path d="M${cx - r * 0.45} ${cy + r * 0.48} C${cx} ${cy + r * 0.36}, ${cx + r * 0.3} ${cy + r * 0.55}, ${cx + r * 0.5} ${cy + r * 0.42}" fill="none" stroke="#5a3218" stroke-width="3" opacity=".3"/>`;
  return `
  <circle cx="${cx}" cy="${cy}" r="${r * 1.28}" fill="url(#halo-${id})"/>
  <ellipse cx="${cx}" cy="${cy + r * 0.18}" rx="${r * 1.05}" ry="${r * 0.16}" fill="#000" opacity=".4"/>
  ${topo(cx, cy, r, '#f2b705')}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0b0a12" stroke="url(#holo-${id})" stroke-width="${Math.max(10, r / 16)}"/>
  ${img}
  <circle cx="${cx}" cy="${cy}" r="${r - 4}" fill="none" stroke="#fffaf0" stroke-width="2" opacity=".55"/>
  <circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="none" stroke="url(#holo-${id})" stroke-width="2" opacity=".7"/>`;
}

function flame(x: number, y: number, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M0-26C7-12 11-6 11 2A11 13 0 1 1-11 2C-11-6-7-12 0-26Z" fill="#ff5a36"/>
    <path d="M0-8C4-2 5 2 5 6A5 6 0 1 1-5 6C-5 2-4-2 0-8Z" fill="#f2b705"/>
  </g>`;
}

function fireBadge(cx: number, cy: number, burned: string) {
  const w = 250, h = 78;
  return `<g transform="translate(${cx - w / 2} ${cy - h / 2})">
    <rect width="${w}" height="${h}" rx="39" fill="#0b1220" stroke="url(#holo-shared)" stroke-width="2.5"/>
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="37" fill="none" stroke="#ff5a36" stroke-width="1.5" opacity=".8"/>
    ${flame(36, 44, 1)}
    <text x="62" y="32" font-size="13" font-weight="800" fill="#ffb199" letter-spacing="2">$WIF BURNED</text>
    <text x="62" y="60" font-size="26" font-weight="800" fill="#fffaf0">${esc(burned)}</text>
  </g>`;
}

function serialPlate(x: number, y: number, kicker: string, serial: string, accent: string, right = true) {
  const w = 168, h = 70;
  const tx = right ? x - w : x;
  return `<g transform="translate(${tx} ${y - h / 2})">
    <rect width="${w}" height="${h}" rx="14" fill="#0b1220" stroke="url(#holo-shared)" stroke-width="2"/>
    <text x="${w / 2}" y="24" text-anchor="middle" font-size="11" font-weight="800" fill="${accent}" letter-spacing="3">${esc(kicker)}</text>
    <text x="${w / 2}" y="54" text-anchor="middle" font-size="26" font-weight="800" fill="#fffaf0" font-family="${MONO}" letter-spacing="1">${esc(serial)}</text>
  </g>`;
}

function seal(cx: number, cy: number, id: string, accent: string, scale = 1) {
  return `<g transform="translate(${cx} ${cy}) rotate(-8) scale(${scale})">
    <circle r="78" fill="#12080c" stroke="url(#holo-${id})" stroke-width="4.5"/>
    <circle r="72" fill="none" stroke="${accent}" stroke-width="1.15" stroke-dasharray="2.5 2.5" opacity=".85"/>
    <path id="sealtop-${id}" d="M-50,-22 A56,56 0 0,1 50,-22" fill="none"/>
    <path id="sealbot-${id}" d="M-50,24 A56,56 0 0,0 50,24" fill="none"/>
    <text font-size="8" font-weight="800" fill="${accent}" letter-spacing="1.1">
      <textPath href="#sealtop-${id}" xlink:href="#sealtop-${id}" startOffset="50%" text-anchor="middle">VERIFIED ON-CHAIN</textPath>
    </text>
    <text font-size="8" font-weight="800" fill="${accent}" letter-spacing="1.1">
      <textPath href="#sealbot-${id}" xlink:href="#sealbot-${id}" startOffset="50%" text-anchor="middle">ROBINHOOD CHAIN</textPath>
    </text>
    <circle r="26" fill="none" stroke="${accent}" stroke-width="2"/>
    <text text-anchor="middle" y="-1" font-size="11" font-weight="800" fill="#fffaf0" letter-spacing="1">FLAT</text>
    <text text-anchor="middle" y="14" font-size="9" font-weight="800" fill="${accent}" letter-spacing="1">PASS</text>
  </g>`;
}

function ribbon(cx: number, cy: number, text: string, fill: string, ink: string, width = 560) {
  const w = width, h = 64, notch = 28;
  const l = cx - w / 2, r = cx + w / 2, t = cy - h / 2, b = cy + h / 2;
  const d = `M${l + notch} ${t} L${r - notch} ${t} L${r} ${cy} L${r - notch} ${b} L${l + notch} ${b} L${l} ${cy} Z`;
  return `<g filter="url(#glow-shared)">
    <path d="${d}" fill="${fill}" stroke="#fffaf0" stroke-width="2"/>
    <text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="${text.length > 22 ? 22 : 28}" font-weight="800" fill="${ink}" letter-spacing="0.5">${esc(text)}</text>
  </g>`;
}

function wordmark(cx: number, y: number, extra = '') {
  return `<text x="${cx}" y="${y}" text-anchor="middle" font-size="18" font-weight="800" fill="#f2b705" letter-spacing="9">FLATLAND${extra ? '  ·  ' + esc(extra) : ''}</text>`;
}

function heroLine(x: number, y: number, phrase: 'VOTED' | 'SIGNED', id: string, wide: boolean, anchor: 'middle' | 'start') {
  const size = wide ? (phrase === 'VOTED' ? 92 : 84) : (phrase === 'VOTED' ? 132 : 118);
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="800" letter-spacing="${wide ? 4 : 2}" fill="url(#hero-${id})" stroke="#1a0a08" stroke-width="${wide ? 5 : 7}" paint-order="stroke fill" filter="url(#glow-${id})"><tspan fill="#ff5a36" stroke="#1a0a08" font-family="Georgia, Times New Roman, serif">I</tspan><tspan> ${phrase}</tspan></text>`;
}

function metaRow(cx: number, cy: number, wallet?: string, ts?: number) {
  const w = wallet ? shortWallet(wallet) : '';
  const d = ts ? formatCardDate(ts) : '';
  if (!w && !d) return '';
  const line = [w, d].filter(Boolean).join('   ·   ');
  return `<g>
    <rect x="${cx - 230}" y="${cy - 28}" width="460" height="56" rx="16" fill="#0b1220cc" stroke="#fffaf0" stroke-width="1" opacity=".9"/>
    <text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="20" font-weight="700" fill="#e8dcc8" font-family="${MONO}" letter-spacing="0.5">${esc(line)}</text>
  </g>`;
}

function sharedHoloDef() {
  // fireBadge references holo-shared; also a glow-shared for the ribbon
  return `<defs>
    <linearGradient id="holo-shared" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7dffd0"/><stop offset=".2" stop-color="#7ab8ff"/><stop offset=".4" stop-color="#c77dff"/>
      <stop offset=".6" stop-color="#ff7ab6"/><stop offset=".8" stop-color="#f2b705"/><stop offset="1" stop-color="#7dffd0"/>
    </linearGradient>
    <filter id="glow-shared" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
}

export function votedPoster(i: VotedCardInput): string { return voteArt(i, false); }
export function votedSvg(i: VotedCardInput): string { return voteArt(i, true); }

function voteArt(i: VotedCardInput, wide: boolean): string {
  const w = wide ? 1200 : 1080, h = wide ? 630 : 1080;
  const t = VOTED;
  const id = wide ? 'vw' : 'vs';
  const titles = wrap(i.title, wide ? 26 : 28, wide ? 2 : 3);
  const opt = i.option.length > 24 ? i.option.slice(0, 23) + '…' : i.option;
  const pick = `${i.letter} — ${opt}`;
  const burn = burnTxt(i.burnedWif);
  const no = i.voterNo && i.voterNo > 0 ? i.voterNo : 0;
  const serial = no ? padSerial(no) : '';
  const discC = wide ? [250, 335, 175] : [540, 590, 205];
  const hiddenNo = no ? `<text x="-999" y="-999">VOTER #${esc(String(no))}</text>` : '';
  const ax = wide ? 500 : 540;
  const anchor: 'middle' | 'start' = wide ? 'start' : 'middle';
  const heroY = wide ? 175 : 200;
  const titleY = wide ? 220 : 250;
  const pickY = wide ? 530 : 825;
  const midX = wide ? 250 : 540;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
  ${sharedHoloDef()}
  ${defs(id, w, h, t)}
  ${confetti(-1, w, h)}
  ${uniqueMotif(i.seed ?? i.wallet, id, w, h)}
  <rect width="${w}" height="${h}" fill="url(#orb-${id})" pointer-events="none"/>
  ${disc(id, discC[0], discC[1], discC[2], i.image)}
  ${foil(w, h, id)}
  ${wordmark(wide ? 720 : 540, wide ? 62 : 78)}
  ${serial ? serialPlate(w - 50, wide ? 88 : 88, 'VOTER', serial, t.accent) : ''}
  ${heroLine(ax, heroY, 'VOTED', id, wide, anchor)}
  ${titles.map((l, k) => `<text x="${ax}" y="${titleY + k * (wide ? 32 : 38)}" text-anchor="${anchor}" font-size="${wide ? 22 : 28}" font-weight="700" fill="#e8dcc8">${esc(l)}</text>`).join('')}
  ${ribbon(midX, pickY, pick, t.accent, '#fffaf0', wide ? 400 : 560)}
  ${seal(wide ? 520 : 178, wide ? 560 : 968, id, t.foil, wide ? 0.72 : 0.92)}
  ${metaRow(wide ? 820 : 540, wide ? 430 : 970, i.wallet, i.ts)}
  ${fireBadge(wide ? 1040 : 900, wide ? 560 : 970, burn)}
  ${hiddenNo}
</svg>`;
}

export function signedPoster(i: SignedCardInput): string { return signArt(i, false); }
export function signedSvg(i: SignedCardInput): string { return signArt(i, true); }

function signArt(i: SignedCardInput, wide: boolean): string {
  const w = wide ? 1200 : 1080, h = wide ? 630 : 1080;
  const t = SIGN_THEMES[i.kind] ?? SIGN_THEMES[0];
  const kind = signedKindLabel(i.kind);
  const headline = i.headline ?? signedHeadline(i.kind, i.title);
  const headLines = wrap(headline, wide ? 26 : 26, 3);
  const titleLines = i.kind === 0 ? [] : wrap(i.title, wide ? 28 : 24, 2);
  const burn = burnTxt(i.burnedWif);
  const pos = i.position && i.position > 0 ? i.position : 0;
  const serial = pos ? padSerial(pos) : '';
  const id = `s${i.kind}${wide ? 'w' : 'q'}`;
  const discC = wide ? [250, 335, 170] : [540, 600, 195];
  const hiddenPos = pos ? `<text x="-999" y="-999">#${esc(String(pos))}</text>` : '';
  const ax = wide ? 500 : 540;
  const anchor: 'middle' | 'start' = wide ? 'start' : 'middle';
  const heroY = wide ? 180 : 210;
  const subY = wide ? 225 : 260;
  const kicker = i.kind === 1 ? 'SEAT' : 'NO.';
  const tagW = Math.max(160, kind.length * 12 + 36);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
  ${sharedHoloDef()}
  ${defs(id, w, h, t)}
  ${confetti(i.kind, w, h)}
  ${uniqueMotif(i.seed ?? i.wallet, id, w, h)}
  <rect width="${w}" height="${h}" fill="url(#orb-${id})" pointer-events="none"/>
  ${disc(id, discC[0], discC[1], discC[2])}
  ${foil(w, h, id)}
  ${wordmark(wide ? 720 : 540, wide ? 62 : 72, 'SIGN')}
  ${serial ? serialPlate(w - 50, wide ? 88 : 88, kicker, serial, t.accent) : ''}
  <rect x="${wide ? 500 : 540 - tagW / 2}" y="${wide ? 88 : 100}" width="${tagW}" height="30" rx="15" fill="${t.accent}"/>
  <text x="${wide ? 500 + tagW / 2 : 540}" y="${wide ? 109 : 121}" text-anchor="middle" font-size="13" font-weight="800" fill="#10203a" letter-spacing="3">${esc(kind.toUpperCase())}</text>
  ${heroLine(ax, heroY, 'SIGNED', id, wide, anchor)}
  ${headLines.map((l, k) => `<text x="${ax}" y="${subY + k * (wide ? 30 : 36)}" text-anchor="${anchor}" font-size="${wide ? 20 : 26}" font-weight="800" fill="#e8dcc8">${esc(l)}</text>`).join('')}
  ${wide ? titleLines.map((l, k) => `<text x="${ax}" y="${subY + headLines.length * 30 + 8 + k * 26}" text-anchor="${anchor}" font-size="18" font-weight="700" fill="#b5bfd3">${esc(l)}</text>`).join('') : ''}
  ${!wide ? ribbon(540, 830, (i.title.length > 28 ? i.title.slice(0, 27) + '…' : i.title), t.accent, i.kind === 0 ? '#fffaf0' : '#10203a', 600) : ''}
  ${seal(wide ? 520 : 178, wide ? 560 : 968, id, t.foil, wide ? 0.72 : 0.92)}
  ${metaRow(wide ? 820 : 540, wide ? 430 : 970, i.wallet, i.ts)}
  ${fireBadge(wide ? 1040 : 900, wide ? 560 : 970, burn)}
  ${hiddenPos}
</svg>`;
}


export type PassRole = 'voted' | 'signed' | 'bought' | 'sold' | 'cashed' | 'profit';

export interface PrivatePassInput {
  role: PassRole;
  title: string;
  wallet: string;
  passId: string;
  txHash?: string;
  block?: number;
  ts?: number;
  detail?: string;
  kind?: number;
  burnedWif?: number;
  profit?: { value: string; cost: string; pct: string };
  seed?: string;
}

const ROLE_HERO: Record<PassRole, string> = {
  voted: 'I VOTED', signed: 'I SIGNED', bought: 'I BOUGHT', sold: 'I SOLD', cashed: 'I CASHED OUT', profit: 'IN PROFIT',
};

function roleTheme(role: PassRole, kind?: number): Theme {
  if (role === 'signed') return SIGN_THEMES[kind ?? 0] ?? SIGN_THEMES[0];
  if (role === 'voted') return VOTED;
  return { bg: '#04150e', glow: '#3ee0a0', accent: '#f2b705', ink: '#f3fff8', foil: '#f2b705', tag: 'STOCKS', mid: '#0a2a1c' };
}

function ticker(w: number, h: number, b: number[], color: string) {
  const bits: string[] = [];
  for (let i = 0; i < 14; i++) {
    const y = 140 + i * 62 + (b[i % 32] % 18);
    if (y > h - 80) break;
    const x = -40 + (b[(i + 4) % 32] % 80);
    bits.push(`<text x="${x}" y="${y}" font-size="11" font-weight="700" fill="${color}" opacity=".14" letter-spacing="6" font-family="${MONO}">${'WIF · STOCKS · USDG · SHARE · '.repeat(8)}</text>`);
  }
  return bits.join('');
}

function privateArt(i: PrivatePassInput, wide: boolean): string {
  const w = wide ? 1200 : 1080, h = wide ? 630 : 1080;
  const t = roleTheme(i.role, i.kind);
  const id = `pp${i.role}${wide ? 'w' : 'q'}`;
  const hero = ROLE_HERO[i.role];
  const date = i.ts ? formatCardDate(i.ts) : '';
  const when = [i.block ? `BLOCK ${i.block}` : '', date].filter(Boolean).join('  ·  ');
  const tx = i.txHash ? shortTxSafe(i.txHash) : '';
  const stocks = i.role === 'bought' || i.role === 'sold' || i.role === 'cashed' || i.role === 'profit';
  const b = seedBytes(i.seed ?? i.txHash ?? i.wallet);
  const ax = wide ? 80 : 540;
  const anchor: 'middle' | 'start' = wide ? 'start' : 'middle';
  const profit = i.profit ? `<text x="${wide ? 80 : 540}" y="${wide ? 300 : 430}" text-anchor="${anchor}" font-size="26" font-weight="800" fill="#3ee0a0">VALUE ${esc(i.profit.value)}  vs  DEPOSIT ${esc(i.profit.cost)}  ·  ${esc(i.profit.pct)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
  ${sharedHoloDef()}
  ${defs(id, w, h, t)}
  ${stocks ? ticker(w, h, b, t.foil) : ''}
  ${uniqueMotif(i.seed ?? i.txHash ?? i.wallet, id, w, h)}
  ${foil(w, h, id)}
  ${wordmark(wide ? 200 : 540, wide ? 62 : 72, 'PRIVATE PASS')}
  <rect x="${wide ? 70 : 70}" y="${wide ? 88 : 100}" width="${wide ? 1060 : 940}" height="40" rx="12" fill="#c41e3a"/>
  <text x="${wide ? 600 : 540}" y="${wide ? 115 : 127}" text-anchor="middle" font-size="15" font-weight="800" fill="#fffaf0">Don&apos;t share this publicly. Share it privately for verification only.</text>
  <text x="${ax}" y="${wide ? 170 : 230}" text-anchor="${anchor}" font-size="${wide ? 64 : 96}" font-weight="800" fill="url(#hero-${id})" stroke="#041108" stroke-width="6" paint-order="stroke fill" filter="url(#glow-${id})">${hero}</text>
  <text x="${ax}" y="${wide ? 215 : 290}" text-anchor="${anchor}" font-size="${wide ? 18 : 22}" font-weight="700" fill="#e8dcc8">${esc(i.title.slice(0, wide ? 48 : 42))}${i.title.length > (wide ? 48 : 42) ? '…' : ''}</text>
  ${i.detail ? `<text x="${ax}" y="${wide ? 250 : 340}" text-anchor="${anchor}" font-size="${wide ? 22 : 28}" font-weight="800" fill="${t.accent}">${esc(i.detail)}</text>` : ''}
  ${profit}
  <text x="${ax}" y="${wide ? 360 : 520}" text-anchor="${anchor}" font-size="${wide ? 18 : 22}" font-weight="700" fill="#fffaf0" font-family="${MONO}">${esc(i.wallet)}</text>
  ${tx ? `<text x="${ax}" y="${wide ? 394 : 568}" text-anchor="${anchor}" font-size="18" font-weight="700" fill="#b5bfd3" font-family="${MONO}">TX  ${esc(tx)}${when ? '   ·   ' + esc(when) : ''}</text>` : (when ? `<text x="${ax}" y="${wide ? 394 : 568}" text-anchor="${anchor}" font-size="18" font-weight="700" fill="#b5bfd3" font-family="${MONO}">${esc(when)}</text>` : '')}
  <g>
    <rect x="${wide ? 80 : 140}" y="${wide ? 470 : 700}" width="${wide ? 700 : 800}" height="${wide ? 110 : 150}" rx="22" fill="#0b1220" stroke="url(#holo-${id})" stroke-width="3"/>
    <text x="${wide ? 430 : 540}" y="${wide ? 500 : 742}" text-anchor="middle" font-size="13" font-weight="800" fill="#ffb199" letter-spacing="4">UNIQUE PASS ID</text>
    <text x="${wide ? 430 : 540}" y="${wide ? 538 : 798}" text-anchor="middle" font-size="${wide ? 32 : 44}" font-weight="800" fill="#fffaf0" font-family="${MONO}" letter-spacing="2">${esc(i.passId)}</text>
    <text x="${wide ? 430 : 540}" y="${wide ? 556 : 830}" text-anchor="middle" font-size="12" font-weight="700" fill="#ffd0d0">Don&apos;t share this publicly. Share it privately for verification only.</text>
  </g>
  ${seal(wide ? 1080 : 540, wide ? 560 : 980, id, t.foil, wide ? 0.62 : 0.78)}
</svg>`;
}

function shortTxSafe(h: string) {
  return h.length >= 12 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

export function privatePoster(i: PrivatePassInput): string { return privateArt(i, false); }
export function privateSvg(i: PrivatePassInput): string { return privateArt(i, true); }

export interface StocksCardInput {
  role: Exclude<PassRole, 'signed'>;
  title?: string;
  detail?: string;
  burnedWif?: number;
  wallet?: string;
  ts?: number;
  seed?: string;
  profit?: { value: string; cost: string; pct: string };
}

export function stocksPoster(i: StocksCardInput): string { return stocksArt(i, false); }
export function stocksSvg(i: StocksCardInput): string { return stocksArt(i, true); }

function stocksArt(i: StocksCardInput, wide: boolean): string {
  const w = wide ? 1200 : 1080, h = wide ? 630 : 1080;
  const t: Theme = { bg: '#04150e', glow: '#3ee0a0', accent: '#f2b705', ink: '#f3fff8', foil: '#f2b705', tag: 'STOCKS', mid: '#0a2a1c' };
  const id = `st${i.role}${wide ? 'w' : 'q'}`;
  const hero = ROLE_HERO[i.role];
  const b = seedBytes(i.seed ?? i.wallet ?? 'stocks');
  const ax = wide ? 500 : 540;
  const anchor: 'middle' | 'start' = wide ? 'start' : 'middle';
  const title = i.title ?? 'Flatland Stocks';
  const titles = wrap(title, wide ? 26 : 28, 2);
  const discC = wide ? [250, 335, 170] : [540, 590, 200];
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
  ${sharedHoloDef()}
  ${defs(id, w, h, t)}
  ${ticker(w, h, b, t.foil)}
  ${uniqueMotif(i.seed ?? i.wallet, id, w, h)}
  <rect width="${w}" height="${h}" fill="url(#orb-${id})" pointer-events="none"/>
  ${disc(id, discC[0], discC[1], discC[2])}
  ${foil(w, h, id)}
  ${wordmark(wide ? 720 : 540, wide ? 62 : 78, 'STOCKS')}
  <text x="${ax}" y="${wide ? 175 : 210}" text-anchor="${anchor}" font-size="${wide ? 72 : 104}" font-weight="800" fill="url(#hero-${id})" stroke="#041108" stroke-width="${wide ? 5 : 7}" paint-order="stroke fill" filter="url(#glow-${id})">${hero}</text>
  ${titles.map((l, k) => `<text x="${ax}" y="${(wide ? 220 : 270) + k * (wide ? 32 : 38)}" text-anchor="${anchor}" font-size="${wide ? 22 : 28}" font-weight="700" fill="#d7f5e6">${esc(l)}</text>`).join('')}
  ${i.detail ? ribbon(wide ? 250 : 540, wide ? 530 : 825, i.detail, t.accent, '#041108', wide ? 400 : 600) : ''}
  ${i.profit ? `<text x="${ax}" y="${wide ? 300 : 360}" text-anchor="${anchor}" font-size="${wide ? 22 : 26}" font-weight="800" fill="#3ee0a0">${esc(`VALUE ${i.profit.value}  vs  ${i.profit.cost}  ·  ${i.profit.pct}`)}</text>` : ''}
  ${metaRow(wide ? 820 : 540, wide ? 430 : 970, i.wallet, i.ts)}
  ${i.burnedWif != null ? fireBadge(wide ? 1040 : 900, wide ? 560 : 970, burnTxt(i.burnedWif)) : ''}
  ${seal(wide ? 520 : 175, wide ? 560 : 968, id, t.foil, wide ? 0.72 : 0.92)}
</svg>`;
}

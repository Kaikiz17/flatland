/** 1:1 celebratory share posters (1080²) plus a landscape 1200×630 OG sibling for X. */
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

export interface VotedCardInput {
  title: string;
  letter: string;
  option: string;
  burnedWif: number;
  votes?: number;
  voterNo?: number;
}
export interface SignedCardInput {
  kind: number;
  title: string;
  burnedWif: number;
  position?: number;
  headline?: string;
}

type Theme = { bg: string; glow: string; accent: string; ink: string; foil: string; tag: string };

const VOTED: Theme = { bg: '#12081c', glow: '#f2b705', accent: '#ff5a36', ink: '#fffaf0', foil: '#f2b705', tag: 'VOTED' };
const SIGN_THEMES: Theme[] = [
  { bg: '#1a0608', glow: '#ff5a36', accent: '#ff5a36', ink: '#fffaf0', foil: '#f2b705', tag: 'PETITION' },
  { bg: '#1a0c18', glow: '#ff7ab6', accent: '#f2b705', ink: '#fffaf0', foil: '#f2b705', tag: 'RSVP' },
  { bg: '#0c0820', glow: '#8b7cff', accent: '#8b7cff', ink: '#fffaf0', foil: '#d4c4ff', tag: 'ALLOWLIST' },
  { bg: '#041614', glow: '#00e0c0', accent: '#00e0c0', ink: '#fffaf0', foil: '#7dffd0', tag: 'ACCESS' },
];

const STARS: [number, number, number][] = [
  [70, 50, 1.6], [150, 110, 2.2], [230, 40, 1.2], [310, 90, 1.8], [400, 30, 2], [490, 80, 1.3],
  [580, 45, 2.4], [670, 100, 1.5], [760, 35, 1.8], [850, 88, 2], [940, 50, 1.4], [1010, 120, 2.1],
  [90, 200, 1.3], [180, 260, 1.7], [880, 210, 1.5], [970, 260, 2], [40, 320, 1.2], [1040, 300, 1.6],
  [120, 160, 1], [520, 20, 1.4], [800, 160, 1.1], [300, 200, 1], [640, 170, 1.8],
];

function stars(w: number, h: number, color = '#fffaf0') {
  const sx = w / 1080, sy = Math.min(1, h / 1080);
  return STARS.map(([x, y, r]) => `<circle cx="${(x * sx).toFixed(1)}" cy="${(y * sy).toFixed(1)}" r="${r}" fill="${color}" opacity="${0.45 + (r % 2) * 0.3}"/>`).join('');
}

function confetti(kind: number, w: number) {
  const cols = kind === 1 ? ['#f2b705', '#ff7ab6', '#fffaf0', '#ff5a36'] : ['#f2b705', '#ff5a36', '#0fa3a3', '#fffaf0'];
  const bits: [number, number, number, number][] = [
    [80, 420, 14, 22], [160, 500, -18, 30], [980, 430, 25, 18], [1020, 520, -12, 28],
    [60, 600, 8, 16], [1000, 640, 20, 20], [200, 380, -30, 14], [900, 390, 16, 16],
  ];
  return bits.map(([x, y, rot, s], i) => {
    const c = cols[i % cols.length];
    const xx = x * (w / 1080);
    return `<rect x="${xx}" y="${y}" width="${s}" height="${s * 0.55}" rx="2" fill="${c}" opacity=".85" transform="rotate(${rot} ${xx} ${y})"/>`;
  }).join('');
}

function disc(id: string, cx: number, cy: number, r: number) {
  return `
  <defs>
    <linearGradient id="dg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8ffff"/><stop offset=".46" stop-color="#0fa3a3"/><stop offset=".495" stop-color="#f2b705"/><stop offset=".505" stop-color="#f2b705"/><stop offset=".55" stop-color="#c4a574"/><stop offset="1" stop-color="#5a3218"/></linearGradient>
    <radialGradient id="halo-${id}" cx="50%" cy="50%" r="50%"><stop offset=".5" stop-color="#f2b705" stop-opacity="0"/><stop offset=".75" stop-color="#f2b705" stop-opacity=".4"/><stop offset="1" stop-color="#f2b705" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.26}" fill="url(#halo-${id})"/>
  <ellipse cx="${cx}" cy="${cy + r * 0.12}" rx="${r * 1.02}" ry="${r * 0.16}" fill="#000" opacity=".35"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#dg-${id})" stroke="#fffaf0" stroke-width="${Math.max(6, r / 28)}"/>
  <line x1="${cx - r + 6}" y1="${cy}" x2="${cx + r - 6}" y2="${cy}" stroke="#f2b705" stroke-width="${Math.max(10, r / 18)}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.08}" fill="none" stroke="#f2b705" stroke-width="2.5" opacity=".55"/>`;
}

function foil(w: number, h: number, color: string) {
  const m = 22, r = Math.min(w, h) * 0.055;
  const inner = m + 14;
  const tick = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x} ${y + dy * 48}V${y}H${x + dx * 48}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/>`;
  return `
  <rect x="${m}" y="${m}" width="${w - m * 2}" height="${h - m * 2}" rx="${r}" fill="none" stroke="${color}" stroke-width="7"/>
  <rect x="${inner}" y="${inner}" width="${w - inner * 2}" height="${h - inner * 2}" rx="${r - 8}" fill="none" stroke="#fffaf0" stroke-width="1.5" opacity=".28"/>
  ${tick(m + 18, m + 18, 1, 1)}${tick(w - m - 18, m + 18, -1, 1)}
  ${tick(m + 18, h - m - 18, 1, -1)}${tick(w - m - 18, h - m - 18, -1, -1)}`;
}

function flame(x: number, y: number, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M0-26C7-12 11-6 11 2A11 13 0 1 1-11 2C-11-6-7-12 0-26Z" fill="#ff5a36"/>
    <path d="M0-8C4-2 5 2 5 6A5 6 0 1 1-5 6C-5 2-4-2 0-8Z" fill="#f2b705"/>
  </g>`;
}

function fireBadge(cx: number, cy: number, burned: string, wide = false) {
  const w = wide ? 280 : 260, h = 86;
  return `<g transform="translate(${cx - w / 2} ${cy - h / 2})">
    <rect width="${w}" height="${h}" rx="43" fill="#10203a" stroke="#ff5a36" stroke-width="3"/>
    ${flame(36, 48, 1.05)}
    <text x="62" y="38" font-size="16" font-weight="800" fill="#ffb199" letter-spacing="2">$WIF BURNED</text>
    <text x="62" y="68" font-size="28" font-weight="800" fill="#fffaf0">${esc(burned)}</text>
  </g>`;
}

function numberBadge(cx: number, cy: number, r: number, kicker: string, num: string, accent: string) {
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r + 8}" fill="${accent}" opacity=".35"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#10203a" stroke="${accent}" stroke-width="6"/>
    <text x="${cx}" y="${cy - r * 0.22}" text-anchor="middle" font-size="${Math.round(r * 0.22)}" font-weight="800" fill="${accent}" letter-spacing="2">${esc(kicker)}</text>
    <text x="${cx}" y="${cy + r * 0.38}" text-anchor="middle" font-size="${Math.round(r * (num.length > 3 ? 0.42 : 0.52))}" font-weight="800" fill="#fffaf0">${esc(num)}</text>
  </g>`;
}

function sky(id: string, w: number, h: number, t: Theme, kind = -1) {
  return `<defs>
    <radialGradient id="sky-${id}" cx="50%" cy="62%" r="70%"><stop offset="0" stop-color="${t.glow}" stop-opacity=".55"/><stop offset=".45" stop-color="${t.accent}" stop-opacity=".18"/><stop offset="1" stop-color="${t.bg}" stop-opacity="1"/></radialGradient>
    <filter id="glow-${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="${t.bg}"/>
  <rect width="${w}" height="${h}" fill="url(#sky-${id})"/>
  ${stars(w, h)}
  ${kind === 1 || kind < 0 ? confetti(kind, w) : ''}`;
}

function wordmark(cx: number, y: number, extra = '') {
  return `<text x="${cx}" y="${y}" text-anchor="middle" font-size="20" font-weight="800" fill="#f2b705" letter-spacing="8">FLATLAND${extra ? '  ·  ' + esc(extra) : ''}</text>`;
}

/** Square 1080×1080 collectible poster — the in-app / downloadable card. */
export function votedPoster(i: VotedCardInput): string {
  return voteArt(i, false);
}
/** Landscape 1200×630 OG for X link previews. */
export function votedSvg(i: VotedCardInput): string {
  return voteArt(i, true);
}

function voteArt(i: VotedCardInput, wide: boolean): string {
  const w = wide ? 1200 : 1080, h = wide ? 630 : 1080;
  const t = VOTED;
  const titles = wrap(i.title, wide ? 28 : 26, 3);
  const opt = i.option.length > 22 ? i.option.slice(0, 21) + '…' : i.option;
  const pick = `${i.letter} — ${opt}`;
  const burn = burnTxt(i.burnedWif);
  const no = i.voterNo && i.voterNo > 0 ? String(i.voterNo) : '';
  const heroY = wide ? 200 : 240;
  const discC = wide ? [280, 400, 200] : [540, 800, 220];
  const badge = no ? numberBadge(wide ? 1000 : 200, wide ? 490 : 900, wide ? 86 : 112, 'VOTER', `#${no}`, t.accent) : '';
  const hiddenNo = no ? `<text x="-999" y="-999">VOTER #${esc(no)}</text>` : '';
  const fire = fireBadge(wide ? 1000 : 880, wide ? 200 : 1000, burn);
  const titleY = wide ? 270 : 310;
  const pickY = wide ? 400 : 450;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Liberation Sans, Helvetica, Arial, sans-serif">
  ${sky('v' + (wide ? 'w' : 's'), w, h, t, -1)}
  ${disc(wide ? 'vw' : 'vs', discC[0], discC[1], discC[2])}
  ${foil(w, h, t.foil)}
  ${wordmark(wide ? 860 : 540, wide ? 70 : 80)}
  <text x="${wide ? 640 : 540}" y="${heroY}" text-anchor="${wide ? 'start' : 'middle'}" font-size="${wide ? 92 : 128}" font-weight="800" letter-spacing="${wide ? 4 : 2}" filter="url(#glow-v${wide ? 'w' : 's'})"><tspan fill="${t.accent}">I </tspan><tspan fill="${t.ink}">VOTED</tspan></text>
  ${titles.map((l, k) => `<text x="${wide ? 640 : 540}" y="${titleY + k * (wide ? 36 : 44)}" text-anchor="${wide ? 'start' : 'middle'}" font-size="${wide ? 26 : 32}" font-weight="700" fill="#e8dcc8">${esc(l)}</text>`).join('')}
  <g>
    <rect x="${wide ? 640 : 540 - 200}" y="${pickY}" width="${wide ? 280 : 400}" height="56" rx="28" fill="#10203acc" stroke="${t.accent}" stroke-width="2"/>
    <text x="${wide ? 780 : 540}" y="${pickY + 38}" text-anchor="middle" font-size="26" font-weight="800" fill="${t.ink}">${esc(pick)}</text>
  </g>
  ${badge}${hiddenNo}${fire}
  <text x="${wide ? 640 : 540}" y="${h - 36}" text-anchor="${wide ? 'start' : 'middle'}" font-size="16" font-weight="700" fill="#b5bfd3">the world is flat. so is every vote.</text>
</svg>`;
}

export function signedPoster(i: SignedCardInput): string {
  return signArt(i, false);
}
export function signedSvg(i: SignedCardInput): string {
  return signArt(i, true);
}

function signArt(i: SignedCardInput, wide: boolean): string {
  const w = wide ? 1200 : 1080, h = wide ? 630 : 1080;
  const t = SIGN_THEMES[i.kind] ?? SIGN_THEMES[0];
  const kind = signedKindLabel(i.kind);
  const headline = i.headline ?? signedHeadline(i.kind, i.title);
  const headLines = wrap(headline, wide ? 28 : 24, 3);
  const titleLines = i.kind === 0 ? [] : wrap(i.title, wide ? 28 : 22, 2);
  const burn = burnTxt(i.burnedWif);
  const pos = i.position && i.position > 0 ? String(i.position) : '';
  const id = `s${i.kind}${wide ? 'w' : 'q'}`;
  const heroY = wide ? 210 : 250;
  const discC = wide ? [280, 400, 200] : [540, 810, 210];
  const badge = pos ? numberBadge(wide ? 1000 : 200, wide ? 490 : 910, wide ? 86 : 112, i.kind === 1 ? 'SEAT' : 'NO.', `#${pos}`, t.accent) : '';
  const hiddenPos = pos ? `<text x="-999" y="-999">#${esc(pos)}</text>` : '';
  const fire = fireBadge(wide ? 1000 : 880, wide ? 200 : 1000, burn);
  const ax = wide ? 640 : 540;
  const anchor = wide ? 'start' : 'middle';
  const subY = wide ? 280 : 320;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Liberation Sans, Helvetica, Arial, sans-serif">
  ${sky(id, w, h, t, i.kind)}
  ${disc(id, discC[0], discC[1], discC[2])}
  ${foil(w, h, t.foil)}
  ${wordmark(wide ? 860 : 540, wide ? 70 : 80, 'SIGN')}
  <rect x="${wide ? 640 : 450}" y="${wide ? 96 : 118}" width="180" height="36" rx="18" fill="${t.accent}"/>
  <text x="${wide ? 730 : 540}" y="${wide ? 121 : 143}" text-anchor="middle" font-size="16" font-weight="800" fill="#10203a" letter-spacing="3">${esc(kind.toUpperCase())}</text>
  <text x="${ax}" y="${heroY}" text-anchor="${anchor}" font-size="${wide ? 80 : 112}" font-weight="800" letter-spacing="${wide ? 2 : 0}" filter="url(#glow-${id})"><tspan fill="${t.accent}">I </tspan><tspan fill="${t.ink}">SIGNED</tspan></text>
  ${headLines.map((l, k) => `<text x="${ax}" y="${subY + k * (wide ? 34 : 42)}" text-anchor="${anchor}" font-size="${wide ? 24 : 30}" font-weight="800" fill="#e8dcc8">${esc(l)}</text>`).join('')}
  ${titleLines.map((l, k) => `<text x="${ax}" y="${subY + headLines.length * (wide ? 34 : 42) + 10 + k * 30}" text-anchor="${anchor}" font-size="22" font-weight="700" fill="#b5bfd3">${esc(l)}</text>`).join('')}
  ${badge}${hiddenPos}${fire}
  <text x="${ax}" y="${h - 36}" text-anchor="${anchor}" font-size="16" font-weight="700" fill="#b5bfd3">one wallet, one act, on-chain.</text>
</svg>`;
}

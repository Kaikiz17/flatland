import { signedHeadline, signedKindLabel } from '../../packages/core/src/prizeRules.ts';
export { signedHeadline, signedKindLabel };

/** OG share card: pure SVG string builder (unit-tested) + optional PNG rasteriser (X/Twitter ignore SVG og:images). */
export interface OgInput {
  id: number;
  title: string;
  options: string[];
  tallies: number[];
  burnedWif: number;
  status: string;
  secondsLeft?: number;
  voters: number;
  grade?: string;
  winner?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COLORS = ['#ff5a36', '#0fa3a3', '#f2b705', '#4f5bd5', '#c13584', '#2e9e5b', '#8a5a44', '#10203a'];

export function wrap(text: string, max: number, lines: number): string[] {
  const words = text.trim().split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) { const keep = out.slice(0, lines); keep[lines - 1] = keep[lines - 1].replace(/.{1,2}$/, '') + '…'; return keep; }
  return out;
}

const fmtTime = (s?: number) => {
  if (s === undefined) return '';
  if (s <= 0) return 'ended';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h left` : h ? `${h}h ${m}m left` : `${m}m left`;
};

export function ogSvg(i: OgInput): string {
  const total = i.tallies.reduce((a, b) => a + b, 0);
  const order = i.options.map((_, k) => k).sort((a, b) => (i.tallies[b] ?? 0) - (i.tallies[a] ?? 0)).slice(0, 4);
  const titleLines = wrap(i.title, 32, 3);
  const rows = order.map((k, r) => {
    const pct = total ? (i.tallies[k] ?? 0) / total : 0;
    const y = 296 + r * 62;
    const w = Math.max(6, Math.round(pct * 560));
    const win = i.winner === k;
    return `<g>
      <rect x="64" y="${y}" width="40" height="40" rx="9" fill="${COLORS[k % COLORS.length]}" stroke="#10203a" stroke-width="3"/>
      <text x="84" y="${y + 29}" text-anchor="middle" font-size="24" font-weight="700" fill="#fff">${String.fromCharCode(65 + k)}</text>
      <rect x="120" y="${y}" width="580" height="40" rx="9" fill="#fff" stroke="#10203a" stroke-width="3"/>
      <rect x="123" y="${y + 3}" width="${Math.min(w, 574)}" height="34" rx="6" fill="${COLORS[k % COLORS.length]}" opacity=".35"/>
      <text x="136" y="${y + 29}" font-size="22" font-weight="700" fill="#10203a">${esc(i.options[k].slice(0, 30))}${win ? '  (winner)' : ''}</text>
      <text x="688" y="${y + 29}" text-anchor="end" font-size="22" font-weight="700" fill="#10203a">${total ? Math.round(pct * 100) : 0}%</text>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Liberation Sans, Helvetica, Arial, sans-serif">
  <rect width="1200" height="630" fill="#f3eee1"/>
  <g stroke="#10203a" stroke-opacity=".08" stroke-width="2">${Array.from({ length: 13 }, (_, k) => `<path d="M${k * 100} 0V630"/>`).join('')}${Array.from({ length: 8 }, (_, k) => `<path d="M0 ${k * 100}H1200"/>`).join('')}</g>
  <rect x="24" y="24" width="1152" height="582" rx="26" fill="none" stroke="#10203a" stroke-width="5"/>
  <rect x="64" y="56" width="52" height="52" rx="12" fill="#10203a"/><circle cx="90" cy="80" r="12" fill="#f3eee1"/><rect x="68" y="80" width="44" height="5" fill="#ff5a36"/>
  <text x="132" y="92" font-size="34" font-weight="700" fill="#10203a">Flatland</text>
  <text x="1136" y="88" text-anchor="end" font-size="22" font-weight="700" fill="#5b6780">${esc(i.status.toUpperCase())}${i.secondsLeft !== undefined && i.status === 'open' ? ' · ' + esc(fmtTime(i.secondsLeft)) : ''}</text>
  ${titleLines.map((l, k) => `<text x="64" y="${166 + k * 54}" font-size="48" font-weight="700" fill="#10203a">${esc(l)}</text>`).join('')}
  ${rows}
  <rect x="760" y="284" width="376" height="232" rx="20" fill="#10203a"/>
  <text x="948" y="338" text-anchor="middle" font-size="20" font-weight="700" fill="#b5bfd3">$WIF BURNED</text>
  <text x="948" y="418" text-anchor="middle" font-size="76" font-weight="700" fill="#ff5a36">${esc(Math.round(i.burnedWif).toLocaleString('en-US'))}</text>
  <text x="948" y="466" text-anchor="middle" font-size="22" fill="#f3eee1">${i.voters} wallet${i.voters === 1 ? '' : 's'} voted${i.grade && i.grade !== 'n/a' ? ' · fairness ' + esc(i.grade) : ''}</text>
  <text x="64" y="590" font-size="22" font-weight="700" fill="#5b6780">1 wallet = 1 vote · every vote burns $WIF · built on the World is Fair rules, open to everyone</text>
</svg>`;
}

export interface CardInput { kicker: string; title: string; big: string; bigLabel: string; lines: string[]; foot?: string }
/** Generic 1200x630 brand card (Flat Score, "I voted"). */
export function cardSvg(i: CardInput): string {
  const t = wrap(i.title, 30, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Liberation Sans, Helvetica, Arial, sans-serif">
  <rect width="1200" height="630" fill="#f3eee1"/>
  <rect x="24" y="24" width="1152" height="582" rx="26" fill="none" stroke="#10203a" stroke-width="5"/>
  <rect x="64" y="56" width="52" height="52" rx="12" fill="#10203a"/><circle cx="90" cy="80" r="12" fill="#f3eee1"/><rect x="68" y="80" width="44" height="5" fill="#ff5a36"/>
  <text x="132" y="92" font-size="34" font-weight="700" fill="#10203a">Flatland</text>
  <text x="1136" y="88" text-anchor="end" font-size="22" font-weight="700" fill="#ff5a36">${esc(i.kicker.toUpperCase())}</text>
  ${t.map((l, k) => `<text x="64" y="${190 + k * 58}" font-size="52" font-weight="700" fill="#10203a">${esc(l)}</text>`).join('')}
  ${i.lines.slice(0, 4).map((l, k) => `<text x="64" y="${380 + k * 46}" font-size="30" font-weight="700" fill="#5b6780">${esc(l.slice(0, 44))}</text>`).join('')}
  <rect x="760" y="284" width="376" height="232" rx="20" fill="#10203a"/>
  <text x="948" y="338" text-anchor="middle" font-size="20" font-weight="700" fill="#b5bfd3">${esc(i.bigLabel.toUpperCase())}</text>
  <text x="948" y="426" text-anchor="middle" font-size="${i.big.length > 7 ? 60 : 84}" font-weight="700" fill="#ff5a36">${esc(i.big)}</text>
  <text x="64" y="590" font-size="22" font-weight="700" fill="#5b6780">${esc(i.foot ?? '1 wallet = 1 vote · every vote burns $WIF · open to everyone')}</text>
</svg>`;
}

/** Rasterise with resvg (Node/Vercel). Returns null when no rasteriser is available (edge): callers fall back to SVG. */
export async function svgToPng(svg: string, fontFiles: string[]): Promise<Uint8Array | null> {
  try {
    const mod: any = await (Function('m', 'return import(m)') as any)('@resvg/resvg-js');
    const r = new mod.Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Liberation Sans' }, fitTo: { mode: 'width', value: 1200 } });
    return r.render().asPng();
  } catch {
    return null;
  }
}

export interface VotedCardInput {
  title: string;
  letter: string;
  option: string;
  burnedWif: number;
  votes?: number;
  voterNo?: number;
}

const earthMotif = (id: string, seal: string, sealFill: string, ring: string) => `
  <defs>
    <radialGradient id="glow-${id}" cx="22%" cy="44%" r="58%"><stop offset="0" stop-color="${id === 'v' ? '#f2b705' : '#0fa3a3'}" stop-opacity=".5"/><stop offset=".55" stop-color="#0fa3a3" stop-opacity=".18"/><stop offset="1" stop-color="#10203a" stop-opacity="0"/></radialGradient>
    <linearGradient id="disc-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9be7e7"/><stop offset=".46" stop-color="#0fa3a3"/><stop offset=".5" stop-color="#f2b705"/><stop offset=".54" stop-color="#c4a574"/><stop offset="1" stop-color="#6b3f2a"/></linearGradient>
    <linearGradient id="panel-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="${id === 'v' ? '#f3eee1' : '#eef6f4'}"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#10203a"/>
  <rect width="1200" height="630" fill="url(#glow-${id})"/>
  <g stroke="#f3eee1" stroke-opacity=".08" stroke-width="1.5"><circle cx="230" cy="330" r="210"/><circle cx="230" cy="330" r="240"/><circle cx="230" cy="330" r="270"/></g>
  <ellipse cx="230" cy="338" rx="176" ry="28" fill="#000" opacity=".25"/>
  <circle cx="230" cy="318" r="168" fill="url(#disc-${id})" stroke="#f3eee1" stroke-width="6"/>
  <line x1="68" y1="318" x2="392" y2="318" stroke="#f2b705" stroke-width="7" stroke-linecap="round"/>
  <circle cx="230" cy="318" r="186" fill="none" stroke="${ring}" stroke-width="2.5" opacity=".5"/>
  <circle cx="230" cy="150" r="58" fill="${sealFill}" stroke="#fffaf0" stroke-width="5"/>
  <text x="230" y="142" text-anchor="middle" font-size="16" font-weight="800" fill="#fffaf0" letter-spacing="2">I</text>
  <text x="230" y="168" text-anchor="middle" font-size="18" font-weight="800" fill="#fffaf0" letter-spacing="1.5">${seal}</text>`;

/** Premium "I voted" share card: night-sky + flat-earth disc, voter number, pick, $WIF burned. */
export function votedSvg(i: VotedCardInput): string {
  const titles = wrap(i.title, 28, 3);
  const pickLines = wrap(`${i.letter} — ${i.option}`, 28, 2);
  const burn = (Math.round(i.burnedWif * 100) / 100).toLocaleString('en-US');
  const no = i.voterNo && i.voterNo > 0 ? String(i.voterNo) : '';
  const foot = (i.votes ? `${i.votes} votes so far · ` : '') + '1 wallet = 1 vote · every vote burns $WIF';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Liberation Sans, Helvetica, Arial, sans-serif">
  ${earthMotif('v', 'VOTED', '#ff5a36', '#f2b705')}
  <text x="230" y="545" text-anchor="middle" font-size="18" font-weight="700" fill="#b5bfd3">FLATLAND</text>
  <text x="230" y="572" text-anchor="middle" font-size="15" font-weight="700" fill="#7a8498">the world is flat. so is every vote.</text>
  <rect x="468" y="56" width="684" height="518" rx="32" fill="url(#panel-v)"/>
  <rect x="468" y="56" width="684" height="518" rx="32" fill="none" stroke="#f2b705" stroke-width="3"/>
  <text x="504" y="108" font-size="18" font-weight="800" fill="#ff5a36" letter-spacing="3">I VOTED</text>
  ${no ? `<text x="1108" y="110" text-anchor="end" font-size="18" font-weight="800" fill="#0fa3a3">VOTER #${esc(no)}</text>` : ''}
  ${titles.map((l, k) => `<text x="504" y="${168 + k * 52}" font-size="42" font-weight="800" fill="#10203a">${esc(l)}</text>`).join('')}
  <text x="504" y="340" font-size="16" font-weight="800" fill="#5b6780" letter-spacing="2">MY PICK</text>
  ${pickLines.map((l, k) => `<text x="504" y="${384 + k * 44}" font-size="36" font-weight="800" fill="#10203a">${esc(l)}</text>`).join('')}
  <rect x="504" y="470" width="612" height="72" rx="16" fill="#10203a"/>
  <text x="528" y="514" font-size="22" font-weight="800" fill="#b5bfd3">$WIF BURNED</text>
  <text x="1092" y="518" text-anchor="end" font-size="36" font-weight="800" fill="#ff5a36">${esc(burn)}</text>
  <text x="504" y="560" font-size="16" font-weight="700" fill="#5b6780">${esc(foot)}</text>
</svg>`;
}

export interface SignedCardInput {
  kind: number;
  title: string;
  burnedWif: number;
  position?: number;
  headline?: string;
}

/** "I signed" share card for Sign (petition / RSVP / allowlist / access). */
export function signedSvg(i: SignedCardInput): string {
  const headline = i.headline ?? signedHeadline(i.kind, i.title);
  const lines = wrap(headline, 26, 3);
  const kind = signedKindLabel(i.kind);
  const burn = (Math.round(i.burnedWif * 100) / 100).toLocaleString('en-US');
  const pos = i.position && i.position > 0 ? `#${i.position}` : '';
  const subLines = i.kind === 0 ? [] : wrap(i.title, 28, 2);
  const kicker = `${kind.toUpperCase()}${pos ? '  ·  ' + pos : ''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Liberation Sans, Helvetica, Arial, sans-serif">
  ${earthMotif('s', 'SIGNED', '#0fa3a3', '#7dffd0')}
  <text x="230" y="545" text-anchor="middle" font-size="18" font-weight="700" fill="#b5bfd3">FLATLAND  ·  SIGN</text>
  <text x="230" y="572" text-anchor="middle" font-size="15" font-weight="700" fill="#7a8498">one wallet, one act, on-chain.</text>
  <rect x="468" y="56" width="684" height="518" rx="32" fill="url(#panel-s)"/>
  <rect x="468" y="56" width="684" height="518" rx="32" fill="none" stroke="#0fa3a3" stroke-width="3"/>
  <text x="504" y="108" font-size="18" font-weight="800" fill="#0fa3a3" letter-spacing="3">I SIGNED</text>
  <text x="1108" y="110" text-anchor="end" font-size="18" font-weight="800" fill="#10203a">${esc(kicker)}</text>
  ${lines.map((l, k) => `<text x="504" y="${178 + k * 54}" font-size="42" font-weight="800" fill="#10203a">${esc(l)}</text>`).join('')}
  ${subLines.map((l, k) => `<text x="504" y="${360 + k * 40}" font-size="26" font-weight="700" fill="#5b6780">${esc(l)}</text>`).join('')}
  <rect x="504" y="470" width="612" height="72" rx="16" fill="#10203a"/>
  <text x="528" y="514" font-size="22" font-weight="800" fill="#b5bfd3">$WIF BURNED</text>
  <text x="1092" y="518" text-anchor="end" font-size="36" font-weight="800" fill="#ffd966">${esc(burn)}</text>
  <text x="504" y="560" font-size="16" font-weight="700" fill="#5b6780">capped at one per wallet · builds an on-chain streak</text>
</svg>`;
}

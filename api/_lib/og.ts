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

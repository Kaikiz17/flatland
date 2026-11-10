// Prefilled Create templates (/#/create?template=<key>).
// GOAT: the top 32 of World is Fair's public "Who is the G.O.A.T." results (worldisflat.fun/fair/results/goat.json, ranked by their verified votes,
// final 14 Sep 2026; winner Vlad Tenev). The original event had 78 candidates; a Flatland election holds at most 32 options.
export const GOAT_NAMES = ['Vlad Tenev', 'Unipcs', 'Ansem', 'Ozzy', 'ogle', 'Vee', 'Rune', 'nobi', 'pow', 'sapphy', 'Altcoinist', 'CZ', 'Him', 'lesabre', 'ika', 'pablo', 'smol intern', 'The Wolf', 'PoorGoat', 'Cobie', 'MoneyLord', 'kook', 'Murad', 'alon', 'Avast', 'Forgivable', 'Shadow', 'Ancient One', 'Andrew Seb', 'asta', 'Aurelius', 'AJC'];
export const TEMPLATES = {
  goat: { title: 'Who is the GOAT? — the rematch', options: GOAT_NAMES, duration: 7 * 86400, prize: '0', winners: '0' },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;

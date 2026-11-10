// Prefilled Create templates (/#/create?template=<key>).
// GOAT: the top 32 of World is Fair's public "Who is the G.O.A.T." results (worldisflat.fun/fair/results/goat.json, ranked by their verified votes,
// final 14 Sep 2026; winner Vlad Tenev). The original event had 78 candidates; a Flatland election holds at most 32 options.
export const GOAT_NAMES = ['Vlad Tenev', 'Unipcs', 'Ansem', 'Ozzy', 'ogle', 'Vee', 'Rune', 'nobi', 'pow', 'sapphy', 'Altcoinist', 'CZ', 'Him', 'lesabre', 'ika', 'pablo', 'smol intern', 'The Wolf', 'PoorGoat', 'Cobie', 'MoneyLord', 'kook', 'Murad', 'alon', 'Avast', 'Forgivable', 'Shadow', 'Ancient One', 'Andrew Seb', 'asta', 'Aurelius', 'AJC'];

// People's Pick: official World is Flat hackathon entries from https://worldisflat.fun/build/api/projects (scraped 10 Nov 2026, 37 live projects)
// plus Flatland. A Flatland election holds at most 32 options, so Flatland leads and 31 official names follow (API order).
// Omitted (swap any in): Multiplier, Santa, AtlasPad, Zeron, Ajo, HireWif.
// Project pages: https://worldisflat.fun/build/<slug>  — Flatland: https://flatland.flatland.workers.dev
export const PEOPLES_PICK = [
  { name: 'Flatland', slug: 'flatland', href: 'https://flatland.flatland.workers.dev' },
  { name: 'Proof of Ship', slug: 'proof-of-ship' },
  { name: 'WIF Gift', slug: 'wif-gift' },
  { name: 'WIF Agent Arena', slug: 'wif-agent-arena' },
  { name: 'Sherwood', slug: 'sherwood' },
  { name: 'ORBRUSH', slug: 'orbrush' },
  { name: 'FLAT//RELAY', slug: 'flat-relay' },
  { name: 'The Flat Earth Society', slug: 'the-flat-earth-society' },
  { name: 'Kerdo', slug: 'kerdo' },
  { name: 'Convince the Flat Earther', slug: 'convince-the-flat-earther' },
  { name: 'The GateKeeper', slug: 'the-gatekeeper' },
  { name: 'Underfoot', slug: 'underfoot' },
  { name: 'stardust', slug: 'stardust' },
  { name: 'Robin town', slug: 'robin-town' },
  { name: 'wifpool', slug: 'wifpool' },
  { name: 'Flat Fee', slug: 'flat-fee' },
  { name: 'Flat Street', slug: 'flat-street' },
  { name: 'Echo', slug: 'echo' },
  { name: 'PTone Agent Wallet', slug: 'ptone-agent-wallet' },
  { name: 'Flat League', slug: 'flat-league' },
  { name: 'Wif Worlds', slug: 'wif-worlds' },
  { name: 'Hoodie Bot', slug: 'hoodie-bot' },
  { name: 'Proofward', slug: 'proofward' },
  { name: 'Stock Fair', slug: 'stock-fair' },
  { name: 'Fallpit', slug: 'fallpit' },
  { name: 'RALLY', slug: 'rally' },
  { name: 'SEMALAM', slug: 'semalam' },
  { name: 'Flat Desk', slug: 'flat-desk' },
  { name: 'WIF League', slug: 'wif-league' },
  { name: 'WIF Quest', slug: 'wif-quest' },
  { name: 'Molt World', slug: 'molt-world' },
  { name: 'Lastbell', slug: 'lastbell' },
] as const;

export const TEMPLATES = {
  goat: {
    title: 'Who is the GOAT? — the rematch',
    options: GOAT_NAMES,
    duration: 7 * 86400,
    prize: '0',
    winners: '0',
    heading: 'Start the GOAT rematch',
    blurb: 'Run your own GOAT rematch: 32 candidates from World is Fair’s public GOAT results, 7 days, 1 $WIF per vote. Edit anything, add pictures, then create. A prize pool for a random voter draw is optional (prize fields below).',
  },
  'peoples-pick': {
    title: "People's Pick — who should win the World is Flat hackathon?",
    options: PEOPLES_PICK.map((p) => p.name),
    duration: 7 * 86400,
    prize: '0',
    winners: '0',
    details: 'https://worldisflat.fun/build',
    heading: "Start People's Pick",
    blurb: 'A community vote on the World is Flat hackathon. Flatland plus 31 official entries are prefilled (the contract holds at most 32 options; omitted: Multiplier, Santa, AtlasPad, Zeron, Ajo, HireWif — swap any in). Project pages live at worldisflat.fun/build/<slug>. 7 days, 1 $WIF per vote. Edit anything, then create.',
  },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;

import { afterEach, describe, expect, it, vi } from 'vitest';
import { telegramCalls, type TgElection } from '../_lib/telegram.ts';
import { handle } from '../_lib/handler.ts';

const A = (n: number) => ('0x' + n.toString(16).padStart(40, '0')) as `0x${string}`;
const E: TgElection = { id: 3, title: 'Which logo wins?', status: 'open', voteCostWei: (10n ** 18n).toString(), url: 'https://f.test/#/e/3', share: 'https://f.test/share/3', end: Math.floor(Date.now() / 1000) + 7200, burnedWif: 3,
  options: [0, 1].map((i) => ({ index: i, letter: 'AB'[i], name: ['Sun', 'Sea'][i], votes: [2, 1][i], share: [2 / 3, 1 / 3][i], depositAddress: A(200 + i), voteUrl: `https://f.test/v/3/${i}` })) };
const msg = (text: string, type = 'private') => ({ message: { message_id: 7, chat: { id: 99, type }, text } });

describe('telegram brain', () => {
  it('/start and /elections', async () => {
    const [s] = await telegramCalls(msg('/start'), [E], 'https://f.test');
    expect(s.method).toBe('sendMessage'); expect(String(s.body.text)).toContain('/vote');
    const [l] = await telegramCalls(msg('/elections@FlatBot'), [E], 'https://f.test');
    expect(String(l.body.text)).toContain('#3 Which logo wins?');
    expect((l.body as any).reply_markup.inline_keyboard[0][0].url).toBe('https://f.test/share/3');
    const [none] = await telegramCalls(msg('/elections'), [], 'https://f.test');
    expect(String(none.body.text)).toContain('No open elections');
  });
  it('/vote returns the one-tap link and the deposit address; /results shows the tally', async () => {
    const [v] = await telegramCalls(msg('/vote 3 B'), [E], 'https://f.test');
    expect(String(v.body.text)).toContain(A(201).slice(0, 2)); // checksummed deposit address of option B
    expect(String(v.body.text).toLowerCase()).toContain(A(201).toLowerCase());
    const urls = (v.body as any).reply_markup.inline_keyboard.flat().map((b: any) => b.url);
    expect(urls).toContain('https://f.test/v/3/1');
    expect(urls.every((u: string) => u.startsWith('https://'))).toBe(true);
    const [r] = await telegramCalls(msg('/results 3'), [E], 'https://f.test');
    expect(String(r.body.text)).toMatch(/A .*67%.*Sun \(2\)/);
    const [bad] = await telegramCalls(msg('/vote 9 A'), [E], 'https://f.test');
    expect(String(bad.body.text)).toContain('couldn’t find');
    const [help] = await telegramCalls(msg('/vote'), [E], 'https://f.test');
    expect(String(help.body.text)).toContain('Usage');
  });
  it('inline mode shares an election with option buttons', async () => {
    const [a] = await telegramCalls({ inline_query: { id: 'q1', query: '3' } }, [E], 'https://f.test');
    expect(a.method).toBe('answerInlineQuery');
    const res = (a.body as any).results[0];
    expect(res.input_message_content.message_text).toContain('Which logo wins?');
    expect(res.reply_markup.inline_keyboard[0][0].url).toBe('https://f.test/v/3/0');
  });
  it('ignores group chatter without a command', async () => {
    expect(await telegramCalls(msg('hello everyone', 'supergroup'), [E], 'https://f.test')).toEqual([]);
  });
});

describe('webhook route degrades without a token', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('GET reports unconfigured; POST is 503 and sends nothing', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const env = { APP_URL: 'https://f.test' };
    const g: any = await (await handle(new Request('https://f.test/api/telegram'), env)).json();
    expect(g.configured).toBe(false);
    const p = await handle(new Request('https://f.test/api/telegram', { method: 'POST', body: JSON.stringify(msg('/start')) }), env);
    expect(p.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    const w = await handle(new Request('https://f.test/api/telegram', { method: 'POST', body: '{}' }), { ...env, TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_WEBHOOK_SECRET: 'sek' });
    expect(w.status).toBe(403);
  });
});

describe('webhook route with a token (Telegram API mocked)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('answers /elections and /vote through the snapshot', async () => {
    const now = Math.floor(Date.now() / 1000);
    const dep = { chainId: 4663, deployBlock: 1, wif: A(1), usdg: A(2), tallier: A(3), entropy: A(4), standing: A(5), flatland: A(6), boxImpl: A(7), gate: A(8), participation: A(9), buyback: A(10), basket: A(11), accountFactory: A(12), paymaster: A(13) };
    const el = { id: 1, creator: A(50), title: 'Pick one', options: ['X', 'Y'], metaURI: '', start: now - 10, end: now + 3600, voteCost: (10n ** 18n).toString(), tallier: A(3), executor: A(0), winners: 0, prizeToken: A(1), status: 'open', statusRaw: 1, winner: 0, executed: false, tallies: [1, 0], chainTally: [1, 0], depositTally: [0, 0], depositsSubmitted: false, depositRoot: '0x', depositCount: 0, challengeEnds: 0, openChallenges: 0, burned: (10n ** 18n).toString(), prizePool: '0', drawBlock: 0, seed: '0x', chainVotes: [{ voter: A(100), option: 0, block: 1, logIndex: 0, ts: now, tx: ('0x' + '1'.padStart(64, '0')) as `0x${string}` }], depositVotes: [], depositAddresses: [A(200), A(201)], collapsed: [], challenges: [] };
    const snap = { version: 1, generatedAt: now, head: 10, deployment: dep, totals: { wifBurned: '1', electionBurned: '0', gateBurned: '0', buybackBurned: '0', votes: 1, elections: 1, gates: 0, participants: 1, acts: 0 }, elections: [el], gates: [], basket: null, countries: {}, voterCountry: {}, standing: {} };
    const sent: any[] = [];
    vi.stubGlobal('fetch', async (u: string, init: any) => { sent.push({ u, body: JSON.parse(init.body) }); return new Response('{"ok":true}'); });
    const env = { APP_URL: 'https://f.test', TELEGRAM_BOT_TOKEN: 'TESTTOKEN', getSnapshot: async () => snap };
    const post = (m: unknown) => handle(new Request('https://f.test/api/telegram', { method: 'POST', body: JSON.stringify(m) }), env);
    const r1: any = await (await post(msg('/elections'))).json();
    expect(r1.ok).toBe(true);
    expect(sent[0].u).toBe('https://api.telegram.org/botTESTTOKEN/sendMessage');
    expect(sent[0].body.text).toContain('#1 Pick one');
    await post(msg('/vote 1 b'));
    expect(sent[1].body.text).toContain('Your vote: B — Y');
    expect(JSON.stringify(sent[1].body.reply_markup)).toContain('https://f.test/v/1/1');
    const res = await post(msg('/start'));
    expect(JSON.stringify(await res.json())).not.toContain('TESTTOKEN');
  });
});

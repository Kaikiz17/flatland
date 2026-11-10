import { describe, expect, it } from 'vitest';
import { replyTo, electionIdFrom, type ElectionInfo } from '../src/reply.js';
import { handleMention, toTweet } from '../src/x.js';
import { runTelegram } from '../src/telegram.js';

const A = (n: number) => ('0x' + n.toString(16).padStart(40, '0')) as `0x${string}`;
const E: ElectionInfo = { id: 7, title: 'Pick a chain snack', status: 'open', voteCostWei: (10n ** 18n).toString(), url: 'https://flat.example/#/e/7', options: [{ index: 0, name: 'Jollof', depositAddress: A(0xa0) }, { index: 1, name: 'Suya', depositAddress: A(0xa1) }, { index: 2, name: 'Plantain', depositAddress: A(0xa2) }] };
const lookup = async (id: number) => (id === 7 ? E : id === 8 ? { ...E, id: 8, status: 'finalized' } : null);

describe('bot brain', () => {
  it('extracts election ids from links', () => {
    expect(electionIdFrom('see https://flat.example/#/e/12?x=1')).toBe(12);
    expect(electionIdFrom('https://flat.example/share/9')).toBe(9);
    expect(electionIdFrom('nothing here')).toBeNull();
  });
  it('"vote B" in reply to a post with the link → deposit address + pay links', async () => {
    const r = await replyTo('@FlatlandBot vote B', 'Vote now https://flat.example/share/7', lookup);
    expect(r.kind).toBe('vote');
    expect(r.text).toContain(A(0xa1).slice(0, 8));
    expect(r.text).toContain('Suya');
    expect(r.buttons[0].url).toContain('ethereum:');
    expect(r.buttons[0].url).toContain('uint256=1000000000000000000');
  });
  it('/vote <id> <label> works with option names', async () => {
    const r = await replyTo('/vote 7 plantain', undefined, lookup);
    expect(r.kind).toBe('vote');
    expect(r.text).toContain('Plantain');
  });
  it('asks which option when it can not tell, and refuses closed/unknown elections', async () => {
    expect((await replyTo('/vote 7 banana', undefined, lookup)).kind).toBe('ambiguous');
    expect((await replyTo('/vote 8 A', undefined, lookup)).kind).toBe('closed');
    expect((await replyTo('/vote 99 A', undefined, lookup)).kind).toBe('unknown');
    expect((await replyTo('hello', undefined, lookup)).kind).toBe('help');
  });
  it('never asks for keys or seed phrases', async () => {
    const r = await replyTo('vote A', 'https://flat.example/#/e/7', lookup);
    expect(r.text).not.toMatch(/private key|mnemonic|connect your wallet/i);
    expect(r.buttons.every((b) => !/sign|key/i.test(b.url))).toBe(true);
  });
  it('X reply fits in 280 chars and is a dry-run object (nothing posted)', async () => {
    const out = await handleMention({ id: '1', author: '@amaka', text: '@FlatlandBot vote C', parentText: 'Snack vote https://flat.example/share/7' }, lookup);
    expect(out.text.length).toBeLessThanOrEqual(280);
    expect(out.text).toContain(A(0xa2).slice(0, 8));
    expect(out.inReplyTo).toBe('1');
    expect(toTweet({ kind: 'help', text: 'x'.repeat(400), buttons: [] }).length).toBeLessThanOrEqual(275);
  });
  it('telegram loop answers one update through the Bot API (fake fetch, no network)', async () => {
    const sent: any[] = [];
    const fake: typeof fetch = async (url: any, init: any) => {
      const method = String(url).split('/').pop();
      const body = JSON.parse(init.body);
      if (method === 'getUpdates') return new Response(JSON.stringify({ result: [{ update_id: 5, message: { message_id: 3, chat: { id: 42 }, text: 'vote A', reply_to_message: { text: 'https://flat.example/#/e/7' } } }] }));
      sent.push(body);
      return new Response(JSON.stringify({ ok: true }));
    };
    await runTelegram('TEST', lookup, { fetchFn: fake, once: true, log: () => {} });
    expect(sent).toHaveLength(1);
    expect(sent[0].chat_id).toBe(42);
    expect(sent[0].text).toContain('Jollof');
    expect(sent[0].reply_markup.inline_keyboard.every((r: any) => r[0].url.startsWith('https://'))).toBe(true);
  });
});

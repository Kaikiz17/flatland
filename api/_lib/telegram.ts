/**
 * Telegram webhook brain for the `flatland` worker (POST /api/telegram). Pure: update in -> list of Bot API calls out, so it is unit-tested
 * without any network. The route (handler.ts) sends the calls using the TELEGRAM_BOT_TOKEN Worker secret and degrades (503, no side effects)
 * when the secret is not set.
 * Commands: /start /elections /vote <id> <opt> /results <id>, inline mode ("@bot", "@bot 3") to share an election into any chat.
 * The bot never asks for keys and never votes for the user: it returns a one-tap vote link + the deposit address for the "send 1 $WIF" path.
 */
import { replyTo, HELP, type ElectionInfo } from '../../packages/bot/src/reply.ts';

export interface TgElection {
  id: number; title: string; status: string; voteCostWei: string; url: string; share: string; end: number; burnedWif: number;
  options: { index: number; letter: string; name: string; votes: number; share: number; depositAddress: string; voteUrl: string }[];
}
export interface TgCall { method: string; body: Record<string, unknown> }

const bar = (p: number) => '█'.repeat(Math.round(p * 10)).padEnd(10, '░');
const left = (end: number) => { const d = end - Math.floor(Date.now() / 1000); return d <= 0 ? 'ended' : d >= 86400 ? `${Math.floor(d / 86400)}d ${Math.floor((d % 86400) / 3600)}h left` : d >= 3600 ? `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m left` : `${Math.max(1, Math.floor(d / 60))}m left`; };

export function tally(e: TgElection): string {
  const total = e.options.reduce((a, o) => a + o.votes, 0);
  return e.options.map((o) => `${o.letter}  ${bar(o.share)} ${Math.round(o.share * 100)}%  ${o.name} (${o.votes})`).join('\n') + `\n${total} votes · 🔥 ${e.burnedWif} $WIF burned` + (e.status === 'open' ? ` · ${left(e.end)}` : ` · ${e.status}`);
}
const optionButtons = (e: TgElection) => e.options.slice(0, 8).map((o) => [{ text: `${o.letter} · ${o.name}`.slice(0, 40), url: o.voteUrl }]);

export const toInfo = (e: TgElection): ElectionInfo => ({ id: e.id, title: e.title, status: e.status, voteCostWei: e.voteCostWei, options: e.options.map((o) => ({ index: o.index, name: o.name, depositAddress: o.depositAddress as any })), url: e.url });

export async function telegramCalls(update: any, elections: TgElection[], appUrl: string): Promise<TgCall[]> {
  const byId = (id: number) => elections.find((e) => e.id === id) ?? null;
  const open = elections.filter((e) => e.status === 'open').sort((a, b) => b.id - a.id);

  // inline mode: share an election (or the live list) into any chat
  const iq = update.inline_query;
  if (iq) {
    const q = String(iq.query ?? '').trim();
    const idq = /^#?(\d+)$/.exec(q);
    const list = idq ? [byId(Number(idq[1]))].filter(Boolean) as TgElection[] : (open.length ? open : elections.slice().reverse()).filter((e) => !q || e.title.toLowerCase().includes(q.toLowerCase())).slice(0, 10);
    return [{ method: 'answerInlineQuery', body: { inline_query_id: iq.id, cache_time: 5, is_personal: false, results: list.map((e) => ({
      type: 'article', id: String(e.id), title: e.title.slice(0, 80), description: `${e.status === 'open' ? left(e.end) : e.status} · ${e.options.map((o) => o.name).join(' / ')}`.slice(0, 120),
      input_message_content: { message_text: `🗳 ${e.title}\n\n${tally(e)}\n\n1 wallet = 1 vote. Tap an option to vote:`, disable_web_page_preview: true },
      reply_markup: { inline_keyboard: [...optionButtons(e), [{ text: 'Open the live room', url: e.share }]] },
    })) } }];
  }

  const msg = update.message ?? update.edited_message;
  const text: string = (msg?.text ?? '').trim();
  if (!msg || !text) return [];
  const send = (t: string, buttons: { text: string; url: string }[][] = []): TgCall[] => [{ method: 'sendMessage', body: { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: t.slice(0, 4000), disable_web_page_preview: true, ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}) } }];

  const m = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  const cmd = m?.[1]?.toLowerCase();
  const args = (m?.[2] ?? '').trim();

  if (cmd === 'start' || cmd === 'help') {
    return send(`🌍 Flatland — 1 wallet = 1 vote, every vote burns $WIF.\n\n/elections — what is open now\n/vote <id> <option> — get a one-tap vote link + the 1 $WIF deposit address\n/results <id> — live tally\nInline: type the bot's @name in any chat to share an election.\n\nAlso on Flatland: Stocks — the community stock pot — and Sign — petitions, RSVPs, allowlists and access. Each act burns $WIF. After you vote or sign, grab your I voted / I signed card from the page.\n\n${HELP}`, [[{ text: 'Open Flatland', url: appUrl }], [{ text: 'Stocks', url: `${appUrl}/#/basket` }, { text: 'Sign', url: `${appUrl}/#/rails` }]]);
  }
  if (cmd === 'elections' || cmd === 'live') {
    if (!open.length) return send('No open elections right now.', [[{ text: 'Start one', url: `${appUrl}/#/create` }]]);
    const lines = open.slice(0, 8).map((e) => `#${e.id} ${e.title}\n   ${left(e.end)} · ${e.options.reduce((a, o) => a + o.votes, 0)} votes · /results ${e.id}`);
    return send(`Open elections:\n\n${lines.join('\n\n')}\n\nVote: /vote <id> <letter>`, open.slice(0, 8).map((e) => [{ text: `#${e.id} ${e.title}`.slice(0, 48), url: e.share }]));
  }
  if (cmd === 'results') {
    const id = Number(/^#?(\d+)/.exec(args)?.[1]);
    const e = Number.isInteger(id) ? byId(id) : null;
    if (!e) return send('Usage: /results <election #>' + (open[0] ? `  (try /results ${open[0].id})` : ''));
    return send(`🗳 #${e.id} ${e.title}\n\n${tally(e)}`, [[{ text: 'Open the live room', url: e.share }]]);
  }
  if (cmd === 'vote') {
    const rep = await replyTo(text, undefined, async (id) => { const e = byId(id); return e ? toInfo(e) : null; });
    const id = Number(/^#?(\d+)/.exec(args)?.[1]);
    const e = Number.isInteger(id) ? byId(id) : null;
    const optIdx = rep.kind === 'vote' ? /Your vote: ([A-Z])/.exec(rep.text)?.[1] : undefined;
    const btns = rep.buttons.filter((b) => b.url.startsWith('https://')).map((b) => {
      // the "web" button becomes the short one-tap link with a rich preview: /v/<id>/<opt>
      if (e && optIdx && b.label === 'Vote on the web') return [{ text: 'Vote on the web (one tap)', url: `${appUrl}/v/${e.id}/${optIdx.charCodeAt(0) - 65}` }];
      return [{ text: b.label, url: b.url }];
    });
    if (rep.kind === 'help') return send('Usage: /vote <election #> <option letter>, e.g. /vote 3 B\n\n' + (open.length ? 'Open now: ' + open.slice(0, 5).map((x) => `#${x.id}`).join(', ') : 'No open elections yet.'));
    return send(rep.text, btns);
  }
  if (msg.chat?.type === 'private' && cmd === undefined) {
    const rep = await replyTo(text, msg.reply_to_message?.text, async (id) => { const e = byId(id); return e ? toInfo(e) : null; });
    return send(rep.text, rep.buttons.filter((b) => b.url.startsWith('https://')).map((b) => [{ text: b.label, url: b.url }]));
  }
  return [];
}

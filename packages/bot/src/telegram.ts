import { replyTo, type Lookup } from './reply.js';

/** Telegram long-polling loop. Only runs when you explicitly start it with your own TELEGRAM_BOT_TOKEN. */
export async function runTelegram(token: string, lookup: Lookup, opts: { fetchFn?: typeof fetch; once?: boolean; log?: (m: string) => void } = {}) {
  const f = opts.fetchFn ?? fetch;
  const log = opts.log ?? console.log;
  const api = (m: string, body: unknown) => f(`https://api.telegram.org/bot${token}/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);
  let offset = 0;
  do {
    const u = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
    for (const up of u.result ?? []) {
      offset = up.update_id + 1;
      const msg = up.message;
      if (!msg?.text) continue;
      const ctx = msg.reply_to_message?.text ?? msg.reply_to_message?.caption;
      const rep = await replyTo(msg.text, ctx, lookup);
      await api('sendMessage', {
        chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: rep.text, disable_web_page_preview: true,
        // eip681 `ethereum:` links are not allowed as Telegram buttons; only https links go on the keyboard
        reply_markup: { inline_keyboard: rep.buttons.filter((b) => b.url.startsWith('https://')).map((b) => [{ text: b.label, url: b.url }]) },
      });
      log(`replied to ${msg.chat.id}: ${rep.kind}`);
    }
  } while (!opts.once);
}

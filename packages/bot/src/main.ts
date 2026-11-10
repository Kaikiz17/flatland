import { apiLookup, replyTo } from './reply.js';
import { runTelegram } from './telegram.js';
import { handleMention } from './x.js';

const [cmd, ...rest] = process.argv.slice(2);
const api = process.env.API_URL ?? 'http://127.0.0.1:8788';
const lookup = apiLookup(api);
const arg = (n: string) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : undefined; };

if (cmd === 'simulate') {
  // dry run: prints what the bot would answer. Nothing is sent anywhere.
  const text = rest.filter((x, i) => !x.startsWith('--') && !rest[i - 1]?.startsWith('--')).join(' ') || 'vote B';
  const ctx = arg('context') ?? (arg('election') ? `https://flatland/#/e/${arg('election')}` : undefined);
  const r = await replyTo(text, ctx, lookup);
  console.log('— Telegram reply —\n' + r.text + '\n' + r.buttons.map((b) => `[${b.label}] ${b.url}`).join('\n'));
  console.log('\n— X reply (dry-run, not posted) —\n' + (await handleMention({ id: '0', author: '@someone', text, parentText: ctx }, lookup)).text);
} else if (cmd === 'telegram') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.error('Set TELEGRAM_BOT_TOKEN (create one with @BotFather). Nothing runs without it.'); process.exit(1); }
  console.log('starting Telegram long-poll against', api);
  await runTelegram(token, lookup);
} else {
  console.log('usage:\n  simulate "vote B" --election 1     dry-run, prints replies\n  telegram                           long-poll with TELEGRAM_BOT_TOKEN (you provide it)\nEnv: API_URL (default http://127.0.0.1:8788)');
}

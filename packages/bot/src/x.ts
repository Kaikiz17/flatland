import { replyTo, type Lookup, type Reply } from './reply.js';

export interface Mention { id: string; text: string; author: string; parentText?: string; parentUrls?: string[] }
/** X replies are limited to 280 chars: keep the essentials (option, address, one link). Rendering only — posting is NOT implemented here. */
export function toTweet(rep: Reply): string {
  if (rep.kind !== 'vote') return rep.text.split('\n')[0].slice(0, 275);
  const addr = /0x[0-9a-fA-F]{40}/.exec(rep.text)?.[0] ?? '';
  const choice = /Your vote: (.+)/.exec(rep.text)?.[1] ?? '';
  const pay = rep.buttons.find((b) => b.label === 'Vote on the web')?.url ?? '';
  return `Your vote: ${choice}\nSend 1 $WIF from your wallet to ${addr}\nOne wallet = one vote.\n${pay}`.slice(0, 280);
}

/** Pure handler for one mention → the reply text that WOULD be posted. A real poster is deliberately out of scope. */
export async function handleMention(m: Mention, lookup: Lookup): Promise<{ to: string; inReplyTo: string; text: string }> {
  const ctx = [m.parentText, ...(m.parentUrls ?? [])].filter(Boolean).join(' ');
  const rep = await replyTo(m.text, ctx, lookup);
  return { to: m.author, inReplyTo: m.id, text: toTweet(rep) };
}

import type { Address } from 'viem';
import { parseVoteText, voteLinks, optionLetter } from '@flatland/core';

/** The slice of the public API (/api/elections/:id) the bot needs. */
export interface ElectionInfo {
  id: number;
  title: string;
  status: string;
  voteCostWei: string;
  options: { index: number; name: string; depositAddress: Address }[];
  url: string;
}
export type Lookup = (id: number) => Promise<ElectionInfo | null>;

export interface Reply { text: string; buttons: { label: string; url: string }[]; kind: 'vote' | 'help' | 'closed' | 'unknown' | 'ambiguous' }

const ID_RE = [/#\/e\/(\d+)/, /\/share\/(\d+)/, /\/elections?\/(\d+)/i, /\belection\s*#?(\d+)/i];
export function electionIdFrom(...texts: (string | undefined)[]): number | null {
  for (const t of texts) {
    if (!t) continue;
    for (const re of ID_RE) { const m = re.exec(t); if (m) return Number(m[1]); }
  }
  return null;
}

export const HELP = 'Reply “vote B” to an election post (or /vote <election #> B). I’ll send you a ready-to-pay 1 $WIF link — I never ask for keys and never vote for you. One wallet = one vote; every vote burns $WIF.';

/**
 * Core bot brain, shared by Telegram and X.
 * @param text     the user's message ("@FlatlandBot vote B", "/vote 3 b", "b")
 * @param context  text of the post/message being replied to (contains the election link) — optional
 */
export async function replyTo(text: string, context: string | undefined, lookup: Lookup): Promise<Reply> {
  const cmd = /^\/vote(?:@\w+)?\s+#?(\d+)\s+(.+)$/i.exec(text.trim());
  const id = cmd ? Number(cmd[1]) : electionIdFrom(text, context);
  const body = cmd ? cmd[2] : text;
  if (!id) return { text: HELP, buttons: [], kind: 'help' };
  const e = await lookup(id);
  if (!e) return { text: `I couldn’t find election #${id}.`, buttons: [], kind: 'unknown' };
  if (e.status !== 'open') return { text: `“${e.title}” is ${e.status} — voting is closed.`, buttons: [{ label: 'See results', url: e.url }], kind: 'closed' };
  const opt = parseVoteText(body.replace(/https?:\/\/\S+/g, ''), e.options.length, e.options.map((o) => o.name));
  if (opt === null) {
    const list = e.options.map((o) => `${optionLetter(o.index)}) ${o.name}`).join('\n');
    return { text: `“${e.title}”\nWhich one? Reply with a letter:\n${list}`, buttons: [{ label: 'Open election', url: e.url }], kind: 'ambiguous' };
  }
  const o = e.options[opt];
  const cost = Number(BigInt(e.voteCostWei) / 10n ** 14n) / 1e4;
  const l = voteLinks({ appUrl: e.url.replace(/\/#.*$/, ''), electionId: id, option: opt, deposit: o.depositAddress, voteCost: BigInt(e.voteCostWei) });
  return {
    kind: 'vote',
    text: `🗳 “${e.title}”\nYour vote: ${optionLetter(opt)} — ${o.name}\nSend exactly ${cost} $WIF from the wallet that should vote to:\n${l.depositAddress}\n(One vote per wallet. Send from your own wallet, not an exchange.)`,
    buttons: [
      { label: `Pay ${cost} WIF in wallet`, url: l.eip681 },
      { label: 'MetaMask', url: l.metamask },
      { label: 'Trust Wallet', url: l.trust },
      { label: 'Vote on the web', url: l.web },
    ],
  };
}

export function apiLookup(apiBase: string, fetchFn: typeof fetch = fetch): Lookup {
  return async (id) => {
    const r = await fetchFn(`${apiBase.replace(/\/$/, '')}/api/elections/${id}`);
    if (!r.ok) return null;
    const j: any = await r.json();
    return { id: j.id, title: j.title, status: j.status, voteCostWei: j.voteCostWei, options: j.options.map((o: any) => ({ index: o.index, name: o.name, depositAddress: o.depositAddress })), url: j.url };
  };
}

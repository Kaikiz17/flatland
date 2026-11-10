// Cloudflare Pages Function. Set INDEXER_URL (or RPC_URL) and APP_URL in the Pages project env.
// PNG OG cards need a wasm rasteriser on the edge; without one this serves the SVG card (still fine for Telegram/Discord;
// for X, point og:image at a Node deployment of this same handler, or enable the resvg-wasm hook below).
import { handle } from '../../api/_lib/handler.ts';
export const onRequest = (ctx: { request: Request; env: Record<string, string> }) => handle(ctx.request, ctx.env);

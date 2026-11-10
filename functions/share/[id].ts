import { handle } from '../../api/_lib/handler.ts';
export const onRequest = (ctx: { request: Request; env: Record<string, string> }) => handle(ctx.request, ctx.env);

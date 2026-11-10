// Vercel function (Node runtime, Web-standard Request/Response). Env: INDEXER_URL | RPC_URL, APP_URL.
import { handle } from './_lib/handler.ts';
import { join } from 'node:path';

const env = () => ({
  INDEXER_URL: process.env.INDEXER_URL, RPC_URL: process.env.RPC_URL, APP_URL: process.env.APP_URL, DEPLOYMENT_URL: process.env.DEPLOYMENT_URL,
  FONT_FILES: process.env.FONT_FILES ?? join(process.cwd(), 'api/assets/LiberationSans-Bold.ttf'),
});
export default { fetch: (req: Request) => handle(req, env()) };
export const GET = (req: Request) => handle(req, env());
export const POST = (req: Request) => handle(req, env());
export const OPTIONS = (req: Request) => handle(req, env());

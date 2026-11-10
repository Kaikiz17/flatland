import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fully static output (dist/): host on Vercel, Cloudflare Pages, GitHub Pages or IPFS. Hash routing => no server rewrites needed.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
  define: { global: 'globalThis' },
});

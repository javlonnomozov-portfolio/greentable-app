import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: '/admin/',
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('../dist/admin', import.meta.url)), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  // `npm run dev` (server) + `npx vite --config admin/vite.config.ts` — API so'rovlari lokal serverga.
  server: { proxy: { '/admin/api': 'http://localhost:3000' } },
});

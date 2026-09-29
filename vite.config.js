import { defineConfig } from 'vite';

// base: './' — чтобы сборка работала и на GitHub Pages в подпапке.
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});

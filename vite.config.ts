import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import pkg from './package.json';
import { precachePlugin } from './src/pwa/precache';

export default defineConfig({
  // Relative asset paths so the Electron build can load dist/ over file://
  base: './',
  plugins: [react(), tailwindcss(), precachePlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          // A local .env.local must not change what the tests see: no server unless a test says so.
          env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
          // Screen tests that pass alone in a second can pass 5 s when every worker is busy.
          testTimeout: 15_000,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
        },
      },
      // The server's SQL runs on PGlite in Node, without the browser setup.
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['supabase/tests/**/*.test.ts'] },
      },
    ],
  },
});

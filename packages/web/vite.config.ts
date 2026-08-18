import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Absolute, so `vite --config packages/web/vite.config.ts` from the repo root and
  // `npm run dev` from inside the package resolve the same project.
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Must stay in step with the `paths` entries in tsconfig.json. `@mini-cloud/shared`
      // resolves to source because its published build is CommonJS; see the note there.
      '@mini-cloud/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      // Not the package root: that entry point pulls in the `ws`-based subscriber,
      // which does not resolve in a browser bundle. `browser.ts` is the HTTP half.
      '@mini-cloud/client': fileURLToPath(new URL('../client/src/browser.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // No dev proxy on purpose: the console talks to the service cross-origin in
    // development exactly as it does in production, so a missing
    // MINI_CLOUD_CORS_ORIGINS fails here rather than only after deployment.
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // React and the Radix primitives change only when a dependency is
            // upgraded, so holding them in their own chunk means editing a page does
            // not invalidate 140kB of vendor code in everyone's cache.
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  envDir: here,
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build can be hosted from any static folder.
  base: './',
  build: {
    target: 'es2022',
    // three.js alone is about 600 kB minified, the app about 200 kB; the warning adds nothing
    // until three.js is split out (next steps). Export already loads on demand.
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Slow sweeps run separately: npm run test:stress (vitest.stress.config.ts).
    exclude: ['tests/stress/**', 'node_modules/**'],
    environment: 'node',
  },
});

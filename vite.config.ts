import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build can be hosted from any static folder.
  base: './',
  build: {
    target: 'es2022',
    // three.js alone is about 600 kB minified; the warning adds nothing until we code-split.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Slow sweeps run separately: npm run test:stress (vitest.stress.config.ts).
    exclude: ['tests/stress/**', 'node_modules/**'],
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';

/** Slow randomized sweeps: npm run test:stress. Must pass before merging a milestone into main. */
export default defineConfig({
  test: {
    include: ['tests/stress/**/*.test.ts'],
    environment: 'node',
    // A single seed can take a few seconds on a slow machine.
    testTimeout: 30_000,
  },
});

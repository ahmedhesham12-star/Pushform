import { defineConfig } from 'vitest/config';

/** Slow randomized sweeps: npm run test:stress. Must pass before merging a milestone into main. */
export default defineConfig({
  test: {
    include: ['tests/stress/**/*.test.ts'],
    environment: 'node',
    // The slowest seed (sweep 6, 4169) takes about 21 s alone and up to 35 s with the eight sweeps running side by side.
    testTimeout: 60_000,
  },
});

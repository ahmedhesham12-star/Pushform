import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build can be hosted from any static folder.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'cli/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});

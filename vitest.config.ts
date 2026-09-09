import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/**'],
  },
  resolve: {
    // Tests run against SOURCE, not dist, so a failing test never depends on a build step.
    alias: {
      '@prepkit/schema': new URL('./packages/schema/src/index.ts', import.meta.url).pathname,
      '@prepkit/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      '@prepkit/adapters': new URL('./packages/adapters/src/index.ts', import.meta.url).pathname,
      '@prepkit/db': new URL('./packages/db/src/index.ts', import.meta.url).pathname,
    },
  },
});

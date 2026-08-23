import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Integration suites share one Docker Postgres; never race them.
    fileParallelism: false,
  },
});

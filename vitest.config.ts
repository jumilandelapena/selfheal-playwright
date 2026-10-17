import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests-agent/unit/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests-agent/e2e/**/*.test.ts'],
          // The mock end-to-end test runs Playwright several times.
          testTimeout: 600_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});

import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 41733);
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // Retry flaky tests up to 2 times (0 in CI for fast failure visibility)
  retries: isCI ? 0 : 2,
  // Run tests in parallel (1 in CI for determinism)
  workers: isCI ? 1 : undefined,
  // Stop after 5 failures to avoid cascading noise
  maxFailures: isCI ? 5 : undefined,
  // Reporters: list (console) + HTML (browsable report)
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  // Global output directory
  outputDir: 'test-results/artifacts',
  webServer: {
    command: `PORT=${port} pnpm dev:renderer -- --host localhost --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

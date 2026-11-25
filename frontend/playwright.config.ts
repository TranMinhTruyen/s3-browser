import { defineConfig } from '@playwright/test';

// E2E tests on the real app in Wails server mode (Go backend + s3b_db.dll), run locally only:
//   bun run e2e:build   build the server exe and the DLL
//   bun run e2e         run the tests (S3 tests need E2E_S3_ENDPOINT, E2E_S3_ACCESS_KEY, E2E_S3_SECRET_KEY)
// E2E_DIR runs the specs of another folder instead of ./e2e (qa-tester evidence in sprints/sprint-NN/evidence/<branch>).
const port = process.env.E2E_PORT ?? '8299';

export default defineConfig({
  testDir: process.env.E2E_DIR ?? './e2e',
  outputDir: './e2e/.run/results',
  // One app instance shares profiles and settings, so specs run one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './e2e/.run/report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: port },
  },
});

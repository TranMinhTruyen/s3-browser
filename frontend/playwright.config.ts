import { defineConfig } from '@playwright/test';

// Chạy kiểm thử E2E trên ứng dụng thật ở chế độ máy chủ Wails (backend Go + s3b_db.dll), chỉ chạy cục bộ:
//   bun run e2e:build   build file exe máy chủ và DLL
//   bun run e2e         chạy kiểm thử (kiểm thử S3 cần E2E_S3_ENDPOINT, E2E_S3_ACCESS_KEY, E2E_S3_SECRET_KEY)
// E2E_DIR chạy các spec trong thư mục khác thay cho ./e2e (bằng chứng của qa-tester nằm trong sprints/sprint-NN/evidence/<branch>).
const port = process.env.E2E_PORT ?? '8299';

export default defineConfig({
  testDir: process.env.E2E_DIR ?? './e2e',
  outputDir: './e2e/.run/results',
  // Một instance của ứng dụng dùng chung hồ sơ và cài đặt, vì vậy các spec chạy lần lượt.
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

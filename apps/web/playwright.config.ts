export default {
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  outputDir: '.next/playwright-test-results',
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run serve:test',
    port: 4173,
    reuseExistingServer: false,
    timeout: 10_000,
  },
};

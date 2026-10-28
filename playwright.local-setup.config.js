import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'local-setup.spec.js', workers: 1, timeout: 45000,
  outputDir: 'artifacts/local-setup-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8129', viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: `${process.env.DASHBOARD_PYTHON || 'python3'} tests/local_setup_preview.py --port 8129`,
    url: 'http://127.0.0.1:8129/api/local-health', reuseExistingServer: false,
  },
});

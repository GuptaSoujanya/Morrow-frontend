import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'beta.spec.js', timeout: 30000,
  workers: 1, reporter: 'list', outputDir: 'artifacts/beta-results',
  use: {
    baseURL: 'http://127.0.0.1:8116',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start -- --mode beta --port 8116',
    url: 'http://127.0.0.1:8116', reuseExistingServer: !process.env.CI,
  },
});

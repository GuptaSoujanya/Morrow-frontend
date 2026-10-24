import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: ['activity-signin.spec.js', 'activity-browsers.spec.js'], timeout: 30000,
  workers: 1, fullyParallel: false, reporter: 'list',
  outputDir: 'artifacts/activity-signin-results',
  use: {
    baseURL: process.env.ONBOARDING_DASHBOARD_URL || 'http://127.0.0.1:8102',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});

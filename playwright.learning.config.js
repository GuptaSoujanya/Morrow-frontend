import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: ['learning.spec.js', 'learning-workspace.spec.js', 'compiler.spec.js'], timeout: 35000,
  workers: 1, fullyParallel: false, reporter: 'list', outputDir: 'artifacts/learning-results',
  use: { baseURL: 'http://127.0.0.1:8117', viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: '../venv/bin/python tests/learning_preview.py', url: 'http://127.0.0.1:8117', reuseExistingServer: false },
});

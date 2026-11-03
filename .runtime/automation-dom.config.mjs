import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'automation-dom.spec.mjs', timeout: 20000,
  workers: 1, reporter: 'list', outputDir: '../artifacts/automation-dom',
  use: { launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } } });

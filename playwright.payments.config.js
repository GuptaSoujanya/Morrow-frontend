import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config.js';

export default defineConfig({ ...accounts, testMatch: 'payments.spec.js', outputDir: 'artifacts/payments-results' });

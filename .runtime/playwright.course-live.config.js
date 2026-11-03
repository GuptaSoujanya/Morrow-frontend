import base from '../playwright.config.js';
import { fileURLToPath } from 'node:url';

export default { ...base, testDir: fileURLToPath(new URL('.', import.meta.url)), testMatch: ['course-live-error.spec.js'],
  outputDir: fileURLToPath(new URL('../artifacts/course-live-error/results', import.meta.url)),
  webServer: { ...base.webServer, cwd: fileURLToPath(new URL('..', import.meta.url)) },
};

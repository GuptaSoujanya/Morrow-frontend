import learning from './playwright.learning.config.js';

export default { ...learning, testMatch: ['learning-reader-polish.spec.js'], outputDir: 'artifacts/reader-polish-results' };

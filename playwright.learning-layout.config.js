import learning from './playwright.learning.config.js';

export default { ...learning, testMatch: ['learning-layout.spec.js'], outputDir: 'artifacts/learning-layout-results' };

import learning from './playwright.learning.config.js';

export default { ...learning, testMatch: ['lesson-reader-scroll.spec.js'], outputDir: 'artifacts/lesson-scroll-results' };

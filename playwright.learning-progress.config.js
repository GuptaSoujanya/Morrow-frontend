import learning from './playwright.learning.config.js';

export default { ...learning, testMatch: ['learning-progress-ui.spec.js'], outputDir: 'artifacts/learning-progress-results' };

import learning from './playwright.learning.config.js';

export default { ...learning, testMatch: ['course-timer.spec.js'], outputDir: 'artifacts/course-timer-results' };

import { avatar, workspaceAvatar } from './identity.js';

// The same saved artwork identifies a destination in navigation and search.
const artwork = {
  overview: 15, bots: 49, pipeline: 28, todo: 27, records: 43,
  learning: 50, data: 26, analytics: 45, reports: 29,
  files: 44, connections: 22, setup: 31, onboarding: 46,
  plans: 41, admin: 46, more: 40, search: 47,
  naukri: 0, boards: 1, sites: 5, profile: 6, linkedin: 7,
  'linkedin-profile': 8, outreach: 9, resume: 10,
};
const learningArtwork = { today: 41, dsa: 30, practice: 43, resume: 47, courses: 30, library: 25, progress: 45 };

export function navigationArt(key, className = '', learningSection = '') {
  const index = key === 'account' ? workspaceAvatar()
    : key === 'learning' && learningSection ? learningArtwork[learningSection] ?? artwork.learning
    : artwork[key] ?? 40;
  return avatar(index, `navigation-art ${className}`.trim());
}

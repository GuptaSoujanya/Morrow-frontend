# Learning implementation checklist

- [x] One Learning workspace with Today, Curriculum, DSA, Discover, Library and Progress.
- [x] Daily and weekly lessons covering system design, full stack and AI agents.
- [x] Resume topics alongside the curriculum and course library.
- [x] Match the selected resume, identify older material and preserve completed learning when the resume changes.
- [x] DSA topic explanations, worked examples and two practice questions.
- [x] Discover technology, relevant companies and GitHub repositories.
- [x] Validate exactly two fresh, distinct daily research papers, prioritizing AI and resume relevance.
- [x] Separate paper, DSA and repository bookmarks, including manually saved repository links.
- [x] Create, edit and organize source-linked personal notes.
- [x] Finish recovery for interrupted saves, concurrent edits and discovery refreshes.
- [x] Individual learning progress, course breakdowns, activity charts, streaks and badges in Progress.
- [x] Compact focus/date/day/week header and one completion count on Today.
- [x] Show the actual resume focus in the header and curriculum.
- [x] Verify account access and identify any platform integration limitations.
- [x] Run backend, navigation, browser, mobile layout and accessibility checks.
- [x] Make the completed checkout available locally without interrupting active work.

Fresh discovery generation uses the connected research agents. Saved content,
bookmarks, notes and progress remain available without generating new material.

Verified: 309 Python tests, 43 browser tests and 27 navigation tests pass; production
build and whitespace checks pass. Browser coverage includes 1440, 768 and 390 px
layouts, accessibility, failed saves, concurrent edits, safe retries, and account
runtime isolation.

Today UX refinement: removed duplicate area cards, prioritized the next lesson,
separated the study list from optional discoveries, grouped missing material, and
kept action labels readable on phones. Header and Progress use compact summaries.
Idle Activity access is in the tools row so it cannot cover lesson actions; active
jobs and alerts retain their visible launcher. Targeted mobile checks pass.

Running checkout: http://127.0.0.1:8116/#/learning. The existing dashboard on port
8100 belongs to a different checkout and remains running. This checkout currently
has no selected resume; choose one in Preferences before generating personal material.

Optional accounts mode supports private notes, categorized bookmarks, profile focus
and library-reading progress. Per-account AI generation and DSA execution still need
a tenant runner; those actions explicitly remain unavailable. The full learning and
generation flow is available in the local beta and the configured workspace owner.
Live research generation was not invoked during validation; research source checks
depend on the configured researchers, and tests use isolated fixtures.

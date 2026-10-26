# Morrow UX verification — October 23, 2026

Local production dashboard: http://127.0.0.1:8100. This report supersedes the earlier Orbit scores and screen counts.

## Local answer reuse and activation — October 24, 2026

The final 267-test answer suite passed, covering intent/cosine matching, meaningful
symbols and numeric thresholds, learned provenance, concurrent writes, scope and
manual-edit invalidation, dropdowns, multi-select, and existing assist behavior.
Three real Python processes asking a synthetic question made one mocked model call
and wrote one answer. A separate 65-test runner/API suite passed, and three pipeline
checks verified output isolation and forwarding private save events without adding
them to ordinary logs. No external model or live application was invoked by these tests.

After explicit user approval, the two active agents were stopped through graceful
dashboard shutdown. Their process IDs and the old service exited. Morrow restarted
with current backend sources, returned HTTP 200, and the answer-sheet endpoint
returned HTTP 401 to an anonymous request. The agents were not restarted.

## Live answer-sheet updates — October 24, 2026

Successful answer saves emit a bounded, run-token-verified event over the existing Activity stream. Reserved records and their tokens never enter retained logs, including oversized malformed records. Replay uses stable IDs; account changes clear private notifications, pending requests, and desktop alerts. Review opens the actual owner-only automation answer sheet, separately from private account files. Revision checks and the shared file lock prevent user edits from overwriting answers saved concurrently by a bot.

Verification includes 18 focused backend tests (with a real isolated child emitter), 34 account-proxy tests, 25 stream/account-scope unit tests, and five fully mocked browser cases. Browser coverage checks actionable alerts, silent initial history, replay deduplication, draft/focus preservation, conflicting saves, explicit desktop permission, account reset, stale-stream rejection, and phone accessibility. Screenshots are `artifacts/answer-notifications/notification-1280.png` and `notification-375.png`. No actual job-board actions or OS desktop notifications were used; the desktop Notification API is simulated in tests.

## Parallel job-site agents — October 24, 2026

Naukri, Hirist, and Instahyre can now be selected together. Each site owns a
persistent browser profile; each run owns its résumé output and screenshots.
Duplicate tasks for the same site remain blocked. New lanes are prepared before
any batch process starts, and only closed, managed profiles can seed their sign-ins.
Shared answers, profile history, worklists, reports, and database migrations are
protected against overlapping writers.

All 21 crew-selection browser tests passed with API requests intercepted. Backend
checks covered three simultaneous synthetic processes, unique runtime paths,
same-site conflicts, and stopping one process without stopping its peers. The
eight runtime-isolation tests also passed. A separate real-Chrome test opened
three temporary profiles against a localhost fixture: initial synthetic cookies
were copied safely, later cookies and session storage stayed separate, browser
counts were correct, and closing Hirist left the other two usable. No real provider
site, saved user profile, or job application was used in testing. The production
build passed, and the idle dashboard was restarted to activate the update.

## Setup checklist and Connections — October 24, 2026

The new onboarding flow and persistent Connections page use the existing dashboard
shell. The following focused checks supplement the earlier review below:

| Check | Result |
| --- | --- |
| `npm run test:onboarding` | 36 passed with every API request intercepted; no real browser profiles, account providers, or workflows invoked |
| Authentication/navigation unit suite | 36 passed, including account cancellation, Free navigation, and the shared-runtime ownership boundary |
| Connections HTTP authorization | 13 passed with temporary servers and fake browser sessions; unauthenticated/cross-origin requests denied and non-owner execution remains forbidden |
| Onboarding API and storage regressions | 31 onboarding tests plus 23 existing API/storage/import tests passed against isolated PostgreSQL databases |
| Synthetic API integration on `:8102` | Login, private profile/PDF upload, draft save, local runner snapshot, completion, reload, and connection prerequisites passed through the real preview services; workflow execution returned `403` and a second account's artifact download returned `404` |
| Accessibility and responsive layout | Zero axe WCAG 2 A/AA and 2.1 A/AA violations across all four setup steps and Connections; profile/Connections checked at 1440, 768, and 375px with no horizontal overflow |

Coverage includes saved profile facts and PDF selection, draft retention on conflicts,
confirmation before changing an account, changed and cleared email persistence, polling
without losing input focus, late responses after browser-group/route/account changes,
and runner preparation failures leaving onboarding unfinished. Screenshots are in
`artifacts/onboarding/`; desktop review and mobile setup/Connections were visually
inspected. Real Google/job-site sign-ins, OTP/CAPTCHA handling, live AI runs, and
multiuser execution were not tested. PDF inputs support text extraction and unchanged
attachments; automatic tailoring still requires a LaTeX source. Saved onboarding does
not certify that a browser session will remain valid.

The saved-data and field-validation update adds 19 regression cases. Existing facts,
resume selections, and platform choices show saved or draft states without claiming
that unverified sign-ins are ready. Cases cover whitespace-only required fields,
invalid emails, first-error focus, server validation persistence, failed replacement
uploads retaining the selected resume, older saved resume pagination, and review
blocking unsaved profile changes. Provider errors remain beside their own account
card. Validation no longer shifts a button between pointer-down and click. The
production build and 36 authentication/navigation unit tests also passed; refreshed
desktop, tablet, and mobile accessibility scans reported zero violations.

The API integration used `artifacts/verify-onboarding-api.py` with synthetic preview
accounts and a generated PDF. It opened no automation browser and submitted no
applications. This verifies the isolated preview services; it does not establish
deployment or readiness of the main account API. Separately, the local main API
was rebuilt with its unchanged, verified dependency manifests; migration
`005_onboarding` completed and database readiness returned `ready`. Its OpenAPI
schema includes onboarding GET/PUT. The dashboard on `:8100` returns `401` for
anonymous onboarding and Connections requests. No real account setup was changed.

PDF/session/runner checks used synthetic inputs and mocked browser/process calls:
136 focused tests plus seven existing Google-login regressions passed. A final
48-test runner setup/HTTP authorization check passed after server cleanup handling
was hardened. Real provider browser login remains a manual check.

The remaining PDF consumers passed 129 targeted regressions covering resume-based
learning, explicit/configured input paths, contact redaction, grounded long-form and
chat answers, fabrication rejection, and existing tailoring behavior. Flows recovery
guidance passed 57 Python checks and all eight browser scenarios (the two affected
scenarios passed on rerun after updating the Connections link expectation and the
browser inventory fixture). Its UI directs sign-in failures to Connections even
when an already-running server returns the previous Bot Crew link.

## Activity sign-in browser controls — October 24, 2026

Activity now includes the setup browser windows as account-scoped controls. Main,
LinkedIn, and parallel lane windows are grouped separately; checking a sign-in and
closing a window reuse the Connections API without replacing saved account hints.
Free accounts can use these controls without requesting owner-only runner data.
Polling pauses when Activity and the browser list are closed, the page is hidden,
or a workflow preview is open. Pending actions remain protected across collapse
and reopen, and terminal check errors remain visible if their window closes.
The focused synthetic regression suite passed all 28 cases with
`npx playwright test --config playwright.activity-signin.config.js`; screenshots
are in `artifacts/activity-signin/`. Desktop and mobile controls were visually
reviewed and passed WCAG 2 A/AA, 2.1 A/AA, and 2.2 AA scans. The production build,
36 onboarding browser tests, 36 authentication/navigation unit tests, and 12
Activity unit tests passed. No real connection or workflow was changed in this check.

## Provider verification and shared browser controls — October 24, 2026

The provider verification and shared-window correction passed 88 Python checks
(40 DOM verification, 35 connection service, 13 HTTP authorization), all 40 onboarding
browser cases, and all 29 Activity cases. The frontend build passed. Fixtures cover
the provider-specific candidate navigation, login/challenge negatives, hidden and
stale controls, unknown/loading pages, email mismatch, per-provider tab reuse, OAuth
continuations, and independent account controls in a shared window. Activity chooses
the targeted provider while preserving a manually selected alternative. Live job-site
sign-ins were not exercised. The dashboard process serving `:8100` was confirmed to
have started after the backend changes; its anonymous session endpoint still rejects
unauthenticated access. Saved sign-in data was not cleared.

Navigation evidence came from the public [Hirist application bundle](https://js-static.hirist.tech/production/24.0.1/_next/static/chunks/pages/_app-1bb487dd7e89c6b5.js),
[Cutshort candidate bundle](https://cdnv2.cutshort.io/_next/static/chunks/pages/profile/%5B...slug%5D-38e047a3d92312a5.js),
and Wellfound's [profile](https://help.wellfound.com/article/829-how-do-profiles-work-what-is-the-difference-between-a-job-profile-and-public-profile)
and [applications](https://help.wellfound.com/article/764-check-applications) documentation.
These establish routes and labels; synthetic DOM tests do not certify every live
authenticated page layout.

## Hirist profile-page verification — October 24, 2026

The Hirist check now opens the canonical `/myprofile` page in the selected Hirist
tab, preserving other providers, browser groups, and Google sign-in in progress.
An already-open canonical profile is not reloaded. Verification requires loaded
account details beside the profile avatar and separate work/education controls;
the static profile template and the recommendation-recipient email cannot verify
an account. Login redirects, profile setup, loading failures, and email mismatch
remain separate outcomes.

All 119 focused Python checks passed: 65 DOM-verification cases, 41 connection-service
cases, and 13 HTTP-authorization cases. These use synthetic pages and temporary
workspaces; no real job-site login or saved browser profile was changed by testing.
The connected browser was unavailable, so live Hirist account verification remains
untested. The idle dashboard at `:8100` was restarted with this change; its anonymous
session endpoint still requires authentication. The selectors were checked against Hirist's public
[profile sidebar](https://js-static.hirist.tech/production/24.0.1/_next/static/chunks/4232.112ed4bacbed528d.js),
[profile sections](https://js-static.hirist.tech/production/24.0.1/_next/static/chunks/6292.45b8309d3962ee13.js),
and [recommendation form](https://js-static.hirist.tech/production/24.0.1/_next/static/chunks/8541.008025eabb8c5829.js).

## LinkedIn stale browser lock — October 24, 2026

The configured LinkedIn profile contained singleton artifacts for a local process
that no longer existed. The old existence-only check disabled sign-in indefinitely.
The replacement permits Chrome's native recovery only for a valid local hostname
and process ID confirmed absent; live, foreign, malformed, inaccessible, and changed
owners remain blocked. Status checks do not delete singleton artifacts or session
data. Workflow reservations and browser-profile locks now have separate guidance.

All 143 focused Python checks passed: 21 lock cases, 65 account-verification cases,
44 connection-service cases, and 13 HTTP-authorization cases. Service fixtures cover
LinkedIn/main isolation and reopening a stale LinkedIn profile without deleting its
artifacts. A read-only check of the configured profile confirmed it is now available
and preserved. The frontend production build also passed. No actual LinkedIn login
was attempted during these checks.

## Browser navigation failure recovery — October 24, 2026

The connection worker previously closed Chrome for every exception, including a
page-load timeout after the window had opened. Navigation timeouts and network
errors now preserve a responsive existing window. Check/Close stay available and
the next check reuses that window. Closed or disconnected windows are released.
Fixed error codes and stages distinguish profile preparation, driver preparation,
startup, navigation, and verification without recording raw exception messages,
page URLs, cookies, or account details in logs.

All 49 connection-service tests and 13 HTTP-authorization tests passed. New synthetic
regressions cover live/dead navigation failures, same-window recovery, startup
classifications, and redaction in API responses, metadata, and logs. A real Chrome
startup smoke test also passed using a temporary blank headless profile; no provider
site was opened and no saved profile was used. A second real-Chrome smoke test loaded
a deliberately stalled local fixture through the connection worker: the timeout
left the browser open with Check and Close enabled. Both temporary profiles were
removed after the tests. The production build passed and the
updated dashboard was restarted. Live LinkedIn completion remains a user check.

## LinkedIn signed-in navigation — October 24, 2026

The prior check accepted the feed's legacy post-composer controls or an expanded
logout link. It missed signed-in profile, jobs, messaging, and settings views. The
shared LinkedIn session detector now recognizes multiple private destinations in
visible member navigation, with account controls where needed. Existing composer
support remains. Login/authwall routes, visible sign-in controls, OTP prompts, and
security-check screens override positive markers. Unknown pages stay retryable;
public profiles and URL strings alone are not proof. Generic editable email inputs
are excluded from LinkedIn account identity.

All 177 focused checks passed: 103 DOM-verification cases (38 new LinkedIn cases),
12 publisher cases, 49 connection-service cases, and 13 HTTP-authorization cases.
The same five synthetic member views pass both Connections and workflow detection.
The existing Naukri no-password fixture now stubs its separately added manual-wait
boundary. The production build passed and the idle dashboard was restarted.
The browser connector was unavailable, so these tests do not certify the user's
live LinkedIn markup. The design follows LinkedIn's documented
[member navigation](https://www.linkedin.com/help/linkedin/answer/a525089) and
[account settings](https://www.linkedin.com/help/linkedin/answer/a1337839).
After restart, the configured workspace's LinkedIn connection changed from
`needs_sign_in` to `connected`, with verification recorded at
`2026-10-24T13:01:24+00:00`. Its later closed-browser status retained that verified
session. This is application-state confirmation of the live retry; the authenticated
page itself was not inspected through the unavailable browser connector.

## Scope

Morrow retains the approved charcoal/lavender direction, dimensional crew and glass shell. The latest Research Studio separates Today, Learning, Resume lab, Library and Progress. Today exposes the selected date’s README, Papers, Tech radar and Company radar, with real heading previews and direct fetch/refresh controls. Learning contains the next unfinished day, saved weekly plans, daily goal and system-design material. Resume lab has its own index and all numbered topics. Readers use the available width and preserve their return URL.

Earlier refinements in this delivery include URL pagination, inline resume PDF preview, 32 selectable workspace avatars, a folded-M logo, local Space Grotesk headings, structured profile editing, grouped preferences, a centered loader and an independently scrolling sidebar. React owns lazy route boundaries and Suspense; TanStack Query caches and deduplicates read requests.

## Verification

| Check | Result |
| --- | --- |
| Production build | Passed; 17 lazy route modules; no react-grab, react-scan or react-doctor in production inputs |
| Browser regression suite | 52 passed; final Research loading-copy cleanup additionally passed 4 targeted checks |
| Python backend, web and pipeline suite | 124 passed |
| Main routes | All 20 at 375, 768 and 1280px, without page overflow or JavaScript exceptions |
| Short laptop layouts | 1280×720, 1366×768 and 1440×900 |
| Research views | All five at 375, 768 and 1280px, including saved and missing dates |
| Accessibility | Zero axe WCAG 2 A/AA, 2.1 A/AA and 2.2 AA violations across desktop routes and all five Research views |
| React Doctor | No issues in the React route adapter |
| Diff whitespace | Passed |

Browser write requests were intercepted; editable-file screenshots use fixtures. Tests did not run bots, change personal profile/settings files, operate schedules or change real course/research completion. Python checks use temporary workspaces and mocks. The requested resume-index repair was performed separately: the old index was backed up under `.memory/backups/`, then README was rebuilt from the 12 existing topic files without AI calls or topic changes.

## Research and progress evidence

- The saved October 22 date exposes all six daily documents, the additional dated note and root research references. Missing October 23 content remains explicitly missing, with a link to the latest saved date.
- Papers, Tech radar and Company radar preview commands target their exact `brief:*` stage and selected date. Cancel sends no run request; failed runs produce an inline error. The existing runner handles confirmed execution and Activity. Actual AI generation was not exercised.
- Daily README and the repaired resume README open in the full-width reader. Resume README contains all 12 topics; Learning and Resume lab remain separate from news.
- Completion is explicit and reversible. Opening a document does not mark it complete. Failed saves retain the prior state and show an error. Today’s completions and paginated completion/reopen history use stored timestamps.
- `.memory/learning.json` is the canonical course/research/plan store. Tests cover legacy migration, reopening without reimporting old completion, module reload, CLI/dashboard coherence, alias deduplication, 16 concurrent process updates, malformed storage and interrupted atomic replacement. Failed writes preserve the last committed JSON.
- The legacy `/course/01-system-design/` URL opens the actual Docsify lesson. Dashboard and course reader share progress controls and storage.
- Date selection, reader return URLs, separate Learning/Resume navigation, source previews and all Research view widths were verified in Chrome.

## Other interaction evidence

- Pagination: Applications and Data hub preserve page, filters and search across reload/Back/Forward. A 100,000-row fixture renders only the selected page; it is a frontend rendering check, not a concurrent-user load test.
- PDF preview: inline contained PDF endpoint, explicit download and fallback link; no automatic download. Backend rejects traversal and escaping symlinks.
- Query cache: repeat reads are reused, manual refresh refetches, successful mutations invalidate, and stale filter responses cannot overwrite the current search. Personal/credential responses are not persisted in browser storage.
- Route resilience: delayed chunks show Suspense loading; failed chunks preserve navigation and recovery. Sidebar scroll remains stable through background polling. Loader centering and reduced motion are checked.
- Profile/preferences: structured YAML preserves types, lists, comments and unrelated keys; revision conflicts preserve drafts; credentials remain masked. Avatar selection persists and restores keyboard focus.
- Controls: dropdown arrows/typeahead/Home/End/Enter/Escape, focus return, invalid dates, month boundaries, phone calendar bounds, inline field errors and multiline inbox drafts.
- Charts: daily values agree with the data table; trend/bar modes, channel filters, keyboard/touch exploration, score buckets and proportional outcomes work. Resize keeps the graph’s interaction target stable. Reduced motion removes animation without removing information.
- Runner: exact command previews, cancel, confirmed actions, competing-run disable, stop confirmation, 18 bots including six profile agents, and Activity idle/live/failure states.

## Performance

The final production measurements use Playwright-controlled installed Chrome and the Lighthouse library, with three desktop and three mobile runs. Values below are medians from `artifacts/lighthouse/summary.json`.

| Preset | Performance | Accessibility | Best practices | SEO | LCP | FCP |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop | 100 | 100 | 100 | 100 | 0.661s | 0.394s |
| Mobile | 94 | 100 | 100 | 100 | 3.024s | 1.432s |

All six runs recorded zero layout shift and 0ms total blocking time. Mobile performance is below the frontend skill’s 100 target; that gate is **not claimed as passed**. The mobile heading LCP remains about 3 seconds in Lighthouse’s simulated network/CPU preset. The critical React/runtime and shared module payload remains performance debt. Fonts are local and preloaded, the initial route and API reads start together, and other routes remain lazy. Content, graphics, controls and motion remain intact. These are local lab results, not field Core Web Vitals or production load tests.

## Visual evidence and limits

Fresh route screenshots: `artifacts/{375,768,1280}/`. Research screenshots: `artifacts/research-{today,learning,resume,library,progress}-{375,768,1280}.png`. Additional evidence includes laptop screens, avatar picker, custom controls, chart touch states, Activity and document readers. The Research laptop and mobile surfaces were visually inspected after the final layout corrections. Full-page screenshots capture fixed navigation/Activity at their viewport position. Artifacts remain gitignored because real views can contain personal data.

The frontend reference pack, formal visual-qa/review-work orchestrators and in-app browser target were unavailable. Existing Playwright with installed Chrome provided browser evidence; no formal dual-oracle pass or other-browser support is claimed. Opaque sandboxed document frames are excluded from axe injection; their surrounding dashboard shell is checked and document rendering is visually reviewed.

Authentication and tenant-scoped PostgreSQL storage are integrated; the existing shared
Python/SQLite workflows remain restricted to their configured owner. Individual tenant
automation execution is not connected yet. Client caching and bounded lists do not prove
100,000 simultaneous users. Live research/bot success still depends on configured agents,
sessions and credentials. The hosted course reader retains its existing CDN dependencies.
Existing generated research content is displayed as saved, not independently verified by
this UI work.

## Activity panel information hierarchy — October 24, 2026

- Progress is the initial workspace view; Agents and Browsers have separate keyboard-accessible tabs. Regular accounts open directly to browser controls. External run actions return to Progress, while the panel's own collapse/reopen preserves the chosen view.
- Five newest updates appear first. Earlier readable updates and the complete retained output are disclosed separately; Copy lives inside Technical details. Other failed runs surface a Review action without changing the selected run automatically.
- The selected run's status, recovery link, Stop, browser preview, account reset, and uncertain connection handling remain covered. At short viewport heights Progress scrolls as one area, with run controls kept at the bottom. The latest-update control occupies its own space and cannot cover output controls.
- Verification: production build; 23 activity/stream unit tests and 5 browser-mode unit tests; 75 browser checks across activity-stream, activity-recovery, activity-browsers, activity-signin, parallel-controls, and crew-selection; the isolated dashboard idle/failure Activity check also passed. The Bot Crew accessibility check was repeated after adding the missing group role to its labelled selected-agent container.
- Desktop and phone screenshots were visually reviewed, including 375×667 recovery and progress. Axe checks passed for the Activity views, browser catalog, sign-in controls, and idle/failure page. Evidence is in `artifacts/activity/`, `artifacts/activity-browsers/`, `artifacts/activity-recovery/`, and `artifacts/activity-signin/`.
- Browser tests used synthetic API responses and did not execute real bots, open provider sign-in windows, or change account data. The in-app browser was unavailable; installed Chrome supplied the test and screenshot evidence.

### Floating Activity panel

Activity opens from a 60px circular launcher into a compact dark panel that matches the workspace. The animated circle remains visible below the panel and is its only open/close control. It shows an Activity icon when closed and an × with the accessible name Close activity when open. There is no duplicate Close button in the header. Live work moves the ring; a badge reports the running-agent count, unknown state, or attention. Reduced motion disables the ring animation. Incoming stream updates do not reopen a closed panel. Both Close and Escape return keyboard focus to the launcher.

The normal desktop panel is 480px wide, with one reading column. The selected agent's heading is the native run selector, including every run's state and duration in its options; there is no duplicate dropdown or run sidebar in compact mode. Expanded desktop adds the complete run list beside the selected detail. Phones retain the single column. All layouts preserve run information, recent progress, retained output, recovery actions, browser counts, and sign-in controls. One detail scroller has a visible scrollbar. Connection status, browser count, Stop, and Back to latest stay in the fixed footer. Native Chrome/counts behavior is preserved.

The typography uses a scoped UI font, distinct heading/body/metadata sizes, matching icons, and labelled Expand / Restore controls in the header. Expansion preserves the selected tab and run and adds reading space on phones as well as desktop. The update stream uses fewer nested surfaces and the agent heading has a visible keyboard focus outline. Technical details opens through a full disclosure row. A short entrance transition respects reduced motion. Expanded phone controls sit above the mobile navigation. The circle remains visible and clickable in both sizes.

Verification covers 54 synthetic Activity/browser/recovery/sign-in cases, including compact480px and expanded desktop layouts, launcher geometry at 1440×900 and 375×667, open/close focus, meaningful expansion, retained tab/run selection, reduced motion, status counts across simultaneous runs, account reset, long-output scrolling, and axe accessibility checks. Screenshots: `artifacts/activity/orb-closed-1440.png`, `compact-normal-1440.png`, `compact-normal-375.png`, and `compact-expanded-375.png`. These are targeted UI checks, not a claim about the full application suite.


## Normal browser runs and optional background work — October 24, 2026

Normal Chrome is the default for new agent runs. The Run in background toggle applies to the next individual or selected-crew launch; preview and launch retain the same mode. The screenshot viewer, popup, page input controls and their UI-only tests were removed. Activity uses authenticated, counts-only browser reads and retains the existing live log stream, per-run status and Stop controls. Compatible simultaneous agents keep separate browser ownership; shared-profile conflicts still block unsafe starts.

Verification for this change: 20 mocked crew launch browser cases; 29 browser-mode, Activity formatting and stream unit cases; 74 focused Naukri authentication/profile cases; 68 account-proxy, browser configuration and lifecycle cases. Backend mode/count/parallel tests were also run independently. The visible Naukri sign-in tests verify the same window is retained, only positive authentication resumes work, closing the window ends the wait, timeout occurs once, and background runs cannot wait invisibly on the removed viewer. Lifecycle tests use isolated child processes, including a child ignoring TERM, while another run remains active.

Crew toggle screenshots at 1280 and 375 pixels were visually inspected, and the crew page passed axe checks. Agent browser count screenshots show two simultaneous agents owning three actual browser instances. Tests used synthetic accounts and pages; no live applications, profile updates or provider sign-in were performed. Platform access or successful real job submissions are not established by these tests.

## Daily Learning — October 26, 2026

Daily Learning combines the saved 90-day learning plan and daily DSA. Today shows two
task cards and a shared streak summary. Reading, DSA practice, and activity have
separate views. DSA uses Learn / Worked example / Practice steps, resumes at the
first unfinished question after reading, and keeps the roadmap collapsed. The
dashboard calendar has month labels and collapsible badges. Phone navigation shows
all four learning views in a two-column control.

Verification: production build, 175 backend tests covering server/learning/account
isolation, 38 client policy/router tests, and 11 isolated browser cases passed.
Browser cases cover real temporary plan and DSA completions, exactly 60 combined XP,
reload persistence, same-day plan retention, failed saves and retries, missing
material, legacy DSA links, stale reads, and full/partial midnight refreshes. The
final phone-layout adjustment was checked again with the responsive/accessibility
case. All five views passed axe WCAG 2.1 AA checks and fit at 375, 768 and 1024 pixels.

Desktop and phone screenshots live in `artifacts/learning/` with `learning-home`,
`learning-plan`, `learning-dsa`, `learning-progress`, and `dashboard-learning` names.
The home and DSA screenshots were visually reviewed. The in-app browser was
unavailable; installed Chrome supplied this evidence. Synthetic learning data stayed
in a temporary test workspace. The running beta's real saved plan was also verified
through a read request, without completing a user task. Practice remains a personal
check-in and does not execute or grade code.

## Unified Learning workspace — October 26, 2026

This update replaces the separate Research Studio, Learning path, and Daily Learning
navigation described above. One Learning workspace contains Today, Resume learning,
Courses, Saved library, and Progress. Today orders DSA, the saved learning day,
papers, daily goals, system design, news, and companies into one checklist. Missing
material stays explicit and does not inflate the available-task count. Finished
90-day plans offer review instead of another generation request. Learning is also a
primary phone-navigation destination.

Old research/study/DSA links retain their destination and filters. Native document
readers return to Today, Resume learning, Saved library, or the selected Progress
page. Course and reading completions retain the existing shared memory, history,
streak, badges, and same-day XP deduplication. Opening a company reading does not
create an application. Fetch controls still preview the configured command before
execution; tests cancel that preview without running real agents.

Verification: production build, 166 focused backend tests and 40 client tests passed.
The browser suite now contains 20 cases. The initial full 18-case run passed; eight
impacted cases were rerun after refinements, and the final four-case run passed with
the completed-plan check, responsive/accessibility coverage, and two new refresh/save
race regressions. Those regressions caught stale in-flight reads replacing saved
progress. Caller-owned abortable reads now keep those old results out of the reader
and course views.

All six workspace views were checked at desktop and phone widths with axe WCAG 2.1 AA.
Fresh screenshots are `artifacts/learning/learning-{today,resume,courses,library,reader,progress}-{desktop,mobile}.png`.
Today phone and Courses desktop were visually inspected, along with the test agent's
Resume phone and Today desktop review. Browser verification uses installed Chrome
and temporary data; the in-app browser was unavailable. The idle local beta was
restarted on port 8116. A read-only request confirmed the real saved plan remains on
day 4 and today's unsaved research sections remain unavailable. No real learning
completions, generated briefings, or applications were created during verification.

## Daylight visual refresh — October 26, 2026

- Production `npm run build`: passed. JavaScript syntax and `git diff --check`: passed.
- Layout review: 11 routes at 375×900,768×1000,1280×720,1440×1000 (44 route/viewport checks), no page errors or document horizontal overflow. Screenshots in `artifacts/daylight/`.
- Final settled-color axe WCAG A/AA review: 20/20 passed. Overview, Bot Crew, Applications, Learning, saved library, Data hub, calendar, dropdown, avatar picker and open Activity at 1440 and 375px. No visible unintended large dark surfaces. Reports in `artifacts/warm-a11y/`.
- Shared controls: keyboard dropdown/typeahead/dismissal, invalid typed dates, calendar navigation and month-end clamping passed in checks adapted to current controls. Original 100,000-row pagination/history/page-size regression passed.
- Avatar persistence: existing index 21 remains stable; new index 48 saves and survives reload. All 48 choices and the 16-choice New friends filter passed; picker fits 375/768/1280px.
- Learning section/course dropdown navigation passed on desktop, tablet and phone. Calendar lower/upper bounds, keyboard movement, selected-day synchronization, responsive layout, and learning accessibility passed against isolated test data.
- Known existing test drift: older dashboard/beta cases still expect Research/Study navigation, an immediately visible AI CLI control, and the old Pipeline date label. Current equivalents (Learning navigation, Advanced settings disclosure, Workflow date) passed adapted checks. No real bot launch or personal-data mutation was used for visual verification.

## DSA sheet and adaptive AI practice — October 26, 2026

Learning now uses a contextual desktop sidebar and one section selector on smaller
screens. Today groups practice, reading, and career research. Practice & exams is
the second Learning destination, followed by Resume topics, Courses, Saved library,
and Progress.

- Production build, JavaScript syntax, and diff checks passed.
- 252 Python checks passed across server/account boundaries, saved learning, daily
  planning, DSA, AI generation/storage, and practice HTTP/scheduling integration.
- 40 client checks passed for account request isolation, access policy, and routing.
- 29 browser cases passed in the combined learning suite. These cover the 72-problem
  DSA sheet, notes/status persistence, filters through reader Back/reload, unsaved
  drafts through navigation and delayed refreshes, three daily and weekly papers,
  answer save/retry/reload/submission, reference-answer gating, and unavailable AI or
  source material. Shared search labels, inline links, and accidental null text were
  corrected and verified.
- Axe/accessibility and overflow checks passed for the five new surfaces at 375 and
  1440px, and the six existing learning surfaces at 375/768/1100/1440px. Final desktop
  and phone captures were visually reviewed. Artifacts:
  `artifacts/learning/dsa-{sheet,problem}-{375,1440}.png` and
  `artifacts/learning/ai-{practice,daily-paper,weekly-paper}-{375,1440}.png`.
- Generation tests use deterministic injected responses through production JSON
  validation and durable storage. Real Claude/Kiro requests were not made. The UI
  fixture disables background scheduling and rejects any real CLI/runner start;
  user papers, answers, and completions were not populated by these tests.
- Local preview on port 8116 exposes the new endpoints. Its practice API reports an
  available CLI and automatic preparation disabled until enabled by the user.

Automatic preparation is opt-in, checks once per minute while Morrow runs, and
catches up after restart. Unfinished daily papers and answers carry forward. Failed
or stopped generation preserves partial results and pauses retries until requested.
Weekly papers use completed saved sources in a fixed seven-day review window.
At that stage practice was self-reviewed. The local compiler follow-up below adds
verified code scores while retaining self-review for written answers.


## Avatar navigation and clickable route cleanup — October 26, 2026

- Production build, changed-module syntax checks, and `git diff --check` passed.
- 27 unit checks passed: nine breadcrumb hierarchy cases plus the existing access-policy and router checks. Parent paths cover readers with safe source filters, bot/provider/profile controls, profile-file tabs, record filters, DSA/course/paper routes, reports and Data categories.
- Eight shell browser cases passed: keyboard workspace search, same-page record search, modal guard, artwork presence, no SVG navigation/header glyphs, four screen widths with axe checks, More-menu deduplication, and one active mobile destination on bot detail pages.
- Four focused breadcrumb browser cases passed, including actual parent clicks, live query-filter updates, keyboard search/focus and filtered reader return. The reader case was rerun after the duplicate local back link was removed; its stable fixture uses a supported Learning category and page two of a 60-item library.
- Overview checks at 1440/375 and profile checks at 1280/375 passed for duplicates, retained useful data, overflow, axe and avatar open/close/focus. Profile artwork visibility is asserted after fixing an inherited rule that hid all tab spans.
- Eleven routes passed layout/runtime checks at 375, 768, 1280 and 1440 pixels (44 route/size combinations). The final compact profile adjustment was checked again on phone and desktop.
- Visual inspection: `artifacts/daylight/overview-1440.png`, Learning/library desktop and phone; `artifacts/overview-cleanup/profile-{375,1280}.png`; actual saved reader `artifacts/avatar-nav/reader-{375,1440}.png`. Every breadcrumb segment remains visible and clickable when its trail wraps on phone.
- Browser checks block persistent API mutations. No real bot run, reading completion, profile edit or application was created. Existing broader tests with old duplicate back-link or navigation selectors may need their expectations updated; the focused cases above verify the replacement navigation.


## Local compiler, verified progress, and direct DSA access — October 26, 2026

- All 862 Python tests passed, including 28 real local-runner checks. Python,
  JavaScript, and C++ execute under macOS isolation; checks cover compilation,
  strict JSON judging, time/memory/output limits, unavailable runtimes, blocked
  workspace/network access, concurrent requests, and child-process cleanup.
- The 72-problem catalog contains 288 checked cases. Integration and HTTP checks
  cover server-owned results, question/source binding, canonical sheet/paper
  identity, drafts, daily best-score deduplication, badges, daily XP, concurrent
  submissions, and preservation of solved status after a later failed attempt.
- Forty account/routing/request-isolation client tests and nine breadcrumb unit
  tests passed. Production build and diff checks passed. CodeMirror dependencies
  and pinned nlohmann/json 3.12.0 are bundled locally; the latter retains its MIT
  license and upstream checksum in `vendor/nlohmann/`.
- DSA has a sidebar shortcut, Launchpad button, and Today action that open the
  Practice step and editor directly. The question sheet offers a direct next-question
  action above the topic list. The editor uses the card width, with input details
  collapsed initially; selecting a lesson step persists it in the URL.
- Eleven compiler browser cases passed across the main and focused verification
  runs: real execution in all three languages, per-language drafts, retry/reload,
  missing-runtime recovery, runtime/compile/timeout diagnostics, idempotent scores
  and XP, badge unlock, and direct DSA navigation with Back/reload at 375/1440px.
  Full WCAG 2.1 A/AA and overflow checks passed for editor/results/progress and
  direct-practice/sheet surfaces. Screenshots in `artifacts/compiler/` were reviewed,
  including `direct-practice-{375,1440}.png`, `sheet-start-{375,1440}.png`, and
  `progress-populated-{375,1440}.png`.
- All 29 existing learning browser regressions also passed, including the seven
  navigation destinations, AI/sheet shared drafts, stale-read protection, completion
  and XP deduplication, and reader return/filter restoration through breadcrumbs.
  Together with the compiler cases, 40 browser cases passed across the final runs.
- Progress includes a score ring, keyboard-selectable chart with a data table,
  submission history, and coding milestones. The selected chart day stays visible
  on resize. Diagnostics scroll with keyboard access and syntax colors meet the
  warm theme's contrast requirements.
- The preview on port 8116 was restarted only after confirming no active jobs.
  Read-only checks confirm all three runtimes available and no personal code
  submissions inserted. Execution and scoring tests use temporary workspaces.
- Linux bubblewrap support is implemented but not runtime-verified on this Mac.
  Resource limits include per-file size limits and a polled memory watchdog, not
  an aggregate filesystem quota. Written paper answers remain self-reviewed;
  verified code points reflect the submitted exercise's four test cases.

## Warm artwork integration — October 26, 2026

- All four built-in imagegen edits are stored as project-local warm AVIF/WebP siblings. Verified1254×1254 RGBA and alpha0–255; original source atlases retained. AVIF75/WebP90 variants total approximately1.1MB/1.8MB respectively across all four atlases. Browser selects one format per image.
- Production build, avatar-picker syntax and diff checks passed.
- Read-only Chrome review covered overview, Bot Crew, Learning library and profile at1440/375. All rendered avatar backgrounds resolved to warm variants, with no horizontal overflow or runtime errors.
- Picker still has48 portraits and16 New friends; selecting index48 saves and survives reload in the isolated test browser. Numeric identities and their order remain unchanged. Labels no longer describe the discarded cool colors.
- All64 CSS crops inspected at112px, with the full contact sheet unobscured. Desktop and phone overview reviewed in context. No material clipping, remaining cool-color artwork or inconsistent backgrounds observed.
- Captures: `artifacts/warm-artwork/overview-{1440,375}.png`, `picker-{1440,375}.png`, `all-64-crops.png`, plus Bot Crew/library/profile views. Exact generation metadata is in `artifacts/warm-assets/`; prompts are recorded in ASSETS.md.

## Brand and loading refresh — October 26, 2026

- Production build and `git diff --check` passed.
- Seven focused browser cases passed: startup/sign-in at 375 and 1280px, delayed route loading at both widths, compact account loading at both widths, and static reduced motion with private navigation hidden while identity resolves. Each loader clears when its operation completes. No horizontal overflow observed. Two existing feedback regressions also passed.
- The compact fixture initially lacked the billing-status GET response; after adding that synthetic response, both compact cases passed. No production defect was found.
- Visually reviewed the shared logo/wordmark in the desktop sidebar, phone sign-in and startup loader, plus logo sizes 16/24/32/48/96px. Local wordmark font resolves correctly. Actual animation frames and reduced-motion captures were checked.
- Captures: `artifacts/brand-refresh/brand-detail.png`, `overview-{1440,768}.png`; `artifacts/brand-loading/startup-1280.png`, `auth-{375,1280}.png`, `route-{375,1280}.png`, `compact-{375,1280}.png`, `reduced-motion-375.png`.
- QA used synthetic API fixtures or blocked persistent API writes. No real account, application, bot run or learning progress was modified. The full browser suite was not rerun for this visual change.

## Scroll preservation and selection polish — October 26, 2026

- Reproduced the original defects with synthetic data: changing Course track on a phone jumped 269px to the top; Applications Next moved 891px toward the table heading.
- All 21 unique scroll/focus scenarios passed at 375, 768 and 1440px: query-only track changes, keyboard focus after asynchronous replacement, background overview refresh, pagination and rows-per-page selection, return via browser Back, user wheel input while loading, and natural clamping of shorter results without a lasting spacer. Coverage is in `tests/scroll-position.spec.js`.
- One tablet wheel test stalled during the interrupted turn; its isolated rerun passed in 1.2 seconds. After the delayed focus restoration fix, all nine affected query/focus/wheel cases passed again.
- Eight shared control checks passed: six component cases across all three widths, plus two existing integrated dropdown/calendar regressions. Covered long-list keyboard visibility, popup-only scrolling, month/day selection, native checkbox/radio/switch behavior, accessibility, reduced motion, forced colors and no horizontal overflow.
- Visually inspected warm selected, mixed, disabled and radio states, dropdown selected badge, and calendar. Captures are in `artifacts/selection-controls/{choices,dropdown,calendar}-{375,768,1440}.png`.
- Rechecked the seven brand/loading cases after scroll integration. Six passed during the initial run; the desktop route case stalled during interrupted browser teardown and passed on its isolated rerun. Production build and `git diff --check` passed.
- These checks used isolated synthetic API responses; no user account settings, bot actions, completions or application records were changed. The full browser suite was not rerun.

## Mascot and clipped-action repair — October 26, 2026

- Reproduced the supplied screenshot: legacy Export styling constrained text buttons to 42/44px. The previous direct-child override stopped matching after Practice DSA and Export were grouped. Both Launchpad and Insights were affected at every audited width, even with zero document overflow.
- Removed the fixed sizing at its source and added responsive action-group wrapping. Fixed the other audit finding: the full Reports date label clipped at 320px and now wraps.
- Post-fix audit passed all 91 combinations: 13 routes at 320, 375, 640, 768, 1024, 1280 and 1440px. Checked visible control text bounds, button padding and document overflow. Nine durable regressions in `tests/action-layout.spec.js` passed, including preserved Practice DSA navigation and an actual Export CSV download.
- Seven startup/account/route loading cases and one brand-size preview case passed with the new mascot. Visually reviewed the wordmark and mascot from 16–96px, desktop/tablet sidebar, phone sign-in, startup and compact loading. Production build and `git diff --check` passed. Startup/client/static missing pages share the hashed mascot URL to avoid duplicate image downloads.
- Captures: `artifacts/action-layout/overview-{1440,768,375}.png`, matching Insights captures, `reports-320.png`; `artifacts/brand-refresh/brand-detail.png`; `artifacts/brand-loading/`. Detailed audit: `artifacts/action-layout/audit.json`.
- The mascot uses a 43.7kB transparent WebP plus a 7kB PNG favicon. Alpha and small-size legibility were verified. The 1.27MB original is retained as source and is not used by production markup.
- QA blocked persistent API writes or used synthetic responses. No account, application, bot run or learning completion was changed. The full browser suite was not rerun.

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

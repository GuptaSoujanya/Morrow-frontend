# Morrow — your career workspace

The single Morrow frontend for accounts, plans, private career workspaces, and the
existing job-hunt tools. Login, signup, recovery, billing, and administration use the
same dark lavender design, navigation, typography, and controls as the dashboard.
The separate `morrow-api` repository contains the backend; it serves no second UI.

The login flow also supports Firebase Google/email authentication while keeping this
custom UI. See the [100-user Firebase setup](../morrow-api/FIREBASE_SETUP.md) to create
the project, enable verification/reset emails, and connect the existing administrator.
Until configured, local sign-in and private email previews remain available.

## Start

Use Node.js 22.19 or newer, the parent project's Python requirements, and the
PostgreSQL/API stack described in [morrow-api/README.md](../morrow-api/README.md).
Start the backend first, from the sibling `morrow-api` folder:

```sh
uv sync --locked
docker compose up -d --build
```

On a fresh checkout, run `uv run morrow init-local` before starting Compose to create
its private configuration. Keep an existing `.env`; it contains the configured
database credentials. The local test administrator is `admin@example.com`.
Its generated password, when bootstrapped, is in
`../morrow-api/.runtime/bootstrap-admin.txt`, which is private and ignored by Git.

In this frontend folder, create an ignored `.env.local`:

```dotenv
MORROW_API_URL=http://127.0.0.1:8200
MORROW_WORKSPACE_OWNER_EMAIL=admin@example.com
```

Then start the existing dashboard:

```sh
npm install
npm start
```

Open **http://127.0.0.1:8100/#/login**. `npm start` loads `.env.local`, builds this frontend,
and starts its Python server. The dashboard serves the UI and forwards `/api/v1/*`
to the backend on port 8200, keeping browser requests and session cookies on one
origin. It uses `../venv/bin/python` when available; otherwise `python3`.
Override the interpreter with `DASHBOARD_PYTHON`, or choose a dashboard port with
`npm start -- --port 8102` and update the backend's `PUBLIC_ORIGIN` accordingly.

## Accounts and plans

- Email signup, verification, login, logout, password recovery, and Google sign-in
  are integrated into the existing dashboard.
- Each user has a private profile, application history, files, and saved records.
  Launchpad displays that account's actual activity; it does not reuse the original
  owner's quotas, runs, or results.
- **Plans** opens Stripe subscription checkout and the customer billing portal.
  Access changes only after the backend verifies subscription state.
- **People & access** lets administrators inspect users and change roles, plans,
  and enabled status. Administrative access requires a reason and is audited.
- **My profile & files**, **Applications**, and **Data hub** use the signed-in user's
  storage. Data hub supports private uploads and authenticated downloads.

| Plan | Monthly price | Modules |
| --- | ---: | --- |
| Free | ₹0 | Profile, applications, private files |
| Plus | ₹499 | Free + resume studio, research, learning |
| Pro | ₹999 | Plus + automations, outreach, insights |

Users bring their own **Claude or Kiro subscription**. These plans do not include AI
subscriptions or credits. Choosing a provider saves a preference; it does not
connect an AI session. Administrators can edit plan names, descriptions, module
access, and the matching Stripe price IDs. Individual automation runtimes are still
pending, so included tools clearly show when execution is not connected.

Configure Google, SMTP, and Stripe credentials in **`morrow-api/.env`**, not frontend
code or `.env.local`. Set `PUBLIC_ORIGIN=http://127.0.0.1:8100` there. Google callbacks
use `/api/v1/auth/google/callback` on that dashboard origin; verification, recovery,
and payment returns open the existing dashboard's hash routes. Provider credentials
are required for live Google sign-in, email delivery, and Stripe checkout. The
backend README documents configuration and local test-mode setup.

## Setup checklist and Connections

New accounts arriving after sign-in open **Setup checklist** (`#/onboarding`). Existing
accounts can open it from the sidebar whenever their facts, resume, or chosen sites
change. Drafts save to the account with version checks; conflicting saves preserve
the edits on screen.

1. **Your profile:** save full name, contact email, phone, current location, and target
   roles. Skills, preferred locations, experience, and notice period can also be added.
   Existing profile facts outside this form remain intact.
2. **Your resume:** upload or select a private PDF, up to 10 MB. Use an unlocked PDF
   with selectable text, no more than 20 pages, and less than 1 MB of extracted text.
   Selecting a replacement keeps the previous private file.
3. **Connect accounts:** choose Naukri, LinkedIn, Hirist, Instahyre, Cutshort, Wellfound,
   and optionally Google / Gmail. **Open sign-in** opens the dedicated automation
   Chrome window. Enter passwords, OTPs, and other verification directly on the site,
   then use **Check sign-in**. An optional account email must match visible account
   evidence before it is reported as checked. Close the window before running a bot.
4. **Review setup:** review saved facts, resume, selected accounts, and browser status.
   **Finish setup** prepares private profile/resume inputs on this computer before
   recording completion. A running owner workflow or unreadable PDF leaves setup
   unfinished with an explanation. Completion records saved setup; sites can still
   expire a session or ask for verification later.

**Connections** (`#/connections`) remains available after onboarding. Open, check,
close, reconnect, or **Change account** there. Changing or disconnecting an account
requires confirmation and clears that provider's sign-in data in the selected browser
group. Changed account emails, including an explicitly cleared email, survive reload.
Switching Morrow users cancels pending UI requests and removes the prior user's view;
subsequent connection requests use the newly authenticated tenant's private directory.

Google sign-in to **Morrow** authenticates the dashboard account through Firebase or
the configured identity provider. Signing in to **Google / Gmail inside automation
Chrome** establishes a separate browser session used by job sites. One does not sign
you into the other, and onboarding does not ask for passwords or cookie exports.

### This computer's prerequisites and browser groups

Run the dashboard's Python service on the computer where Chrome and the automation
tools should operate. A hosted dashboard alone cannot open a visitor's personal Chrome;
this build does not pair a hosted service with a separate remote runner.

- Install the parent project's Python dependencies and Google Chrome. Chrome can be
  located through `CHROME_BINARY`; `CHROMEDRIVER` can specify an installed compatible
  driver when automatic driver discovery is unavailable.
- Install **Poppler** so `pdftotext` is on the Python service's `PATH`. Setup validates
  that the uploaded PDF has usable text before preparing runner inputs.
- Install and sign in to your own **Claude or Kiro CLI** for AI-assisted workflows.
  Finding the executable does not verify its subscription or authentication.
- Uploaded PDFs can supply profile text and be attached unchanged by supported bots.
  LaTeX-based resume tailoring still requires a `.tex` source and its existing compiler
  dependencies; uploading a PDF does not create that source.

Connections reuses the exact dedicated automation profile used by the corresponding
bot. It never imports the person's ordinary Chrome profile or copies its cookies.
The **Main browser** shares Google, Naukri, and sequential job-board sessions. LinkedIn
has its own profile. Parallel board runs use separate **Hirist**, **Instahyre**,
**Cutshort**, and **Wellfound** lanes; connect that board and Google in its lane when
using it. Signing in to Main does not copy the session into parallel lanes. Locked
profiles and conflicting active runs block connection changes. Up to three managed
windows may be open; idle managed windows close after 15 minutes while saved sessions
remain on disk.

### Local runner APIs and private storage

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/onboarding` | Current versioned preferences, profile, selected private resume, and computed readiness |
| `PUT /api/v1/onboarding` | Save a draft or completion with `expected_version`, `platforms`, `account_hints`, `resume_artifact_id`, and `completed` |
| `GET /api/connections?scope=main` | This account's browser status; supported parallel scopes are `lane:hirist`, `lane:instahyre`, `lane:cutshort`, and `lane:wellfound` |
| `POST /api/connections/{provider}/{action}` | `open`, `check`, `close`, `switch`, or `disconnect`, with `scope` and optional `expected_account` |
| `POST /api/runner/setup` | Prepare the selected private inputs using the saved `version` and `profile_version`; the server fetches files through the authenticated account API |

Onboarding state and profile facts live in tenant-scoped PostgreSQL tables; uploaded
resumes use the existing private artifact store. Apply backend migration
`005_onboarding` before starting the updated API. No browser session is uploaded by
these endpoints or included in downloadable artifacts.

Paths below are relative to the parent workspace and are private runtime data:

| Data | Location |
| --- | --- |
| Ordinary account browser groups | `data/private/connections/<tenant-id>/<main\|linkedin\|lane-board>/chrome/` |
| Owner's existing browser groups | Configured `BROWSER_PROFILE_DIR` and `LINKEDIN_BROWSER_PROFILE_DIR`, each with its `chrome/` subfolder; defaults are `data/browser/naukri` and `data/browser/linkedin` |
| Owner's parallel board groups | `lanes/<board>/chrome/` beside the configured main profile directory |
| Connection status/account labels | `.morrow-connections.json` beside each group's `chrome/` folder |
| Prepared profile and resume | `data/private/runner/<tenant-id>/<snapshot-id>/profile.yaml` and `resume.pdf`; `current.json` selects that tenant's snapshot |

Private directories use restrictive filesystem permissions, and these paths stay out
of Git. Browser session state remains on this computer. The original profile/resume
files are preserved: a verified owner snapshot sets `PROFILE_PATH` and `RESUME_PATH`
for future dashboard jobs through `data/private/runner/active-owner.json`.

**Current execution boundary:** all authenticated accounts can save private setup and
manage their isolated local browser sessions. Individual tenant workflow execution is
still not wired to those sessions. Only the configured workspace owner may execute the
existing shared workflows; administrator status or a paid plan alone does not grant
that access. Preparing a tenant's inputs does not switch the owner's active snapshot.

## Existing workspace tools

The original owner's dashboard retains its existing tools and data. Execution,
shared browser sessions, server settings, schedules, and the shared course remain
restricted to the administrator whose email matches `MORROW_WORKSPACE_OWNER_EMAIL`.
Other accounts use tenant-scoped data views and plan gates; they cannot execute
these shared workflows. The original workspace includes:

- **Launchpad:** reference-inspired dark summary, real activity graph, compact metrics,
  recent attempts, Bot Crew shortcuts, follow-ups, saved flow progress and research output.
- **Data hub:** all-time record counts, source paths and searchable research/report/profile/resume files; inline PDF preview, explicit downloads, URL-backed pagination and clear missing/error states.
- **Applications:** search the actual ledger, switch between discovered jobs and attempts,
  filter by platform/outcome/date, sort by score and open the underlying records.
- **Bot Crew:** 18 application, profile and career assistants with original 3D avatars, actual-run
  controls, configuration links, busy states and recorded history. Select cards in **Run agents together**
  and use **Run selected** to launch a compatible group after one confirmation. The selection panel
  stays visible while browsing agents; confirmation describes each action, with commands under
  **Technical details**. An older dashboard service shows restart guidance and preserves the selection
  if it does not support group launches. Restart the service after backend updates once active runs finish.
  **Browser for crew runs** defaults to **Background**, which opens no desktop window. Choose
  **Visible — watch Chrome** for a normal Chrome window, sign-in or verification; its window opens centered and can take focus as tabs change.
  Individual run settings offer the same **Browser mode** choice. Existing browser profiles are reused,
  and a background run never switches itself into a visible session. The old `BACKGROUND=true`
  setting now also means headless, rather than pushing a normal window off-screen.
- **Flows:** inspect a selected date's saved stages with live five-second updates, the latest
  recorded error and specific repair guidance. **Resume workflow** runs only unfinished
  recorded stages using saved settings; **Retry this stage** targets one stage. Completed
  results remain saved, and a failed stage restarts from its beginning. Missing output files
  are flagged for recovery. Active runs block conflicting retries; a quiet process is labelled
  without assuming it has stopped. Configure a separate run, validate material, or open
  container browser screens from the same page. Stage errors survive restarts; failures
  before the first checkpoint use the dashboard runner's retained history.
- **Insights:** conversion funnel, outcomes, match scores, platform/search comparisons,
  recent runs and 7/14/30/all-time CSV exports.
- **Research Studio:** search and read generated briefings, study plans, resume research and
  saved recruiter drafts. Today presents the selected date’s daily README, Papers, Tech radar and Company radar, with direct fetch/refresh controls. Learning and Resume lab have separate material and progress. Library contains the searchable `.research` collection; Progress records completion history.
- **Automation controls:** Naukri and four other job boards, company sites, Naukri/LinkedIn
  profiles plus dedicated Hirist/Instahyre/Cutshort/Wellfound profile agents, LinkedIn posts, recruiter email drafts and resume tailoring.
- **Action inbox, Learning path and Reports:** answer questions, complete facts, read course
  modules in expandable tracks and review or generate reports from the date archive.
- **My profile & files / Preferences:** configuration editing, masked credentials, revision
  checks, unsaved drafts, private backups, preferences grouped by purpose and a 32-character workspace avatar picker.
- **Activity:** the running-agent list shows who is working, their status and elapsed time. **View activity** selects that agent's progress and logs. **All browsers** lists the active runs' browsers and tabs, grouped by agent; **Open preview** goes straight to the chosen browser, with **Back to all browsers** for switching. **Watch browser** also opens the selected run's read-only preview, with tab selectors and a capture timestamp. Background runs stay off your desktop. Copy and Stop apply to the selected run; other agents keep working.
- **Schedules:** enable, inspect and disable the supported Naukri-profile/LinkedIn macOS jobs.
- **Custom controls:** keyboard-accessible dropdowns, calendar date entry, persistent field errors,
  clear loading/retry states and draft-preserving saves.
- **Interactive charts:** trend/bars toggle, channel filters, crosshairs, touch/keyboard date
  inspection, score-range exploration and outcome rings, all driven by the actual records.
- **Morrow design:** dark glass navigation/dock, layered charcoal cards, original avatar art,
  duotone navigation, local typography, restrained motion and reduced-motion support.

See [CAPABILITIES.md](CAPABILITIES.md) for the original local-tool inventory and data
semantics. The account boundary above determines which workflows are available to
each signed-in user.

Owner-workspace runs show an exact command preview and ask for confirmation. Bot Crew's
**Run now** and **Run selected** perform actual work: application agents submit applications,
profile agents save changes, and research agents save their output. LinkedIn creates a saved
draft (and its configured Telegram alert); recruiter writers save drafts. Agents needing a
job URL or description ask you to set that up first. Practice mode remains available in
individual settings. Explicit run-mode choices override inherited `DRY_RUN` settings for
that process without editing `.env`.

Select up to eight independent agents across categories; selections remain while navigating
the workspace. The batch preview validates the complete selection before the confirmation.
The start request checks resources and capacity again under one lock; a conflict starts none
of the selected agents. If process creation fails partway, the UI reports exactly which
agents started and retains only the failed selections for review.
Runs that share a browser session, resume compiler output, or the same pipeline stage
are rejected with an explanation until that resource is free. For example, learning
and tech-news research can run together, while two bots using the main browser must wait.

Activity uses a same-origin server-sent event stream (`GET /api/events`); commands
continue to use the JSON API. Logs carry run IDs and timestamps, and reconnects
resume from the last received cursor. If streaming is unavailable, a single
non-overlapping request checks activity every 5 seconds while busy or 15 seconds
while idle; general workspace refresh runs every 30 seconds. Recent history is
kept in memory (50 runs, 5,000 log entries), and a server restart resets it.
The browser viewer requests an uncached screenshot (`GET /api/run/browser`) about every two seconds while open and visible. Requests never overlap, errors are shown explicitly, and closing the viewer or changing accounts cancels requests and clears its images. Screenshots are not saved. A private per-run registry restricts capture to that run's browser instances and is removed when the run ends. Container runs use the browser screens in Flows instead. Choose visible Chrome before starting a run; an already-background browser stays headless.
The browser list uses a separate, uncached metadata request (`GET /api/run/browsers`) every five seconds while Activity or All browsers is open. It pauses when hidden or while watching a preview. Listing browsers captures no images and never opens or focuses desktop windows. Closed runs disappear from the list; unavailable browser sessions and runs that have not opened a browser are labelled explicitly.
Account changes close the stream and clear private activity. Account mode retains
the existing restriction that the shared local runner belongs to its explicit owner.
Commands started separately in a terminal are outside this console's process control.

## Integration and data

| Layer | Responsibility |
| --- | --- |
| `froned-dashbord`, port 8100 | All screens, shared visual system, session-aware routing, and same-origin API proxy |
| `morrow-api`, port 8200 | Authentication, roles, module access, Stripe, audit logs, and private storage APIs |
| PostgreSQL and artifact storage | Separate user records and private files; no user data is stored in Git |
| Existing workspace scripts and files | Owner-only bot execution and original local history |

The frontend's `/api/session` supplies identity and original-workspace availability.
`/api/v1/*` is forwarded to the backend. For ordinary users, `tenant_api.py` adapts
existing dashboard reads and profile saves to authenticated, tenant-scoped APIs.
Unsupported operations fail closed instead of falling back to the owner's files.
An administrator accesses another user's data through explicit audited endpoints.

Profiles and account records live in PostgreSQL with row-level security. Artifacts
are private and downloaded through authenticated endpoints. Profile saves include a
version; a conflicting edit must be reloaded rather than silently overwritten.
Private uploads and account history remain separate from the original workspace.

For the configured owner, the original tools still read the project's existing
SQLite database, `data/`, `.memory/`, `.research/`, `course/`, and `.env`. Original
course endpoints use the same durable progress store; `common/learning_memory.py`
is shared with the learning CLI. Importing the original workspace into an account
creates a snapshot, not ongoing synchronization. Bot output continues to use the
legacy stores until individual runtimes and their storage adapters are migrated.

Owner-workspace file saves require the revision that was opened; external changes cause a conflict instead
of an overwrite. Prior versions are saved under `data/inputs/backups/dashboard-*.bak` with
private permissions. Unsaved editor drafts survive in-app navigation; they are held only
in memory. Reloading the whole page discards them after the browser's warning.

Local servers bind to loopback. A deployment should keep the backend and PostgreSQL
private behind the dashboard's public HTTPS origin, configure secure cookies and
allowed hosts, and retain the separation between account storage and owner-only
automation. Authentication is integrated; tenant-aware bot execution and scheduling
have not yet been implemented.

## Development and verification

```sh
npm run build                  # rebuild app/ into dist/, then reload the page
npm run test:auth-unit          # account isolation and managed-auth client flows
npm run test:onboarding         # fully mocked setup/Connections, mobile and accessibility checks
npm run test:accounts           # integration checks against synthetic preview :8102
npm test                       # Playwright UI, accessibility and responsive checks
npm run audit                  # 3 desktop + 3 mobile Lighthouse runs in Chromium
../venv/bin/python -m pytest tests ../tests/web -q
```

Browser checks default to installed Google Chrome on macOS; set `CHROMIUM_PATH` to another
Playwright-compatible Chromium executable. `DASHBOARD_URL` changes the target for audits.
Legacy UI checks replace write requests with fixtures. Account integration checks use
synthetic users and an isolated API preview; they do not run bots or edit your personal
files. Backend tests use temporary data. Reports are deliberately sandboxed: the automated
accessibility scan checks the dashboard shell separately from report documents.
Onboarding checks intercept every API request and never open a real automation profile
or contact Google/job sites. Set `ONBOARDING_DASHBOARD_URL` to another local preview
origin if needed; the default is `http://127.0.0.1:8102`. Real provider sign-ins have
not been exercised by this automated suite.

Source: `app/js/` (ES modules), `app/styles/` (design tokens and primitives), `server.py`
(dashboard server, authentication bridge, and tenant adapters). React 19 owns lazy route boundaries and Suspense; existing DOM components render inside a route adapter and account screens use the same application root. TanStack Query v5 caches and deduplicates read requests. Typography uses locally hosted Space Grotesk and Source Sans 3. Original avatar graphics are bundled from
`app/assets/`; generation details are in `ASSETS.md`. Design decisions are in `DESIGN.md`; verification
evidence and limitations are in `QA.md`. Generated screenshots/reports in `artifacts/` are
gitignored because real dashboard views can contain personal information.

Only Firebase app/auth modules are dynamically bundled into the sign-in flow; no
Firebase database replaces PostgreSQL. The npm gRPC override pins a patched range
for an unused Firestore transitive dependency pulled in by the umbrella SDK.

## Owner-workspace learning and navigation

For the original workspace owner, course lessons, research notes and 90-day learning completions save to **`.memory/learning.json`** in the project root. The server imports prior `data/reports/studied.json` and `.research/learning/progress.json` once, preserving the originals. Writes use a process lock, fsync and atomic replacement. Invalid storage is reported rather than silently reset. Back up `.memory/` with the rest of your workspace. Other accounts use their own stored reading progress and cannot read or change this shared progress file.

- Research Studio → **Today**: choose a date, open its daily README, and read Papers, Tech radar and Company radar. Missing dates remain explicitly empty, with a link to the latest saved date. Fetch a whole briefing or one section directly, after reviewing its exact command.
- **Learning**: your first unfinished learning day, 90-day progress, daily goal, system-design brief and saved weekly plans. **Resume lab**: a separate topic library based on your resume, with its own overview and completion count.
- Fetch actions use your configured AI agents and persist their output in `.research/`; they are not simulated feeds. The Activity panel follows each run, and its output views refresh when that agent finishes, even while another agent is still working. Independent research stages can run in parallel.
- Open a read → **Mark complete**. **Reopen reading** reverses it. Opening alone never completes an item.
- **Progress**: dated course/research completions and reopens, plus imported work whose original dates were not recorded.
- Learning path and the hosted course reader share the same progress. `/course/01-system-design/` redirects to `/course/#/01-system-design/`. The course reader still uses its existing CDN scripts.
- Applications, Data hub and the Research library keep page/filter/search state in the URL. Browser Back, Forward and reload restore it.

TanStack Query keeps ordinary GETs fresh for 30 seconds and evicts unused entries after five minutes. Status/run/editable files bypass the cache. Mutations do not retry and invalidate cached reads after success. No credential or personal-data cache is persisted to browser storage. React Suspense and a route error boundary keep navigation available while pages load or fail. The initial route loads alongside its data to avoid an extra waterfall.

`npm run dev` includes development-only react-grab and react-scan; `npm run doctor` checks the React route adapter. Production builds exclude those tools. Client caching and bounded rendering do **not** establish a particular deployment capacity; load testing and isolated workers are still required before scaling multiuser automation.

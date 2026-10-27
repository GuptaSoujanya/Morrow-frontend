# Morrow — your career workspace

Morrow starts in **free beta** mode. It opens directly into your workspace with all
tools available, no Morrow login, no plan restrictions, and no billing or access
administration screens. Each person runs their own copy on their computer.

## Start

Use Node.js 22.19 or newer, zsh, and the parent project's Python requirements. From the parent
project, install the launcher once:

```sh
scripts/morrow install
morrow start
```

Installation creates `~/.local/bin/morrow`, a symlink to this checkout's launcher. With
`~/.local/bin` on your `PATH`, `morrow start` works from any directory. You can also run
`scripts/morrow start` directly from the parent project without installing it.

Open **http://127.0.0.1:8100/**. The launcher builds the frontend, starts the Python backend in
the background, and waits for `/api/session` to confirm that the free beta is ready. It always
uses beta mode, ignoring `MORROW_MODE=accounts` and account-service settings. The terminal can
be closed after startup succeeds.

| Command | Purpose |
| --- | --- |
| `morrow start` | Start the free beta, or reuse this launcher's running dashboard |
| `morrow start --port 8116` | Start the free beta on a different local port |
| `morrow stop` | Stop only the dashboard process group owned by this launcher |
| `morrow restart` | Rebuild and restart the owned dashboard |
| `morrow status` | Check the owned dashboard and readiness |
| `morrow logs` | Follow `reports/morrow/dashboard.log` in the parent checkout |

Each command also works as `scripts/morrow <command>` from the parent project. An unrelated
process on port 8100 is reported as a conflict and left running. The launcher does not start
or stop Docker, PostgreSQL, or the account API. Finish any active work before restarting.

For a foreground development server, run these commands from this frontend folder:

```sh
npm install
npm start -- --mode beta
```

`npm start` loads `.env.local`, builds the frontend, and starts the Python server.
It uses `../venv/bin/python` when available; otherwise `python3`. Override the
interpreter with `DASHBOARD_PYTHON`, or choose a port with `npm start -- --mode beta --port 8102`.
For this manual command, beta is the default unless `MORROW_MODE` selects accounts; `--mode beta`
overrides that environment setting. Stop a manually started server with Ctrl+C in its terminal.
The launcher does not take ownership of it.

Old login, signup, recovery, plans, and administration links open the workspace.
Account and onboarding links open **My profile & files**. The beta does not call
the account or payment APIs, and `/api/v1/*` is disabled on the dashboard.
Profile files, browser sessions, and job history stay on this computer; the server
continues listening only on `127.0.0.1`. This is a local beta distribution, not a
shared hosted workspace. Connections to job platforms and your own Claude/Kiro
session are still needed to run the corresponding tools.

## Optional accounts mode

Accounts, plan gates, payments, and administration are retained for a later release.
Use the manual developer setup below to enable them with `npm start -- --mode accounts`.
The beta launcher rejects `morrow start accounts`; it does not manage the account services.
Account mode still requires authentication and fails closed if its backend is unavailable.

Use the PostgreSQL/API stack described in [morrow-api/README.md](../morrow-api/README.md).
Start that backend first, from the sibling `morrow-api` folder:

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
MORROW_MODE=accounts
MORROW_API_URL=http://127.0.0.1:8200
MORROW_WORKSPACE_OWNER_EMAIL=admin@example.com
```

Then start the existing dashboard:

```sh
npm install
npm start -- --mode accounts
```

Open **http://127.0.0.1:8100/#/login**. `npm start -- --mode accounts` loads `.env.local`, builds this frontend,
and starts its Python server. The dashboard serves the UI and forwards `/api/v1/*`
to the backend on port 8200, keeping browser requests and session cookies on one
origin. It uses `../venv/bin/python` when available; otherwise `python3`.
Override the interpreter with `DASHBOARD_PYTHON`, or choose a dashboard port with
`npm start -- --mode accounts --port 8102` and update the backend's `PUBLIC_ORIGIN` accordingly.
Stop this foreground dashboard with Ctrl+C. Manage the API and PostgreSQL separately with
Docker Compose from `morrow-api/`; `morrow stop` does not stop those services.

## Accounts and plans (accounts mode only)

- Email signup, verification, login, logout, password recovery, and Google sign-in
  are integrated into the existing dashboard.
- Each user has a private profile, application history, files, and saved records.
  Launchpad displays that account's actual activity; it does not reuse the original
  owner's quotas, runs, or results.
- **Plans** opens Razorpay subscription checkout for INR, UPI AutoPay, and cards,
  with billing status, refresh, and cancellation in this dashboard. Stripe checkout
  and its billing portal remain supported for existing installations. Access changes
  only after the backend verifies payment and subscription state.
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
access, and the matching provider plan/price IDs. Individual automation runtimes are still
pending, so included tools clearly show when execution is not connected.

Configure Google, SMTP, and payment credentials in **`morrow-api/.env`**, not frontend
code or `.env.local`. Set `PUBLIC_ORIGIN=http://127.0.0.1:8100` there. Google callbacks
use `/api/v1/auth/google/callback` on that dashboard origin; verification, recovery,
and payment returns open the existing dashboard's hash routes. Provider credentials
are required for live Google sign-in, email delivery, and checkout. The
backend README documents configuration and local test-mode setup. For India payments,
follow [Razorpay setup](../morrow-api/PAYMENTS_SETUP.md). Restart the dashboard server
after updating its API proxy so Razorpay webhook signatures are forwarded.

## Setup checklist and Connections

New accounts arriving after sign-in open **Setup checklist** (`#/onboarding`). Existing
accounts can open it from the sidebar whenever their facts, resume, or chosen sites
change. Drafts save to the account with version checks; conflicting saves preserve
the edits on screen.

For the workspace owner, step 4 also shows **Your private data repo**: the git clone under
`user/` that the CLI bots read. **Connect repo** creates it from the Morrow-user template (or
clones a repo you name) with the GitHub CLI on this computer, and **Finish setup** then copies the
saved profile and resume into it. The free beta shows the same card under **Preferences →
Connections & maintenance**.

Existing details are prefilled and marked **Saved**. The checklist distinguishes saved
steps, unsaved changes, and missing details; saved account choices are separate from
verified browser sign-ins. Validation messages appear beside the affected field and
focus the first problem. Saved PDFs can be reused, including older files, without
uploading again. Finishing setup requires saving any profile changes first.

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

**Activity → Sign-in browsers** also controls the windows opened during setup, even
when no bot is running. Choose the account in an open window, then **Check sign-in**
or **Close browser**. Closing keeps the saved sign-ins. Google, Naukri, and the main
job boards share one window; LinkedIn and parallel lanes have separate cards. These controls are
available to every signed-in account, while shared runner activity remains owner-only.
Browser status refreshes while Activity is visible; opening Activity never launches a sign-in window. **Manage connections** opens the full account
controls for signing in or changing accounts.

Connections distinguishes the shared Chrome window from the selected provider tab.
Only the selected provider shows **Check sign-in** and **Close browser**; other
providers show **Open sign-in** and explain which account is already open. Opening
another provider reuses its existing tab or adds a tab to the same window, preserving
other sites' sign-in pages. Checks return to that provider's tab. Previously checked
details remain saved when reopening a tab; an explicit check refreshes them.
Hirist, Cutshort, Wellfound, and Instahyre use visible account navigation or logout
controls as evidence. An unknown page, a login screen, and an email that cannot be
matched now have different guidance; a page URL alone is never proof of sign-in.
Hirist checks open `/myprofile` in its existing tab and use the loaded account email
beside the avatar plus work and education editing controls. An already-open profile
is not reloaded, and a Google sign-in still in progress is left in place. Login
redirects, unfinished profile setup, and a profile that fails to load have distinct
guidance. The recommendation-recipient email is never used as the account identity.

An abandoned Chrome lock no longer disables sign-in when its recorded process on
this computer is confirmed gone. Chrome handles its own recovery when opened;
Morrow does not delete lock files or saved sign-ins. Live or uncertain locks remain
blocked, with separate guidance for a running workflow and an occupied browser
profile. LinkedIn's separate profile does not block the main browser group.
If an account page times out or encounters a network error, a usable sign-in
window stays open. Finish loading or reload that tab, then use **Check sign-in**;
**Close browser** remains available. Startup and verification failures have separate
guidance. Diagnostics retain fixed failure codes and stages, never raw driver errors.

LinkedIn checks recognize its visible member navigation across feed, profile, jobs,
messaging, and settings views. Connections and LinkedIn workflows share this check;
verification does not require opening the post composer. Login, authwall, and
security-check screens take priority over old page elements. Public profile URLs
alone never verify a session. An optional email remains a separate identity check;
editable email fields and email addresses in posts do not identify the account.

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
| `GET /api/runner/repo` | Workspace owner only: whether `user/` (or `MORROW_USER_DIR`) is a git clone, its remote, whether `database/course` is present and which input files exist. Also available in the free beta |
| `POST /api/runner/repo` | Workspace owner only: run `scripts/setup_user.sh` (optional `repo` as `owner/name`) to create the private repo from the Morrow-user template or clone an existing one, and clone Morrow-database. Needs the GitHub CLI signed in on this computer; refused while a workflow runs |
| `POST /api/runner/repo/sync` | Workspace owner, accounts mode: merge the saved account profile into `user/inputs/profile.yaml` (existing facts kept, previous file backed up under `inputs/backups/`) and save the selected resume PDF to `user/resume/`, using the saved `version` and `profile_version` |

Onboarding state and profile facts live in tenant-scoped PostgreSQL tables; uploaded
resumes use the existing private artifact store. Apply backend migration
`005_onboarding` before starting the updated API. No browser session is uploaded by
these endpoints or included in downloadable artifacts.

Paths below are relative to the parent workspace and are private runtime data:

| Data | Location |
| --- | --- |
| Ordinary account browser groups | `user/private/connections/<tenant-id>/<main\|linkedin\|lane-board>/chrome/` |
| Owner's existing browser groups | Configured `BROWSER_PROFILE_DIR` and `LINKEDIN_BROWSER_PROFILE_DIR`, each with its `chrome/` subfolder; defaults are `user/browser/naukri` and `user/browser/linkedin` |
| Owner's parallel board groups | `lanes/<board>/chrome/` beside the configured main profile directory |
| Connection status/account labels | `.morrow-connections.json` beside each group's `chrome/` folder |
| Prepared profile and resume | `user/private/runner/<tenant-id>/<snapshot-id>/profile.yaml` and `resume.pdf`; `current.json` selects that tenant's snapshot |

Private directories use restrictive filesystem permissions, and these paths stay out
of Git. Browser session state remains on this computer. The original profile/resume
files are preserved: a verified owner snapshot sets `PROFILE_PATH` and `RESUME_PATH`
for future dashboard jobs through `user/private/runner/active-owner.json`.

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
  Agent runs open normal Chrome windows by default. Turn on **Run in background** before starting
  a card, selected crew, or configured workflow to hide its browser windows. Both modes retain
  live logs, progress, and Stop controls in Activity. The choice affects new runs only.
  Each job site keeps its own browser profile and Chrome instance. Naukri, Hirist, Instahyre, Cutshort and Wellfound can work together; each run writes its own résumé and screenshot files.
  A visible Naukri run that needs sign-in waits in that same window for up to five minutes,
  and resumes only after verified sign-in. A background run that needs human help fails with
  connection guidance; turn off background mode to retry in Chrome.
- **Flows:** inspect a selected date's saved stages with live five-second updates, the latest
  recorded error and specific repair guidance. **Resume workflow** runs only unfinished
  recorded stages using saved settings; **Retry this stage** targets one stage. Completed
  results remain saved, and a failed stage restarts from its beginning. Missing output files
  are flagged for recovery. Active runs block conflicting retries; a quiet process is labelled
  without assuming it has stopped. Configure a separate run, validate material, or open
  Activity from the same page. Stage errors survive restarts; failures
  before the first checkpoint use the dashboard runner's retained history.
- **Insights:** conversion funnel, outcomes, match scores, platform/search comparisons,
  recent runs and 7/14/30/all-time CSV exports.
- **Learning:** follow daily DSA, learning, papers, topics, news and company research, then
  continue resume learning or the full course curriculum. Saved library searches the
  `user/research` collection, including dated briefings and recruiter drafts. Progress shows
  shared activity, badges and completion history. Missing material has direct fetch controls.
- **Automation controls:** Naukri and four other job boards, company sites, Naukri/LinkedIn
  profiles plus dedicated Hirist/Instahyre/Cutshort/Wellfound profile agents, LinkedIn posts, recruiter email drafts and resume tailoring.
- **Action inbox and Reports:** answer questions, complete facts and review or generate
  reports from the date archive.
- **My profile & files / Preferences:** configuration editing, masked credentials, revision
  checks, unsaved drafts, private backups, preferences grouped by purpose and a 32-character workspace avatar picker.
- **Activity:** click the floating circle at the bottom right to open the panel. Its moving ring shows live work; the badge shows the running-agent count or an attention marker. Incoming updates keep a closed panel closed. The animated circle remains visible and is the only open/close control: click it again or press Escape to close Activity. **Expand** and **Restore** sit in the header; expansion adds reading space on desktop and phones while keeping the current tab and run selected. **Progress** opens first. The normal view is a compact dark panel. Click the selected agent's heading to switch runs; every run remains available, including completed ones. Expanded desktop adds a full run list beside the selected run's status, recovery action, and five newest progress updates. Both desktop and phones use a single scrolling detail view. Earlier updates and **Technical details** (including Copy) open on demand, while run controls and **Back to latest** stay reachable below the output. A notice surfaces other failed runs without changing the selected task. **Agents** lists running agents with their status and elapsed time; **View activity** returns to that run's progress. **Browsers** shows agent browser counts and separate sign-in controls. Accounts without runner access open directly to browser controls. Normal runs open actual Chrome windows; **Run in background** hides windows for newly started runs. Copy and Stop apply to the selected run; other agents keep working. Arrow keys, Home, and End switch Activity tabs; Escape collapses the panel.
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
Different job sites reserve separate browser sessions, and résumé output is isolated per run.
A selected crew prepares every browser profile before any agent starts. A new board session
can inherit the closed managed main session once; subsequent runs retain that board's own
sign-in. Open or changing source profiles are never copied. Connect a fresh session under
Connections → Parallel lane for that site when needed.

Two tasks on the same job site still wait for one another, as do overlapping pipeline stages
and workspace maintenance. This prevents duplicate account work. Shared answers, profile
history and worklists use short locked writes, while logs and browser counts stay separate
for each run. Stopping one run leaves the other agents working.

Activity uses a same-origin server-sent event stream (`GET /api/events`); commands
continue to use the JSON API. Logs carry run IDs and timestamps, and reconnects
resume from the last received cursor. If streaming is unavailable, a single
non-overlapping request checks activity every 5 seconds while busy or 15 seconds
while idle; general workspace refresh runs every 30 seconds. Recent history is
kept in memory (50 runs, 5,000 log entries), and a server restart resets it.
Activity shows the number of open Chrome instances for each live agent and the combined total.
It reads an uncached, counts-only request (`GET /api/run/browsers?counts=1`) every five seconds
while Activity is open and visible. It never captures pages or lists private tabs. The removed
remote viewer is replaced by the actual Chrome windows for normal runs. Unknown or delayed
counts remain explicitly marked, and ended runs disappear even while cleanup finishes.
Manual Connections sign-in windows remain managed separately in Activity.
Account changes close the stream and clear private activity. Account mode retains
the existing restriction that the shared local runner belongs to its explicit owner.
Commands started separately in a terminal are outside this console's process control.

## Integration and data

| Layer | Responsibility |
| --- | --- |
| `froned-dashbord`, port 8100 | All screens, shared visual system, session-aware routing, and same-origin API proxy |
| `morrow-api`, port 8200 | Authentication, roles, module access, subscriptions, audit logs, and private storage APIs |
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
SQLite database, `user/` (inputs, memory, research) and `database/course/`, and `.env`. Original
course endpoints use the same durable progress store; `common/learning_memory.py`
is shared with the learning CLI. Importing the original workspace into an account
creates a snapshot, not ongoing synchronization. Bot output continues to use the
legacy stores until individual runtimes and their storage adapters are migrated.

Owner-workspace file saves require the revision that was opened; external changes cause a conflict instead
of an overwrite. Prior versions are saved under `user/inputs/backups/dashboard-*.bak` with
private permissions. Unsaved editor drafts survive in-app navigation; they are held only
in memory. Reloading the whole page discards them after the browser's warning.

Local servers bind to loopback. A deployment should keep the backend and PostgreSQL
private behind the dashboard's public HTTPS origin, configure secure cookies and
allowed hosts, and retain the separation between account storage and owner-only
automation. Authentication is integrated; tenant-aware bot execution and scheduling
have not yet been implemented.

## Development and verification

Agents announce successfully saved answers through the existing Activity stream. **Answer sheet updated → Review changes** opens **My profile & files → Agent answer sheet**, showing the saved question, answer, source, and agent. This owner-only sheet uses the runner's configured `DATA_DIR/answers.txt`; private account files keep their separate storage. New updates preserve editor drafts, and saving an outdated revision returns a conflict. Reload after keeping any unsaved edits. **Enable desktop alerts** requests browser permission only when clicked, lasts for this session, and uses generic notification text. No external push service is involved.

Notifications and recent changes are held in memory and cleared when the account changes; the answer sheet itself persists on disk. Existing changes are loaded silently after refresh. Test the feature with `npx playwright test tests/answer-notifications.spec.js`; every API in those browser checks is mocked.

```sh
npm run build                  # rebuild app/ into dist/, then reload the page
npm run test:auth-unit          # account isolation and managed-auth client flows
npm run test:beta               # free local beta, redirects, desktop/mobile navigation
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

## Learning workspace and daily progress

Open **Learning** (`#/learning`) for one workspace with **Today**, **Your curriculum**, **DSA practice**,
**Discover**, **Saved library**, and **Progress**. Desktop navigation
groups these destinations under Learning; smaller screens use one section selector.
Today comes first: DSA practice,
your saved learning-plan day, research papers, daily goals, system-design topics,
tech news, GitHub repositories, and companies to explore. Each available task has its own reading or
practice view and explicit completion state. The daily count includes available
tasks; missing material is listed separately with an action to prepare it. Company
research completion records learning, while job applications remain in Applications.

The learning-plan reading uses the existing saved week files and completion history.
Completing it keeps today's reading visible; the next local date selects your next
unfinished day. Daily research only uses material saved for the selected local date;
older briefings remain in the dated Saved library. No readings or progress are invented.
Your curriculum brings the weekly roadmap, resume topics, and course tracks together.
The header and curriculum show supported skills and saved target roles from the
selected learning profile. Generated lessons record the resume fingerprint:
changing resumes refreshes unfinished material while preserving completed days,
previous topic files, and notes. Older material without provenance is labeled as
unverified rather than claimed to match the current resume.
New weekly material uses the selected resume and target roles for system design,
full-stack exercises, and AI-agent projects. Existing saved weeks remain available.
The compact header shows your focus, date and learning day/week. Today has one
completion count for its available activities, avoiding a conflicting event count.
Its next-lesson action comes first, followed by a short study list and optional
discoveries. Unprepared material is grouped in one setup section; individual
preparation controls are available on expansion.

Discover separates research papers, technology news, companies, and GitHub repositories.
The paper researcher must return exactly two distinct original sources, prioritizing AI,
and cannot repeat a paper from the previous 30 days. Each paper must include a
publication date within the last 30 days, with recent work preferred. Fetching uses the configured AI
research agents; it does not run merely by opening Learning. The existing daily pipeline
includes the new `brief:repositories` stage. Individual readings can be marked complete;
finishing all items completes that briefing once, using the shared activity store.
Refreshed papers start unread, while previously earned activity stays in history.
Reading states belong to each dated briefing, so reopening a repository in one
briefing does not reopen another date's reading.

Saved library groups archived material, bookmarks, and personal notes. Bookmark
collections distinguish papers, DSA questions, GitHub repositories, and other resources.
You can also add a repository link yourself. Notes support source links, categories,
editing and deletion; conflicting revisions are rejected and unsaved drafts remain
available while navigating within the current account session. Notes and bookmarks
use the same locked `user/memory/learning.json` store as progress.

In optional accounts mode, users with Learning access have private notes,
bookmarks, resume-focus summaries and library-reading progress. Notes and bookmarks
use versioned account storage, isolated from the local owner's files; combined
storage is limited to 1 MB. Account activity reflects currently completed private
documents, because account records do not yet retain completion-event history.
Per-account AI generation and DSA execution still need a connected tenant runner;
those actions are unavailable explicitly rather than falling back to owner data.

The DSA practice provides one topic per local calendar day: a concept explanation,
a worked Python example, and practice questions with revealable solutions. The path
contains 22 topics, from hash maps and arrays through graphs, dynamic programming,
bits, and tries. Read the explanation, practice each question, then choose
**Complete DSA topic**. Each question and worked example has an in-app code editor;
run examples while learning, then submit the full test suite for a verified score.
Reading and practice checklists remain personal check-ins. Checklist progress and
code drafts save on this computer and survive restarts.

The next topic opens the next day. Missing a day keeps your unfinished topic waiting;
after all 22 topics, the path revisits completed topics for revision. An open page
refreshes across midnight and when returning from another tab. **Refresh**
can also reload the saved state.

**DSA practice** separates Learn, Worked example, and Practice into individual steps,
and Continue resumes at the first unfinished practice question after reading. The
DSA roadmap is collapsed until requested. **Progress** contains separate completion
bars for every learning area, course-level breakdowns, a seven-day activity chart,
the full calendar, streaks, badges, coding results and learning history. Today keeps
its focus on the next task. The dashboard retains its compact activity widget.
Existing `#/dsa`, `#/research`, and `#/study` links open the corresponding view inside
Learning. Reader return links and library filters survive browser Back and reload.

The dashboard and Learning workspace show a GitHub-style activity calendar,
current and longest streaks, XP levels, and six milestone badges. Completing any
course chapter, research reading, or daily DSA topic keeps the learning streak going.
Course chapters earn 20 XP, research readings 10 XP, daily DSA 50 XP, and fully passing
code solutions 10 XP. Each item
earns credit once per day; reopening does not erase historical activity or create
extra credit that day. A streak ending yesterday remains current while today is
still available. Dates follow the computer's local calendar, including the original
local date recorded for each completion. Older imported progress without dates
does not create invented streaks or calendar entries.

Learning activity uses the local `user/memory/learning.json` store described below;
code drafts and verified scores use `user/memory/code-practice.json`. No Morrow
account is required in the free beta. To verify the feature without changing your
own progress, run `npm run test:learning`; its server uses temporary synthetic data
and blocks all non-learning actions.

### DSA sheet and AI practice

**DSA → Practice sheet** (`#/learning/dsa/sheet`) adds a topic-by-topic path with
72 problems across 11 chapters from the bundled course. Search by topic or question,
filter by progress, and save an approach, code, or notes alongside **Not started**,
**Attempted**, or **Solved**. Foundation / Practice / Challenge describe each problem's
place in its chapter. The sheet follows the idea of an A2Z practice path; it is not
a copy of the complete Striver question bank. The original sheet is linked for reference.
Daily lesson checklists share problem attempts, while topic completion remains explicit.
Unfinished daily lessons keep their reading and practice progress on the next day.

**Practice & exams** (`#/learning/practice`) creates three separate AI papers:
DSA, daily learning, and research review. Daily papers contain three questions;
weekly exam papers contain five questions per available category. Generation uses
the configured Claude or Kiro CLI and saved source text, with tool use disabled.
The CLI must be installed and signed in on this computer. Missing source material,
invalid AI output, and connection failures are shown with recovery actions; no
placeholder questions are presented as generated work.

Choose **Start AI practice** to prepare the first papers and enable automatic daily
preparation. The setting can be paused at any time. While Morrow is running, it checks
for missing daily papers every minute and catches up when restarted. Unfinished
papers and their answers carry forward; new questions adapt to the next unfinished
material, read state, prior attempts, and previous questions. Reading a source and
submitting a practice paper are separate actions. Research practice uses the oldest
unread saved paper briefing, including an earlier day's unfinished reading.

Weekly exams are prepared on request, once per calendar week, from material completed
in the preceding seven days including the preparation date. Each exam's review window
stays fixed after its first paper is generated. Categories without eligible material
explain what is needed. Weekly reference answers and review criteria unlock only after
every question has an answer and the paper is explicitly submitted. Written answers
support self-review. DSA questions also have local code tests with a separate,
server-verified score; no AI grade is assigned to written answers.

Answers save as you type. Submission saves an immutable completed paper and records
10 XP in the shared activity calendar; retries cannot earn duplicate credit. Papers,
answers, settings, and generation state live in **`user/memory/practice.json`**, with locked,
atomic writes. Back up this file alongside `user/memory/learning.json`. Stopped or failed
generation keeps any completed papers and requires an explicit retry.

### Local compiler and coding progress

Every one of the 72 sheet problems, daily practice questions, and worked examples
has a CodeMirror editor with Python, JavaScript, and C++ support. Drafts save per
problem and language. **Run examples** checks the visible sample; **Try your own
input** accepts JSON; **Submit solution** checks all four cases and records the
result. Input/output contracts and comparison rules appear beside the editor.
Tests verify returned values, not algorithmic complexity or object identity.

DSA has a direct sidebar shortcut and a **Practice DSA** button on Launchpad.
Both open `#/learning/dsa?step=practice` at today's first unfinished practice
question with its editor ready. Today's **Practice now** action opens the same view.
Learn and Worked example remain available as tabs; the selected tab survives reload.
The practice sheet also offers **Start coding** / **Continue coding** above the topic
list, so finding a table row is optional. Editor input details open on demand.

New AI DSA papers select a problem from their saved topic's test catalog, keeping
the generated question and executable contract aligned. Older papers show a clearly
labeled related coding exercise. The same problem shares drafts and daily best
scores across the sheet, daily lesson, and AI paper. Written paper submission and
code submission remain separate actions.

Code executes on the computer running Morrow. Python and JavaScript implement
`solve(input)`; C++ starters include a bundled JSON parser and a standard-input/output
wrapper. Existing standalone C++ programs can also read JSON from stdin and output
one JSON value. No cloud compiler or paid execution service is used.

The server detects installed Python 3, Node.js, and a C++17 compiler. macOS uses
`sandbox-exec`; Linux requires `bubblewrap` with working namespaces and seccomp.
Unsupported or unavailable isolation disables execution and shows a setup message;
there is no unsandboxed fallback. Programs have no access to workspace files or the
network. Each run has a 3-second wall limit, bounded memory and output, and a fresh
process per case. Compilation allows 15 seconds; a submission has a 30-second total
budget. At most two executions run at once. macOS execution is tested; the Linux
backend still needs runtime verification on Linux.

**Progress** shows today's score ring, a selectable 14-day score chart, pass rate,
submission streak, recent results, and five coding badges alongside the existing
learning heatmap and XP rewards. A problem earns up to 100 daily points based on
tests passed; only its best result that day contributes. Repeats cannot inflate the
score or daily XP. A full pass marks the problem solved and earns 10 learning XP
once per problem per local day. Manual checklist changes earn no verified code score.
Back up `user/memory/code-practice.json` alongside the other learning stores.

`npm run test:learning` checks the editor, real local execution, scoring, and responsive
screens using a temporary workspace; it does not change personal learning progress.

## Local-workspace learning and navigation

In the free local beta (and for the original workspace owner in accounts mode), course lessons, research notes, daily DSA and 90-day learning completions save to **`user/memory/learning.json`** in your private user repo. The server imports prior `user/reports/studied.json` and `user/research/learning/progress.json` once, preserving the originals. Writes use a process lock, fsync and atomic replacement. Invalid storage is reported rather than silently reset. `scripts/sync_data.sh` pushes `user/` with the rest of your private data. Other accounts use their own stored reading progress and cannot read or change this shared progress file.

- **Learning → Today**: follow the daily checklist. Fetch a whole briefing or one missing section after reviewing its exact command. **Saved library** provides dated archives, category filters and search.
- **Your curriculum**: follow the daily/weekly plan, continue resume topics, and browse course tracks in one view. Detailed readers keep the same saved completion state.
- **Discover**: read two AI-priority papers, explore new technology and companies, and find GitHub projects. **Saved library** includes categorized bookmarks and editable personal notes.
- Fetch actions use your configured AI agents and persist their output in `user/research/`; they are not simulated feeds. The Activity panel follows each run, and its output views refresh when that agent finishes, even while another agent is still working. Independent research stages can run in parallel.
- Open a read → **Mark complete**. **Reopen reading** reverses it. Opening alone never completes an item.
- **Progress**: individual learning-area and course totals, weekly charts, streaks, badges, coding results, and dated completion history. Imported work keeps its completion state without inventing activity dates.
- Courses and the hosted course reader share the same progress. `/course/01-system-design/` redirects to `/course/#/01-system-design/`. The course reader still uses its existing CDN scripts.
- Applications, Data hub and the Saved library keep page/filter/search state in the URL. Browser Back, Forward and reload restore it.

TanStack Query keeps ordinary GETs fresh for 30 seconds and evicts unused entries after five minutes. Status/run/editable files bypass the cache. Mutations do not retry and invalidate cached reads after success. No credential or personal-data cache is persisted to browser storage. React Suspense and a route error boundary keep navigation available while pages load or fail. The initial route loads alongside its data to avoid an extra waterfall.

`npm run dev` includes development-only react-grab and react-scan; `npm run doctor` checks the React route adapter. Production builds exclude those tools. Client caching and bounded rendering do **not** establish a particular deployment capacity; load testing and isolated workers are still required before scaling multiuser automation.

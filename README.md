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
- **Bot Crew:** 18 application, profile and career assistants with original 3D avatars, practice
  controls, configuration links, busy states and recorded history.
- **Flows:** select groups or exact stages, continue or rerun completed work, skip groups,
  choose date/CLI/concurrency, inspect grouped checkpoints and validate material.
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
- **Activity:** compact illustrated launcher, run summary, expandable output, copy, follow-latest, graceful stop and force stop for owned runs.
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

Owner-workspace runs show an exact command preview and ask for confirmation. Practice mode is selected by
default wherever supported. Pipeline practice mode still permits its learning/research stages
to invoke the configured AI CLI. Only one command can run through this server at a time.
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
- Fetch actions use your configured AI agents and persist their output in `.research/`; they are not simulated feeds. The Activity panel shows the run, and the view refreshes when it finishes. Only one dashboard run can execute at a time.
- Open a read → **Mark complete**. **Reopen reading** reverses it. Opening alone never completes an item.
- **Progress**: dated course/research completions and reopens, plus imported work whose original dates were not recorded.
- Learning path and the hosted course reader share the same progress. `/course/01-system-design/` redirects to `/course/#/01-system-design/`. The course reader still uses its existing CDN scripts.
- Applications, Data hub and the Research library keep page/filter/search state in the URL. Browser Back, Forward and reload restore it.

TanStack Query keeps ordinary GETs fresh for 30 seconds and evicts unused entries after five minutes. Status/run/editable files bypass the cache. Mutations do not retry and invalidate cached reads after success. No credential or personal-data cache is persisted to browser storage. React Suspense and a route error boundary keep navigation available while pages load or fail. The initial route loads alongside its data to avoid an extra waterfall.

`npm run dev` includes development-only react-grab and react-scan; `npm run doctor` checks the React route adapter. Production builds exclude those tools. Client caching and bounded rendering do **not** establish a particular deployment capacity; load testing and isolated workers are still required before scaling multiuser automation.

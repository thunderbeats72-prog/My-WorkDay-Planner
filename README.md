# My Workday Planner

Private workday planner for a Business Development Executive (previously built as BD Command Center — same IndexedDB database name, so existing tasks/timer data carry over untouched).

Private, local-first PWA for a Business Development Executive. ₹0/month target: React + TypeScript + IndexedDB (Dexie) + Tesseract.js in-browser OCR. No paid AI, no Teams API, no data leaves the browser.

## Run
```bash
npx -y pnpm@10 install
npx -y pnpm@10 dev        # http://localhost:5173
npx -y pnpm@10 build      # type-check + production build
npx -y pnpm@10 test       # engine, ML and full-app tests
npx -y pnpm@10 lint
```

## What's working
- Onboarding & working-hours settings, deep-navy responsive layout, mobile bottom nav
- Task CRUD, priorities, categories, deadlines, undo completion, soft delete, search — persisted in IndexedDB across refresh/restart
- Screenshot Import: drag/drop or upload, Tesseract.js OCR with progress, editable raw text, deterministic parsing, confidence + ambiguous-date warnings, duplicate detection, **mandatory review before saving**, plus a sample-text mode
- Scheduling: explainable scoring (priority + deadline + deferrals), daily timeline, lunch/buffers, capacity & remaining time, conflict warnings, unscheduled queue (never silently discarded), manual override
- Time tracking: Start/Pause/Resume/Complete, one active session, timestamp-based elapsed time persisted in IndexedDB so it recovers after refresh
- Reminders: a **notification centre** in the utility bar (unread badge, snooze 15m, dismiss, mark all read) that persists across reloads, plus **real desktop and phone notifications** through the service worker — permission-gated, quiet-hours aware, de-duplicated per deadline, and clickable straight into the task
- Weekly report from real saved data (est. vs actual, follow-ups/proposals, category breakdown)
- Backup: JSON + CSV export, validated JSON import, local reset; PWA manifest + service-worker app-shell cache

## Honest limitations
- **Notifications:** in-app reminders are always written and survive reloads. System banners fire while the app is open, and — on Android, for the installed PWA — from a best-effort background check. A fully closed browser on desktop cannot be woken; there is no push server by design, and the app says so rather than pretending otherwise.
- **Cloud sync:** not configured (by design). See `SUPABASE.md` for the RLS-first setup; never expose a service-role key.
- **OCR:** quality depends on screenshot clarity; inferred dates are flagged and never auto-confirmed.
- IndexedDB is per-browser/device and can be cleared — export backups regularly.

## Deploy
Vercel (or any static host) with **build command** `pnpm build` and **output directory** `dist`. The repo pins its dependency graph in `pnpm-lock.yaml`; no environment variables are required. Service-worker caching only activates in production builds.

## Tests
`npx -y pnpm@10 test` runs Vitest with jsdom + Testing Library: pure scheduling/scoring/date-parsing/OCR tests (`src/lib/engine.test.ts`), on-device ML tests (`src/lib/ml.test.ts`), and a full-app integration test covering onboarding, task CRUD, timer start/pause, rescheduling, completion + undo, screenshot import and reload persistence (`src/App.test.tsx`), backed by `fake-indexeddb`.

## Architecture
`src/lib/types.ts` (domain models) · `src/lib/db.ts` (Dexie/IndexedDB) · `src/lib/engine.ts` (pure scheduling + OCR parsing — unit-testable) · `src/App.tsx` (UI, timer, reminders)

## UI/UX redesign (My Workday Planner)
- Exact palette: navy `#17243B`, primary `#356AE6`, canvas `#F4F6FA`, success `#168568`; 8px spacing, restrained shadows, priorities always shown as text labels (never colour alone).
- Sidebar order: Today, Inbox, Schedule, Overdue, Completed, Reports, Screenshot Import, Settings. Tablet (768–1100px) collapses to an icon rail; below 768px a bottom nav (Today, Inbox, Schedule, Import, Settings) + floating Add button replaces it.
- Task cards: completion checkbox (with undo), one contextual primary action, Edit, Reschedule (Tomorrow / +2 days / Next Monday / pick a date), and an overflow menu (Snooze, Edit, Complete, Delete with confirmation).
- Task detail is a side panel (full-screen sheet on mobile) with dependency picker, persisted elapsed time, and full history. Validation keeps your input and explains the error instead of discarding it.
- Screenshot import is a guided 4-step wizard (Upload → Extract → Review → Confirm) with an explicit consequences summary before anything is saved.
- Schedule "Apply suggestions" now asks first, listing how many tasks move, how many stay queued, and confirming no deadline changes. Daily view interleaves the protected break; proposal blocks are labelled focus blocks; weekly view shows real due dates only.
- Dashboard header shows live Online/Offline, notification-permission, and truthful "Local-only · Sync not configured" chips. Overdue is computed only from real deadlines — suggested times passing never marks a task overdue.

## Outlook & Teams connection (Microsoft Graph)
- Settings → **Connected accounts**: paste your own free Azure App Registration **Application (client) ID** (SPA platform, redirect URI shown in-app), then **Connect with Microsoft** — OAuth 2.0 + PKCE in the browser, no client secret, read-only scopes `User.Read, Mail.Read, Chat.ReadBasic, ChatMessage.Read`.
- Today gains a **“Missed in Outlook & Teams”** card: unread mail + Teams messages that @mention you, with sender, time-ago, preview, **Open** (original), **Create task** (prefilled follow-up), and dismiss. Per-source errors (e.g. admin-consent required for chat reads) are shown, never hidden or faked.
- Tokens live only in session storage (~1h); cached highlights are local. Disconnect in Settings. Requires your work Microsoft 365 account; cannot be verified without the user's own tenant — test after registering the app.
- Onboarding was redesigned as a 3-step guided setup (About you → Working rhythm → Defaults) with a branded intro panel, live greeting/schedule previews, and step progress.

## Motion & UX pass
- Tasteful micro-animations throughout (page transitions, card/task hover lift, slide-in detail panel, popping menus/toasts, checkbox pop, pulsing live-timer dot, animated capacity ring & progress bars) — all disabled under `prefers-reduced-motion`.
- **Quick Add bar** on Today: type, pick priority, Enter — task is created for today without opening a form.
- **Keyboard shortcuts:** `N` new task, `D` Today, `I` Inbox, `C` Schedule, `R` Reports (ignored while typing).
- Inbox gained filter chips (All / Critical+High / Due today / Overdue / Proposals) and sorting (Smart / Deadline / Newest).
- Sticky blurred action bar, skeleton loading screen with shimmer, animated day-capacity ring on the dashboard.

## Visual & UX pass 2
- **Command palette (`Ctrl/Cmd + K`):** fuzzy jump to any page, action (add task, import, check Outlook/Teams), or open task — full keyboard support (↑↓ / Enter / Esc). Also reachable from the header search button.
- **Dark theme:** sun/moon toggle in the header, persisted per device, with a fully re-tuned dark palette (cards, forms, menus, palette, mobile nav).
- **Dashboard hero:** animated gradient banner driven by real data (overdue count, deadlines today, completed, free capacity) with a large animated capacity ring.
- **Count-up stat cards** with icon tiles that animate in on load; priority accent bars on task cards; staggered list entrances; sidebar profile card with initials avatar and live online dot.
- All new motion honours `prefers-reduced-motion`.

## Visual & responsive pass 3
- **Next-7-days strip** on Today: per-day due counts (overdue in red), tap any day to open Schedule.
- **Completion celebration:** a brief confetti burst when a task is completed (suppressed under reduced-motion).
- **Scroll progress bar** at the very top + a **back-to-top** button after scrolling.
- **Mobile top bar** (sticky, blurred): brand, live online status, command-palette and theme buttons — since the sidebar is hidden on phones.
- **Responsive hardening:** dedicated breakpoints at 1500 / 1200 / 1024 / 900 / 767 / 420px; global `overflow-x: clip` guards, `min-width: 0` flex fixes and word-wrapping so long titles/clients can't stretch the layout; schedule timeline stacks vertically on phones; weekly grid collapses 7 → 3 → 2 → 1 columns; task actions go full-width on touch; inputs use 16px text on mobile to stop iOS focus-zoom; toasts dock above the bottom nav; safe-area padding on sheets.

## Logic audit + on-device ML
Scenario fixes (all covered by tests where the logic is pure):
- Double-clicking Start no longer resets the running segment and loses elapsed time; starting a completed task is refused with guidance; clock skew can never bank negative time.
- Deleting a task with a live timer ends its session first (no orphan timers).
- **Closed-app timer safeguard:** a heartbeat is written while a timer runs. On reload, if the app was closed, only ~30s past the last heartbeat is banked and the timer auto-pauses (with a history note) — time with the app shut is never counted as work. Duplicate active sessions are auto-paused, keeping the newest.
- Blocked tasks and tasks waiting on an unfinished dependency are **never scheduled**; they sit in the queue with a "Why not scheduled" reason.
- Broken settings (workday end ≤ start, empty working days) can't produce negative capacity — and Settings now validates before saving, plus working days are finally editable (Mon–Sun picker).
- Conflicts are only flagged within the same suggested date (new `suggestedDate` field), not across different days.
- Dependency cycles (A → B → A) are rejected in the task panel with input preserved.
- Expired Microsoft tokens (401) now disconnect cleanly with a "please reconnect" message instead of cryptic errors.

On-device ML (no external model/API; trained only on your saved data, `src/lib/ml.ts`):
- **Duration learning:** median actuals per category/client (3+ samples) — the scheduler then plans with the learned duration and labels it "learned".
- **Smart suggestions in the task panel:** keyword/Naive-Bayes over your own past titles suggests category, priority and a realistic duration, with reasons and confidence; nothing changes until you tap Apply.
- **Deadline-risk scoring:** transparent 0–100 score (deadline proximity, deferrals, blocked/dependency, inbox age, remaining capacity) with every factor listed — surfaced as the "At-risk & likely to slip" card on Today.
- **Reports insights:** sharpest working hour, categories whose estimates are systematically off, and a "what things really take you" table.
- Small samples are always labelled as such; with no history the system says so instead of guessing.

## Premium pass 4 — smart capture, focus suggestion, wrap-up
- **Smart Quick add:** one line can carry the whole task. Dates ("tomorrow", "Fri", "21 Oct", `2026-10-24`), times ("3pm", "15:30", "eod"), priority (`!high`, `p1`, `!!`), duration (`45m`, `1.5h`), category (`#proposal`, `#follow-up`) and client (`@Nova`, expanded against your saved clients) are parsed live, shown as chips before you press Enter, and stripped from the title. A bare time that already passed today rolls to tomorrow and says so. Parsing lives in `src/lib/quickAdd.ts` (10 unit tests); unparseable words stay in the title untouched.
- **Do this next:** `src/lib/focus.ts` turns the scheduler's score into one explainable suggestion — overdue first, quick wins flagged, blocked/unmet-dependency tasks excluded, work that fits the time actually left preferred, and a running timer always wins. "Another" cycles suggestions; the score and reason are visible rather than hidden. 8 unit tests.
- **End-of-day wrap-up:** after `workdayEnd`, Today offers to roll still-open tasks to tomorrow in one click (deferrals counted, undo from the toast).
- **Undo delete:** soft-deleted tasks can be restored from the toast as well as reopening them.
- **Keyboard:** `?` opens a shortcut sheet (or the palette action), `/` jumps to Quick add from any page, and dialogs now trap Tab and restore focus to the trigger on close. Global shortcuts stand down while a dialog is open.
- **Truthful day state:** free time is now the smaller of uncommitted capacity and the hours left; after hours it reads zero, non-working days show "No working hours today", and the hero copy adapts instead of promising an unavailable 8h.
- **Responsive:** quick-add tokens and the focus card reflow at 1100/900/560px, reminder actions become a 2×2 grid on phones, stat cards drop to two columns below 1240px, and the 320px layout was checked end to end.

## Design pass — quiet ink

The interface was rebuilt around a deliberately small design vocabulary
rather than layered decoration:

- **One neutral palette.** Paper greys in light, near-black in dark
  (`#08080a` canvas, `#101012` surface) with no navy cast. A single muted
  cobalt is reserved for state; actions are ink.
- **No aurora, no glow.** The hero is one flat panel; the time-of-day
  gradients, radial blobs, dotted grid, dashed ring orbit, gradient-clipped
  numbers and coloured stat bars are gone.
- **Hairlines over shadows.** Cards are white/black paper with a 1px border,
  12px radius and no drop shadow. Inputs, chips and badges follow the same rule.
- **Typography carries the hierarchy.** One family, tighter tracking
  (`-0.028em` on headings), smaller uppercase labels with far less letter
  spacing, and tabular numerals for anything that counts.
- **Personality, not noise.** The keyboard readout (`⌘K` · `/` · `?`) with a
  blinking caret, the live clock, the "Next in …" countdown and the `NOW`
  marker in the plan are the only "alive" elements.
- **Cleanup.** Sparkle icons replaced with functional ones, the emoji vibe
  glyph replaced by a status dot, the default company value removed, and the
  greeting no longer says "Good morning, there".

## Design v4 — monochrome, Geist, and one planner

A second pass tightened the product rather than restyling it.

- **Type.** Geist (self-hosted variable font, `@fontsource-variable/geist`)
  replaces Inter as the single universal family. It is a contemporary
  grotesque built for interfaces: tighter apertures, clearer numerals, and
  it holds up at 10px labels as well as 30px headings.
- **No blue.** Every brand blue is gone. Actions are ink (`#17181d` light,
  `#f3f3f5` dark), state is grey, and the only saturated colours left are
  semantic — red overdue, amber warning, green done.
- **A real clock.** The digital readout became an **analogue dial** in the
  utility bar: hairline face, three hands, four quarter ticks and a small
  digital readout beside it so the time still scans instantly. It re-renders
  once a second and re-syncs when the tab regains visibility.
- **A new mark.** The logo is now a "day arc": a nearly-complete ring with a
  gap and a single pin at the start, on flat near-black. No gradients, no
  glow, no spark. It ships as SVG plus regenerated PNG icons (192, 512,
  maskable, apple-touch, favicon).
- **One planner instead of four pages.** Inbox, Schedule, Overdue and
  Screenshot Import are merged into **My Tasks**: a collapsible "Today's
  plan" strip (one row per task, live `now` marker, queued work with reasons,
  apply suggestions), the overdue summary, filter chips, search, sort, and
  the task list. Import opens as a dialog; the old URLs
  (`#/inbox`, `#/schedule`, `#/overdue`, `#/import`) redirect to `#/tasks`.
- **Sidebar.** Five destinations in two groups (Work / Review) with Settings
  anchored at the foot beside the profile card. Collapse to a rail still
  works and is remembered.
- **Phones.** The sidebar is gone entirely below 768px. The bottom bar has
  exactly four destinations — Today, My Tasks, Completed, Reports — and
  Settings lives behind the gear in the top-right corner.
- **Onboarding and settings** were brought into the same language: a black
  brand panel, no oversized "W" watermark, a flat capacity meter, ink day
  chips and stepper dots.
- **Branding.** Every "Clouder Technologies" reference is gone from the app,
  the README and the default settings.

## Design v5 — a real dark theme, branded assets, and notifications

The third pass looked for what breaks rather than what to add.

### Dark mode, actually dark

- **One neutral ramp, no cast.** Canvas `#0a0a0c`, surface `#121215`,
  raised `#202025`, borders `#2a2a31` — every grey is a true neutral, so
  nothing reads navy. Light mode moved to `#f5f5f6` paper.
- **Ink fills carry their own text colour.** A `--on-ink` token now pairs with
  `--ink`, which fixed the visible bug where an active filter chip was white
  text on a near-white fill (1.1:1 contrast) in dark mode.
- **Blue retired everywhere.** A colour-space sweep converted the last
  blue-tinted surfaces, shadows and gradients to neutral greys; the only
  saturated colours left are semantic (red / amber / green). The one remaining
  blue-ish hue is the "Meeting" category chip, deliberately moved to teal.
- **Elevation reads as elevation.** Cards separate from the canvas with a
  hairline plus surface step instead of a shadow that a black-on-black
  background swallows.
- **Selection states are dark-native.** Day chips, segmented controls and
  toggles use a lightened surface in dark mode instead of the light theme's
  near-black fill, and disabled buttons are muted rather than invisible.
- **Contrast audited, not eyeballed.** A scripted WCAG pass walks every text
  node on all five pages and reports anything under 5:1; the remaining hits
  are only decorative 9.5 px shortcut hints.
- **Tablet layout repaired.** A later `:root` block was resetting
  `--sidebar-width` to 264 px at every width, so from 768–1080 px a widened
  rail sat on top of content whose margin had collapsed to zero. Each
  breakpoint now owns its width explicitly: no sidebar under 768, a real
  78 px rail with reserved space up to 1080, and the user's width above it.

### One mark, everywhere

- The old blue **"W" logo was still shipping** as `icon.svg`,
  `favicon-32.png`, `icon-192.png` and `apple-touch-icon.png`. All of them are
  regenerated from the day-arc mark, with a thicker variant for the 16/32 px
  favicons so the pin survives.
- Added `favicon-16.png`, a `mask-icon` colour, and a **1200×630 Open Graph
  card** (`og-image.png`) with matching `og:`/`twitter:` meta tags.
- `manifest.webmanifest` now carries the mark as its theme/background colour,
  an `id`, display overrides, categories, and **three app shortcuts**
  (Today / My Tasks / Reports) for the long-press menu on an installed app.
- The browser chrome colour follows the theme (`#f5f5f6` / `#0a0a0c`)
  instead of the retired navy.

### Notifications you can actually receive

Two layers, because they fail in different ways.

1. **In-app centre** — a bell in the utility bar (and the phone top bar) with
   an unread badge and a panel listing every reminder: task, client, deadline
   relative to now, snooze and dismiss per row, mark all read, clear all.
   Backed by `localStorage`, so it survives reloads and never depends on the
   OS accepting a banner.
2. **Native notifications** — shown through the **service worker**
   (`registration.showNotification`), which is the only path that works in an
   Android PWA, with a `Notification` constructor fallback for desktop
   browsers without a worker. Tapping one focuses the app and opens the task.

Supporting behaviour:

- `deliverNative()` sends the icon, badge, tag, vibration pattern and a deep
  link; delivery is de-duplicated per `(task, deadline)` for 14 days, and
  **snoozing clears that marker** so the reminder genuinely comes back.
- Quiet hours suppress the OS banner only — the in-app copy always lands.
- A **"Send a test notification"** button in Settings proves the whole chain
  on the current device, and the panel shows honest states: *Alerts off*,
  *System alerts on*, *Blocked by browser*, *Not supported*.
- `periodicSync` is registered when the browser supports it (installed
  Android PWA), so reminders can fire from the background: the worker reads
  IndexedDB, applies lead time and quiet hours, and fires once per deadline.
- Nothing leaves the device. There is no push server, and the copy says so.

## Design v6 — one logo, proven, and a tick that sits still

Two things that looked fine in screenshots and were wrong in fact.

### The logo was three different logos

- The **in-app mark drew a 177° arc** while `icon.svg` and every PNG drew
  **233°** — the sidebar logo and the tab icon were genuinely different shapes.
  Geometry now lives in one module, `src/lib/brandGeometry.ts`, consumed by the
  component, the generated SVG and `scripts/build-icons.mjs`
  (`pnpm brand:icons`). A unit test asserts the component and `icon.svg`
  produce the same dash pattern, and the test suite also checks that every
  shipped icon file is non-empty and the `.ico` is a real three-size container.
- **Old icons survive in caches and in the OS's copy.** Icons are now served
  with a generation query (`?v=4`), the service worker is network-first for
  brand assets and everything in `public/` including `favicon.ico`, and the
  manifest lists PNG icons first — a few Android launchers ignore the SVG entry.
- Shipped the gaps too: **`favicon.ico`** (16/32/48, the URL browsers request
  when nothing else is declared) and **`favicon-48.png`**.
- **Social cards were resolving to the favicon.** `og:image` was relative, and
  crawlers do not resolve relative URLs, so LinkedIn, Slack and iMessage fell
  back to whatever icon they had cached — often the old "W". `og:image`,
  `og:url`, `twitter:image` and `canonical` are now absolute, built from
  `SITE_URL` / `VERCEL_URL` at build time (`%SITE_URL%` in `index.html`).

### The tick was 7px off-centre

`.task-check` is a `<button>`, and the user-agent's `padding: 1px 6px` was never
reset. That left a 5px content box for a 14px glyph, and because a grid item
that overflows its area has its `center` alignment demoted to `start`, the tick
rendered 7px right and 1px low inside the circle — exactly the misalignment
visible on the Completed page. The control now resets its padding, centres on
the grid, locks `flex`/`aspect-ratio` so an empty circle can never stretch into
a stadium, and sits 0.75px from the title's optical centre. Measured, not
eyeballed: the browser offset is now `0.00 × 0.00`.

### Why the installed app kept the old name and icon

The window title of an installed PWA is `{name stored in the OS shortcut} -
{document title}`. Windows copies **both** the name and the icon when the app is
installed and never re-reads them on a refresh or a redeploy, so an app installed
under an older name keeps that name in its title bar indefinitely. No amount of
refreshing, and no change to the manifest, can reach it — the shortcut has to be
reinstalled.

What the app *can* do is make sure the next install lands correct, so the
manifest now calls itself `My Workday Planner` (it said `Workday Planner`, which
is not the name anywhere else in the product), the icon URLs moved to a new
generation (`?v=5`), and a new service worker reloads an open tab once when it
takes control — previously the first refresh after a deploy kept painting the
cached shell, which is indistinguishable from "nothing happened".

## Accounts — a user ID, a password, and the honest limits of each

Sign up in **Settings → Account** with a user ID and a password. No email, no
magic link, no verification mail, because there is nothing to verify against —
the account is created on the device you are holding.

- Passwords are stretched with **PBKDF2-SHA256**, 210,000 iterations, a random
  16-byte salt per account, and compared in constant time. The plain password is
  never stored and never sent anywhere.
- Five wrong attempts start a pause that doubles: 30s, 60s, 2m, up to 15m.
- An unknown user ID and a wrong password return **the same message**, so the
  screen is not an oracle for which IDs exist.
- Changing a password re-hashes it. Deleting the account leaves your tasks
  exactly where they are.

### What "the same login on my phone and laptop" actually requires

A user ID and password can only *identify* you; something still has to move the
data. The planner ships with no server, so sync is opt-in and the UI says which
of the two states you are in:

| State | What the header says | What is true |
| --- | --- | --- |
| No account | `Local-only · No account` | Everything is in this browser |
| Account, no sync | `Local-only · @you` | The login is here; a second device starts empty |
| Account + sync | `Synced · @you` | Same login, same tasks, both devices |

**To turn on sync** (once, ~2 minutes):

1. Create a free project at [supabase.com](https://supabase.com).
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor. It creates
   one table and three row-level-security policies, so the public key in the
   browser can only ever read and write **your own** row.
3. Turn off **Authentication → Providers → Email → Confirm email**. The app maps
   `lakshit` to `lakshit@users.workday-planner.app` and never sends mail there; if
   confirmation is on, sign-up returns no session and the panel tells you so
   instead of failing silently.
4. In the app: **Settings → Account → Use on phone and laptop**, paste the
   project URL and the `anon public` key. They are stored in this browser, not in
   the bundle, so no redeploy is needed.

Then sign in on the second device with the same ID and password.

### How the merge behaves

`src/lib/snapshot.ts` merges per record, not per device:

- **Tasks** carry `updatedAt`; the newest copy of each task wins. Editing task A
  on the phone and task B on the laptop keeps both.
- **Sessions, events**: unioned by id — they only ever accumulate.
- **Reminders**: a terminal state (`done`, `dismissed`) beats a queued one, so a
  reminder dismissed on the phone does not reappear from the laptop.
- **Settings** have no per-field clock, so the whole block follows the snapshot
  written most recently.

Sync runs when you sign in, when the tab becomes visible, every two minutes, and
whenever you press **Sync now**. It is always safe to press: with nothing to
merge it reports "both devices already match" and writes nothing.

### Why this is not a violation of the local-first promise

Nothing leaves the device unless you connect a sync project, and the app works
exactly as before if you never do. Disconnecting returns the planner to
local-only immediately; the tasks stay. The only data a sync project ever sees is
the JSON snapshot of your planner, protected by a row that only your login can
read.

### Signing up during onboarding

Setup is now four steps, and the **first** one is the account: sign in, create an
account, or continue without one. Asking there matters — a user who finishes
setup before creating the login tends never to come back to it.

The step also asks the question that decides whether "same login" means anything:
**where does the data live?** If no sync project is connected it says so plainly
and offers the two-minute setup inline; if one is connected it confirms sync is
on. Signing in on a second device pulls the merged snapshot before you finish
setup, so the name and working hours you land on are the ones already in use.

### Zero-setup sync (recommended)

Pasting keys on every device is friction nobody should pay twice. Set two
environment variables once, in the deployment:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

Every device built from that deployment then uses the same project with nothing
to configure — `.env.example` documents it. The anon key is public by design;
row-level security in `supabase/schema.sql` is what keeps rows private. A project
entered by hand in the app still wins over the build-time default, so a single
device can be pointed elsewhere without a redeploy.

## Sync on Neon

Neon is Postgres, not a backend — a browser cannot hold a connection string and
should not. So this repo ships the missing piece: three small functions in `api/`
that hold the connection string server-side and scope every query to the token's
owner. The browser only ever sees a 64-character session token.

```
api/auth/signup.ts   POST  { userId, password, displayName? } -> { token }
api/auth/signin.ts   POST  { userId, password }               -> { token }
api/snapshot.ts      GET | POST | DELETE   (Bearer <token>)
db/neon-schema.sql   3 tables, no extensions
```

The password is stretched with the same PBKDF2-SHA256/210k as the local accounts,
so a user ID means one thing everywhere. Session tokens are stored **hashed**, so
a database leak does not hand over live sessions. The user is always taken from
the token, never from the request body, so one account cannot ask for another's
snapshot by naming it.

### Setup, once

1. **Create the project** at [neon.com](https://neon.com) — free plan. Region:
   **AWS ap-southeast-1 (Singapore)**, the closest Neon has to India.
2. **Run `db/neon-schema.sql`** in the Neon SQL editor. Three tables.
3. **Copy the connection string** from *Connection Details*. Use the **pooled**
   one; serverless functions open many short-lived connections.
4. **Add it to the deployment** as `DATABASE_URL` — a server-side variable, never
   `VITE_`-prefixed, never shipped to the browser.
5. **Add `VITE_SYNC_MODE=neon`** and redeploy.
6. Open the app: onboarding step 1 now says *sync is built in*. Create the
   account on the laptop, sign in on the phone with the same ID.

### What it costs you versus Supabase

| | Neon + this API | Supabase |
| --- | --- | --- |
| Auth | Written here (~150 lines) | Built in |
| Region near India | Singapore | **Mumbai** |
| Free-tier pausing | Scales to zero, resumes on request | Pauses after 7 idle days |
| Lock-in | Plain Postgres — `pg_dump` and go | Supabase-specific |

Neon's scale-to-zero is actually *better* than Supabase's pause for this app: a
cold start costs a few hundred milliseconds once, instead of a project that stays
down until someone clicks Restore. The price is that you own the auth code.

## One database, every user, real-time — and who has to do what

There is exactly **one** setup, done once by whoever owns the deployment. After
that:

- **Every visitor** creates their own user ID and password inside the app.
- **Nobody ever sees a database key.** Not the owner's friends, not their phone.
- **Each account is isolated.** `planner_snapshots` is keyed by `user_id`, and
  every route derives the user from the session token rather than the request
  body, so one account cannot read another's tasks even by naming it.

| Who | Does what | How often |
| --- | --- | --- |
| Deployment owner | Creates the database, sets two env vars | **Once, ever** |
| Every user | Signs up with an ID and password in the app | Once per person |
| Every device | Signs in with that same ID and password | Once per device |

The common misreading is that each person needs a database login. They do not —
they need an *app* login, which is just a row in a table you already created.

### The shortest possible setup (no copying keys)

Vercel can create the Neon project and wire it up itself:

1. Vercel → your project → **Storage** tab → **Create Database** → **Neon**.
2. Accept the defaults and connect it to this project. Vercel injects
   `DATABASE_URL` into every environment automatically — there is nothing to
   copy or paste.
3. Add **one** more variable: `VITE_SYNC_MODE` = `neon`.
4. Redeploy.

That is the whole thing. The seven-step manual route in the previous section
still works and gives you control over the region.

### What "real-time" actually means here

| | Latency |
| --- | --- |
| Edit on this device → pushed | ~2.5s (debounced, so typing is one write) |
| Other device notices → pulls | ~4s |
| **Worst case, phone to laptop** | **~7 seconds** |

How: `api/version.ts` returns one timestamp. A visible tab polls it every 4s and
only pulls the full snapshot when that timestamp changes. No websockets, no
always-on server, no per-message billing — and it degrades gracefully: the poll
slows to 30s after two minutes untouched, and stops entirely while the tab is
hidden, so a forgotten browser tab cannot keep a database awake all night.

Writing is gated on `stats.needsPush`, which is true only when the merged result
genuinely differs from what the server holds. Without that gate, two devices
would trade an updated timestamp forever — each pull bumping the version the
other was watching. `src/lib/snapshot.test.ts` has a convergence group that
fails if that ever regresses.

### The tables create themselves

Setup used to include pasting SQL into Neon's editor — the step most likely to
go wrong for someone who does not do this for a living. `api/_lib/schema.ts` now
runs the same `create table if not exists` statements on the first request after
a cold start. It is memoised per serverless instance, takes no input, and costs
one round trip once.

`db/neon-schema.sql` remains for anyone who prefers to provision explicitly, or
who deploys somewhere without the `/api` functions.

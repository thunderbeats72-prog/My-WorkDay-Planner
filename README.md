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
- Reminders: a **notification centre** in the utility bar (unread badge, snooze 15m, dismiss, mark all read) that persists across reloads, plus **real desktop and phone notifications** through the service worker — permission-gated, quiet-hours aware, de-duplicated per nudge, repeated until the task is done, and clickable straight into the task
- Weekly report from real saved data (est. vs actual, follow-ups/proposals, category breakdown)
- Daily update, as a tab inside Reports: an optional note when completing a task, and a one-tap "Generate Daily Report" for any date — completed struck through, pending plain, notes after their task, WhatsApp/Markdown/plain text, one saved update per day
- Backup: JSON + CSV export, validated JSON import, local reset; PWA manifest + service-worker app-shell cache
- **Attachments:** photos (compressed in-browser) and 15-second voice memos on any task, with playback in the task panel — stored locally first, and synced across devices as their own rows, never inside the snapshot

## Honest limitations
- **Notifications:** in-app reminders are always written and survive reloads. System banners fire while the app is open, and — on Android, for the installed PWA — from a best-effort background check. A fully closed browser on desktop cannot be woken; there is no push server by design, and the app says so rather than pretending otherwise.
- **Cloud sync:** Neon Postgres behind this repo's own `/api` functions. Set the connection once in Vercel and every device uses it; no keys are ever pasted into the app.
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
  IndexedDB and applies **the same rule as the page** — lead time, repeat
  cadence, quiet hours, and a dismissed or snoozed task stays quiet.
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

**To turn on sync** (once, and only by whoever deploys the site):

1. Vercel → **Storage** → **Create Database** → **Neon**, and pick the Singapore
   region (closest to India; the free plan has no Indian region).
2. In Vercel → **Settings → Environment Variables**, add `VITE_SYNC_MODE=neon` to
   **Production**, **Preview** and **Development**. The Neon integration supplies
   `DATABASE_URL` on its own.
3. **Redeploy.** Every device that opens that URL now shares one database.

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

### Nothing to paste, ever

There is deliberately no place in the UI to enter a database URL or key. Whoever
deploys sets it once in Vercel; every device then inherits it, and the app only
ever says sync is on when it truly is. The front door states the local-only
truth when a copy has no database, instead of handing a non-technical user a
four-step homework assignment.

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

## Why a phone could not sign in with the same password

`signIn` checked the **local device first**. A phone that had never seen this
planner has no local account, so it failed with "that user ID and password do not
match an account on this device" — before the server was ever asked. The account
existed; the check never reached it.

Sign-in now asks the backend first:

1. Backend accepts → `adoptVerifiedAccount()` writes the matching local record
   (fresh salt, same password) and binds the device.
2. Backend unreachable but this device already has the account → you are let in,
   with "signed in on this device only". An offline laptop is not a locked laptop.
3. Backend says the password is wrong → that message, and nothing is written.

Sign-up has the same order now, so a phone can never be left holding a
half-account that was created locally and rejected remotely. If the ID already
exists on the backend, sign-up quietly becomes a sign-in.

`src/hooks/useAccount.test.tsx` fails if that ordering is ever reversed again.

## Design pass — auth and the platform around it

- **One auth surface** for onboarding and Settings: icon-led fields, a
  segmented mode switch, a single full-width action.
- **Password reveal** without moving focus, and a submit that stays disabled
  until it can actually do something.
- **Errors arrive in place** — a tinted panel with a short nudge, announced via
  `role="alert"`, instead of a toast that vanishes.
- **Tabs are real tabs** (`role="tab"`), so the submit button is the only
  "Sign in" button a screen reader has to choose between.
- **Coarse pointers** get 48px fields and 16px text, which is also what stops
  iOS zooming the page when a field is focused.
- **`prefers-reduced-motion`** disables the whole motion layer rather than
  leaving a few animations running.
- The header chip is now a **live dot**: grey when local-only, green when synced,
  breathing while a write is in flight.

Everything uses the existing ink tokens — no new colours, no gradients, and no
return of the spotlight, lift or sweep effects that were removed earlier.

## Design v7 — two invisible bugs, then craft

Surveying the stylesheet turned up something worse than plain styling.

### The paint tokens had been set to `none`

When gradients were removed, `--grad-primary`, `--grad-success`, `--grad-warm`
and `--grad-danger` were redefined as `none` — but **19 rules still paint with
them**: the floating add button, every progress bar, the capacity bars, the
priority rails. All of it was drawing nothing. An invisible element looks like a
design choice, which is why it survived several passes.

The tokens are solid colours now (`var(--ink)`, `var(--success)`,
`var(--warning)`, `var(--danger)`). Same rules, same call sites, actually
visible, and no gradient is back in the product.

Two more of the same kind:

- The little rule before every page-title eyebrow was painted with
  `--grad-primary`, so it had never rendered.
- Page titles were gradient-clipped text ending in `--primary`, which is a mid
  grey in dark mode — long titles faded as they ran right. The gradient block is
  deleted rather than overridden; dead paint declarations are what hid the other
  19.

`src/lib/theme.test.ts` now fails if any paint token's final definition is
`none`, `transparent` or a gradient, if a decorative rule references a dead
token, if a page title clips its text, or if the reduced-motion opt-out is
removed.

### The craft layer

| Area | Change |
| --- | --- |
| Page headers | fluid title size, tighter tracking, description measured at 62ch |
| Cards | one radius, one border, one shadow (none in dark) |
| Empty states | icon in a ring, 42ch measure, centred — reads considered, not missing |
| Stat numbers | tabular figures, −0.035em tracking, label quiet above |
| Sidebar | 2px rail marker on the active item instead of a filled block |
| Bottom nav | dot under the icon, no pill; respects the home-indicator inset |
| Chrome | themed scrollbars, themed text selection |
| Task cards | border shift on hover only — nothing moves |
| Print | chrome hidden, cards kept whole — reports are printable |

No new colours and none of the removed effects came back: no spotlight, no lift,
no gradient bar, no timer sweep, no check burst.

## Attachments — photos and voice memos that sync, without a heavier sync

A task can carry a photo (the visiting card, the receipt, the whiteboard) and
a voice memo (the thought on the way out of the meeting), captured right in
the task panel:

- **Voice notes** use `MediaRecorder` with a 15-second cap — the recorder
  stops itself, so a press in a pocket cannot run up an hour of audio.
  Stop/Discard are live while it records, and one code path saves the result,
  so a memo can never be recorded and silently dropped. Browsers without
  `MediaRecorder` simply do not get the button, and a blocked microphone says
  so in one actionable sentence.
- **Photos** are resized (1600px long edge) and re-encoded on a quality ladder
  *before anything is stored*, aiming under 380 KB against a hard cap of
  600 KB — the same numbers the server enforces, imported from one shared
  module (`src/lib/attachmentLimits.ts`), so the client can never compress to
  a size the server refuses. Files already under the cap are stored as-is.
- The panel shows a thumbnail grid and inline `<audio>` playback, per-file
  size and date, an honest sync badge (*Synced* / *Waiting to sync* /
  *This device*), and two-step deletes.

### Why the bytes never enter the snapshot

The snapshot is re-sent whole whenever anything changes, it is stringified
and diffed per record on every sync, and it rides the ~4.5 MB serverless body
cap. A single megabyte inside a task would re-travel on every title edit; a
single unsqueezed camera photo would take down sync for **every** device at
once. So attachments have their own channel:

| | Snapshot | Attachments |
| --- | --- | --- |
| Transport | one JSON body, merged per record | one row + one request per file |
| Table | `planner_snapshots` (1 row/user) | `planner_attachments` (1 row/file) |
| Endpoint | `/api/snapshot` | `/api/attachments` |
| Cap | what a planner needs | 600 KB/file · 400 files · 40 MB/account (server-enforced) |

`db/neon-schema.sql` documents the table, and `api/_lib/schema.ts` creates it
automatically on the first request like everything else.

### How the merge works when media is immutable

Attachments are **never edited** after capture — only created and deleted —
so there is no edit conflict to resolve. `planAttachmentSync()`
(`src/lib/attachmentSync.ts`) reduces the whole question to one pure function
over two lists, tested in `src/lib/attachments.test.ts`:

- local row the server lacks → **push**; remote row the device lacks → **pull**;
- local deletion → a **tombstone** (id kept, bytes dropped) until the server
  acknowledges the delete, then the row is purged — an offline delete can
  never resurrect the file;
- a live row the server no longer holds → purged locally (deletion made on
  another device, same direction snapshots already flow);
- a tombstone the server never saw → purged with no round trip at all.

Each sync run moves at most 30 files and reports `more` when a shelf is
waiting, so first sign-in with a hundred photos finishes in seconds and keeps
draining quietly in the background. Failures are appended to the sync message
(`· Photos & voice notes: …`) and never turn a successful task sync into a
failed one.

The version other devices poll (`/api/version`) is now `max(snapshot
updated_at, attachments updated_at)` — a photo added on the laptop changes
the number the phone is watching. Deleting one bumps the snapshot's clock
*without touching its payload*, because a delete can otherwise leave every
timestamp unchanged and linger forever.

### Honest limits

- JSON/CSV backups do **not** include attachments (blobs are not JSON);
  files live in IndexedDB plus — when sync is on — the attachment table.
- With sync off, attachments are on this device only, and the panel says so.
- The per-account caps are a safety rail on the free database, not a plan
  tier; Settings → Account shows usage whenever there is any.

## The 16 enhancements — what shipped, in five commits

Each enhancement landed with tests, honest copy where the data runs out, and
the same constraints as the rest of the planner: local-first, ₹0, no new
colors, nothing leaves the device unless it already did (Microsoft Graph with
your own connection).

### Capture (`29cb72e`)

- **Voice quick-add** — Web Speech API dictation feeds the existing
  quick-add parser (dates, `#category`, `@client`, `!priority`). Unsupported
  browsers and denied microphones get a specific sentence, not a silent dead
  button (`src/lib/speech.ts`).
- **Share-to-planner** — the PWA manifest declares a `share_target`; the
  service worker parks the shared text in a cache entry (no localStorage in a
  SW, no backend), redirects to the app, and Today's Quick add opens with it
  as a draft, subject-first when a title exists (`shareInbox.ts`).
- **Voice notes & photos** live with [attachments](#attachments--photos-and-voice-memos-that-sync-without-a-heavier-sync).

### Prediction (`48005cd`)

- **Monte Carlo deadline forecasts** — 1,000 deterministic on-device runs per
  task: triangular duration spread (0.55–1.9×), duration model ordered
  client-median → category-median → bias-corrected → estimate, a deferral
  restart chance, and a calendar-aware walk that skips weekends, lunch and
  nights (broken hours refuse politely). Output: `% on time`, median finish
  date, p10–p90 band, and evidence reasons — in the task panel and on the
  at-risk card (`forecast.ts`).
- **Planning-fallacy calibration** — `learnDurations` measures per-category
  estimate bias (avg actual ÷ avg estimate, ≥3 aligned pairs, ≥10% miss,
  clamped 0.5–3). The factor only corrects plans that still rely on a raw
  estimate; a learned median always wins. Visible as plan-foot
  "estimates corrected ×1.4", per-block `learned` tags, forecast fine print,
  and Reports' "Estimate bias, measured" table.
- **Tomorrow rehearsal** — after `workdayEnd`, tomorrow is planned from
  learned durations: capacity vs demand, deadlines that day with no slot, and
  safe defer suggestions (least urgent first, never a same-day deadline).
  Each Move counts as a real deferral; the card dismisses and never nags
  (`rehearsal.ts`).
- **Best time to follow-up** — the window is the middle 50% of when a
  client's messages actually arrive, on demand from your Microsoft mail,
  with a 3-message floor and an honest "not enough mail" state
  (`replyWindow.ts`, `fetchClientMail`).

### Schedule (`43014f8`)

- **Energy-curve placement** — `buildInsights` derives the sharpest and
  slowest hours from your own timer sessions (a "slowest" needs a real 2+
  hour spread). The scheduler moves deep work ahead of unlocked admin for
  the sharp hour and batches admin into the slump — deadlines always win,
  every swap becomes a visible block reason, and `energyNote` explains the
  curve in the plan card.
- **Live day reflow** — when the task set changes, `diffDayPlans` compares
  the two plans built at the same clock and the plan card shows
  "N tasks re-flowed live" with `14:00 → 14:40` style shifts. Honest
  autopilot: the queue still shows what didn't fit, and the banner dismisses
  (`diffDayPlans`, render-adjust — no effects, no lint drift).
- **Calendar truth** — `Calendars.Read` joins the Microsoft scopes; one local
  day of `calendarView` becomes busy intervals the plan renders as fact
  blocks, jumps and clamps around, merges on overlap, and never double-counts
  lunch. A refused scope says exactly how to reconnect; an old connection
  gets a readable 403 instead of a silently free day.

### Relationship (`cfe077b`)

- **Client radar** — `buildClientRadar` groups open tasks by the `client`
  field into "Brief: Nova" cards: overdue/due-soon counts, next deadline,
  priorities, minutes, and up to three newest cached mail mentions with
  deep links, sorted by risk (`radar.ts`).
- **Follow-up cadence** — two on-device rules with the working shown:
  follow-up/email quiet 3 days → nudge, proposal silent 7 days → escalate —
  suppressed when cached mail shows the client replied after the task last
  moved. Every line quotes the rule and the dates (`cadence.ts`).

### Interface (`29cb72e`, `48005cd`, `d655124`)

- **Local assistant Q&A** — the command palette answers questions from your
  data only: templated intents compute exact aggregates with citations
  (overdue, due today, completed, tracked time, what's next with scheduler
  reasons, named-task status/durations, client summaries); BM25 ranks task
  documents for name-shaped questions. Confidence is always labelled
  `exact` / `closest` / `none`, and "not found on this device" is a real
  answer (`qa.ts`). No cloud AI — no network call exists in the path.
- **.ics export** — the scheduled day as folded, CRLF-terminated VEVENTs
  with floating local times, `VALUE=DATE` for date-only tasks, and completed
  work marked `✓` + `STATUS:COMPLETED` (`ics.ts`).
- **Privacy blur** — on by default: 60s idle or a hidden tab blurs client
  names and task titles behind a wash until you move again
  (`privacy.ts`, `usePrivacyBlur.ts`).
- **Day replay** — a scrubber over the day's real timer sessions and
  completions: spans clipped at midnight, running sessions skipped, play/pause
  and a live readout of what was happening at each minute (`replay.ts`,
  Reports page).

### Honest limits of the batch

- Reply and mention checks run against *cached* Graph highlights (unread
  inbox + chat as last fetched) — a reply you've already read may be missed
  until the next refresh; the cadence text says "cached mail" out loud.
- Energy, forecasts and calibration are only as good as your tracked history;
  with no sessions the plan says so instead of inventing a curve.
- The calendar scope was added after the first release of this feature set:
  connections made before it need one reconnect (the 403 message says so).
- Radar mail mentions and reply windows use name matching, not thread
  identity — good enough for a glance, never claimed to be a CRM.

Batch gates: lint held at the 19-warning baseline with 0 errors, `tsc -b`
clean, and the suite grew 353 → 432 tests across the five commits.

## Fixes — the menu that hid behind the bar, and dictation that heard the wrong words

Two reports from a phone. Neither was a missing feature, and both were real.

### The ⋮ menu showed three of its five actions

"Other options is not visible": Snooze, Edit and Complete were there, Mark
blocked and Delete were not. Every item was rendered all along — the problem was
paint order. `.task-card:focus-within` raises the card to `z-index: 20`, which
creates a stacking context, so the menu's own `z-index: 60` was trapped inside
the card and could not beat the fixed bottom navigation at 45. The menu also
always opened downwards, so on the last card of a list its lower half had
nowhere to go.

`MenuPopover` (`ui.tsx`) now renders the menu into `document.body`, positions it
from the trigger's rectangle, flips it above the trigger when the bottom of the
screen is nearer than the menu is tall, stops short of the bottom navigation,
and scrolls internally when even that is not enough. It closes on Escape, on an
outside press, or on the action — a press on the trigger itself only toggles it.
`TaskCard.test.tsx` holds both promises with a 640px viewport and a 64px bar.

### Dictation heard two words and then stopped

`continuous = false` ends a session at the first pause; on Android that was often
after the first two words, which reads as "it heard me wrong". The recogniser now
runs continuously and is restarted after the browser's own silence stop (up to a
minute), the trailing phrase is folded in even when a session ends mid-sentence,
and `normaliseTranscript` repairs what speech actually produces into the syntax
the parser already reads — "to morrow" → "tomorrow", "three thirty pm" →
"3:30 pm", "thirty minutes" → "30 minutes", "hash tag email" → "#email". When
the browser offers several guesses, `pickBestTranscript` keeps the one that
yields the most task tokens.

Language was the other half: a phone set to Hindi transcribes English speech
into words `quickAdd.ts` cannot parse. Settings → Voice pins the language
(`Settings.dictationLang`; empty means follow the device, but only when the
device is already English). The microphone is requested *before* the recogniser
starts, so a blocked or missing mic gets a sentence instead of a dead button, and
the New task sheet carries the same mic on its title field.

Batch gates: `tsc -b` clean, lint at the 19-warning baseline with 0 errors, and
the suite grew 432 → 460 tests (`TaskCard.test.tsx`, `useDictation.test.tsx`,
and the rewritten `speech.test.ts`).

## Notes that write themselves into the daily update

The planner could already finish a task. What it could not do was say *what
happened* — and the WhatsApp update was being retyped by hand every evening
from the same tasks the app already held.

### Completing asks one question, and only one

Tapping Complete now opens a sheet with the task's title and a multiline
"Completion Note / Progress Update": **Complete Task** (saves the note),
**Complete Without Note** (saves the task, writes nothing else) and **Cancel**
(closes, completes nothing — the App owns the task, so a dismissed sheet cannot
leave it half-done). The note is optional; the saved one is shown as history
instead of being pre-filled, so "Complete Without Note" can never quietly
overwrite words the person already wrote. On a phone the field does not grab
focus, because that raises the keyboard over the sheet.

Notes live on the task (`completionNote`, `notes`, `notesUpdatedAt`) — not on
the report. That is the whole sync design: there is no sync step. Editing a note
in the task panel or in the day list edits the same row the report reads, so the
preview updates, a deleted note disappears, and nothing can be duplicated.

### "Generate Daily Report" reads the day, and only the day

`src/lib/dailyReport.ts` turns one date's tasks into text: `Priorities -` first,
then one named section per heading kept from the screenshot the work came from
(`BizConnect Leads Follow-ups -`), each item as `- Title` with its note appended
as `Title - note.` Struck-through titles mark completed work, and titles only —
`~~Follow up with Narayani Group~~ - Couldn't connect today.` The note is never
struck, a pending task is never struck, and a note never marks anything done.
Three output variants are offered (`~…~` for WhatsApp, `~~…~~` for Markdown,
`[COMPLETED] …` for plain text) because the same string is pasted into different
places.

The preview is a textarea, not a picture. Typing in it sets a `dirty` flag;
regeneration then asks before replacing what was written, and "Regenerate" is
always available as an explicit action. Copy falls back from
`navigator.clipboard` to a hidden textarea and, if both are refused, says so and
puts the caret in the preview — a blocked clipboard is a message, not a lost
report.

### Teams does not read tildes, so Copy carries two flavours

WhatsApp renders `~text~` as a strikethrough; Teams and Outlook do not. Pasted
there, the tildes are just characters — which is exactly what showed up in the
group chat. The report text is correct for WhatsApp and useless for Teams, and
no single string can be right for both.

A clipboard can hold more than one flavour, so Copy now writes **both**:

- `text/plain` — the report as it reads in the preview (`~title~ - note`), which
  is what WhatsApp pastes and what keeps the strikethrough there.
- `text/html` — the same report with a real `<s>` around each completed title,
  `<br>` for line breaks and the note outside the strike, which is what Teams
  and Outlook render as an actual strikethrough.

The rich path is `navigator.clipboard.write` with a `ClipboardItem`. Where that
is unavailable or refuses mixed flavours (older Safari, some WebViews), the
legacy path selects a hidden textarea and fills both flavours from the `copy`
event, so the strikethrough survives there too. "Copy as Markdown" and "Copy as
plain text" stay literal on purpose — their whole point is marker text.

A hand-edited preview is converted from the markers it already contains, so a
paste never quietly drops the user's own wording; the plain-text format is
marker-free and therefore copies text only rather than guessing where a title
ends and its note begins.

### One update per day, and yesterday stays yesterday

Saved updates are a Dexie v3 table keyed by `dateISO`. Re-saving a day replaces
that day's text on purpose; saving today can never touch yesterday, because it is
a different row. The date bar carries ←/→, a date picker and a jump list of days
that already have an update, and the history panel opens an old day's saved text
without touching the tasks. Deleting a snapshot never deletes work. JSON backups
now carry the saved updates too, and restore them one row per date.

### Screenshots: headings and "already done" are read, not guessed

`parseScreenshotText` now walks sectioned blocks: a heading line
(`Priorities -`, `Today:`, `BizConnect Leads Follow-ups -`) becomes the section
of the tasks under it rather than a task itself, so imported work keeps its
grouping in the report. A struck line (`~~…~~`, `~…~`, `[x] …`) only raises a
"struck through" badge and an unticked **Already done** checkbox — OCR is not a
reliable witness to completion, so the person confirms it. The review step also
carries the **reporting date** (default today): imported work is dated to that
day, so a screenshot of yesterday's chat lands in yesterday's update instead of
this evening's. The heading of each draft is editable, and a draft whose text
already exists is flagged as a duplicate rather than silently added twice.

### The daily update is a tab in Reports, not a sixth destination

It shipped briefly as its own page in the navigation, which made the app ask a
question it should not: *is this the weekly report or the daily one?* They are
two views of the same saved work. **Reports** now carries a two-tab switch —
**Daily update** first, **Weekly summary** second — and the sidebar is back to
five destinations with the phone bar back to its four (Today, My Tasks,
Completed, Reports). The daily view keeps everything it had: the date bar, the
format picker, the editable preview, copy, and saved history; only its page
header went away, replaced by a one-line toolbar inside the view.

`#/daily` is kept as a redirect. It was a real URL for one release, so old
bookmarks still open Reports with the daily tab selected — the App reads the
hash once at boot, before the router normalises it to `#/reports`.

Everything on these screens reuses the existing mobile rules: full-width cards,
16px fields (no iOS zoom), action rows that wrap rather than overflow, tabs that
split the width evenly at 620px, and one-column format cards below 620px.

### The empty state was centred, but not centred

The "Nothing on this day yet" card sat against the left edge of a wide preview
while its own words were centred inside it. Two rules were both true: the
component is a centred flex column, and a later rule caps it at `46ch` for
readability. A capped flex item cannot stretch, so the space it did not fill
went to the **right** — the block hugged the left edge and only its text looked
centred. `.empty-state` now carries `margin-left/right: auto`, so the block
itself is centred at every width; `.plan-empty`, which is a line inside the plan
body rather than a centred block, is deliberately left alone. `cascade.test.ts`
asserts the computed margins on phone, tablet and laptop, and that the 46ch cap
still applies.

Batch gates: `tsc -b` clean, `npm run build` clean, lint at the 21-warning
baseline with 0 errors, and the suite grew 460 → 513 tests
(`dailyReport.test.ts` 23, `DailyReportFlow.test.tsx` 16 end-to-end through the
real App and fake IndexedDB — including which tab Reports opens on — plus
`db.test.ts` 4 for the storage and backup round-trip and three cascade
assertions for the empty-state centring).

### Honest limits of this batch

- There is no browser in this environment, so the mobile layout was checked by
  reviewing the CSS at 320/375/620px and by jsdom tests — not by eye on a real
  phone. The rules are the existing ones (full-bleed cards, 16px fields, wrapping
  action rows, one-column format cards), not a new layout.
- A reopened task keeps its completion note deliberately: the words were the
  person's, and the day's report still reads them rather than inventing silence.
  The note is only ever shown next to its own task.
- Section headings survive import, but a task added by hand has no heading and
  falls under `Priorities`.
- A day change with a hand-edited preview asks first; there is no background
  draft autosave, so "Save this update" remains the only way to keep wording
  past the day you are looking at.

## Design v8 — reminders that keep reminding

The complaint was short: *notifications are not there*. Three separate causes,
all of which had to go.

### It alerted once, then went silent

`buildReminders` answered "what is due within the lead window" — a single
crossing point. Once that moment passed and the alert had been delivered, the
key `${taskId}|${dueAt}` was in the 14-day de-duplication ledger and the task
was never mentioned again. A deadline in the morning produced one buzz at
09:00 and nothing all day.

The rule is now **deadline-anchored with repeats** (`buildReminderDue` in
`engine.ts`):

| Moment | What happens |
| --- | --- |
| `dueDate + dueTime − reminderLeadMinutes` | first alert (slot 0) |
| every `reminderRepeatMinutes` (default 30) after that | a nudge, while the task is still open |
| midnight | the cadence restarts, and the overdue task keeps nudging |
| snooze (+15 min) | moves only the *next* nudge; the cadence resumes |
| dismissed or done | silence until the deadline changes |
| no deadline at all | the daily summary, below |

The slot number is what makes a repeat a *new* alert rather than a duplicate,
and the key carries the moment the nudge became due
(`${taskId}|${dueAt}|${nudgeAt}`) because a bare slot number would collide
across days. Slot 0 keeps the pre-repeat key, so an alert already sitting in
someone's bell is not re-delivered by the update. There is **no cap**: an early
version capped repeats at 24 slots measured from the first alert, which meant a
task overdue by more than twelve hours fell outside its own window and stopped
notifying entirely — the exact bug the feature existed to fix.

### A task with no deadline could not be reminded about

Half the planner's tasks were created with no date, and a date-less task has
nothing for a deadline reminder to hang on. Two changes:

- **New tasks land on today.** The form and quick-add now agree; a date can
  still be cleared or changed, but the default is a day that can be reminded
  about.
- **One pending summary a day** (`buildDailyDigest`), at `digestTime`
  (09:30 by default), which counts what is still open: overdue / due today /
  no date. It is keyed by the date, so it cannot repeat.

### The background worker still fired once per deadline

Even with all of the above, an installed app with the page closed was handled
by `public/sw.js`, which had its own copy of the old rule: lead time, one
notification per `(task, deadline)`, no repeats and no knowledge of the
snooze/dismiss records the page writes. On a phone that is the *only* path
that matters.

`computeDue()` in the worker now mirrors the engine exactly — same window, same
slot maths, same key shape — and skips a task that has a `dismissed`, `done` or
still-snoozed `reminderRecords` row. The worker's shell cache moved to
`workday-shell-v8` so the new file is actually fetched.
`serviceWorkerReminders.test.ts` loads the real `sw.js` in Node and drives
`computeDue` directly, including the "30 minutes later, still open" case, the
snooze window, and the table names it reads — a renamed Dexie store would
otherwise fail silently by returning an empty list.

### And the switch could be off with no way to tell

The browser permission and the planner's own `notificationsEnabled` are
separate. If the browser was already allowing banners while the app's switch
was off, the panel showed nothing at all. It now shows *System alerts are off*
with the same one-tap fix.

### Two categories the app had never heard of

`Category` was a closed union of eight, and `CATEGORIES[category].label` was
read straight through — so any name the user invented would have rendered as
`undefined`. The domain type is now `string` with a small set of helpers
(`categoryLabel`, `categoryMeta`, `categoryChoices`), and every display site,
report breakdown, CSV cell and duration model goes through them.

- **Adding one** happens where the confusion happens: in the category picker
  on the task form, `＋ New category…` opens a one-line input — and in
  **Settings → Categories**, which lists everything, built-ins included, with
  the number of tasks filed under each.
- **Editing one** is a rename in place: the pencil on the row turns the chip
  into an input, and **Save** (or Enter) rewrites every task already filed
  under the old name. The list is a list of *names*, not foreign keys — that is
  what makes an old backup readable — so a rename that touched only the list
  would strand its tasks on a word no picker offers any more.
- **Deleting one** asks first, and says what it will do: those tasks move to
  **Other**, and the tasks themselves are kept. The confirmation names the
  count, so nobody deletes a bucket with eleven tasks in it by accident.
- **It is remembered** in `settings.customCategories`, offered in the picker
  and the import review table afterwards, usable as a `#token` in quick-add
  (`#fieldwork` finds *Field Work*), filterable in reports, and learnable by
  the on-device suggestions. Management writes through immediately rather than
  waiting for “Save changes”; the page keeps any unsaved edits to the other
  fields while the new list lands.

### Dictation stopped repeating itself

`appendSpoken()` plus a high-water mark on the processed result index. Finials
only ever advance it, so a browser that replays the whole `results` array —
which some Android builds do after a restart — emits nothing new, while a
legitimately new phrase still lands. The regression test fails if the
high-water mark is removed.

Batch gates: `tsc -b` clean, lint at the 21-warning baseline with 0 errors,
`npm run build` clean, and the suite grew 513 → **564 tests** across 51 files
(`serviceWorkerReminders.test.ts` drives the real worker; `ReminderFlow.test.tsx`
covers repeats, the digest and adding a category; `CategoryManagement.test.tsx`
renames and deletes one through the real Settings page and checks the tasks
followed).

### Honest limits of this batch

- A desktop browser with the tab closed cannot be woken; there is no push
  server by design. Repeats run while the app is open, and on Android from the
  background check.
- The daily summary is delivered by the app when it is open (or at the set time
  if it is already open). It is not queued by the system for later.
- Renaming rewrites the tasks that carry the old name; a **saved daily
  report** keeps the wording it was written with, because that is a record of a
  day rather than a live view.

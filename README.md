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
- Reminders: in-app queue, Start/Complete/Snooze 15m, quiet-hours settings, optional browser Notification (permission-gated)
- Weekly report from real saved data (est. vs actual, follow-ups/proposals, category breakdown)
- Backup: JSON + CSV export, validated JSON import, local reset; PWA manifest + service-worker app-shell cache

## Honest limitations
- **Notifications:** reliable only while the app is open. A closed webpage cannot guarantee reminders — this is stated in-app, not hidden.
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

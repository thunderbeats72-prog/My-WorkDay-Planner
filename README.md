# My Workday Planner

Private workday planner for a Business Development Executive at Clouder Technologies (previously built as BD Command Center — same IndexedDB database name, so existing tasks/timer data carry over untouched).

Private, local-first PWA for a Business Development Executive at Clouder Technologies. ₹0/month target: React + TypeScript + IndexedDB (Dexie) + Tesseract.js in-browser OCR. No paid AI, no Teams API, no data leaves the browser.

## Run
```bash
npx -y pnpm@9 install
npx -y pnpm@9 dev
# build check
npx -y pnpm@9 build
```

## What's working (Stages 1–4 + 6, local)
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
- Known gap: no headless browser in the build sandbox, so viewport acceptance was verified by build + CSS breakpoint implementation, not screenshot testing. Resize the preview (or use device toolbar) to confirm at 390px / 820px / 1440px.

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
- Sandbox limitation remains: no headless browser, so breakpoints are implemented + build-verified rather than screenshot-verified. Please spot-check at ~390px (phone), ~820px (tablet) and full width.

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

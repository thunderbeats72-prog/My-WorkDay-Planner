import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Category, PageId, ReminderRecord, Settings, Task } from './lib/types';
import { DEFAULT_SETTINGS, normaliseCustomCategory } from './lib/types';
import {
  combineDateTime,
  daysFromNow,
  dueLabel,
  formatDateLong,
  formatDuration,
  formatSecondsLabel,
  isQuietNow,
  relativeDayLabel,
  taskDueAt,
  toISODate,
  todayISO,
} from './lib/dates';
import {
  clearAllData,
  createBackupPayload,
  listAllEvents,
  listReminders,
  listReports,
  listTasks,
  loadSettings,
  logEvent,
  restoreBackup,
  saveReminders,
  saveSettings,
  saveTasks,
  uniqueId,
  validateBackup,
} from './lib/db';
import { applyPlanToTasks, buildDailyDigest, buildReminderDue, buildReminders } from './lib/engine';
import {
  addNotification,
  clearNotifications as clearNotificationList,
  deliverNative,
  forgetDelivered,
  loadNotifications,
  markAllNotificationsRead,
  markDelivered,
  registerBackgroundChecks,
  saveNotifications,
  sendTestNotification,
  wasDelivered,
} from './lib/notifications';
import type { AppNotification } from './lib/notifications';
import type { BusyInterval, DayPlan, LearnedDurations, ParsedDraft, ReminderDue, ReminderItem } from './lib/engine';
import {
  beginGraphSignIn,
  cleanGraphRedirectUrl,
  clearGraphToken,
  completeGraphSignIn,
  fetchClientMail,
  type ClientMailResult,
  fetchDayMeetings,
  fetchGraphHighlights,
  graphRedirectPending,
  loadGraphCache,
  loadGraphToken,
  saveGraphCache,
} from './lib/graph';
import type { GraphAccount, GraphHighlight, GraphToken } from './lib/graph';
import { tasksToCsv } from './lib/reports';
import { useTimer } from './hooks/useTimer';
import { useAmbientEffects } from './hooks/useAmbientEffects';
import { usePrivacyBlur } from './hooks/usePrivacyBlur';
import {
  useMediaQuery,
  useNotificationPermission,
  useNow,
  useOnline,
  useScrollPosition,
} from './hooks/useEnvironment';
import { Sidebar, MobileTopBar, BottomNav, ScrollProgress, BackToTop, LiveClock } from './components/Shell';
import { NotificationCenter } from './components/NotificationCenter';
import type { NavCounts } from './components/Shell';
import { Button, ConfirmDialog, Confetti, Modal, SkeletonScreen, ToastStack } from './components/ui';
import type { ToastItem, ToastTone } from './components/ui';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { TodayPage } from './components/TodayPage';
import { MyTasksPage } from './components/MyTasksPage';
import { CompletedPage } from './components/CompletedPage';
import { CompletionDialog } from './components/CompletionDialog';
import { ReportsPage } from './components/ReportsPage';
import { ImportPage } from './components/ImportPage';
import { SettingsPage } from './components/SettingsPage';
import { TaskPanel } from './components/TaskPanel';
import { TaskForm } from './components/TaskForm';
import type { TaskDraft } from './components/TaskForm';
import { GraphCard } from './components/GraphCard';
import { Onboarding } from './components/Onboarding';
import { StickerPop } from './components/StickerPop';
import type { StickerMoment } from './components/StickerPop';
import { loadShelf, recordSticker, saveShelf, stickerCaption, stickerFor, streakFrom } from './lib/stickers';
import { markNudged, nudgeFor, wasNudged } from './lib/assistant';
import { haptic } from './lib/haptics';
import type { QuickAddDraft } from './lib/quickAdd';
import { sharedToQuickText, takeSharedPayload } from './lib/shareInbox';
import { buildFoldedIcs } from './lib/ics';
import { learnDurations } from './lib/ml';
import { answerQuestion } from './lib/qa';
import type { QaAnswer } from './lib/qa';
import { useAccount } from './hooks/useAccount';
import type { CommonPageProps } from './components/pageProps';
import type { TaskCardHandlers } from './components/TaskCard';
import { Keyboard, Search, Plus, Wifi, WifiOff, Moon, Sun, ScanText } from 'lucide-react';

const PAGE_IDS: PageId[] = ['today', 'tasks', 'completed', 'reports', 'settings'];
const SIDEBAR_STORAGE_KEY = 'workday.sidebar';

/* Bookmarks and old links keep working: the retired pages were merged into
   My Tasks, so every alias lands there. The daily update is now the first tab
   of Reports, so `#/daily` opens Reports — ReportsPage reads the hash once at
   mount and selects that tab. */
const LEGACY_HASHES: Record<string, PageId> = {
  inbox: 'tasks',
  schedule: 'tasks',
  overdue: 'tasks',
  import: 'tasks',
  planner: 'tasks',
  tasks: 'tasks',
  daily: 'reports',
};

function pageFromHash(): PageId {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (PAGE_IDS.includes(raw as PageId)) return raw as PageId;
  return LEGACY_HASHES[raw] ?? 'today';
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

interface FormState {
  open: boolean;
  task: Task | null;
  initialDraft: TaskDraft | null;
}

interface ConfirmState {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone: 'danger' | 'primary' | 'success';
  onConfirm: () => void;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS }));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageId>(() => pageFromHash());
  const now = useNow(15_000);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const [navOpen, setNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /* `#/daily` was a destination of its own until the daily update moved into
     Reports. Read once at boot — the router normalises the hash on mount — so
     an old bookmark still opens that tab. */
  const [reportsView] = useState<'daily' | 'weekly'>(() =>
    window.location.hash.replace(/^#\/?/, '').trim() === 'daily' ? 'daily' : 'weekly',
  );
  const [panelId, setPanelId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ open: false, task: null, initialDraft: null });
  /* Which task is waiting for its optional completion note. The dialog never
     completes anything by itself — a cancel leaves the task untouched. */
  const [completeId, setCompleteId] = useState<string | null>(null);
  // A line shared from another app (PWA share sheet) waits here until Today's
  // Quick add has taken it — consumed exactly once, see shareInbox.ts.
  const [quickSeed, setQuickSeed] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confettiKey, setConfettiKey] = useState(0);
  const [stickerMoment, setStickerMoment] = useState<StickerMoment | null>(null);
  const stickerKey = useRef(0);
  const nudgedThisSession = useRef(false);
  const [graphToken, setGraphToken] = useState<GraphToken | null>(() => loadGraphToken());
  const [graphItems, setGraphItems] = useState<GraphHighlight[]>(() => loadGraphCache()?.items ?? []);
  const [graphFetchedAt, setGraphFetchedAt] = useState<string | null>(() => loadGraphCache()?.fetchedAt ?? null);
  const [graphAccount, setGraphAccount] = useState<GraphAccount | null>(null);
  const [graphErrors, setGraphErrors] = useState<string[]>([]);
  const [graphBusy, setGraphBusy] = useState(false);
  const [meetings, setMeetings] = useState<BusyInterval[]>([]);
  const graphRedirectHandled = useRef(false);
  const [notificationPermission, requestNotificationPermission] = useNotificationPermission();
  const [notifications, setNotifications] = useState<AppNotification[]>(() => loadNotifications());

  useAmbientEffects(!loading);
  usePrivacyBlur(settings.privacyBlur);

  const online = useOnline();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const wideSidebar = useMediaQuery('(min-width: 1081px)');
  const drawerOpen = !wideSidebar && navOpen;

  const toggleSidebar = useCallback(() => {
    if (wideSidebar) {
      setSidebarCollapsed((current) => !current);
    } else {
      setNavOpen((current) => !current);
    }
  }, [wideSidebar]);

  const navigate = useCallback((next: PageId) => {
    setPage(next);
    setNavOpen(false);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? 'collapsed' : 'expanded');
    } catch {
      // Storage can be blocked in private mode; the sidebar still works for this session.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('nav-drawer-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('nav-drawer-open');
    };
  }, [navOpen]);
  const { scrolled, atTop } = useScrollPosition();

  const settingsRef = useRef(settings);
  const tasksRef = useRef(tasks);
  const remindersRef = useRef(reminders);
  const graphTokenRef = useRef(graphToken);
  settingsRef.current = settings;
  tasksRef.current = tasks;
  remindersRef.current = reminders;
  graphTokenRef.current = graphToken;

  const addToast = useCallback(
    (message: string, tone: ToastTone = 'info', action?: { label: string; onAction: () => void }) => {
      const id = uniqueId('toast');
      setToasts((current) => [
        ...current.slice(-3),
        { id, message, tone, actionLabel: action?.label, onAction: action?.onAction },
      ]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 6000);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /** Re-reads the local database — used after a sync merges another device's work. */
  const reloadFromDevice = useCallback(async () => {
    const [loadedSettings, loadedTasks, loadedReminders] = await Promise.all([
      loadSettings(),
      listTasks(),
      listReminders(),
    ]);
    settingsRef.current = loadedSettings;
    tasksRef.current = loadedTasks;
    remindersRef.current = loadedReminders;
    setSettings(loadedSettings);
    setTasks(loadedTasks);
    setReminders(loadedReminders);
  }, []);

  const account = useAccount({
    onDataChanged: () => void reloadFromDevice(),
    onNotice: addToast,
  });

  // Task and settings editing was written before sync existed, so it reaches
  // the sync engine through a ref rather than threading a new prop everywhere.
  const accountRef = useRef<typeof account | null>(null);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  const isDark = settings.theme === 'system' ? prefersDark : settings.theme === 'dark';

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = isDark ? 'dark' : 'light';
    root.style.colorScheme = isDark ? 'dark' : 'light';
    // Keep the browser chrome identical to the canvas — no navy, no flash.
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', isDark ? '#0a0a0c' : '#f5f5f6');
    root.classList.add('theme-fade');
    // Mirror the resolved theme where a pre-paint script can read it. IndexedDB
    // cannot be read synchronously, so this is what stops a dark-mode reload
    // from flashing a light canvas before the settings table answers.
    try {
      localStorage.setItem('workday.theme.v1', isDark ? 'dark' : 'light');
    } catch {
      // Private mode: the pre-paint script simply falls back to the OS setting.
    }
    const timer = window.setTimeout(() => root.classList.remove('theme-fade'), 480);
    return () => window.clearTimeout(timer);
  }, [isDark]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loadedSettings, loadedTasks, loadedReminders] = await Promise.all([
          loadSettings(),
          listTasks(),
          listReminders(),
        ]);
        if (cancelled) return;
        settingsRef.current = loadedSettings;
        tasksRef.current = loadedTasks;
        remindersRef.current = loadedReminders;
        setSettings(loadedSettings);
        setTasks(loadedTasks);
        setReminders(loadedReminders);
        setLoading(false);
        if (graphRedirectPending() && loadedSettings.graphClientId && !graphRedirectHandled.current) {
          graphRedirectHandled.current = true;
          try {
            const token = await completeGraphSignIn(loadedSettings.graphClientId);
            if (cancelled) return;
            setGraphToken(token);
            addToast('Microsoft connected — read-only Outlook and Teams highlights are on.', 'success');
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Microsoft sign-in failed.';
            setGraphErrors([message]);
            addToast('Microsoft connection failed. Open Settings to see the details.', 'danger');
          } finally {
            cleanGraphRedirectUrl();
          }
        }
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        addToast(
          error instanceof Error
            ? `Local database unavailable: ${error.message}. Private browsing can block IndexedDB.`
            : 'Local database unavailable. Private browsing can block IndexedDB.',
          'danger',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addToast]);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // The share sheet parked a line at /share (service worker); take it once
  // and land on Today with Quick add already holding it.
  useEffect(() => {
    let cancelled = false;
    void takeSharedPayload().then((payload) => {
      if (cancelled) return;
      const text = payload ? sharedToQuickText(payload) : '';
      if (!text) return;
      setQuickSeed(text);
      setPage('today');
      window.setTimeout(() => window.scrollTo({ top: 0 }), 60);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const consumeQuickSeed = useCallback(() => setQuickSeed(null), []);

  useEffect(() => {
    if (window.location.hash !== `#/${page}`) {
      window.history.replaceState(null, '', `#/${page}`);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [page]);

  useEffect(() => {
    if (confettiKey === 0) return;
    const timer = window.setTimeout(() => setConfettiKey(0), 1400);
    return () => window.clearTimeout(timer);
  }, [confettiKey]);

  const persistTasks = useCallback((next: Task[], changed?: Task[]) => {
    tasksRef.current = next;
    setTasks(next);
    if (changed && changed.length > 0) {
      void saveTasks(changed);
      // Queue a push so the other device sees this without waiting for a poll.
      accountRef.current?.schedulePush();
    }
  }, []);

  const updateTaskById = useCallback(
    (id: string, updater: (task: Task) => Task): Task | null => {
      const current = tasksRef.current.find((task) => task.id === id);
      if (!current) return null;
      const updated = { ...updater(current), updatedAt: new Date().toISOString() };
      persistTasks(
        tasksRef.current.map((task) => (task.id === id ? updated : task)),
        [updated],
      );
      return updated;
    },
    [persistTasks],
  );

  const handleActualMinutes = useCallback(
    (taskId: string, minutes: number) => {
      const task = tasksRef.current.find((candidate) => candidate.id === taskId);
      if (!task || task.actualMinutes === minutes) return;
      updateTaskById(taskId, (current) => ({ ...current, actualMinutes: minutes }));
    },
    [updateTaskById],
  );

  const timer = useTimer({
    tasks,
    onActualMinutes: handleActualMinutes,
    onNotice: (message) => addToast(message, 'info'),
    enabled: !loading,
  });

  const applyTheme = useCallback(
    (theme: Settings['theme']) => {
      if (settingsRef.current.theme === theme) return;
      const next: Settings = { ...settingsRef.current, theme };
      settingsRef.current = next;
      setSettings(next);
      void saveSettings(next);
      accountRef.current?.schedulePush();
    },
    [],
  );

  const toggleTheme = useCallback(() => applyTheme(isDark ? 'light' : 'dark'), [applyTheme, isDark]);

  const updateSettings = useCallback(async (next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
    await saveSettings(next);
    accountRef.current?.schedulePush();
  }, []);

  /**
   * A category the user named themselves.
   *
   * It lives in settings rather than in a table of its own: it is a short list
   * of words, it belongs with the other preferences, and it travels in the same
   * settings object that backups and cloud sync already carry. The task keeps
   * the name itself, so a category is never a dangling reference.
   */
  const addCategory = useCallback(
    (name: string): string | null => {
      const current = settingsRef.current;
      const existing = current.customCategories ?? [];
      const result = normaliseCustomCategory(name, existing);
      if (!result.ok) return result.error;
      void updateSettings({ ...current, customCategories: [...existing, result.value] });
      addToast(`Category “${result.value}” added.`, 'success');
      return null;
    },
    [addToast, updateSettings],
  );

  /**
   * Rename a category, on the tasks as well as in the list.
   *
   * A task stores the category's name, not a reference to it — that is what
   * makes the list safe to trim and what keeps an old backup readable. The
   * cost is this: renaming has to walk the tasks, or every task filed under the
   * old name would silently fall back to looking like a custom category that
   * no longer exists in any picker.
   */
  const renameCategory = useCallback(
    async (from: string, to: string): Promise<string | null> => {
      const current = settingsRef.current;
      const existing = current.customCategories ?? [];
      if (!existing.includes(from)) return 'That category is no longer in your list.';
      const result = normaliseCustomCategory(to, existing, from);
      if (!result.ok) return result.error;
      const next = result.value;
      if (next === from) return null;

      await updateSettings({
        ...current,
        customCategories: existing.map((name) => (name === from ? next : name)),
      });

      const iso = new Date().toISOString();
      const changed = tasksRef.current
        .filter((task) => task.category === from)
        .map((task) => ({ ...task, category: next, updatedAt: iso }));
      if (changed.length > 0) {
        const byId = new Map(changed.map((task) => [task.id, task]));
        persistTasks(
          tasksRef.current.map((task) => byId.get(task.id) ?? task),
          changed,
        );
      }
      addToast(
        changed.length > 0
          ? `Renamed to “${next}” on ${changed.length} task${changed.length === 1 ? '' : 's'}.`
          : `Category renamed to “${next}”.`,
        'success',
      );
      return null;
    },
    [addToast, persistTasks, updateSettings],
  );

  /**
   * Delete a category and move what was filed under it to “Other”.
   *
   * Deleting the word without moving the tasks would leave them pointing at a
   * name no picker offers — they would still render, but there would be no way
   * to choose it again. “Other” is the one bucket that always exists.
   */
  const deleteCategory = useCallback(
    async (name: string): Promise<number> => {
      const current = settingsRef.current;
      const existing = current.customCategories ?? [];
      if (!existing.includes(name)) return 0;

      await updateSettings({ ...current, customCategories: existing.filter((item) => item !== name) });

      const iso = new Date().toISOString();
      const changed = tasksRef.current
        .filter((task) => task.category === name)
        .map((task) => ({ ...task, category: 'other' as Category, updatedAt: iso }));
      if (changed.length > 0) {
        const byId = new Map(changed.map((task) => [task.id, task]));
        persistTasks(
          tasksRef.current.map((task) => byId.get(task.id) ?? task),
          changed,
        );
      }
      addToast(
        changed.length > 0
          ? `Category deleted — ${changed.length} task${changed.length === 1 ? '' : 's'} moved to Other.`
          : `Category “${name}” deleted.`,
        'success',
      );
      return changed.length;
    },
    [addToast, persistTasks, updateSettings],
  );

  const buildTask = useCallback(
    (draft: TaskDraft, extra?: Partial<Task>): Task => {
      const iso = new Date().toISOString();
      return {
        id: uniqueId('tsk'),
        ...draft,
        actualMinutes: 0,
        scheduledFor: null,
        suggestedDate: null,
        suggestedStart: null,
        status: 'inbox',
        deferrals: 0,
        createdAt: iso,
        updatedAt: iso,
        completedAt: null,
        deletedAt: null,
        source: 'manual',
        graphRef: null,
        ...extra,
      };
    },
    [],
  );

  const handleQuickAdd = useCallback(
    (draft: QuickAddDraft) => {
      const task = buildTask(
        {
          title: draft.title,
          notes: '',
          client: draft.client,
          category: draft.category,
          priority: draft.priority,
          estimatedMinutes: draft.estimatedMinutes,
          dueDate: draft.dueDate,
          dueTime: draft.dueTime,
          blocked: false,
          dependencyIds: [],
        },
        { status: 'todo' },
      );
      persistTasks([...tasksRef.current, task], [task]);
      void logEvent(task.id, 'created', 'Task created from Quick Add');
      const when = task.dueDate ? relativeDayLabel(task.dueDate) : null;
      const whenLabel = when === 'Today' || when === 'Tomorrow' ? when.toLowerCase() : when;
      addToast(`Added “${task.title}”${whenLabel ? ` for ${whenLabel}` : ''}.`, 'success', {
        label: 'Open',
        onAction: () => setPanelId(task.id),
      });
    },
    [addToast, buildTask, persistTasks],
  );

  const handleFormSubmit = useCallback(
    (draft: TaskDraft) => {
      const existing = formState.task;
      setFormState({ open: false, task: null, initialDraft: null });
      if (existing) {
        const current = tasksRef.current.find((task) => task.id === existing.id);
        if (!current) return;
        const updated: Task = {
          ...current,
          ...draft,
          updatedAt: new Date().toISOString(),
        };
        persistTasks(
          tasksRef.current.map((task) => (task.id === updated.id ? updated : task)),
          [updated],
        );
        void logEvent(updated.id, 'updated', 'Task details updated');
        addToast('Task updated.', 'success');
        return;
      }
      const task = buildTask(draft);
      persistTasks([...tasksRef.current, task], [task]);
      void logEvent(task.id, 'created', 'Task created');
      addToast('Task created.', 'success', { label: 'Open', onAction: () => setPanelId(task.id) });
    },
    [addToast, buildTask, formState.task, persistTasks],
  );

  const reopenTask = useCallback(
    async (id: string) => {
      const updated = updateTaskById(id, (task) => ({ ...task, status: 'todo', completedAt: null }));
      if (!updated) return;
      await logEvent(id, 'status', 'Task reopened — completion undone');
      addToast('Task reopened.', 'info');
    },
    [addToast, updateTaskById],
  );

  /**
   * Save a task's own note, dating it.
   *
   * `notesUpdatedAt` is what puts the note on the right day's report: a note
   * edited today belongs to today even when the task was created last week.
   * The note is the task's, not the report's — the report reads it, never the
   * other way round.
   */
  const saveTaskNote = useCallback(
    (id: string, notes: string) => {
      const next = notes.trim();
      const current = tasksRef.current.find((task) => task.id === id);
      if (!current || (current.notes ?? '') === next) return;
      const at = new Date().toISOString();
      const updated: Task = {
        ...current,
        notes: next,
        notesUpdatedAt: next ? at : null,
        updatedAt: at,
      };
      persistTasks(
        tasksRef.current.map((task) => (task.id === id ? updated : task)),
        [updated],
      );
      void logEvent(id, 'updated', next ? 'Note updated' : 'Note cleared');
    },
    [persistTasks],
  );

  /**
   * Store a completion note after the fact — from the task panel, or by
   * correcting one written in a hurry. An empty string clears it, which also
   * takes it back out of that day's report.
   */
  const saveCompletionNote = useCallback(
    (id: string, note: string) => {
      const next = note.trim();
      const current = tasksRef.current.find((task) => task.id === id);
      if (!current || (current.completionNote ?? '') === next) return;
      const at = new Date().toISOString();
      const updated: Task = {
        ...current,
        completionNote: next || undefined,
        completionNoteAt: next ? at : null,
        updatedAt: at,
      };
      persistTasks(
        tasksRef.current.map((task) => (task.id === id ? updated : task)),
        [updated],
      );
      void logEvent(id, 'updated', next ? 'Completion note updated' : 'Completion note cleared');
    },
    [persistTasks],
  );

  /**
   * Completing is now a two-step intent: ask for the optional note, then save.
   *
   * Tapping Complete on a task that is already complete is still the undo —
   * reopening must not go through a note dialog for work that is being undone.
   */
  const toggleComplete = useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((candidate) => candidate.id === id);
      if (!task) return;
      if (task.status === 'completed') {
        await reopenTask(id);
        return;
      }
      setCompleteId(id);
    },
    [reopenTask],
  );

  /** The dialog's “Complete Task” / “Complete Without Note”. */
  const confirmComplete = useCallback(
    async (id: string, note: string) => {
      setCompleteId(null);
      const task = tasksRef.current.find((candidate) => candidate.id === id);
      if (!task || task.status === 'completed') return;
      if (timer.isRunning(id)) {
        await timer.finish();
      }
      haptic('success');
      const latest = tasksRef.current.find((candidate) => candidate.id === id) ?? task;
      const at = new Date().toISOString();
      const keptNote = note.trim() || (latest.completionNote ?? '');
      const updated: Task = {
        ...latest,
        status: 'completed',
        completedAt: at,
        completionNote: keptNote.trim() ? keptNote.trim() : undefined,
        completionNoteAt: keptNote.trim() ? at : null,
        updatedAt: at,
      };
      persistTasks(
        tasksRef.current.map((candidate) => (candidate.id === id ? updated : candidate)),
        [updated],
      );
      await logEvent(id, 'status', keptNote.trim() ? 'Task completed with a note' : 'Task completed');

      // What just happened, in the assistant's terms: how many are done today,
      // whether the board is now clear, and what it would do next.
      const clock = new Date();
      // Local day, not UTC: a completion at 1am in IST belongs to that day, not
      // to yesterday because the server clock says so.
      const today = todayISO(clock);
      const isToday = (task: Task) => (task.completedAt ? toISODate(new Date(task.completedAt)) : '') === today;
      const openAfter = tasksRef.current.filter(
        (candidate) => candidate.status !== 'completed' && candidate.deletedAt === null && candidate.id !== id,
      );
      const completedToday = tasksRef.current.filter(
        (candidate) => candidate.status === 'completed' && candidate.deletedAt === null && isToday(candidate),
      ).length;
      const streakDays = streakFrom(loadShelf(), today);
      // `tasksRef` already holds this task as completed, so this count includes it.
      const sticker = stickerFor({
        completedToday,
        streakDays,
        hour: clock.getHours(),
        clearedAll: openAfter.length === 0,
      });
      saveShelf(recordSticker(loadShelf(), sticker.id, clock.toISOString()));
      const next = [...openAfter].sort((a, b) => (taskDueAt(a)?.getTime() ?? Infinity) - (taskDueAt(b)?.getTime() ?? Infinity))[0];
      stickerKey.current += 1;
      setStickerMoment({
        key: stickerKey.current,
        sticker,
        caption: stickerCaption(sticker, { completedToday, nextTitle: next?.title ?? null }),
      });

      // Confetti is for clearing the board, not for every tick. A celebration
      // that fires forty times a week stops being a celebration.
      if (!prefersReducedMotion() && (sticker.id === 'clean-sweep' || completedToday % 10 === 0)) {
        setConfettiKey((current) => current + 1);
      }
      addToast('Task completed.', 'success', { label: 'Undo', onAction: () => void reopenTask(id) });
    },
    [addToast, persistTasks, reopenTask, timer],
  );

  const startTask = useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((candidate) => candidate.id === id);
      if (!task) return;
      if (task.status === 'completed') {
        addToast('Completed tasks cannot be timed. Reopen it first.', 'warning');
        return;
      }
      await timer.start(id);
      if (task.status !== 'in_progress') {
        updateTaskById(id, (current) => ({ ...current, status: 'in_progress' }));
      }
    },
    [addToast, timer, updateTaskById],
  );

  const resumeTask = useCallback(
    async (id: string) => {
      await timer.resume(id);
      updateTaskById(id, (current) => (current.status === 'in_progress' ? current : { ...current, status: 'in_progress' }));
    },
    [timer, updateTaskById],
  );

  const finishTimer = useCallback(async () => {
    const minutes = await timer.finish();
    if (minutes > 0) addToast(`Timer finished — ${formatDuration(minutes)} tracked on this task.`, 'success');
  }, [addToast, timer]);

  const pauseTimer = useCallback(async () => {
    await timer.pause();
    addToast('Timer paused.', 'info');
  }, [addToast, timer]);

  const rescheduleTask = useCallback(
    async (id: string, iso: string) => {
      const task = tasksRef.current.find((candidate) => candidate.id === id);
      if (!task) return;
      const movingLater = task.dueDate === null || iso > task.dueDate;
      const updated = updateTaskById(id, (current) => ({
        ...current,
        dueDate: iso,
        deferrals: movingLater ? current.deferrals + 1 : current.deferrals,
        suggestedDate: null,
        suggestedStart: null,
      }));
      if (!updated) return;
      await logEvent(id, 'deferral', `Due date changed to ${iso}${movingLater ? ' (counts as a deferral)' : ''}`);
      addToast(`Rescheduled to ${formatDateLong(iso)}.`, 'info');
    },
    [addToast, updateTaskById],
  );

  const snoozeTask = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((candidate) => candidate.id === taskId);
      if (!task) return;
      const dueAt = combineDateTime(task.dueDate ?? todayISO(), task.dueTime || '17:00').toISOString();
      const recordId = `rem_${task.id}_${task.dueDate ?? 'none'}_${task.dueTime || 'eod'}`;
      const existing = remindersRef.current.find((record) => record.id === recordId);
      const record: ReminderRecord = {
        id: recordId,
        taskId: task.id,
        dueAt,
        status: 'queued',
        snoozedUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      const next = [...remindersRef.current.filter((item) => item.id !== recordId), record];
      remindersRef.current = next;
      setReminders(next);
      await saveReminders([record]);
      await logEvent(task.id, 'reminder', 'Reminder snoozed for 15 minutes');
      // A snooze is a request to be told again — clear the de-dupe marker.
      forgetDelivered(task.id);
      setNotifications((current) =>
        saveNotifications(current.filter((item) => item.taskId !== task.id || item.kind === 'test')),
      );
      addToast('Reminder snoozed for 15 minutes.', 'info');
    },
    [addToast],
  );

  const dismissReminder = useCallback(
    async (taskId: string) => {
      const task = tasksRef.current.find((candidate) => candidate.id === taskId);
      if (!task) return;
      const dueAt = combineDateTime(task.dueDate ?? todayISO(), task.dueTime || '17:00').toISOString();
      const recordId = `rem_${task.id}_${task.dueDate ?? 'none'}_${task.dueTime || 'eod'}`;
      const existing = remindersRef.current.find((record) => record.id === recordId);
      const record: ReminderRecord = {
        id: recordId,
        taskId: task.id,
        dueAt,
        status: 'dismissed',
        snoozedUntil: null,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      const next = [...remindersRef.current.filter((item) => item.id !== recordId), record];
      remindersRef.current = next;
      setReminders(next);
      await saveReminders([record]);
      await logEvent(task.id, 'reminder', 'Reminder dismissed');
      setNotifications((current) => saveNotifications(current.filter((item) => item.taskId !== task.id)));
      addToast('Reminder dismissed.', 'info');
    },
    [addToast],
  );

  const toggleBlocked = useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((candidate) => candidate.id === id);
      if (!task) return;
      const updated = updateTaskById(id, (current) => ({ ...current, blocked: !current.blocked }));
      if (!updated) return;
      await logEvent(id, 'status', updated.blocked ? 'Marked as blocked' : 'Unblocked');
      addToast(updated.blocked ? 'Task marked blocked — it will stay queued.' : 'Task unblocked.', 'info');
    },
    [addToast, updateTaskById],
  );

  const requestDelete = useCallback(
    (task: Task) => {
      setConfirmState({
        title: 'Delete task?',
        message: (
          <p>
            “{task.title}” will be hidden from every view. Its timer is ended first if one is running. This is a soft
            delete — export a backup if you need a permanent record.
          </p>
        ),
        confirmLabel: 'Delete task',
        tone: 'danger',
        onConfirm: () => {
          setConfirmState(null);
          void (async () => {
            if (timer.isRunning(task.id)) await timer.finish();
            const updated = updateTaskById(task.id, (current) => ({
              ...current,
              deletedAt: new Date().toISOString(),
              suggestedDate: null,
              suggestedStart: null,
            }));
            if (!updated) return;
            await logEvent(task.id, 'status', 'Task deleted (soft delete)');
            if (panelId === task.id) setPanelId(null);
            addToast('Task deleted.', 'info', {
              label: 'Undo',
              onAction: () => {
                const restored = updateTaskById(task.id, (current) => ({ ...current, deletedAt: null }));
                if (!restored) return;
                void logEvent(task.id, 'restored', 'Delete undone from the toast');
                addToast('Task restored.', 'success', { label: 'Open', onAction: () => setPanelId(task.id) });
              },
            });
          })();
        },
      });
    },
    [addToast, panelId, timer, updateTaskById],
  );

  const deferTodayToTomorrow = useCallback(async () => {
    const today = todayISO();
    const targets = tasksRef.current.filter(
      (task) => task.deletedAt === null && task.status !== 'completed' && task.dueDate === today,
    );
    if (targets.length === 0) {
      addToast('Nothing is left for today.', 'success');
      return;
    }
    const tomorrow = daysFromNow(1);
    const previous = new Map(targets.map((task) => [task.id, { dueDate: task.dueDate, deferrals: task.deferrals }]));
    const changed: Task[] = [];
    const next = tasksRef.current.map((task) => {
      const before = previous.get(task.id);
      if (!before) return task;
      const updated: Task = {
        ...task,
        dueDate: tomorrow,
        deferrals: task.deferrals + 1,
        suggestedDate: null,
        suggestedStart: null,
        updatedAt: new Date().toISOString(),
      };
      changed.push(updated);
      return updated;
    });
    persistTasks(next, changed);
    for (const task of targets) {
      void logEvent(task.id, 'deferral', 'Moved to tomorrow from the end-of-day wrap-up');
    }
    addToast(
      `Moved ${targets.length} task${targets.length === 1 ? '' : 's'} to tomorrow.`,
      'info',
      {
        label: 'Undo',
        onAction: () => {
          const restored = tasksRef.current.map((task) => {
            const before = previous.get(task.id);
            if (!before) return task;
            return { ...task, dueDate: before.dueDate, deferrals: before.deferrals, updatedAt: new Date().toISOString() };
          });
          persistTasks(restored, restored.filter((task) => previous.has(task.id)));
          for (const task of targets) void logEvent(task.id, 'deferral', 'Wrap-up rollover undone');
          addToast('Moved back to today.', 'info');
        },
      },
    );
  }, [addToast, persistTasks]);

  const applySuggestion = useCallback(
    async (taskId: string, suggestion: { category: Task['category']; priority: Task['priority']; estimatedMinutes: number }) => {
      const updated = updateTaskById(taskId, (current) => ({ ...current, ...suggestion }));
      if (!updated) return;
      await logEvent(
        taskId,
        'updated',
        `Applied on-device suggestion: ${suggestion.category}, ${suggestion.priority}, ${suggestion.estimatedMinutes}m`,
      );
      addToast('Suggestion applied.', 'success');
    },
    [addToast, updateTaskById],
  );

  const applyPlan = useCallback(
    (plan: DayPlan) => {
      const next = applyPlanToTasks(plan, tasksRef.current);
      const changed = next.filter((task, index) => task !== tasksRef.current[index]);
      persistTasks(next, changed);
      for (const task of changed) {
        void logEvent(
          task.id,
          'updated',
          task.suggestedDate
            ? `Scheduled for ${task.suggestedDate}${task.suggestedStart ? ` at ${task.suggestedStart}` : ''}`
            : 'Removed from suggested schedule',
        );
      }
      addToast(`Schedule applied for ${formatDateLong(plan.dateISO)}. Deadlines were not changed.`, 'success');
    },
    [addToast, persistTasks],
  );

  const importDrafts = useCallback(
    (
      drafts: ParsedDraft[],
      meta: { createdAt: string; completedAt: string; completedIds: string[]; dateISO: string },
    ) => {
      /* The reporting date, not “now”: a screenshot of yesterday's priorities
         is dated yesterday, so it lands in yesterday's daily update and does
         not turn up in today's as though it were new work. */
      const done = new Set(meta.completedIds.map((title) => title.trim().toLowerCase()));
      const created = drafts.map((draft) => {
        const completed = done.has(draft.title.trim().toLowerCase());
        return buildTask(
          {
            title: draft.title,
            notes: draft.notes,
            client: draft.client,
            category: draft.category,
            priority: draft.priority,
            estimatedMinutes: draft.estimatedMinutes,
            dueDate: draft.dueDate,
            dueTime: draft.dueTime,
            blocked: false,
            dependencyIds: [],
          },
          {
            source: 'ocr',
            status: completed ? 'completed' : 'inbox',
            createdAt: meta.createdAt,
            updatedAt: meta.completedAt,
            completedAt: completed ? meta.completedAt : null,
            section: draft.section || undefined,
          },
        );
      });
      persistTasks([...tasksRef.current, ...created], created);
      for (const task of created) {
        void logEvent(
          task.id,
          'created',
          `Created from reviewed screenshot text (${task.source}) for ${meta.dateISO}`,
        );
      }
      setPage('tasks');
      const completedCount = created.filter((task) => task.status === 'completed').length;
      addToast(
        `${created.length} screenshot task${created.length === 1 ? '' : 's'} saved to My Tasks after review${
          completedCount > 0 ? `, ${completedCount} already done` : ''
        }.`,
        'success',
      );
    },
    [addToast, buildTask, persistTasks],
  );

  const handleExportBackup = useCallback(async () => {
    const [events, reports] = await Promise.all([listAllEvents(), listReports()]);
    const payload = createBackupPayload(
      settingsRef.current,
      tasksRef.current,
      timer.sessions,
      remindersRef.current,
      events,
      reports,
    );
    downloadFile(`workday-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    const next = { ...settingsRef.current, lastBackupAt: new Date().toISOString() };
    await updateSettings(next);
    addToast('JSON backup downloaded. Keep it somewhere safe.', 'success');
  }, [addToast, timer.sessions, updateSettings]);

  const handleExportCsv = useCallback(() => {
    downloadFile(`workday-tasks-${todayISO()}.csv`, tasksToCsv(tasksRef.current), 'text/csv');
    addToast('Task CSV downloaded.', 'success');
  }, [addToast]);

  const handleExportIcs = useCallback(() => {
    downloadFile(
      `workday-plan-${todayISO()}.ics`,
      buildFoldedIcs(tasksRef.current, { now: new Date() }),
      'text/calendar',
    );
    addToast('Calendar file downloaded — import or subscribe to it in any calendar app.', 'success');
  }, [addToast]);

  const handleImportBackup = useCallback(
    async (file: File) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        addToast('That file is not valid JSON.', 'danger');
        return;
      }
      const result = validateBackup(parsed);
      if (!result.ok) {
        addToast(result.error, 'danger');
        return;
      }
      setConfirmState({
        title: 'Restore this backup?',
        message: (
          <p>
            The backup contains <strong>{result.data.tasks.length}</strong> task
            {result.data.tasks.length === 1 ? '' : 's'} and {result.data.timeSessions.length} timer session
            {result.data.timeSessions.length === 1 ? '' : 's'}. Matching IDs are merged; nothing else is deleted.
          </p>
        ),
        confirmLabel: 'Merge backup',
        tone: 'primary',
        onConfirm: () => {
          setConfirmState(null);
          void (async () => {
            await restoreBackup(result.data, 'merge');
            const [loadedSettings, loadedTasks, loadedReminders] = await Promise.all([
              loadSettings(),
              listTasks(),
              listReminders(),
            ]);
            settingsRef.current = loadedSettings;
            tasksRef.current = loadedTasks;
            remindersRef.current = loadedReminders;
            setSettings(loadedSettings);
            setTasks(loadedTasks);
            setReminders(loadedReminders);
            addToast('Backup merged successfully.', 'success');
          })();
        },
      });
    },
    [addToast],
  );

  const handleResetData = useCallback(() => {
    void (async () => {
      await clearAllData();
      clearGraphToken();
      setGraphToken(null);
      setGraphItems([]);
      setGraphErrors([]);
      setGraphAccount(null);
      setGraphFetchedAt(null);
      const defaults = { ...DEFAULT_SETTINGS };
      settingsRef.current = defaults;
      tasksRef.current = [];
      remindersRef.current = [];
      setSettings(defaults);
      setTasks([]);
      setReminders([]);
      setPanelId(null);
      setPage('today');
      addToast('All local data was cleared.', 'info');
    })();
  }, [addToast]);

  const connectGraph = useCallback(
    async (clientId: string) => {
      if (!clientId.trim()) {
        addToast('Add your Azure Application (client) ID first.', 'warning');
        return;
      }
      const next = { ...settingsRef.current, graphClientId: clientId.trim() };
      await updateSettings(next);
      try {
        await beginGraphSignIn(clientId.trim());
      } catch (error) {
        addToast(
          error instanceof Error ? `Could not start Microsoft sign-in: ${error.message}` : 'Could not start Microsoft sign-in.',
          'danger',
        );
      }
    },
    [addToast, updateSettings],
  );

  const disconnectGraph = useCallback(() => {
    clearGraphToken();
    setGraphToken(null);
    setGraphItems([]);
    setGraphErrors([]);
    setGraphAccount(null);
    setGraphFetchedAt(null);
    addToast('Microsoft disconnected. Session tokens were removed.', 'info');
  }, [addToast]);

  const checkGraph = useCallback(
    async (tokenOverride?: GraphToken) => {
      const token = tokenOverride ?? graphTokenRef.current ?? loadGraphToken();
      if (!token) {
        addToast('Connect Microsoft in Settings first.', 'warning');
        return;
      }
      setGraphBusy(true);
      setGraphErrors([]);
      try {
        // Mail/chat highlights and today's calendar truth in one round trip.
        const [result, calendar] = await Promise.all([
          fetchGraphHighlights(token),
          fetchDayMeetings(token, todayISO()),
        ]);
        setGraphItems(result.items);
        setMeetings(calendar.items);
        setGraphErrors(calendar.error ? [...result.errors, calendar.error] : result.errors);
        setGraphAccount(result.account);
        setGraphFetchedAt(result.fetchedAt);
        saveGraphCache({ fetchedAt: result.fetchedAt, items: result.items });
        if ([...result.errors, calendar.error ?? ''].some((message) => message.includes('401'))) {
          clearGraphToken();
          setGraphToken(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not reach Microsoft Graph.';
        setGraphErrors([message]);
        if (message.includes('401')) {
          clearGraphToken();
          setGraphToken(null);
        }
      } finally {
        setGraphBusy(false);
      }
    },
    [addToast],
  );

  const autoCheckedGraph = useRef(false);
  useEffect(() => {
    const token = graphToken ?? loadGraphToken();
    if (!token || autoCheckedGraph.current) return;
    autoCheckedGraph.current = true;
    void checkGraph(token);
  }, [graphToken, checkGraph]);

  // A session that crosses midnight must not keep yesterday's meetings.
  const lastMeetingDay = useRef(todayISO());
  useEffect(() => {
    const day = todayISO();
    if (day === lastMeetingDay.current) return;
    lastMeetingDay.current = day;
    const token = graphToken ?? loadGraphToken();
    if (!token) return;
    void fetchDayMeetings(token, day).then((calendar) => {
      setMeetings(calendar.items);
    });
  }, [graphToken, now]);

  const createTaskFromHighlight = useCallback(
    async (item: GraphHighlight) => {
      const draft: TaskDraft = {
        title: `Follow up: ${item.title}`.slice(0, 150),
        notes: `${item.preview}\n\nOriginal: ${item.webUrl}`,
        client: '',
        category: item.kind === 'mail' ? 'email' : 'follow_up',
        priority: 'high',
        estimatedMinutes: settingsRef.current.defaultEstimateMinutes,
        dueDate: todayISO(),
        dueTime: '',
        blocked: false,
        dependencyIds: [],
      };
      const task = buildTask(draft, { source: 'graph', graphRef: item.ref, status: 'inbox' });
      persistTasks([...tasksRef.current, task], [task]);
      await logEvent(task.id, 'created', `Created from ${item.kind === 'mail' ? 'Outlook' : 'Teams'} highlight`);
      setGraphItems((current) => {
        const next = current.filter((candidate) => candidate.id !== item.id);
        saveGraphCache({ fetchedAt: graphFetchedAt ?? new Date().toISOString(), items: next });
        return next;
      });
      addToast('Task created from Microsoft highlight.', 'success', {
        label: 'Open',
        onAction: () => setPanelId(task.id),
      });
    },
    [addToast, buildTask, graphFetchedAt, persistTasks],
  );

  const dismissHighlight = useCallback(
    (id: string) => {
      setGraphItems((current) => {
        const next = current.filter((item) => item.id !== id);
        saveGraphCache({ fetchedAt: graphFetchedAt ?? new Date().toISOString(), items: next });
        return next;
      });
    },
    [graphFetchedAt],
  );

  const handleRequestNotifications = useCallback(async (): Promise<string> => {
    const permission = await requestNotificationPermission();
    if (permission === 'granted') {
      const next = { ...settingsRef.current, notificationsEnabled: true };
      await updateSettings(next);
      void registerBackgroundChecks();
      addToast('Notifications enabled on this device.', 'success');
    } else if (permission === 'denied') {
      addToast('Browser permission was denied. In-app reminders still work.', 'warning');
    }
    return permission;
  }, [addToast, requestNotificationPermission, updateSettings]);

  const handleOpenNotificationTask = useCallback((taskId: string) => {
    setPage('tasks');
    setPanelId(taskId);
    setNotifications((current) => markAllNotificationsRead(current));
  }, []);

  const handleMarkAllRead = useCallback(() => {
    setNotifications((current) => markAllNotificationsRead(current));
  }, []);

  const handleClearNotifications = useCallback(() => {
    setNotifications(clearNotificationList());
  }, []);

  const handleDismissNotification = useCallback((item: AppNotification) => {
    setNotifications((current) => saveNotifications(current.filter((entry) => entry.id !== item.id)));
  }, []);

  /**
   * Proves the whole chain end to end: in-app entry, OS banner, and a
   * permission prompt when the browser has not been asked yet.
   */
  const handleSendTestNotification = useCallback(async () => {
    let permission = notificationPermission;
    if (permission !== 'granted') permission = await requestNotificationPermission();

    setNotifications((current) =>
      addNotification(current, {
        id: `test_${Date.now()}`,
        taskId: null,
        title: 'Notifications are on',
        body: 'This is what a deadline alert looks like on this device.',
        createdAt: new Date().toISOString(),
        dueAt: null,
        read: false,
        kind: 'test',
      }),
    );

    if (permission !== 'granted') {
      addToast('Saved in-app. Allow notifications to also get system alerts.', 'info');
      return;
    }
    if (!settingsRef.current.notificationsEnabled) {
      await updateSettings({ ...settingsRef.current, notificationsEnabled: true });
    }
    const sent = await sendTestNotification();
    addToast(
      sent ? 'Test notification sent to this device.' : 'System notifier unavailable — the in-app copy is above.',
      sent ? 'success' : 'warning',
    );
    void registerBackgroundChecks();
  }, [addToast, notificationPermission, requestNotificationPermission, updateSettings]);

  const handleOnboarding = useCallback(
    async (next: Settings) => {
      const completed = { ...next, onboardingComplete: true };
      await updateSettings(completed);
      addToast('Setup complete — welcome to your workday.', 'success');
      // Push straight away: the whole point of signing in during setup is that
      // the next device sees this without waiting for the two-minute tick.
      if (account.cloudConnected) void account.syncNow();
    },
    [account, addToast, updateSettings],
  );

  const activeReminders: ReminderItem[] = useMemo(() => {
    const base = buildReminders(tasks, settings, now);
    return base.filter((reminder) => {
      const record = reminders.find(
        (item) => item.taskId === reminder.task.id && item.dueAt === reminder.dueAt.toISOString(),
      );
      if (!record) return true;
      if (record.status === 'dismissed' || record.status === 'done') return false;
      if (record.snoozedUntil && new Date(record.snoozedUntil).getTime() > now.getTime()) return false;
      return true;
    });
  }, [tasks, settings, now, reminders]);

  /**
   * Reminders become notifications here.
   *
   * Three decisions shape this:
   *
   *   · The in-app list is always written; it is the reliable layer. The OS is
   *     asked only when alerts are enabled, permission is granted and it is not
   *     quiet hours.
   *   · A pending task is nudged again every `reminderRepeatMinutes`, not just
   *     once at its deadline. The slot number is part of the de-duplication
   *     key, so each nudge is new and none is delivered twice.
   *   · A dismissed or snoozed reminder silences its task until it is done or
   *     snoozed past — that is what dismissal means, and repeats must not
   *     overrule it.
   */
  const dueReminders: ReminderDue[] = useMemo(() => {
    /* A dismissal belongs to one deadline, not to the task forever: move the
       task to tomorrow and it must be able to remind again. The record is keyed
       by (task, deadline), so matching on the same pair keeps that promise. */
    const silenced = new Set(
      reminders
        .filter(
          (record) =>
            record.status === 'done' ||
            record.status === 'dismissed' ||
            (record.snoozedUntil !== null && new Date(record.snoozedUntil).getTime() > now.getTime()),
        )
        .map((record) => `${record.taskId}|${record.dueAt}`),
    );
    return buildReminderDue(tasks, settings, now).filter(
      (entry) => !silenced.has(`${entry.task.id}|${entry.dueAt.toISOString()}`),
    );
  }, [tasks, settings, now, reminders]);

  useEffect(() => {
    if (dueReminders.length === 0) return;
    /* Slot 0 keeps the key reminders used before repeats existed, so an alert
       already in someone's bell is not re-delivered after this update. Every
       repeat keys on the moment its window opened, which is unique per nudge
       (a slot number alone would repeat across days). */
    const keyOf = (entry: ReminderDue) =>
      entry.slot === 0
        ? `${entry.task.id}|${entry.dueAt.toISOString()}`
        : `${entry.task.id}|${entry.dueAt.toISOString()}|${entry.nudgeAt.toISOString()}`;
    const candidates = dueReminders.filter((entry) => !wasDelivered(keyOf(entry))).slice(0, 5);
    if (candidates.length === 0) return;

    const quiet = isQuietNow(settings, now);
    /* Quiet hours mean quiet: the first alert is still recorded in the bell
       (it is a list, not an interruption), but a repeat would only be noise at
       2am and is skipped entirely. */
    const deliverable = candidates.filter((entry) => entry.slot === 0 || !quiet);
    if (deliverable.length === 0) return;

    const createdAt = new Date().toISOString();
    setNotifications((current) =>
      deliverable.reduce((list, entry) => {
        markDelivered(keyOf(entry));
        const client = entry.task.client ? `${entry.task.client} · ` : '';
        const repeatNote = entry.slot > 0 ? 'Still open · ' : '';
        return addNotification(list, {
          id: `rem_${entry.task.id}_${entry.dueAt.getTime()}`,
          taskId: entry.task.id,
          title: entry.task.title,
          body: `${client}${repeatNote}${dueLabel(entry.task, now)}`,
          createdAt,
          dueAt: entry.dueAt.toISOString(),
          read: false,
          kind: 'reminder',
        });
      }, current),
    );

    if (!settings.notificationsEnabled || notificationPermission !== 'granted' || quiet) return;
    for (const entry of deliverable.slice(0, 2)) {
      const client = entry.task.client ? `${entry.task.client} · ` : '';
      void deliverNative({
        title: entry.task.title,
        body: `${client}${entry.slot > 0 ? 'Still open · ' : ''}${dueLabel(entry.task, now)}`,
        /* A fresh tag per repeat: the same tag with `renotify: false` replaces
           the banner without making a sound, which would look like a reminder
           that never arrived. */
        tag: entry.slot === 0 ? `rem_${entry.task.id}` : `rem_${entry.task.id}_${entry.slot}`,
        taskId: entry.task.id,
        page: 'tasks',
      });
    }
  }, [dueReminders, settings, notificationPermission, now, addToast]);

  /**
   * One summary a day: everything still open, including work with no deadline.
   *
   * Without this, a task with no due date has nothing for a deadline reminder
   * to hang on and can sit in the list unnoticed. Delivered at most once per
   * calendar day, keyed by the date itself.
   */
  useEffect(() => {
    const digest = buildDailyDigest(tasks, settings, now);
    if (!digest) return;
    const key = `digest|${digest.dateISO}`;
    if (wasDelivered(key)) return;
    markDelivered(key);

    const parts: string[] = [];
    if (digest.overdue.length > 0) parts.push(`${digest.overdue.length} overdue`);
    if (digest.dueToday.length > 0) parts.push(`${digest.dueToday.length} due today`);
    if (digest.undated.length > 0) parts.push(`${digest.undated.length} with no date`);
    const body = `${digest.total} task${digest.total === 1 ? '' : 's'} still open — ${parts.join(', ')}.`;

    setNotifications((current) =>
      addNotification(current, {
        id: `digest_${digest.dateISO}`,
        taskId: null,
        title: 'Today’s pending work',
        body,
        createdAt: new Date().toISOString(),
        dueAt: null,
        read: false,
        kind: 'reminder',
      }),
    );

    if (!settings.notificationsEnabled || notificationPermission !== 'granted' || isQuietNow(settings, now)) return;
    void deliverNative({
      title: `Today’s pending work — ${digest.total}`,
      body,
      tag: `digest_${digest.dateISO}`,
      page: 'tasks',
    });
  }, [tasks, settings, now, notificationPermission]);

  // Ask the installed app to check reminders in the background (best effort).
  useEffect(() => {
    if (notificationPermission !== 'granted' || !settings.notificationsEnabled) return;
    void registerBackgroundChecks();
  }, [notificationPermission, settings.notificationsEnabled]);

  // Tapping an OS notification focuses the app and opens the task.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'workday:notification-click') return;
      setPage('tasks');
      if (typeof data.taskId === 'string') setPanelId(data.taskId);
      setNotifications((current) => markAllNotificationsRead(current));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // A dialog already has the keyboard; do not navigate or stack another one.
      if (document.querySelector('[role="dialog"]')) return;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if (event.key === '/') {
        // Quick capture from anywhere: land on Today and put the caret in the bar.
        event.preventDefault();
        setPage('today');
        window.setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>('.quick-add-input');
          input?.focus();
          input?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        }, 60);
        return;
      }
      if (event.key === 'n' || event.key === 'N') {
        setFormState({ open: true, task: null, initialDraft: null });
      } else if (event.key === 'd' || event.key === 'D') {
        setPage('today');
      } else if (event.key === 'i' || event.key === 'I') {
        setPage('tasks');
      } else if (event.key === 'c' || event.key === 'C') {
        setPage('completed');
      } else if (event.key === 'r' || event.key === 'R') {
        setPage('reports');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const completeTask = completeId ? tasks.find((task) => task.id === completeId) ?? null : null;
  const panelTask = panelId ? tasks.find((task) => task.id === panelId) ?? null : null;

  const learned: LearnedDurations = useMemo(
    () => learnDurations(tasks, timer.sessions).learned,
    [tasks, timer.sessions],
  );

  const counts: NavCounts = useMemo(() => {
    const open = tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null);
    const today = todayISO(now);
    return {
      tasks: open.length,
      overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today).length,
      today: open.filter((task) => task.dueDate === today).length,
      completed: tasks.filter((task) => task.status === 'completed' && task.deletedAt === null).length,
      reports: 0,
    };
  }, [tasks, now]);

  /**
   * The assistant says one thing, once.
   *
   * Not on every render, not on every page change: once per session and once
   * per day per observation. It uses the same counts the sidebar shows, so it
   * can never claim a number the rest of the screen disagrees with — and the
   * action takes you where the fix is, instead of explaining it.
   */
  useEffect(() => {
    if (loading || nudgedThisSession.current || !settings.onboardingComplete) return;
    nudgedThisSession.current = true;
    const today = todayISO(new Date());
    const nudge = nudgeFor({
      overdue: counts.overdue,
      dueToday: counts.today,
      openCount: counts.tasks,
      hour: new Date().getHours(),
    });
    if (!nudge || wasNudged(nudge, today)) return;
    markNudged(nudge, today);
    addToast(nudge.message, 'info', {
      label: nudge.actionLabel,
      onAction: () => navigate(nudge.page),
    });
  }, [addToast, counts, loading, navigate, settings.onboardingComplete]);

  // The tab title is the one place the planner can be honest while you are elsewhere.
  // A running timer takes precedence: it is the only live number that matters.
  const runningTask = timer.activeSession
    ? tasks.find((task) => task.id === timer.activeSession?.taskId) ?? null
    : null;
  const runningClock = runningTask ? formatSecondsLabel(Math.floor(timer.elapsedMsFor(runningTask.id) / 1000)) : '';

  useEffect(() => {
    if (runningClock) {
      document.title = `${runningClock} · ${runningTask?.title ?? 'Timing'} — My Workday Planner`;
      return;
    }
    const parts: string[] = [];
    if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`);
    if (counts.today > 0) parts.push(`${counts.today} due today`);
    document.title = parts.length > 0 ? `${parts.join(' · ')} — My Workday Planner` : 'My Workday Planner';
  }, [counts.overdue, counts.today, runningClock, runningTask?.title]);

  // Crossing midnight while the app is open should re-frame the board, not leave
  // yesterday's "due today" numbers on screen.
  const dayRef = useRef(todayISO(now));
  useEffect(() => {
    const today = todayISO(now);
    if (dayRef.current === today) return;
    dayRef.current = today;
    addToast('A new day — the board has rolled over.', 'info');
  }, [now, addToast]);

  const taskHandlers = useCallback(
    (task: Task): TaskCardHandlers => ({
      onOpen: () => setPanelId(task.id),
      onEdit: () => {
        setPanelId(null);
        setFormState({ open: true, task, initialDraft: null });
      },
      onToggleComplete: () => void toggleComplete(task.id),
      onStart: () => void startTask(task.id),
      onPause: () => void pauseTimer(),
      onResume: () => void resumeTask(task.id),
      onFinish: () => void finishTimer(),
      onReschedule: (iso) => void rescheduleTask(task.id, iso),
      onSnooze: () => void snoozeTask(task.id),
      onDelete: () => requestDelete(task),
      onToggleBlocked: () => void toggleBlocked(task.id),
    }),
    [finishTimer, pauseTimer, requestDelete, rescheduleTask, resumeTask, snoozeTask, startTask, toggleBlocked, toggleComplete],
  );

  /** Local assistant Q&A (#13) — pure function over local planner data. */
  const handleAsk = useCallback(
    (question: string): QaAnswer =>
      answerQuestion({ question, tasks, settings, sessions: timer.sessions, now }),
    [tasks, settings, timer.sessions, now],
  );

  /** On-demand per-client mail for reply-window stats (#7) — never throws. */
  const handleFetchClientMail = useCallback(
    async (client: string): Promise<ClientMailResult> => {
      const token = graphToken ?? loadGraphToken();
      if (!token) {
        return {
          messages: [],
          error: 'Connect Microsoft in Settings first — reply windows come from your Microsoft mail.',
        };
      }
      return fetchClientMail(token, client);
    },
    [graphToken],
  );

  if (loading) {
    return (
      <div className="app-shell loading-shell">
        <SkeletonScreen />
      </div>
    );
  }

  if (!settings.onboardingComplete) {
    return (
      <Onboarding onComplete={(next) => void handleOnboarding(next)} account={account} addToast={addToast} />
    );
  }

  const common: CommonPageProps = {
    tasks,    settings,
    now,
    timer,
    taskHandlers,
    onOpenPage: navigate,
    onQuickAdd: handleQuickAdd,
    onNewTask: () => setFormState({ open: true, task: null, initialDraft: null }),
    onEditTask: (task) => {
      setPanelId(null);
      setFormState({ open: true, task, initialDraft: null });
    },
    addToast,
    online,
    graphHighlights: graphItems,
  };

  const graphConnected = Boolean(graphToken && graphToken.expiresAt > now.getTime());
  const graphCard = (
    <GraphCard
      configured={settings.graphClientId.trim().length > 0}
      connected={graphConnected}
      account={graphAccount}
      items={graphItems}
      errors={graphErrors}
      fetchedAt={graphFetchedAt}
      busy={graphBusy}
      onConnect={() => void connectGraph(settings.graphClientId)}
      onDisconnect={disconnectGraph}
      onCheck={() => void checkGraph()}
      onCreateTask={(item) => void createTaskFromHighlight(item)}
      onDismiss={dismissHighlight}
      onOpenSettings={() => setPage('settings')}
    />
  );

  const notificationCenter = (
    <NotificationCenter
      notifications={notifications}
      permission={notificationPermission}
      alertsEnabled={settings.notificationsEnabled}
      onOpenTask={handleOpenNotificationTask}
      onSnooze={(taskId) => void snoozeTask(taskId)}
      onDismiss={handleDismissNotification}
      onMarkAllRead={handleMarkAllRead}
      onClearAll={handleClearNotifications}
      onRequestPermission={() => void handleRequestNotifications()}
      onSendTest={() => void handleSendTestNotification()}
      onOpenSettings={() => setPage('settings')}
    />
  );

  const renderPage = () => {
    switch (page) {
      case 'today':
        return (
          <TodayPage
            {...common}
            graphCard={graphCard}
            meetings={meetings}
            reminders={activeReminders}
            notificationsPermission={notificationPermission}
            onRequestNotifications={() => void handleRequestNotifications()}
            onSnoozeReminder={(taskId) => void snoozeTask(taskId)}
            onDismissReminder={(taskId) => void dismissReminder(taskId)}
            onStartTask={(taskId) => void startTask(taskId)}
            onResumeTask={(taskId) => void resumeTask(taskId)}
            onCompleteReminder={(taskId) => void toggleComplete(taskId)}
            onDeferTodayToTomorrow={() => void deferTodayToTomorrow()}
            draftSeed={quickSeed}
            onDraftSeedConsumed={consumeQuickSeed}
          />
        );
      case 'tasks':
        return (
          <MyTasksPage
            {...common}
            onOpenImport={() => setImportOpen(true)}
            onApplyPlan={applyPlan}
            onFetchClientMail={handleFetchClientMail}
          />
        );
      case 'completed':
        return <CompletedPage {...common} />;
      case 'reports':
        return (
          <ReportsPage
            {...common}
            initialView={reportsView}
            onExportCsv={handleExportCsv}
            onSaveCompletionNote={saveCompletionNote}
            onSaveTaskNote={saveTaskNote}
            onComplete={(id) => void toggleComplete(id)}
          />
        );
      case 'settings':
        return (
          <SettingsPage
            {...common}
            onSaveSettings={(next) => void updateSettings(next)}
            onThemeChange={applyTheme}
            onExportBackup={() => void handleExportBackup()}
            onImportBackup={(file) => void handleImportBackup(file)}
            onExportCsv={handleExportCsv}
            onExportIcs={handleExportIcs}
            onResetData={handleResetData}
            onAddCategory={addCategory}
            onRenameCategory={renameCategory}
            onDeleteCategory={deleteCategory}
            graph={{
              connected: graphConnected,
              account: graphAccount,
              errors: graphErrors,
              busy: graphBusy,
              onConnect: (clientId) => void connectGraph(clientId),
              onDisconnect: disconnectGraph,
              onCheck: () => void checkGraph(),
            }}
            notificationsPermission={notificationPermission}
            onRequestNotifications={handleRequestNotifications}
            onSendTestNotification={() => void handleSendTestNotification()}
            account={account}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="app-shell"
      data-sidebar={wideSidebar ? (sidebarCollapsed ? 'rail' : 'full') : 'responsive'}
      style={wideSidebar ? ({ '--sidebar-width': sidebarCollapsed ? '78px' : '264px' } as CSSProperties) : undefined}
    >
      <ScrollProgress value={scrolled} />
      <Sidebar
        page={page}
        settings={settings}
        counts={counts}
        online={online}
        onNavigate={navigate}
        collapsed={wideSidebar ? sidebarCollapsed : !drawerOpen}
        open={drawerOpen}
        onToggle={toggleSidebar}
      />
      {/* Always mounted, so it fades both ways instead of blinking out. CSS
          removes it above the tablet breakpoint, where there is no drawer. */}
      <div
        className={`sidebar-scrim ${drawerOpen ? 'is-open' : ''}`.trim()}
        role="presentation"
        aria-hidden={!drawerOpen}
        onMouseDown={() => setNavOpen(false)}
      />
      <div className="app-main">
        <MobileTopBar
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={() => setPage('settings')}
          notifications={notificationCenter}
        />
        <div className={`utility-bar ${scrolled > 4 ? 'is-scrolled' : ''}`.trim()}>
          <button type="button" className="utility-search" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
            <span>Search pages, tasks and actions…</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="utility-actions">
            <button
              type="button"
              className="utility-import"
              onClick={() => setImportOpen(true)}
              title="Import tasks from a screenshot"
            >
              <ScanText size={15} aria-hidden="true" />
              <span>Import</span>
            </button>
            {notificationCenter}
            <LiveClock />
            <span className={`status-pill ${online ? 'online' : 'offline'}`}>
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              {online ? 'Online' : 'Offline'}
            </span>
            <span
              className={`sync-chip ${account.cloudConnected ? 'is-live' : ''} ${account.busy ? 'is-busy' : ''}`.trim()}
              title={
                account.cloudConnected
                  ? 'Changes reach your other devices in a few seconds'
                  : 'Everything is stored in this browser only'
              }
            >
              <span className="sync-dot" aria-hidden="true" />
              {account.busy
                ? 'Syncing…'
                : account.account
                  ? account.cloudConnected
                    ? `Live · @${account.account.id}`
                    : `Local-only · @${account.account.id}`
                  : 'Local-only · No account'}
            </span>
            <button
              type="button"
              className="icon-btn shortcut-hint-btn"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              onClick={() => setShortcutsOpen(true)}
            >
              <Keyboard size={18} />
            </button>
            <button
              type="button"
              className="icon-btn theme-toggle"
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={toggleTheme}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setFormState({ open: true, task: null, initialDraft: null })}
            >
              New task
            </Button>
          </div>
        </div>
        <main className="page-container">{renderPage()}</main>
      </div>
      <BottomNav
        page={page}
        onNavigate={navigate}
        onAddTask={() => setFormState({ open: true, task: null, initialDraft: null })}
      />
      <BackToTop visible={!atTop} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <CommandPalette
        open={paletteOpen}
        tasks={tasks}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
        onNewTask={() => setFormState({ open: true, task: null, initialDraft: null })}
        onOpenTask={(id) => setPanelId(id)}
        onCheckGraph={graphConnected ? () => void checkGraph() : null}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onAsk={handleAsk}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import from a screenshot"
        subtitle="Everything stays in this browser — the image is never uploaded."
        size="lg"
      >
        <div className="import-embed">
          <ImportPage
            {...common}
            onImportDrafts={(drafts, meta) => {
              importDrafts(drafts, meta);
              setImportOpen(false);
            }}
          />
        </div>
      </Modal>
      <TaskPanel
        task={panelTask}
        tasks={tasks}
        settings={settings}
        now={now}
        elapsedMs={panelTask ? timer.elapsedMsFor(panelTask.id) : 0}
        isRunning={panelTask ? timer.isRunning(panelTask.id) : false}
        isPaused={panelTask ? timer.hasPausedSession(panelTask.id) : false}
        learned={learned}
        onClose={() => setPanelId(null)}
        onEdit={() => {
          if (!panelTask) return;
          const task = panelTask;
          setPanelId(null);
          setFormState({ open: true, task, initialDraft: null });
        }}
        onStart={() => panelTask && void startTask(panelTask.id)}
        onPause={() => void pauseTimer()}
        onResume={() => panelTask && void resumeTask(panelTask.id)}
        onFinish={() => void finishTimer()}
        onToggleComplete={() => panelTask && void toggleComplete(panelTask.id)}
        onSaveNote={(note) => panelTask && saveTaskNote(panelTask.id, note)}
        onSaveCompletionNote={(note) => panelTask && saveCompletionNote(panelTask.id, note)}
        onApplySuggestion={(input) => panelTask && void applySuggestion(panelTask.id, input)}
        onOpenTask={(id) => setPanelId(id)}
        onAttachmentsChange={() => accountRef.current?.schedulePush()}
      />
      <TaskForm
        open={formState.open}
        task={formState.task}
        settings={settings}
        tasks={tasks}
        initialDraft={formState.initialDraft}
        /* A new task lands on today by default: a task with no deadline has
           nothing for a reminder to hang on, and "nothing was ever notified
           about it" is exactly the complaint this had to fix. */
        defaultDueDate={todayISO()}
        onClose={() => setFormState({ open: false, task: null, initialDraft: null })}
        onSubmit={handleFormSubmit}
        onAddCategory={addCategory}
      />
      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel={confirmState?.confirmLabel ?? 'Confirm'}
        tone={confirmState?.tone ?? 'danger'}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => confirmState?.onConfirm()}
      />
      <CompletionDialog
        key={completeTask?.id ?? 'closed'}
        task={completeTask}
        onCancel={() => setCompleteId(null)}
        onComplete={(note) => {
          if (completeTask) void confirmComplete(completeTask.id, note);
        }}
      />
      <StickerPop moment={stickerMoment} onDone={() => setStickerMoment(null)} />
      {confettiKey > 0 ? <Confetti key={confettiKey} /> : null}
    </div>
  );
}

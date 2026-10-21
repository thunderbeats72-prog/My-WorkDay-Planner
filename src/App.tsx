import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { PageId, ReminderRecord, Settings, Task } from './lib/types';
import { DEFAULT_SETTINGS } from './lib/types';
import {
  combineDateTime,
  daysFromNow,
  dueLabel,
  formatDateLong,
  formatDuration,
  formatSecondsLabel,
  isQuietNow,
  relativeDayLabel,
  todayISO,
} from './lib/dates';
import {
  clearAllData,
  createBackupPayload,
  listAllEvents,
  listReminders,
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
import { applyPlanToTasks, buildReminders } from './lib/engine';
import type { DayPlan, ParsedDraft, ReminderItem } from './lib/engine';
import {
  beginGraphSignIn,
  cleanGraphRedirectUrl,
  clearGraphToken,
  completeGraphSignIn,
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
import {
  useMediaQuery,
  useNotificationPermission,
  useNow,
  useOnline,
  useScrollPosition,
} from './hooks/useEnvironment';
import { Sidebar, MobileTopBar, BottomNav, ScrollProgress, BackToTop, LiveClock } from './components/Shell';
import type { NavCounts } from './components/Shell';
import { Button, ConfirmDialog, Confetti, SkeletonScreen, ToastStack } from './components/ui';
import type { ToastItem, ToastTone } from './components/ui';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { TodayPage } from './components/TodayPage';
import { InboxPage } from './components/InboxPage';
import { OverduePage } from './components/OverduePage';
import { CompletedPage } from './components/CompletedPage';
import { SchedulePage } from './components/SchedulePage';
import { ReportsPage } from './components/ReportsPage';
import { ImportPage } from './components/ImportPage';
import { SettingsPage } from './components/SettingsPage';
import { TaskPanel } from './components/TaskPanel';
import { TaskForm } from './components/TaskForm';
import type { TaskDraft } from './components/TaskForm';
import { GraphCard } from './components/GraphCard';
import { Onboarding } from './components/Onboarding';
import type { QuickAddDraft } from './lib/quickAdd';
import type { CommonPageProps } from './components/pageProps';
import type { TaskCardHandlers } from './components/TaskCard';
import { Keyboard, Search, Plus, Wifi, WifiOff, Moon, Sun } from 'lucide-react';

const PAGE_IDS: PageId[] = ['today', 'inbox', 'schedule', 'overdue', 'completed', 'reports', 'import', 'settings'];
const SIDEBAR_STORAGE_KEY = 'workday.sidebar';

function pageFromHash(): PageId {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return PAGE_IDS.includes(raw as PageId) ? (raw as PageId) : 'today';
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
  const [panelId, setPanelId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>({ open: false, task: null, initialDraft: null });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confettiKey, setConfettiKey] = useState(0);
  const [graphToken, setGraphToken] = useState<GraphToken | null>(() => loadGraphToken());
  const [graphItems, setGraphItems] = useState<GraphHighlight[]>(() => loadGraphCache()?.items ?? []);
  const [graphFetchedAt, setGraphFetchedAt] = useState<string | null>(() => loadGraphCache()?.fetchedAt ?? null);
  const [graphAccount, setGraphAccount] = useState<GraphAccount | null>(null);
  const [graphErrors, setGraphErrors] = useState<string[]>([]);
  const [graphBusy, setGraphBusy] = useState(false);
  const graphRedirectHandled = useRef(false);
  const [notificationPermission, requestNotificationPermission] = useNotificationPermission();

  useAmbientEffects(!loading);

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

  const isDark = settings.theme === 'system' ? prefersDark : settings.theme === 'dark';

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = isDark ? 'dark' : 'light';
    root.style.colorScheme = isDark ? 'dark' : 'light';
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', isDark ? '#0b1220' : '#17243B');
    root.classList.add('theme-fade');
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
    if (changed && changed.length > 0) void saveTasks(changed);
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

  const toggleTheme = useCallback(() => {
    const next: Settings = { ...settingsRef.current, theme: isDark ? 'light' : 'dark' };
    settingsRef.current = next;
    setSettings(next);
    void saveSettings(next);
  }, [isDark]);

  const updateSettings = useCallback(async (next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
    await saveSettings(next);
  }, []);

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

  const toggleComplete = useCallback(
    async (id: string) => {
      const task = tasksRef.current.find((candidate) => candidate.id === id);
      if (!task) return;
      if (task.status === 'completed') {
        await reopenTask(id);
        return;
      }
      if (timer.isRunning(id)) {
        await timer.finish();
      }
      const latest = tasksRef.current.find((candidate) => candidate.id === id) ?? task;
      const updated: Task = {
        ...latest,
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persistTasks(
        tasksRef.current.map((candidate) => (candidate.id === id ? updated : candidate)),
        [updated],
      );
      await logEvent(id, 'status', 'Task completed');
      if (!prefersReducedMotion()) setConfettiKey((current) => current + 1);
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
    (drafts: ParsedDraft[]) => {
      const created = drafts.map((draft) =>
        buildTask(
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
          { source: 'ocr', status: 'inbox' },
        ),
      );
      persistTasks([...tasksRef.current, ...created], created);
      for (const task of created) {
        void logEvent(task.id, 'created', `Created from reviewed screenshot text (${task.source})`);
      }
      setPage('inbox');
      addToast(
        `${created.length} screenshot task${created.length === 1 ? '' : 's'} saved to Inbox after review.`,
        'success',
      );
    },
    [addToast, buildTask, persistTasks],
  );

  const handleExportBackup = useCallback(async () => {
    const events = await listAllEvents();
    const payload = createBackupPayload(
      settingsRef.current,
      tasksRef.current,
      timer.sessions,
      remindersRef.current,
      events,
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
        const result = await fetchGraphHighlights(token);
        setGraphItems(result.items);
        setGraphErrors(result.errors);
        setGraphAccount(result.account);
        setGraphFetchedAt(result.fetchedAt);
        saveGraphCache({ fetchedAt: result.fetchedAt, items: result.items });
        if (result.errors.some((message) => message.includes('401'))) {
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
      addToast('Browser notifications enabled — best-effort while the browser is open.', 'success');
    } else if (permission === 'denied') {
      addToast('Browser permission was denied. In-app reminders still work.', 'warning');
    }
    return permission;
  }, [addToast, requestNotificationPermission, updateSettings]);

  const handleOnboarding = useCallback(
    async (next: Settings) => {
      const completed = { ...next, onboardingComplete: true };
      await updateSettings(completed);
      addToast('Setup complete — welcome to your workday.', 'success');
    },
    [addToast, updateSettings],
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

  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!settings.notificationsEnabled || notificationPermission !== 'granted') return;
    if (isQuietNow(settings, now)) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    for (const reminder of activeReminders.slice(0, 3)) {
      const key = `${reminder.task.id}|${reminder.task.dueDate}|${reminder.task.dueTime}`;
      if (notifiedRef.current.has(key)) continue;
      notifiedRef.current.add(key);
      try {
        new Notification('Workday reminder', {
          body: `${reminder.task.title} — ${dueLabel(reminder.task, now)}`,
          tag: key,
        });
      } catch {
        // Notification failures are non-fatal; in-app reminders remain.
      }
    }
  }, [activeReminders, settings, notificationPermission, now]);

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
        setPage('inbox');
      } else if (event.key === 'c' || event.key === 'C') {
        setPage('schedule');
      } else if (event.key === 'r' || event.key === 'R') {
        setPage('reports');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const panelTask = panelId ? tasks.find((task) => task.id === panelId) ?? null : null;

  const counts: NavCounts = useMemo(() => {
    const open = tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null);
    const today = todayISO(now);
    return {
      inbox: open.length,
      overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today).length,
      today: open.filter((task) => task.dueDate === today).length,
      completed: tasks.filter((task) => task.status === 'completed' && task.deletedAt === null).length,
      reports: 0,
    };
  }, [tasks, now]);

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

  if (loading) {
    return (
      <div className="app-shell loading-shell">
        <SkeletonScreen />
      </div>
    );
  }

  if (!settings.onboardingComplete) {
    return <Onboarding onComplete={(next) => void handleOnboarding(next)} />;
  }

  const common: CommonPageProps = {
    tasks,
    settings,
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

  const renderPage = () => {
    switch (page) {
      case 'today':
        return (
          <TodayPage
            {...common}
            graphCard={graphCard}
            reminders={activeReminders}
            notificationsPermission={notificationPermission}
            onRequestNotifications={() => void handleRequestNotifications()}
            onSnoozeReminder={(taskId) => void snoozeTask(taskId)}
            onDismissReminder={(taskId) => void dismissReminder(taskId)}
            onStartTask={(taskId) => void startTask(taskId)}
            onResumeTask={(taskId) => void resumeTask(taskId)}
            onCompleteReminder={(taskId) => void toggleComplete(taskId)}
            onDeferTodayToTomorrow={() => void deferTodayToTomorrow()}
          />
        );
      case 'inbox':
        return <InboxPage {...common} />;
      case 'overdue':
        return <OverduePage {...common} />;
      case 'completed':
        return <CompletedPage {...common} />;
      case 'schedule':
        return <SchedulePage {...common} onApplyPlan={applyPlan} />;
      case 'reports':
        return <ReportsPage {...common} onExportCsv={handleExportCsv} />;
      case 'import':
        return <ImportPage {...common} onImportDrafts={importDrafts} />;
      case 'settings':
        return (
          <SettingsPage
            {...common}
            onSaveSettings={(next) => void updateSettings(next)}
            onExportBackup={() => void handleExportBackup()}
            onImportBackup={(file) => void handleImportBackup(file)}
            onExportCsv={handleExportCsv}
            onResetData={handleResetData}
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
      {drawerOpen ? (
        <div className="sidebar-scrim" role="presentation" onMouseDown={() => setNavOpen(false)} />
      ) : null}
      <div className="app-main">
        <MobileTopBar
          isDark={isDark}
          online={online}
          onToggleTheme={toggleTheme}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenNav={() => setNavOpen((current) => !current)}
          navOpen={navOpen}
        />
        <div className={`utility-bar ${scrolled > 4 ? 'is-scrolled' : ''}`.trim()}>
          <button type="button" className="utility-search" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
            <span>Search pages, tasks and actions…</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="utility-actions">
            <LiveClock />
            <span className={`status-pill ${online ? 'online' : 'offline'}`}>
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              {online ? 'Online' : 'Offline'}
            </span>
            <span className="sync-chip">Local-only · Sync not configured</span>
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
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <TaskPanel
        task={panelTask}
        tasks={tasks}
        settings={settings}
        now={now}
        elapsedMs={panelTask ? timer.elapsedMsFor(panelTask.id) : 0}
        isRunning={panelTask ? timer.isRunning(panelTask.id) : false}
        isPaused={panelTask ? timer.hasPausedSession(panelTask.id) : false}
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
        onApplySuggestion={(input) => panelTask && void applySuggestion(panelTask.id, input)}
        onOpenTask={(id) => setPanelId(id)}
      />
      <TaskForm
        open={formState.open}
        task={formState.task}
        settings={settings}
        tasks={tasks}
        initialDraft={formState.initialDraft}
        onClose={() => setFormState({ open: false, task: null, initialDraft: null })}
        onSubmit={handleFormSubmit}
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
      {confettiKey > 0 ? <Confetti key={confettiKey} /> : null}
    </div>
  );
}

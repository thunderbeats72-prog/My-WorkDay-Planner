export type Priority = 'critical' | 'high' | 'medium' | 'low';

export type Category =
  | 'follow_up'
  | 'proposal'
  | 'meeting'
  | 'email'
  | 'report'
  | 'research'
  | 'admin'
  | 'other';

export type TaskStatus = 'inbox' | 'todo' | 'in_progress' | 'completed';

export type TaskSource = 'manual' | 'ocr' | 'graph';

export type SessionState = 'running' | 'paused' | 'completed';

export type ReminderStatus = 'queued' | 'done' | 'dismissed';

export type Theme = 'light' | 'dark' | 'system';

export type PageId = 'today' | 'tasks' | 'completed' | 'reports' | 'settings';

export interface GraphRef {
  kind: 'mail' | 'chat';
  id: string;
  webUrl: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  client: string;
  category: Category;
  priority: Priority;
  estimatedMinutes: number;
  actualMinutes: number;
  dueDate: string | null;
  dueTime: string;
  scheduledFor: string | null;
  suggestedDate: string | null;
  suggestedStart: string | null;
  status: TaskStatus;
  blocked: boolean;
  dependencyIds: string[];
  deferrals: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  source: TaskSource;
  graphRef: GraphRef | null;
}

export interface TimeSession {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  state: SessionState;
  lastHeartbeatAt: string | null;
  note: string;
}

export interface ReminderRecord {
  id: string;
  taskId: string;
  dueAt: string;
  status: ReminderStatus;
  snoozedUntil: string | null;
  createdAt: string;
}

export type TaskEventType =
  | 'created'
  | 'updated'
  | 'status'
  | 'timer'
  | 'deferral'
  | 'dependency'
  | 'reminder'
  | 'restored';

export interface TaskEvent {
  id: string;
  taskId: string;
  at: string;
  type: TaskEventType;
  detail: string;
}

export interface Settings {
  id: 'app';
  name: string;
  role: string;
  company: string;
  workdayStart: string;
  workdayEnd: string;
  lunchStart: string;
  lunchEnd: string;
  workingDays: number[];
  focusBlockMinutes: number;
  bufferMinutes: number;
  defaultPriority: Priority;
  defaultEstimateMinutes: number;
  reminderLeadMinutes: number;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  notificationsEnabled: boolean;
  theme: Theme;
  /** Blur client names and titles when the tab hides or nobody is typing. */
  privacyBlur: boolean;
  graphClientId: string;
  onboardingComplete: boolean;
  lastBackupAt: string;
}

export interface ScheduleBlock {
  id: string;
  taskId: string | null;
  title: string;
  start: number;
  end: number;
  kind: 'focus' | 'break' | 'buffer';
  learned?: boolean;
}

export interface PriorityMeta {
  label: string;
  weight: number;
  tone: string;
}

export const PRIORITIES: Record<Priority, PriorityMeta> = {
  critical: { label: 'Critical', weight: 40, tone: 'critical' },
  high: { label: 'High', weight: 30, tone: 'high' },
  medium: { label: 'Medium', weight: 20, tone: 'medium' },
  low: { label: 'Low', weight: 10, tone: 'low' },
};

export const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];

export interface CategoryMeta {
  label: string;
  tone: string;
}

export const CATEGORIES: Record<Category, CategoryMeta> = {
  follow_up: { label: 'Follow-up', tone: 'c1' },
  proposal: { label: 'Proposal', tone: 'c2' },
  meeting: { label: 'Meeting', tone: 'c3' },
  email: { label: 'Email', tone: 'c4' },
  report: { label: 'Report', tone: 'c5' },
  research: { label: 'Research', tone: 'c6' },
  admin: { label: 'Admin', tone: 'c7' },
  other: { label: 'Other', tone: 'c8' },
};

export const CATEGORY_ORDER: Category[] = [
  'follow_up',
  'proposal',
  'meeting',
  'email',
  'report',
  'research',
  'admin',
  'other',
];

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  name: '',
  role: 'Business Development Executive',
  company: '',
  workdayStart: '09:00',
  workdayEnd: '18:00',
  lunchStart: '13:00',
  lunchEnd: '13:45',
  workingDays: [1, 2, 3, 4, 5],
  focusBlockMinutes: 50,
  bufferMinutes: 10,
  defaultPriority: 'medium',
  defaultEstimateMinutes: 30,
  reminderLeadMinutes: 60,
  quietHoursEnabled: true,
  quietStart: '20:00',
  quietEnd: '08:00',
  notificationsEnabled: false,
  theme: 'light',
  privacyBlur: true,
  graphClientId: '',
  onboardingComplete: false,
  lastBackupAt: '',
};

export function isOpenTask(task: Task): boolean {
  return task.status !== 'completed' && task.deletedAt === null;
}

export function isCompletedTask(task: Task): boolean {
  return task.status === 'completed' && task.deletedAt === null;
}

export function isEmptyDraft(text: string): boolean {
  return text.trim().length === 0;
}

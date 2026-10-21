import type { PageId, Priority, Settings, Task } from '../lib/types';
import type { TimerApi } from '../hooks/useTimer';
import type { TaskCardHandlers } from './TaskCard';
import type { ToastTone } from './ui';

export interface AddToast {
  (message: string, tone?: ToastTone, action?: { label: string; onAction: () => void }): void;
}

export interface CommonPageProps {
  tasks: Task[];
  settings: Settings;
  now: Date;
  timer: TimerApi;
  taskHandlers: (task: Task) => TaskCardHandlers;
  onOpenPage: (page: PageId) => void;
  onQuickAdd: (title: string, priority: Priority) => void;
  onNewTask: () => void;
  onEditTask: (task: Task) => void;
  addToast: AddToast;
  online: boolean;
}

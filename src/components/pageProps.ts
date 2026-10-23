import type { PageId, Settings, Task } from '../lib/types';
import type { QuickAddDraft } from '../lib/quickAdd';
import type { TimerApi } from '../hooks/useTimer';
import type { GraphHighlight } from '../lib/graph';
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
  onQuickAdd: (draft: QuickAddDraft) => void;
  onNewTask: () => void;
  onEditTask: (task: Task) => void;
  addToast: AddToast;
  online: boolean;
  /** Cached Microsoft Graph highlights (mail + chat) for client briefs. */
  graphHighlights: GraphHighlight[];
}

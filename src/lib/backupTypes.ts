import type { ReminderRecord, SavedReport, Settings, Task, TaskEvent, TimeSession } from './types';

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  settings: Settings;
  tasks: Task[];
  timeSessions: TimeSession[];
  reminderRecords: ReminderRecord[];
  taskEvents: TaskEvent[];
  /** Optional: files written before daily updates existed simply lack it. */
  reports?: SavedReport[];
}

/**
 * Client radar (#11) — one glance per client: what's open, what's at stake,
 * and the mail that mentions them. Pure grouping: no fetching, no guessing,
 * just the `client` field on tasks plus whatever highlights the caller already
 * has cached from Microsoft Graph.
 */

import { dayOffset } from './dates';
import type { GraphHighlight } from './graph';
import type { Priority, Task } from './types';

export interface ClientBrief {
  client: string;
  openCount: number;
  overdue: number;
  /** Due today or within the next three days. */
  dueSoon: number;
  nextDueDate: string | null;
  estimatedMinutes: number;
  /** Distinct priorities present, most urgent first. */
  priorities: Priority[];
  /** This client's open tasks, urgency-ordered. */
  tasks: Task[];
  /** Newest cached mail/chat mentions of the client, capped at three. */
  mentions: GraphHighlight[];
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function mentionMatches(mention: GraphHighlight, client: string): boolean {
  const needle = client.toLowerCase();
  return (
    mention.title.toLowerCase().includes(needle) ||
    mention.from.toLowerCase().includes(needle) ||
    mention.preview.toLowerCase().includes(needle)
  );
}

export function buildClientRadar(
  tasks: Task[],
  now: Date,
  mentions: GraphHighlight[] = [],
): ClientBrief[] {
  const byClient = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.deletedAt !== null || task.status === 'completed') continue;
    const client = task.client.trim();
    if (!client) continue;
    const bucket = byClient.get(client) ?? [];
    bucket.push(task);
    byClient.set(client, bucket);
  }

  const briefs: ClientBrief[] = [];
  for (const [client, clientTasks] of byClient) {
    const sorted = [...clientTasks].sort((a, b) => {
      const aDue = a.dueDate ?? '9999-12-31';
      const bDue = b.dueDate ?? '9999-12-31';
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
    const dated = sorted.filter((task) => task.dueDate !== null) as Task[];
    const priorities = [...new Set(sorted.map((task) => task.priority))].sort(
      (a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b],
    );
    briefs.push({
      client,
      openCount: sorted.length,
      overdue: sorted.filter((task) => task.dueDate !== null && dayOffset(task.dueDate as string, now) < 0).length,
      dueSoon: sorted.filter((task) => {
        if (task.dueDate === null) return false;
        const offset = dayOffset(task.dueDate, now);
        return offset >= 0 && offset <= 3;
      }).length,
      nextDueDate: dated.length > 0 ? dated[0].dueDate : null,
      estimatedMinutes: sorted.reduce((sum, task) => sum + task.estimatedMinutes, 0),
      priorities,
      tasks: sorted,
      mentions: mentions
        .filter((mention) => mentionMatches(mention, client))
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(0, 3),
    });
  }

  return briefs.sort((a, b) => {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue;
    if (b.dueSoon !== a.dueSoon) return b.dueSoon - a.dueSoon;
    const aNext = a.nextDueDate ?? '9999-12-31';
    const bNext = b.nextDueDate ?? '9999-12-31';
    if (aNext !== bNext) return aNext.localeCompare(bNext);
    if (b.openCount !== a.openCount) return b.openCount - a.openCount;
    return a.client.localeCompare(b.client);
  });
}

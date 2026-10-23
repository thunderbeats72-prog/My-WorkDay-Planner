/**
 * Follow-up cadence (#12) — rule-based, on-device, fully explainable.
 *
 * Two rules, exactly as agreed:
 *   • quiet follow-up: a follow-up/email task with no movement for 3 days → nudge
 *   • silent proposal: a proposal task quiet for 7 days → escalate
 *
 * "No reply" is checked against whatever mail the app has actually cached from
 * Microsoft Graph: if the client wrote anything after the task last moved, the
 * rule stays quiet instead of nagging. Nothing here talks to a server or a
 * model — read the dates, apply the rule, show your work.
 */

import { formatDateShort } from './dates';
import type { GraphHighlight } from './graph';
import type { Task } from './types';

export const NUDGE_AFTER_DAYS = 3;
export const ESCALATE_AFTER_DAYS = 7;

export interface CadenceAction {
  task: Task;
  level: 'nudge' | 'escalate';
  ruleId: 'quiet-follow-up' | 'silent-proposal';
  /** Days since the task last moved (the number that tripped the rule). */
  days: number;
  /** The full, human-readable justification — rule, dates, and all. */
  reason: string;
}

/** Newest cached inbound mail per client (matched by name in from/subject/preview). */
export function repliesFromHighlights(
  highlights: GraphHighlight[],
  clients: string[],
): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const client of clients) {
    const needle = client.toLowerCase();
    for (const highlight of highlights) {
      if (highlight.kind !== 'mail') continue;
      const mentions =
        highlight.from.toLowerCase().includes(needle) ||
        highlight.title.toLowerCase().includes(needle) ||
        highlight.preview.toLowerCase().includes(needle);
      if (!mentions) continue;
      const at = new Date(highlight.receivedAt);
      if (Number.isNaN(at.getTime())) continue;
      const current = latest.get(client);
      if (!current || at > current) latest.set(client, at);
    }
  }
  return latest;
}

const NUDGE_CATEGORIES = new Set(['follow_up', 'email']);

function daysSince(anchorISO: string, now: Date): number {
  const anchor = new Date(anchorISO);
  if (Number.isNaN(anchor.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / 86_400_000));
}

export function followUpCadence(input: {
  tasks: Task[];
  now: Date;
  /** Optional reply index — see repliesFromHighlights. */
  replies?: Map<string, Date>;
}): CadenceAction[] {
  const { now, replies } = input;
  const actions: CadenceAction[] = [];

  for (const task of input.tasks) {
    if (task.deletedAt !== null || task.status === 'completed') continue;
    const anchorISO = task.updatedAt || task.createdAt;
    const days = daysSince(anchorISO, now);
    if (days <= 0) continue;

    const isProposal = task.category === 'proposal';
    const isNudgeable = NUDGE_CATEGORIES.has(task.category);
    if (!isProposal && !isNudgeable) continue;

    // Reply check: if the client wrote after the task last moved, stay quiet.
    const client = task.client.trim();
    const reply = client && replies ? replies.get(client) : undefined;
    if (reply && reply.getTime() > new Date(anchorISO).getTime()) continue;

    const anchorLabel = formatDateShort(anchorISO.slice(0, 10));
    if (isProposal && days >= ESCALATE_AFTER_DAYS) {
      actions.push({
        task,
        level: 'escalate',
        ruleId: 'silent-proposal',
        days,
        reason: `Proposal quiet for ${days} days (last movement ${anchorLabel})${
          client ? ` and no reply from ${client} in your cached mail` : ''
        }. Rule: proposals escalate after ${ESCALATE_AFTER_DAYS} quiet days — ask for a decision or park it.`,
      });
    } else if (isNudgeable && days >= NUDGE_AFTER_DAYS) {
      actions.push({
        task,
        level: 'nudge',
        ruleId: 'quiet-follow-up',
        days,
        reason: `No movement for ${days} days (since ${anchorLabel})${
          client ? ` and no reply from ${client} in your cached mail` : ''
        }. Rule: follow-ups nudge after ${NUDGE_AFTER_DAYS} quiet days.`,
      });
    }
  }

  return actions.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'escalate' ? -1 : 1;
    if (b.days !== a.days) return b.days - a.days;
    return a.task.title.localeCompare(b.task.title);
  });
}

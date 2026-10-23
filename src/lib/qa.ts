/**
 * Local assistant Q&A (#13) — BM25 retrieval + templated, cited answers over
 * your own planner data. Everything runs in this browser: no cloud AI, no
 * network, no invented facts. Two halves:
 *
 *   1. Templated intents compute aggregates (overdue, due today, worked time,
 *      next task, per-task durations, client summaries) and cite the exact
 *      records they came from.
 *   2. BM25 ranks task documents for name-shaped questions, and the fallback
 *      either lists the closest real matches or says plainly that nothing
 *      matched — confidence is always labelled ('exact' vs 'closest' vs
 *      'none') so the UI never dresses a guess as an answer.
 */

import { dayOffset, formatDuration, relativeDayLabel, toISODate } from './dates';
import { scoreTask } from './engine';
import type { Settings, Task, TimeSession } from './types';

const STOPWORDS = new Set([
  'a', 'about', 'am', 'an', 'and', 'any', 'are', 'at', 'be', 'been', 'but', 'by', 'can', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'mine', 'much', 'my', 'of', 'on',
  'or', 'our', 'should', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'to', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@#'._-]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export interface QaDoc {
  id: string;
  taskId: string;
  title: string;
  text: string;
}

export function buildQaDocs(tasks: Task[]): QaDoc[] {
  return tasks
    .filter((task) => task.deletedAt === null)
    .map((task) => ({
      id: `task:${task.id}`,
      taskId: task.id,
      title: task.title,
      text: `${task.title} ${task.notes} ${task.client} ${task.category} ${task.status}`.trim(),
    }));
}

export interface QaHit {
  doc: QaDoc;
  score: number;
}

/** Classic BM25 (k1 = 1.2, b = 0.75) over the task documents. */
export function bm25Search(query: string, docs: QaDoc[], k = 3): QaHit[] {
  const terms = tokenize(query);
  if (terms.length === 0 || docs.length === 0) return [];
  const k1 = 1.2;
  const b = 0.75;
  const avgLength = docs.reduce((sum, doc) => sum + tokenize(doc.text).length, 0) / docs.length || 1;
  const docTerms = docs.map((doc) => tokenize(doc.text));

  const hits: QaHit[] = [];
  docs.forEach((doc, index) => {
    const termsInDoc = docTerms[index];
    const termFreq = new Map<string, number>();
    for (const term of termsInDoc) termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const tf = termFreq.get(term);
      if (!tf) continue;
      const df = docs.filter((_candidate, candidateIndex) => docTerms[candidateIndex].includes(term)).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * termsInDoc.length) / avgLength)));
    }
    if (score > 0) hits.push({ doc, score });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}

export interface QaCitation {
  label: string;
  taskId?: string;
}

export interface QaAnswer {
  text: string;
  /** 'exact' = computed from records; 'closest' = retrieval only; 'none' = honest miss. */
  confidence: 'exact' | 'closest' | 'none';
  citations: QaCitation[];
}

export interface AskInput {
  question: string;
  tasks: Task[];
  sessions: TimeSession[];
  now: Date;
  settings: Settings;
}

const UNKNOWN = (question: string): QaAnswer => ({
  text: `I couldn't find “${question.slice(0, 60)}” in your tasks, sessions or clients. I only answer from data already on this device — try a task name, a client, “overdue”, “due today”, “what's next”, or “how much did I work this week”.`,
  confidence: 'none',
  citations: [],
});

function cite(task: Task): QaCitation {
  return { label: task.title, taskId: task.id };
}

function formatList(tasks: Task[], max = 3): string {
  const titles = tasks.slice(0, max).map((task) => `“${task.title}”`);
  const rest = tasks.length - titles.length;
  return rest > 0 ? `${titles.join(', ')} +${rest} more` : titles.join(', ');
}

export function answerQuestion(input: AskInput): QaAnswer {
  const question = input.question.trim();
  if (question.length < 3) return UNKNOWN(question);
  const q = question.toLowerCase();
  const { tasks, sessions, now, settings } = input;
  const open = tasks.filter((task) => task.status !== 'completed' && task.deletedAt === null);

  // ---- Templated intents, most specific first ---------------------------

  if (q.includes('overdue')) {
    const overdue = open
      .filter((task) => task.dueDate !== null && dayOffset(task.dueDate, now) < 0)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    if (overdue.length === 0) {
      return { text: 'Nothing is overdue right now.', confidence: 'exact', citations: [] };
    }
    return {
      text: `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}: ${formatList(overdue)}.`,
      confidence: 'exact',
      citations: overdue.slice(0, 4).map(cite),
    };
  }

  if (q.includes('due today') || (q.includes('today') && q.includes('due'))) {
    const today = toISODate(now);
    const dueToday = open.filter((task) => task.dueDate === today);
    if (dueToday.length === 0) {
      return { text: 'Nothing is dated due today.', confidence: 'exact', citations: [] };
    }
    return {
      text: `${dueToday.length} task${dueToday.length === 1 ? '' : 's'} due today: ${formatList(dueToday)}.`,
      confidence: 'exact',
      citations: dueToday.slice(0, 4).map(cite),
    };
  }

  if (/\b(complet|finish)/.test(q)) {
    const today = toISODate(now);
    const weekAgo = now.getTime() - 7 * 86_400_000;
    const done = tasks.filter((task) => {
      if (task.status !== 'completed' || task.deletedAt !== null || !task.completedAt) return false;
      if (q.includes('today')) return task.completedAt.slice(0, 10) === today;
      if (q.includes('week')) return new Date(task.completedAt).getTime() >= weekAgo;
      return task.completedAt.slice(0, 10) === today;
    });
    const window = q.includes('week') ? 'this week' : 'today';
    if (done.length === 0) {
      return { text: `Nothing completed ${window} yet.`, confidence: 'exact', citations: [] };
    }
    return {
      text: `${done.length} completed ${window}, including ${formatList(done)}.`,
      confidence: 'exact',
      citations: done.slice(0, 4).map(cite),
    };
  }

  if (/(how much|total|how long).*(work|focus|track|time)|hours (this|did)/.test(q)) {
    const scopeToday = q.includes('today');
    const scopeWeek = q.includes('week');
    const dayKey = toISODate(now);
    let minutes = 0;
    for (const session of sessions) {
      if (session.state === 'running' || session.durationMs <= 0) continue;
      const started = new Date(session.startedAt);
      if (Number.isNaN(started.getTime())) continue;
      if (scopeToday && toISODate(started) !== dayKey) continue;
      if (scopeWeek && started.getTime() < now.getTime() - 7 * 86_400_000) continue;
      minutes += Math.round(session.durationMs / 60_000);
    }
    const window = scopeToday ? 'today' : scopeWeek ? 'this week' : 'in total';
    return {
      text:
        minutes > 0
          ? `You've tracked ${formatDuration(minutes)} ${window} across completed timer sessions.`
          : `No completed timer time tracked ${window} yet — only running sessions exist, and those don't count until they stop.`,
      confidence: 'exact',
      citations: [],
    };
  }

  if (/(what'?s next|what should i (do|work on|start)|next task|recommend|suggest)/.test(q)) {
    if (open.length === 0) {
      return { text: 'Nothing is open — the board is clear.', confidence: 'exact', citations: [] };
    }
    const ranked = open
      .map((task) => ({ task, scored: scoreTask(task, settings, now) }))
      .sort((a, b) => b.scored.score - a.scored.score);
    const top = ranked[0].task;
    const due = top.dueDate ? `, due ${relativeDayLabel(top.dueDate, now)}` : ', no deadline';
    return {
      text: `Start with “${top.title}” — ${top.priority} priority${due}. The scheduler scored it ${ranked[0].scored.score}/100 because: ${ranked[0].scored.reasons.join('; ')}.`,
      confidence: 'exact',
      citations: [cite(top)],
    };
  }

  if (/(how long|how much time|time spent|did it take|took)/.test(q)) {
    const hit = bm25Search(question, buildQaDocs(tasks), 1)[0];
    if (!hit) return UNKNOWN(question);
    const task = tasks.find((candidate) => candidate.id === hit.doc.taskId);
    if (!task) return UNKNOWN(question);
    const tracked = sessions
      .filter((session) => session.taskId === task.id && session.state !== 'running' && session.durationMs > 0)
      .reduce((sum, session) => sum + session.durationMs, 0);
    const minutes = Math.round(tracked / 60_000) || task.actualMinutes;
    if (minutes <= 0) {
      return {
        text: `“${task.title}” has no tracked time yet — estimate is ${formatDuration(task.estimatedMinutes)}.`,
        confidence: 'exact',
        citations: [cite(task)],
      };
    }
    return {
      text: `“${task.title}” took ${formatDuration(minutes)} of tracked time (estimate was ${formatDuration(task.estimatedMinutes)}).`,
      confidence: 'exact',
      citations: [cite(task)],
    };
  }

  if (/(when|due|deadline|status)/.test(q)) {
    const hit = bm25Search(question, buildQaDocs(tasks), 1)[0];
    if (!hit) return UNKNOWN(question);
    const task = tasks.find((candidate) => candidate.id === hit.doc.taskId);
    if (!task) return UNKNOWN(question);
    const due = task.dueDate ? `due ${relativeDayLabel(task.dueDate, now)}` : 'no due date set';
    const client = task.client ? `, client ${task.client}` : '';
    return {
      text: `“${task.title}” — ${due}, status ${task.status.replace('_', ' ')}, ${formatDuration(task.estimatedMinutes)} estimated${client}.`,
      confidence: 'exact',
      citations: [cite(task)],
    };
  }

  // Client summary: any client name mentioned in the question.
  const clients = [...new Set(open.map((task) => task.client.trim()).filter(Boolean))];
  const mentionedClient = clients.find((client) => q.includes(client.toLowerCase()));
  if (mentionedClient) {
    const mine = open.filter((task) => task.client.trim() === mentionedClient);
    const overdue = mine.filter((task) => task.dueDate !== null && dayOffset(task.dueDate, now) < 0).length;
    const dated = mine.filter((task) => task.dueDate !== null).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    const next = dated.length > 0 ? `next due ${relativeDayLabel(dated[0].dueDate as string, now)}` : 'no deadlines';
    return {
      text: `“${mentionedClient}” — ${mine.length} open task${mine.length === 1 ? '' : 's'}, ${overdue} overdue, ${next}.`,
      confidence: 'exact',
      citations: mine.slice(0, 4).map(cite),
    };
  }

  // ---- BM25 fallback: closest real matches, or an honest miss -----------
  const hits = bm25Search(question, buildQaDocs(tasks), 3);
  if (hits.length === 0) return UNKNOWN(question);
  const lines = hits.map((hit) => {
    const task = tasks.find((candidate) => candidate.id === hit.doc.taskId);
    if (!task) return hit.doc.title;
    const due = task.dueDate ? `due ${relativeDayLabel(task.dueDate, now)}` : 'no date';
    return `“${task.title}” (${task.status.replace('_', ' ')}, ${due})`;
  });
  return {
    text: `Nothing in my templates matches that exactly — closest in your data: ${lines.join(' · ')}.`,
    confidence: 'closest',
    citations: hits.map((hit) => ({ label: hit.doc.title, taskId: hit.doc.taskId })),
  };
}

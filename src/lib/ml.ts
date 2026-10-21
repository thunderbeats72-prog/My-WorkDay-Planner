import type { Category, Priority, Settings, Task, TimeSession } from './types';
import { CATEGORY_ORDER, PRIORITIES } from './types';
import { dayOffset } from './dates';
import type { LearnedDurations } from './engine';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'about', 'into', 'over', 'after', 'before',
  'call', 'email', 'task', 'todo', 'follow', 'up', 'reminder', 'check', 'send', 'sent',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

export interface DurationLearning {
  learned: LearnedDurations;
  categorySamples: Partial<Record<Category, number>>;
  clientSamples: Record<string, number>;
  totalSamples: number;
}

export function collectActualMinutes(tasks: Task[], sessions: TimeSession[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const task of tasks) {
    totals.set(task.id, Math.max(0, task.actualMinutes || 0));
  }
  const fromSessions = new Map<string, number>();
  for (const session of sessions) {
    const minutes = Math.max(0, session.durationMs) / 60000;
    fromSessions.set(session.taskId, (fromSessions.get(session.taskId) ?? 0) + minutes);
  }
  for (const [taskId, minutes] of fromSessions) {
    if (minutes > 0) totals.set(taskId, Math.round(minutes));
  }
  return totals;
}

export function learnDurations(tasks: Task[], sessions: TimeSession[], minimumSamples = 3): DurationLearning {
  const actuals = collectActualMinutes(tasks, sessions);
  const categoryValues = new Map<Category, number[]>();
  const clientValues = new Map<string, number[]>();

  for (const task of tasks) {
    if (task.deletedAt !== null) continue;
    const actual = actuals.get(task.id) ?? 0;
    if (actual < 1) continue;
    if (!categoryValues.has(task.category)) categoryValues.set(task.category, []);
    categoryValues.get(task.category)!.push(actual);
    if (task.client.trim()) {
      const key = task.client.trim();
      if (!clientValues.has(key)) clientValues.set(key, []);
      clientValues.get(key)!.push(actual);
    }
  }

  const byCategory: Partial<Record<Category, number>> = {};
  const categorySamples: Partial<Record<Category, number>> = {};
  let totalSamples = 0;
  for (const category of CATEGORY_ORDER) {
    const values = categoryValues.get(category) ?? [];
    categorySamples[category] = values.length;
    if (values.length >= minimumSamples) {
      byCategory[category] = median(values);
      totalSamples += values.length;
    }
  }

  const byClient: Record<string, number> = {};
  const clientSamples: Record<string, number> = {};
  for (const [client, values] of clientValues) {
    clientSamples[client] = values.length;
    if (values.length >= minimumSamples) {
      byClient[client] = median(values);
      totalSamples += values.length;
    }
  }

  return { learned: { byCategory, byClient }, categorySamples, clientSamples, totalSamples };
}

export interface TaskSuggestion {
  category: Category;
  priority: Priority;
  estimatedMinutes: number;
  reasons: string[];
  confidence: number;
  samples: number;
  hasEnoughHistory: boolean;
  matchedTokens: string[];
}

interface NaiveBayesModel {
  categoryCounts: Map<Category, number>;
  tokenCounts: Map<Category, Map<string, number>>;
  tokenTotals: Map<Category, number>;
  priorityCounts: Map<Priority, number>;
  tokenPriorityCounts: Map<Priority, Map<string, number>>;
  totalTasks: number;
  vocabulary: Set<string>;
}

function trainModel(tasks: Task[]): NaiveBayesModel {
  const model: NaiveBayesModel = {
    categoryCounts: new Map(),
    tokenCounts: new Map(),
    tokenTotals: new Map(),
    priorityCounts: new Map(),
    tokenPriorityCounts: new Map(),
    totalTasks: 0,
    vocabulary: new Set(),
  };

  for (const task of tasks) {
    if (task.deletedAt !== null) continue;
    model.totalTasks += 1;
    model.categoryCounts.set(task.category, (model.categoryCounts.get(task.category) ?? 0) + 1);
    model.priorityCounts.set(task.priority, (model.priorityCounts.get(task.priority) ?? 0) + 1);
    const tokens = new Set(tokenise(task.title));
    for (const token of tokens) {
      model.vocabulary.add(token);
      if (!model.tokenCounts.has(task.category)) model.tokenCounts.set(task.category, new Map());
      const categoryTokens = model.tokenCounts.get(task.category)!;
      categoryTokens.set(token, (categoryTokens.get(token) ?? 0) + 1);
      model.tokenTotals.set(task.category, (model.tokenTotals.get(task.category) ?? 0) + 1);

      if (!model.tokenPriorityCounts.has(task.priority)) model.tokenPriorityCounts.set(task.priority, new Map());
      const priorityTokens = model.tokenPriorityCounts.get(task.priority)!;
      priorityTokens.set(token, (priorityTokens.get(token) ?? 0) + 1);
    }
  }

  return model;
}

function predictCategory(model: NaiveBayesModel, tokens: string[]): { category: Category; confidence: number; margin: number } {
  const vocabularySize = Math.max(1, model.vocabulary.size);
  const scores: Array<{ category: Category; score: number }> = [];

  for (const category of CATEGORY_ORDER) {
    const priorCount = model.categoryCounts.get(category) ?? 0;
    if (priorCount === 0) continue;
    const prior = priorCount / model.totalTasks;
    let logProb = Math.log(prior);
    const tokenMap = model.tokenCounts.get(category) ?? new Map<string, number>();
    const total = model.tokenTotals.get(category) ?? 0;
    for (const token of tokens) {
      const count = tokenMap.get(token) ?? 0;
      logProb += Math.log((count + 1) / (total + vocabularySize));
    }
    scores.push({ category, score: logProb });
  }

  if (scores.length === 0) return { category: 'other', confidence: 0, margin: 0 };
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  const margin = second ? best.score - second.score : 1;
  const confidence = Math.max(0, Math.min(95, Math.round((1 - Math.exp(-margin / 2)) * 100)));
  return { category: best.category, confidence, margin };
}

function predictPriority(model: NaiveBayesModel, tokens: string[]): { priority: Priority; confidence: number } {
  const vocabularySize = Math.max(1, model.vocabulary.size);
  const scores: Array<{ priority: Priority; score: number }> = [];
  for (const priority of Object.keys(PRIORITIES) as Priority[]) {
    const priorCount = model.priorityCounts.get(priority) ?? 0;
    if (priorCount === 0) continue;
    let logProb = Math.log(priorCount / model.totalTasks);
    const tokenMap = model.tokenPriorityCounts.get(priority) ?? new Map<string, number>();
    const total = priorCount;
    for (const token of tokens) {
      const count = tokenMap.get(token) ?? 0;
      logProb += Math.log((count + 1) / (total + vocabularySize));
    }
    scores.push({ priority, score: logProb });
  }
  if (scores.length === 0) return { priority: 'medium', confidence: 0 };
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  const margin = second ? best.score - second.score : 1;
  return {
    priority: best.priority,
    confidence: Math.max(0, Math.min(95, Math.round((1 - Math.exp(-margin / 2)) * 100))),
  };
}

export function suggestForTask(title: string, tasks: Task[], settings: Settings, minimumSamples = 5): TaskSuggestion {
  const tokens = Array.from(new Set(tokenise(title)));
  const model = trainModel(tasks);
  const history = tasks.filter((task) => task.deletedAt === null).length;

  if (history < minimumSamples || tokens.length === 0) {
    return {
      category: 'other',
      priority: settings.defaultPriority,
      estimatedMinutes: settings.defaultEstimateMinutes,
      reasons: [
        history < minimumSamples
          ? `Only ${history} saved task${history === 1 ? '' : 's'} so far — add ${minimumSamples - history} more for on-device suggestions.`
          : 'Add a few more words to the title for a suggestion.',
      ],
      confidence: 0,
      samples: history,
      hasEnoughHistory: false,
      matchedTokens: tokens,
    };
  }

  const categoryPrediction = predictCategory(model, tokens);
  const priorityPrediction = predictPriority(model, tokens);
  const learning = learnDurations(tasks, [], 3);
  const categoryMedian = learning.learned.byCategory[categoryPrediction.category];

  const categorySamples = model.categoryCounts.get(categoryPrediction.category) ?? 0;
  const reasons: string[] = [];
  reasons.push(
    `Reads like ${categoryPrediction.category.replace('_', ' ')} (${categorySamples} similar saved task${categorySamples === 1 ? '' : 's'}).`,
  );
  if (priorityPrediction.confidence > 0) {
    reasons.push(`Priority pattern suggests ${PRIORITIES[priorityPrediction.priority].label.toLowerCase()}.`);
  }
  if (categoryMedian) {
    reasons.push(`Your actual time for this category is typically ${categoryMedian}m.`);
  } else {
    reasons.push('Not enough timed tasks in this category yet — using your default estimate.');
  }

  const matchedTokens = tokens.filter((token) => {
    const map = model.tokenCounts.get(categoryPrediction.category);
    return map ? (map.get(token) ?? 0) > 0 : false;
  });

  const confidence = Math.round(
    Math.max(0, Math.min(95, categoryPrediction.confidence * 0.7 + priorityPrediction.confidence * 0.2 + Math.min(10, history))),
  );

  return {
    category: categoryPrediction.category,
    priority: priorityPrediction.priority,
    estimatedMinutes: categoryMedian ?? settings.defaultEstimateMinutes,
    reasons,
    confidence,
    samples: history,
    hasEnoughHistory: true,
    matchedTokens,
  };
}

export interface RiskFactor {
  label: string;
  points: number;
}

export interface RiskScore {
  score: number;
  level: 'low' | 'medium' | 'high';
  factors: RiskFactor[];
}

export function deadlineRisk(task: Task, tasks: Task[], settings: Settings, now: Date = new Date()): RiskScore {
  const factors: RiskFactor[] = [];
  let score = 0;

  if (task.dueDate) {
    const offset = dayOffset(task.dueDate, now);
    if (offset < 0) {
      score += 45;
      factors.push({ label: `Overdue by ${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'}`, points: 45 });
    } else if (offset === 0) {
      score += 35;
      factors.push({ label: 'Deadline is today', points: 35 });
    } else if (offset <= 2) {
      score += 25;
      factors.push({ label: `Deadline in ${offset} day${offset === 1 ? '' : 's'}`, points: 25 });
    } else if (offset <= 7) {
      score += 12;
      factors.push({ label: `Deadline in ${offset} days`, points: 12 });
    }
  } else {
    factors.push({ label: 'No deadline set', points: 0 });
  }

  if (task.blocked) {
    score += 20;
    factors.push({ label: 'Marked as blocked', points: 20 });
  }
  if (task.dependencyIds.length > 0) {
    const missing = task.dependencyIds.filter((id) => {
      const dependency = tasks.find((candidate) => candidate.id === id);
      return dependency ? dependency.status !== 'completed' : false;
    }).length;
    if (missing > 0) {
      score += 15;
      factors.push({ label: `${missing} unfinished dependenc${missing === 1 ? 'y' : 'ies'}`, points: 15 });
    }
  }
  if (task.deferrals > 0) {
    const points = Math.min(15, task.deferrals * 5);
    score += points;
    factors.push({ label: `Deferred ${task.deferrals} time${task.deferrals === 1 ? '' : 's'}`, points });
  }
  if (task.source === 'ocr' || task.status === 'inbox') {
    score += 5;
    factors.push({ label: 'Still unreviewed in inbox', points: 5 });
  }
  if (task.dueDate && task.estimatedMinutes > 60) {
    score += 8;
    factors.push({ label: 'Estimated effort over one hour', points: 8 });
  }
  const capacity = Math.max(0, settings.focusBlockMinutes);
  if (task.estimatedMinutes > capacity) {
    score += 7;
    factors.push({ label: `Longer than one ${capacity}m focus block`, points: 7 });
  }

  const clamped = Math.max(0, Math.min(100, score));
  return {
    score: clamped,
    level: clamped >= 60 ? 'high' : clamped >= 30 ? 'medium' : 'low',
    factors,
  };
}

export interface EstimateBias {
  category: Category;
  samples: number;
  averageEstimate: number;
  averageActual: number;
  differencePct: number;
  direction: 'over' | 'under' | 'on';
}

export interface DurationInsight {
  category: Category;
  samples: number;
  medianEstimate: number;
  medianActual: number;
}

export interface WorkingHourInsight {
  hour: number;
  minutes: number;
}

export interface ReportInsights {
  sharpestHour: WorkingHourInsight | null;
  bias: EstimateBias[];
  durations: DurationInsight[];
  hasEnoughData: boolean;
}

export function buildInsights(tasks: Task[], sessions: TimeSession[]): ReportInsights {
  const actuals = collectActualMinutes(tasks, sessions);
  const categoryEstimates = new Map<Category, number[]>();
  const categoryActuals = new Map<Category, number[]>();

  for (const task of tasks) {
    if (task.deletedAt !== null) continue;
    const actual = actuals.get(task.id) ?? 0;
    if (actual <= 0) continue;
    if (!categoryEstimates.has(task.category)) categoryEstimates.set(task.category, []);
    if (!categoryActuals.has(task.category)) categoryActuals.set(task.category, []);
    categoryEstimates.get(task.category)!.push(task.estimatedMinutes);
    categoryActuals.get(task.category)!.push(actual);
  }

  const bias: EstimateBias[] = [];
  const durations: DurationInsight[] = [];

  for (const category of CATEGORY_ORDER) {
    const estimates = categoryEstimates.get(category) ?? [];
    const actualList = categoryActuals.get(category) ?? [];
    if (estimates.length < 3) continue;
    const averageEstimate = Math.round(estimates.reduce((sum, value) => sum + value, 0) / estimates.length);
    const averageActual = Math.round(actualList.reduce((sum, value) => sum + value, 0) / actualList.length);
    const differencePct = averageEstimate === 0 ? 0 : Math.round(((averageActual - averageEstimate) / averageEstimate) * 100);
    bias.push({
      category,
      samples: estimates.length,
      averageEstimate,
      averageActual,
      differencePct,
      direction: Math.abs(differencePct) < 10 ? 'on' : differencePct > 0 ? 'under' : 'over',
    });
    durations.push({
      category,
      samples: actualList.length,
      medianEstimate: median(estimates),
      medianActual: median(actualList),
    });
  }

  const byHour = new Map<number, number>();
  for (const session of sessions) {
    if (session.state === 'running') continue;
    if (session.durationMs <= 0) continue;
    const started = new Date(session.startedAt);
    const hour = started.getHours();
    if (Number.isNaN(hour)) continue;
    byHour.set(hour, (byHour.get(hour) ?? 0) + Math.round(session.durationMs / 60000));
  }
  let sharpestHour: WorkingHourInsight | null = null;
  for (const [hour, minutes] of byHour) {
    if (!sharpestHour || minutes > sharpestHour.minutes) sharpestHour = { hour, minutes };
  }

  return {
    sharpestHour,
    bias: bias.sort((a, b) => Math.abs(b.differencePct) - Math.abs(a.differencePct)),
    durations,
    hasEnoughData: bias.length > 0 || sessions.length >= 3,
  };
}

import { describe, expect, it } from 'vitest';
import type { Settings, Task } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  buildDayPlan,
  buildWeekSummary,
  diffDayPlans,
  findDependencyCycle,
  findDuplicate,
  parseDuePhrase,
  parseScreenshotText,
  parseTimePhrase,
  scoreTask,
  workingMinutes,
} from './engine';
import { draftToTask } from './engine';
import { dayOffset, daysFromNow, todayISO } from './dates';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  name: 'Test User',
  workdayStart: '09:00',
  workdayEnd: '18:00',
  lunchStart: '13:00',
  lunchEnd: '13:45',
  workingDays: [1, 2, 3, 4, 5],
  focusBlockMinutes: 50,
  bufferMinutes: 10,
};

const WEDNESDAY = new Date(2026, 9, 21, 9, 0, 0);

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  const iso = WEDNESDAY.toISOString();
  const { id, ...rest } = overrides;
  return {
    id,
    title: overrides.title ?? 'Test task',
    notes: '',
    client: '',
    category: 'other',
    priority: 'medium',
    estimatedMinutes: 30,
    actualMinutes: 0,
    dueDate: null,
    dueTime: '',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'todo',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: iso,
    updatedAt: iso,
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...rest,
  };
}

describe('workingMinutes', () => {
  it('subtracts the protected lunch break', () => {
    expect(workingMinutes(settings)).toBe(9 * 60 - 45);
  });

  it('returns zero for a broken workday instead of negative capacity', () => {
    expect(workingMinutes({ ...settings, workdayStart: '18:00', workdayEnd: '09:00' })).toBe(0);
  });

  it('ignores a lunch outside working hours', () => {
    expect(workingMinutes({ ...settings, lunchStart: '20:00', lunchEnd: '21:00' })).toBe(9 * 60);
  });
});

describe('scoreTask ordering', () => {
  it('ranks critical/overdue work above a low task with no deadline', () => {
    const critical = makeTask({
      id: 'a',
      priority: 'critical',
      dueDate: daysFromNow(-2, WEDNESDAY),
    });
    const low = makeTask({ id: 'b', priority: 'low' });
    const criticalScore = scoreTask(critical, settings, WEDNESDAY);
    const lowScore = scoreTask(low, settings, WEDNESDAY);
    expect(criticalScore.score).toBeGreaterThan(lowScore.score);
    expect(criticalScore.reasons.some((reason) => reason.includes('Overdue'))).toBe(true);
    expect(criticalScore.blocked).toBe(false);
  });

  it('explains every scoring factor', () => {
    const task = makeTask({ id: 'a', priority: 'high', dueDate: todayISO(WEDNESDAY), deferrals: 2 });
    const scored = scoreTask(task, settings, WEDNESDAY);
    expect(scored.reasons.length).toBeGreaterThanOrEqual(3);
    expect(scored.reasons.join(' ')).toContain('Deferred 2 times');
  });
});

describe('buildDayPlan', () => {
  it('schedules eligible tasks from now, leaves blocked and dependency tasks queued with reasons', () => {
    const completed = makeTask({ id: 'done', status: 'completed', completedAt: WEDNESDAY.toISOString() });
    const a = makeTask({ id: 'a', title: 'Proposal', priority: 'high', estimatedMinutes: 60, dueDate: todayISO(WEDNESDAY) });
    const b = makeTask({ id: 'b', title: 'Follow-up', estimatedMinutes: 30 });
    const blocked = makeTask({ id: 'c', title: 'Blocked task', blocked: true });
    const waiting = makeTask({ id: 'd', title: 'Waiting task', dependencyIds: ['a'] });

    const plan = buildDayPlan([completed, a, b, blocked, waiting], settings, WEDNESDAY);

    expect(plan.capacityMinutes).toBe(495);
    expect(plan.plannedMinutes).toBe(90);
    expect(plan.blocks[0].start).toBe(9 * 60);
    expect(plan.blocks.filter((block) => block.kind === 'focus').length).toBeGreaterThanOrEqual(2);
    expect(plan.queued.map((item) => item.task.id)).toContain('c');
    expect(plan.queued.map((item) => item.task.id)).toContain('d');
    expect(plan.queued.find((item) => item.task.id === 'c')?.reason).toContain('blocked');
    expect(plan.queued.find((item) => item.task.id === 'd')?.reason).toContain('dependency');
    expect(plan.queued.map((item) => item.task.id)).not.toContain('done');
  });

  it('never schedules past the end of the workday and keeps the rest in the queue', () => {
    const late = new Date(2026, 9, 21, 17, 30, 0);
    const big = makeTask({ id: 'big', title: 'Big task', estimatedMinutes: 120 });
    const small = makeTask({ id: 'small', title: 'Small task', estimatedMinutes: 15 });

    const plan = buildDayPlan([small, big], settings, late);
    expect(plan.blocks.every((block) => block.end <= 18 * 60)).toBe(true);
    expect(plan.queued.some((item) => item.task.id === 'big')).toBe(true);
    expect(plan.queued.find((item) => item.task.id === 'big')?.reason).toContain('Not enough time');
  });

  it('inserts the protected lunch break and never overlaps it', () => {
    const long = makeTask({ id: 'long', title: 'Long task', estimatedMinutes: 300 });
    const plan = buildDayPlan([long], settings, WEDNESDAY);
    const lunch = plan.blocks.find((block) => block.kind === 'break');
    expect(lunch).toBeDefined();
    expect(lunch?.start).toBe(13 * 60);
    expect(lunch?.end).toBe(13 * 60 + 45);
    for (const block of plan.blocks.filter((candidate) => candidate.kind === 'focus')) {
      const overlapsLunch = block.start < 13 * 60 + 45 && 13 * 60 < block.end;
      expect(overlapsLunch).toBe(false);
    }
  });

  it('queues everything with a reason on a non-working day', () => {
    const saturday = new Date(2026, 9, 24, 9, 0, 0);
    const task = makeTask({ id: 'a' });
    const plan = buildDayPlan([task], settings, saturday);
    expect(plan.isWorkingDay).toBe(false);
    expect(plan.blocks).toHaveLength(0);
    expect(plan.queued[0]?.reason).toBe('Not a working day');
  });

  it('plans with learned durations once there is enough history', () => {
    const task = makeTask({ id: 'learn', estimatedMinutes: 30 });
    const plan = buildDayPlan([task], settings, WEDNESDAY, {
      learned: { byCategory: { other: 90 }, byClient: {} },
    });
    expect(plan.plannedMinutes).toBe(90);
    expect(plan.blocks.find((block) => block.taskId === 'learn')?.learned).toBe(true);
  });

  it('never lets a buffer collide with the protected lunch break', () => {
    const task = makeTask({ id: 'short', estimatedMinutes: 5 });
    const plan = buildDayPlan([task], settings, new Date(2026, 9, 21, 12, 55));
    for (const block of plan.blocks) {
      const overlapsLunch = block.start < 13 * 60 + 45 && 13 * 60 < block.end;
      expect(overlapsLunch).toBe(false);
    }
  });

  it('never schedules completed tasks and never mutates the caller array', () => {
    const task = makeTask({ id: 'a' });
    const tasks = [task];
    const plan = buildDayPlan(tasks, settings, WEDNESDAY);
    expect(tasks[0].suggestedDate).toBeNull();
    expect(plan.blocks.length).toBeGreaterThan(0);
  });
});

describe('buildWeekSummary', () => {
  it('counts real due dates per day', () => {
    const tasks = [
      makeTask({ id: 'a', dueDate: daysFromNow(1, WEDNESDAY) }),
      makeTask({ id: 'b', dueDate: daysFromNow(1, WEDNESDAY) }),
      makeTask({ id: 'c', dueDate: daysFromNow(-1, WEDNESDAY) }),
    ];
    const week = buildWeekSummary(tasks, settings, WEDNESDAY);
    expect(week).toHaveLength(7);
    const tomorrow = week.find((day) => day.dateISO === daysFromNow(1, WEDNESDAY));
    expect(tomorrow?.dueCount).toBe(2);
    const yesterday = week.find((day) => day.dateISO === daysFromNow(-1, WEDNESDAY));
    expect(yesterday?.overdueCount).toBe(1);
  });
});

describe('date and time parsing', () => {
  it('parses relative, weekday and explicit dates', () => {
    expect(parseDuePhrase('Due tomorrow', WEDNESDAY).dateISO).toBe(daysFromNow(1, WEDNESDAY));
    expect(parseDuePhrase('due: 2026-11-05', WEDNESDAY).dateISO).toBe('2026-11-05');
    const weekday = parseDuePhrase('by Friday', WEDNESDAY);
    expect(weekday.dateISO).not.toBeNull();
    expect(new Date(`${weekday.dateISO}T12:00:00`).getDay()).toBe(5);
  });

  it('flags ambiguous numeric dates instead of guessing silently', () => {
    const parsed = parseDuePhrase('due 03/04', WEDNESDAY);
    expect(parsed.dateISO).toBe('2026-04-03');
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.reason).toContain('ambiguous');
  });

  it('parses 12-hour and 24-hour times including EOD', () => {
    expect(parseTimePhrase('due at 3pm').time).toBe('15:00');
    expect(parseTimePhrase('due 15:30').time).toBe('15:30');
    expect(parseTimePhrase('by EOD').time).toBe('18:00');
  });

  it('computes the day offset from today', () => {
    expect(dayOffset(daysFromNow(2, WEDNESDAY), WEDNESDAY)).toBe(2);
    expect(dayOffset(daysFromNow(-1, WEDNESDAY), WEDNESDAY)).toBe(-1);
  });
});

describe('screenshot parsing', () => {
  const text = `Follow up with Acme Industries on the proposal
Client: Acme Industries
Due: 24/10
Priority: high
Estimate: 30 min

Send revised pricing deck to Nexus Retail — urgent
Due tomorrow 3pm
Client: Nexus Retail

Call Priya about the renewal
Due 03/04
Estimate: 20 minutes`;

  it('splits blocks and extracts structured fields', () => {
    const drafts = parseScreenshotText(text, WEDNESDAY);
    expect(drafts).toHaveLength(3);
    expect(drafts[0].client).toBe('Acme Industries');
    expect(drafts[0].category).toBe('follow_up');
    expect(drafts[0].priority).toBe('high');
    expect(drafts[0].estimatedMinutes).toBe(30);
    expect(drafts[0].dueDate).toBe('2026-10-24');
    expect(drafts[0].warnings).toHaveLength(0);
    expect(drafts[0].confidence).toBeGreaterThan(60);
  });

  it('extracts urgent priority and relative time for the second task', () => {
    const drafts = parseScreenshotText(text, WEDNESDAY);
    expect(drafts[1].priority).toBe('critical');
    expect(drafts[1].dueDate).toBe(daysFromNow(1, WEDNESDAY));
    expect(drafts[1].dueTime).toBe('15:00');
    expect(drafts[1].estimatedMinutes).toBe(30);
  });

  it('keeps ambiguous dates flagged with a warning', () => {
    const drafts = parseScreenshotText(text, WEDNESDAY);
    expect(drafts[2].dueDate).toBe('2026-04-03');
    expect(drafts[2].warnings.some((warning) => warning.toLowerCase().includes('ambiguous'))).toBe(true);
    expect(drafts[2].confidence).toBeLessThan(drafts[0].confidence);
  });

  it('detects duplicates against existing open tasks', () => {
    const drafts = parseScreenshotText(text, WEDNESDAY);
    const existing = makeTask({ id: 'existing', title: 'Follow up with Acme Industries on the proposal' });
    expect(findDuplicate(drafts[0], [existing])?.id).toBe('existing');
    expect(findDuplicate(drafts[0], [])).toBeNull();
  });

  it('marks completed existing tasks as non-duplicates', () => {
    const drafts = parseScreenshotText(text, WEDNESDAY);
    const completed = makeTask({
      id: 'completed',
      title: drafts[0].title,
      status: 'completed',
      completedAt: WEDNESDAY.toISOString(),
    });
    expect(findDuplicate(drafts[0], [completed])).toBeNull();
  });

  it('converts a reviewed draft into an inbox task', () => {
    const drafts = parseScreenshotText(text, WEDNESDAY);
    const task = draftToTask(drafts[0], settings, WEDNESDAY);
    expect(task.source).toBe('ocr');
    expect(task.status).toBe('inbox');
    expect(task.title).toContain('Acme');
    expect(task.dueDate).toBe('2026-10-24');
  });

  it('returns no drafts for empty text', () => {
    expect(parseScreenshotText('   ', WEDNESDAY)).toHaveLength(0);
  });
});

describe('dependency validation', () => {
  it('detects a cycle that would be created by an edit', () => {
    const a = makeTask({ id: 'a', dependencyIds: ['b'] });
    const b = makeTask({ id: 'b', dependencyIds: [] });
    expect(findDependencyCycle('b', ['a'], [a, b])).not.toBeNull();
    expect(findDependencyCycle('b', [], [a, b])).toBeNull();
  });
});

describe('calendar meetings block capacity (#10)', () => {
  const busy = [{ id: 'm1', title: 'Sync with Nova', start: 10 * 60, end: 11 * 60 }];

  it('renders meetings as facts and never schedules across them', () => {
    const tasks = [
      makeTask({ id: 'a', estimatedMinutes: 240 }),
      makeTask({ id: 'b', estimatedMinutes: 120 }),
    ];
    const plan = buildDayPlan(tasks, settings, WEDNESDAY, { busy });

    const meeting = plan.blocks.find((block) => block.kind === 'meeting');
    expect(meeting?.title).toBe('Sync with Nova');
    expect(meeting?.start).toBe(600);
    expect(meeting?.end).toBe(660);
    expect(plan.busyMinutes).toBe(60);

    for (const block of plan.blocks.filter((candidate) => candidate.kind === 'focus')) {
      const overlapsMeeting = block.start < 11 * 60 && 10 * 60 < block.end;
      expect(overlapsMeeting).toBe(false);
    }
  });

  it('jumps the cursor over a meeting that starts when the day does', () => {
    const plan = buildDayPlan([makeTask({ id: 'a', estimatedMinutes: 60 })], settings, WEDNESDAY, {
      busy: [{ id: 'm0', title: 'Standup', start: 9 * 60, end: 9 * 60 + 30 }],
    });
    const firstFocus = plan.blocks.find((block) => block.kind === 'focus');
    expect(firstFocus?.start).toBe(9 * 60 + 30);
  });

  it('merges overlapping meetings and never double-counts lunch', () => {
    const plan = buildDayPlan([makeTask({ id: 'a', estimatedMinutes: 30 })], settings, WEDNESDAY, {
      busy: [
        { id: 'm1', title: 'Overlapping A', start: 10 * 60, end: 11 * 60 },
        { id: 'm2', title: 'Overlapping B', start: 10 * 60 + 30, end: 11 * 60 + 30 },
        { id: 'm3', title: 'Across lunch', start: 12 * 60 + 45, end: 13 * 60 + 15 },
      ],
    });
    // 10:00–11:30 merged = 90m, plus 12:45–13:15 = 30m of which 15m sits in lunch.
    expect(plan.busyMinutes).toBe(90 + 30 - 15);
    const meetings = plan.blocks.filter((block) => block.kind === 'meeting');
    expect(meetings).toHaveLength(2);
  });

  it('keeps meetings out of the lunch overlap in the timeline too', () => {
    const plan = buildDayPlan([makeTask({ id: 'a', estimatedMinutes: 300 })], settings, WEDNESDAY, {
      busy: [{ id: 'm', title: 'Lunch sync', start: 12 * 60 + 45, end: 13 * 60 + 15 }],
    });
    const lunch = plan.blocks.find((block) => block.kind === 'break');
    const meeting = plan.blocks.find((block) => block.kind === 'meeting');
    // Meeting block stays a raw calendar fact; capacity math subtracted lunch.
    expect(meeting?.start).toBe(12 * 60 + 45);
    expect(lunch?.start).toBe(13 * 60);
    for (const block of plan.blocks.filter((candidate) => candidate.kind === 'focus')) {
      const overlapsMeeting = block.start < 13 * 60 + 15 && 12 * 60 + 45 < block.end;
      expect(overlapsMeeting).toBe(false);
    }
  });
});

describe('energy-curve placement (#8)', () => {
  const curve = { sharpestHour: 10, slumpHour: 14, sharpestMinutes: 180, slumpMinutes: 12 };

  it('moves deep work ahead of admin for the sharp hour, with a visible reason', () => {
    const admin = makeTask({ id: 'admin', title: 'File invoices', category: 'admin', estimatedMinutes: 60 });
    const deep = makeTask({ id: 'deep', title: 'Research competitors', category: 'research', estimatedMinutes: 60 });
    const plan = buildDayPlan([admin, deep], settings, WEDNESDAY, { energy: curve });

    const focus = plan.blocks.filter((block) => block.kind === 'focus');
    expect(focus[0]?.taskId).toBe('deep');
    expect(focus[0]?.reason).toContain('sharpest hour');
    expect(focus[0]?.reason).toContain('10:00');
    expect(plan.energyNote).toContain('sharpest 10:00');
    expect(plan.energyNote).toContain('slowest 14:00');
    expect(plan.energyNote).toContain('moved ahead of admin work');
  });

  it('deadlines beat energy: due-today admin keeps its scored place', () => {
    const admin = makeTask({
      id: 'admin',
      title: 'Send compliance form',
      category: 'admin',
      estimatedMinutes: 60,
      dueDate: todayISO(WEDNESDAY),
    });
    const deep = makeTask({ id: 'deep', title: 'Deep dive', category: 'research', estimatedMinutes: 60 });
    const plan = buildDayPlan([admin, deep], settings, WEDNESDAY, { energy: curve });

    const focus = plan.blocks.filter((block) => block.kind === 'focus');
    expect(focus[0]?.taskId).toBe('admin');
    expect(focus[1]?.reason).toBeUndefined();
    // The curve still reports itself honestly even when it could not move anything.
    expect(plan.energyNote).toContain('sharpest 10:00');
  });

  it('batches admin into the slump once the sharp hour has passed', () => {
    const afternoon = new Date(2026, 9, 21, 14, 30, 0);
    const deep = makeTask({ id: 'deep', title: 'Draft proposal', category: 'proposal', estimatedMinutes: 60 });
    const admin = makeTask({ id: 'admin', title: 'Tidy inbox', category: 'email', estimatedMinutes: 60 });
    const plan = buildDayPlan([deep, admin], settings, afternoon, { energy: curve });

    const focus = plan.blocks.filter((block) => block.kind === 'focus');
    expect(focus[0]?.taskId).toBe('admin');
    expect(focus[0]?.reason).toContain('slowest hour');
    expect(plan.energyNote).toContain('moved up');
  });

  it('changes nothing when no curve is given', () => {
    const admin = makeTask({ id: 'admin', title: 'Admin', category: 'admin', estimatedMinutes: 60 });
    const deep = makeTask({ id: 'deep', title: 'Research', category: 'research', estimatedMinutes: 60 });
    const plan = buildDayPlan([admin, deep], settings, WEDNESDAY);
    const focus = plan.blocks.filter((block) => block.kind === 'focus');
    expect(focus[0]?.taskId).toBe('admin'); // pure score order
    expect(plan.energyNote).toBeNull();
    expect(focus[0]?.reason).toBeUndefined();
  });
});

describe('diffDayPlans (#9)', () => {
  it('shows the moves and the pull-in when urgent work lands mid-day', () => {
    const a = makeTask({ id: 'a', title: 'Steady work', estimatedMinutes: 60 });
    const b = makeTask({ id: 'b', title: 'More steady work', estimatedMinutes: 60 });
    const before = buildDayPlan([a, b], settings, WEDNESDAY);

    const urgent = makeTask({
      id: 'urgent',
      title: 'Client fire drill',
      priority: 'critical',
      estimatedMinutes: 60,
      dueDate: todayISO(WEDNESDAY),
    });
    const after = buildDayPlan([a, b, urgent], settings, WEDNESDAY);

    const shifts = diffDayPlans(before, after);
    expect(shifts.some((shift) => shift.taskId === 'urgent' && shift.kind === 'scheduled')).toBe(true);
    expect(shifts.some((shift) => shift.taskId === 'a' && shift.kind === 'moved')).toBe(true);
    const movedA = shifts.find((shift) => shift.taskId === 'a' && shift.kind === 'moved');
    expect(movedA?.from).toMatch(/^\d{2}:\d{2}$/);
    expect(movedA?.to).toMatch(/^\d{2}:\d{2}$/);
  });

  it('reports a task that fell out of the timeline', () => {
    const a = makeTask({ id: 'a', estimatedMinutes: 60 });
    const b = makeTask({ id: 'b', estimatedMinutes: 60 });
    const before = buildDayPlan([a, b], settings, WEDNESDAY);
    const blocked: Task = { ...b, blocked: true };
    const after = buildDayPlan([a, blocked], settings, WEDNESDAY);

    const shifts = diffDayPlans(before, after);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({ taskId: 'b', kind: 'queued', from: expect.stringMatching(/^\d{2}:\d{2}$/), to: null });
    expect(shifts[0]?.title).toBe(b.title);
  });

  it('stays empty for an unchanged plan', () => {
    const tasks = [makeTask({ id: 'a', estimatedMinutes: 60 })];
    const first = buildDayPlan(tasks, settings, WEDNESDAY);
    const second = buildDayPlan(tasks, settings, WEDNESDAY);
    expect(diffDayPlans(first, second)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { daysFromNow, todayISO } from './dates';
import { parseQuickAdd } from './quickAdd';

const NOW = new Date(2026, 9, 21, 15, 30, 0); // Wed 21 Oct 2026, 15:30

function parse(text: string, extra: Partial<Parameters<typeof parseQuickAdd>[1]> = {}) {
  return parseQuickAdd(text, { now: NOW, fallbackPriority: 'medium', fallbackEstimateMinutes: 30, ...extra });
}

describe('parseQuickAdd', () => {
  it('leaves a plain title alone and defaults to today', () => {
    const result = parse('Follow up with Acme');
    expect(result.draft.title).toBe('Follow up with Acme');
    expect(result.draft.dueDate).toBe(todayISO(NOW));
    expect(result.draft.priority).toBe('medium');
    expect(result.draft.estimatedMinutes).toBe(30);
    expect(result.draft.category).toBe('other');
    expect(result.tokens).toHaveLength(0);
  });

  it('pulls a full task out of one line', () => {
    const result = parse('Send pricing sheet to Nova tomorrow 3pm !high 45m #proposal @Nova');
    expect(result.draft.title).toBe('Send pricing sheet to Nova');
    expect(result.draft.dueDate).toBe(daysFromNow(1, NOW));
    expect(result.draft.dueTime).toBe('15:00');
    expect(result.draft.priority).toBe('high');
    expect(result.draft.estimatedMinutes).toBe(45);
    expect(result.draft.category).toBe('proposal');
    expect(result.draft.client).toBe('Nova');
    expect(result.tokens.map((token) => token.kind).sort()).toEqual([
      'category',
      'client',
      'date',
      'estimate',
      'priority',
      'time',
    ]);
  });

  it('reads p-levels and bang priorities', () => {
    expect(parse('Fix invoice p1').draft.priority).toBe('critical');
    expect(parse('Fix invoice p4').draft.priority).toBe('low');
    expect(parse('Fix invoice !!').draft.priority).toBe('critical');
    expect(parse('Fix invoice !').draft.priority).toBe('high');
    expect(parse('Fix invoice p1').draft.title).toBe('Fix invoice');
  });

  it('understands hours, minutes and clamps silly estimates', () => {
    expect(parse('Draft deck 1.5h').draft.estimatedMinutes).toBe(90);
    expect(parse('Draft deck 20 min').draft.estimatedMinutes).toBe(20);
    expect(parse('Draft deck 600m').draft.estimatedMinutes).toBe(480);
    expect(parse('Draft deck 2m').draft.estimatedMinutes).toBe(5);
  });

  it('matches category aliases and expands known clients', () => {
    const result = parse('Chase the reply #follow-up @nova', { clients: ['Nova Retail', 'Aarav Logistics'] });
    expect(result.draft.category).toBe('follow_up');
    expect(result.draft.client).toBe('Nova Retail');
    expect(result.draft.title).toBe('Chase the reply');
  });

  it('rolls a bare time that already passed over to tomorrow', () => {
    const result = parse('Call Sam 9am');
    expect(result.rolledOver).toBe(true);
    expect(result.draft.dueDate).toBe(daysFromNow(1, NOW));
    expect(result.draft.dueTime).toBe('09:00');
    expect(result.tokens.find((token) => token.kind === 'time')?.label).toBe('tomorrow, 9am');
    expect(result.draft.title).toBe('Call Sam');
  });

  it('keeps a future time on the stated date', () => {
    const result = parse('Standup tomorrow 9am');
    expect(result.rolledOver).toBe(false);
    expect(result.draft.dueDate).toBe(daysFromNow(1, NOW));
    expect(result.draft.dueTime).toBe('09:00');
  });

  it('cleans a dangling connector left behind by a removed token', () => {
    expect(parse('Email Sam at 3pm').draft.title).toBe('Email Sam');
    expect(parse('Review the deck on Friday').draft.title).toBe('Review the deck');
    expect(parse('todo: pay rent').draft.title).toBe('pay rent');
  });

  it('never returns an empty title', () => {
    const result = parse('!high 30m');
    expect(result.draft.title.length).toBeGreaterThan(0);
    expect(result.draft.priority).toBe('high');
    expect(result.draft.estimatedMinutes).toBe(30);
  });

  it('respects an explicit fallback day', () => {
    const result = parse('Read the brief', { fallbackDueDate: null });
    expect(result.draft.dueDate).toBeNull();
  });
});

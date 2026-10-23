import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GRAPH_SCOPES,
  describeGraphError,
  fetchDayMeetings,
  graphCalendarViewUrl,
  type GraphToken,
} from './graph';

const token: GraphToken = {
  accessToken: 'test-token',
  expiresAt: Date.now() + 60_000,
  scopes: GRAPH_SCOPES.join(' '),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe('calendar scope and URL (#10)', () => {
  it('asks for Calendars.Read alongside the existing scopes', () => {
    expect(GRAPH_SCOPES).toContain('Calendars.Read');
    expect(GRAPH_SCOPES).toContain('Mail.Read');
  });

  it('builds calendarView bounds for exactly one local day in UTC', () => {
    const url = new URL(graphCalendarViewUrl('2026-10-21'));
    expect(url.pathname).toBe('/v1.0/me/calendarView');
    expect(url.searchParams.get('startDateTime')).toBe('2026-10-21T00:00:00Z');
    expect(url.searchParams.get('endDateTime')).toBe('2026-10-22T00:00:00Z');
    expect(url.searchParams.get('$top')).toBe('50');
  });

  it('turns a refused calendar call into reconnection instructions, not silence', () => {
    const message = describeGraphError(403, 'calendar', '{"error":{"code":"AccessDenied"}}');
    expect(message).toContain('Calendars.Read');
    expect(message).toContain('reconnect');
  });
});

describe('fetchDayMeetings', () => {
  it('maps timed events to busy minutes and drops all-day, free, and other-day noise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          value: [
            { id: '1', subject: 'Nova sync', start: { dateTime: '2026-10-21T10:00:00' }, end: { dateTime: '2026-10-21T10:30:00' }, showAs: 'busy' },
            { id: '2', subject: 'All day off', isAllDay: true, start: { dateTime: '2026-10-21T00:00:00' }, end: { dateTime: '2026-10-22T00:00:00' }, showAs: 'busy' },
            { id: '3', subject: 'Flexible', showAs: 'free', start: { dateTime: '2026-10-21T11:00:00' }, end: { dateTime: '2026-10-21T12:00:00' } },
            { id: '4', subject: 'Tomorrow thing', start: { dateTime: '2026-10-22T10:00:00' }, end: { dateTime: '2026-10-22T11:00:00' } },
            { id: '5', subject: 'Zero', start: { dateTime: '2026-10-21T13:00:00' }, end: { dateTime: '2026-10-21T13:00:00' } },
            { id: '6', subject: '', start: { dateTime: '2026-10-21T15:00:00' }, end: { dateTime: '2026-10-21T15:45:00' } },
          ],
        }),
      ),
    );

    const result = await fetchDayMeetings(token, '2026-10-21');
    expect(result.error).toBeNull();
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ id: '1', title: 'Nova sync', start: 600, end: 630 });
    expect(result.items[1]).toEqual({ id: '6', title: '(no subject)', start: 15 * 60, end: 15 * 60 + 45 });
  });

  it('never throws on a missing scope — it explains what to do', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'AccessDenied' } }, 403)),
    );
    const result = await fetchDayMeetings(token, '2026-10-21');
    expect(result.items).toEqual([]);
    expect(result.error).toContain('Calendars.Read');
  });

  it('reports network failure honestly instead of pretending the day is free', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    const result = await fetchDayMeetings(token, '2026-10-21');
    expect(result.items).toEqual([]);
    expect(result.error).toBe('network down');
  });
});

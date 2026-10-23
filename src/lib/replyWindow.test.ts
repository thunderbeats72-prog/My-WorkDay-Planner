import { describe, expect, it } from 'vitest';
import { MIN_REPLY_SAMPLES, replyWindowFor, type MailSample } from './replyWindow';

const NOW = new Date(2026, 9, 21, 12, 0, 0);

function mail(hour: number, minute = 0, day = 20, from = 'sam@nova.test'): MailSample {
  return {
    fromName: 'Sam',
    fromAddress: from,
    receivedAt: new Date(2026, 9, day, hour, minute, 0).toISOString(),
    subject: 'Re: things',
  };
}

describe('replyWindowFor', () => {
  it('refuses to draw a window on thin evidence', () => {
    const few = [mail(9), mail(15)];
    expect(replyWindowFor('Nova', few, NOW)).toBeNull();
    expect(MIN_REPLY_SAMPLES).toBeGreaterThanOrEqual(3);
  });

  it('covers the middle 50% of their sending hours', () => {
    // Hours: 9, 10, 11, 16 → p25 ≈ 9.75, p75 ≈ 13.25 → rounded to :00/:30.
    const window = replyWindowFor('Nova', [mail(9), mail(10), mail(11), mail(16)], NOW)!;
    expect(window.samples).toBe(4);
    expect(window.windowStart).toMatch(/^\d{2}:\d{2}$/);
    expect(window.windowEnd).toMatch(/^\d{2}:\d{2}$/);
    expect(window.windowStart < window.windowEnd).toBe(true);
    expect(window.hint).toContain('Nova');
    expect(window.hint).toContain('follow up');
    expect(window.lastAt).toBeTruthy();
    expect(window.firstAt < window.lastAt).toBe(true);
  });

  it('drops future-dated junk and invalid timestamps instead of stretching the window', () => {
    const window = replyWindowFor(
      'Nova',
      [mail(9), mail(10), mail(11), mail(3), mail(23, 0, 25)], // last is tomorrow
      NOW,
    )!;
    expect(window.samples).toBe(4);
    expect(new Date(window.lastAt) <= NOW).toBe(true);
  });

  it('says "around" when they always write in the same hour', () => {
    const window = replyWindowFor(
      'Zenith',
      [mail(9), mail(9, 0, 19), mail(9, 0, 18), mail(9, 0, 17)],
      NOW,
    )!;
    expect(window.windowStart).toBe(window.windowEnd);
    expect(window.hint).toContain('around');
  });
});

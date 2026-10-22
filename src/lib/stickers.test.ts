import { describe, expect, it } from 'vitest';
import {
  STICKERS,
  loadShelf,
  recordSticker,
  saveShelf,
  stickerCaption,
  stickerFor,
  streakFrom,
  type EarnedSticker,
} from './stickers';

const base = { completedToday: 1, streakDays: 0, hour: 14, clearedAll: false };

describe('which sticker you earned', () => {
  it('gives the first completion of the day the quiet one', () => {
    expect(stickerFor(base).id).toBe('first-light');
  });

  it('celebrates a cleared board above everything else', () => {
    expect(stickerFor({ ...base, completedToday: 12, clearedAll: true }).id).toBe('clean-sweep');
  });

  it('marks a ten-task day', () => {
    expect(stickerFor({ ...base, completedToday: 10 }).id).toBe('finisher');
  });

  it('notices the hour it is actually finished at', () => {
    expect(stickerFor({ ...base, completedToday: 2, hour: 9 }).id).toBe('early-bird');
    expect(stickerFor({ ...base, completedToday: 2, hour: 22 }).id).toBe('night-owl');
  });

  it('notices a streak', () => {
    expect(stickerFor({ ...base, completedToday: 3, streakDays: 4 }).id).toBe('steady');
  });

  it('falls back to momentum for an ordinary second task', () => {
    expect(stickerFor({ ...base, completedToday: 2, hour: 14 }).id).toBe('momentum');
  });

  it('always returns a real sticker from the set', () => {
    for (const completedToday of [1, 2, 5, 9, 10, 30]) {
      for (const hour of [6, 10, 14, 21, 23]) {
        const sticker = stickerFor({ completedToday, streakDays: 0, hour, clearedAll: false });
        expect(STICKERS[sticker.id]).toBeDefined();
        expect(sticker.name.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the line under the stamp', () => {
  it('names the next task when there is one', () => {
    const caption = stickerCaption(STICKERS.momentum, { completedToday: 4, nextTitle: 'Send the invoice' });
    expect(caption).toContain('Send the invoice');
    expect(caption).toContain('4');
  });

  it('says nothing extra when the board is clear', () => {
    const caption = stickerCaption(STICKERS['clean-sweep'], { completedToday: 3 });
    expect(caption).toContain('Board clear');
    expect(caption).toContain('3');
    expect(caption).not.toContain('Next:');
  });

  it('never scolds', () => {
    for (const sticker of Object.values(STICKERS)) {
      const caption = stickerCaption(sticker, { completedToday: 2 });
      expect(caption.toLowerCase()).not.toMatch(/should|must|failed|lazy/);
    }
  });
});

describe('the shelf', () => {
  it('keeps the newest first and caps the length', () => {
    let list: EarnedSticker[] = [];
    for (let index = 0; index < 80; index += 1) {
      list = recordSticker(list, index % 2 === 0 ? 'momentum' : 'steady', `2026-01-01T00:00:${index}.000Z`);
    }
    expect(list).toHaveLength(60);
    expect(list[0].id).toBe('steady');
  });

  it('survives a storage that is empty or broken', () => {
    localStorage.clear();
    expect(loadShelf()).toEqual([]);
    localStorage.setItem('workday.stickers.v1', 'not json');
    expect(loadShelf()).toEqual([]);
  });

  it('round-trips through storage', () => {
    localStorage.clear();
    saveShelf([{ id: 'momentum', at: '2026-01-02T10:00:00.000Z' }]);
    expect(loadShelf()).toEqual([{ id: 'momentum', at: '2026-01-02T10:00:00.000Z' }]);
  });
});

describe('the streak', () => {
  const day = (iso: string): EarnedSticker => ({ id: 'momentum', at: `${iso}T09:00:00.000Z` });

  it('counts consecutive days ending today', () => {
    expect(streakFrom([day('2026-01-03'), day('2026-01-02'), day('2026-01-01')], '2026-01-03')).toBe(3);
  });

  it('keeps yesterday live until today has one', () => {
    expect(streakFrom([day('2026-01-02'), day('2026-01-01')], '2026-01-03')).toBe(2);
  });

  it('breaks on a missing day', () => {
    expect(streakFrom([day('2026-01-03'), day('2026-01-01')], '2026-01-03')).toBe(1);
  });

  it('is zero when the last sticker is old', () => {
    expect(streakFrom([day('2025-12-24')], '2026-01-03')).toBe(0);
  });

  it('counts several stickers on one day as one day', () => {
    expect(streakFrom([day('2026-01-03'), day('2026-01-03'), day('2026-01-02')], '2026-01-03')).toBe(2);
  });
});

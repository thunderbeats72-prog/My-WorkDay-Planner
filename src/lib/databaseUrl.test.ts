import { describe, expect, it } from 'vitest';
import { pickDatabaseUrl } from './databaseUrl';

describe('finding the connection string in whatever the integration named it', () => {
  it('takes DATABASE_URL first, pooled', () => {
    expect(pickDatabaseUrl({ DATABASE_URL: 'postgres://pooled', DATABASE_URL_UNPOOLED: 'postgres://direct' })).toBe(
      'postgres://pooled',
    );
  });

  it('accepts the name Vercel’s Neon integration actually injects when prefixed', () => {
    // The bug this prevents: the database is attached, the variable is
    // `MY_PLANNER_DATABASE_URL`, and the app insists nothing is attached.
    expect(pickDatabaseUrl({ MY_PLANNER_DATABASE_URL: 'postgres://neon' })).toBe('postgres://neon');
  });

  it('accepts POSTGRES_URL, which is what a hand-pasted string is usually called', () => {
    expect(pickDatabaseUrl({ POSTGRES_URL: 'postgres://hand' })).toBe('postgres://hand');
  });

  it('ignores empty values rather than handing the driver an empty string', () => {
    expect(pickDatabaseUrl({ DATABASE_URL: '   ', STORAGE_DATABASE_URL: 'postgres://real' })).toBe('postgres://real');
  });

  it('says nothing when there is genuinely nothing', () => {
    expect(pickDatabaseUrl({})).toBeUndefined();
    expect(pickDatabaseUrl(undefined)).toBeUndefined();
    expect(pickDatabaseUrl({ VITE_SYNC_MODE: 'neon' })).toBeUndefined();
  });

  it('trims stray whitespace copied along with the string', () => {
    expect(pickDatabaseUrl({ DATABASE_URL: '  postgres://x  ' })).toBe('postgres://x');
  });
});

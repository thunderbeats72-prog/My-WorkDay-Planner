/**
 * Which environment variable holds the Postgres connection string?
 *
 * One deployment is not one spelling. Vercel's Neon integration can prefix its
 * variables with the storage name (`MY_PLANNER_DATABASE_URL`); a connection
 * string pasted by hand is usually `POSTGRES_URL`; Neon's own docs use
 * `DATABASE_URL`. Looking for the suffix means a database that *is* attached is
 * always found, instead of the app claiming there is none because the name
 * differed by a prefix.
 */

/** Pooled first: the serverless driver opens one short-lived connection per query. */
export const DATABASE_URL_NAMES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'NEON_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
] as const;

export function pickDatabaseUrl(vars: Record<string, string | undefined> | undefined): string | undefined {
  if (!vars) return undefined;

  for (const name of DATABASE_URL_NAMES) {
    const exact = vars[name];
    if (typeof exact === 'string' && exact.trim()) return exact.trim();
  }

  // A prefixed or otherwise renamed variable, e.g. `STORAGE_DATABASE_URL`.
  const candidates = Object.keys(vars)
    .filter((key) => /(^|_)DATABASE_URL$/i.test(key) || /(^|_)POSTGRES_URL$/i.test(key))
    .sort((a, b) => a.length - b.length);
  for (const key of candidates) {
    const value = vars[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return undefined;
}

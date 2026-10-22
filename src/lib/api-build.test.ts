import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the way Vercel builds serverless functions.
 *
 * A deployment failed with these, and the deploy still reported success while
 * every /api route returned 404 — which looked, from the phone, like "the
 * password is wrong":
 *
 *   error TS2835: Relative import paths need explicit file extensions
 *   error TS2591: Cannot find name 'process'
 *
 * Vercel type-checks each function on its own, without necessarily reading this
 * project's tsconfig. These assertions keep the source compatible with that,
 * without needing to shell out to tsc from a test.
 */

const API = resolve(process.cwd(), 'api');

function apiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return apiFiles(full);
    return entry.endsWith('.ts') ? [full] : [];
  });
}

const files = apiFiles(API).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

describe('serverless function sources', () => {
  it('finds the API routes', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('every relative import carries an explicit .js extension', () => {
    // node16 resolution demands it; the bundler used locally accepts it.
    for (const { path, source } of files) {
      for (const match of source.matchAll(/from\s+'(\.{1,2}\/[^']*)'/g)) {
        expect(match[1], `${path} imports ${match[1]}`).toMatch(/\.js$/);
      }
    }
  });

  it('never reads `process.env` directly — it is typed through globalThis', () => {
    for (const { path, source } of files) {
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(withoutComments, `${path} uses process.env directly`).not.toMatch(/(?<!\.)\bprocess\s*\./);
    }
  });

  it('never reaches for `globalThis.crypto` untyped', () => {
    for (const { path, source } of files) {
      expect(source, `${path} uses globalThis.crypto directly`).not.toContain('globalThis.crypto.');
    }
  });

  it('every route file exports a default handler', () => {
    // A file that compiles but exports nothing deploys and then 500s on every
    // call, which is the same silence as not deploying at all.
    for (const { path, source } of files) {
      if (/[\\/]_lib[\\/]/.test(path)) continue;
      expect(source, `${path} has no default export`).toMatch(/export default async function handler/);
    }
  });

  it('ships a tsconfig that turns on node types', () => {
    const config = JSON.parse(readFileSync(join(API, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { types?: string[] };
    };
    expect(config.compilerOptions?.types).toContain('node');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The first 400 milliseconds.
 *
 * The static cover in `index.html` is painted before any JavaScript runs, so it
 * is the only thing standing between a cold phone and a white rectangle. It is
 * also easy to break silently — a removed element, a missing hand-over, a white
 * background in dark mode. These are the invariants that keep it honest.
 */

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe('the boot cover', () => {
  it('exists in the first paint, before the app is mounted', () => {
    expect(html).toContain('id="boot"');
    expect(html.indexOf('id="boot"')).toBeLessThan(html.indexOf('id="root"'));
  });

  it('is an ink panel, not a white flash', () => {
    expect(html).toMatch(/#boot\s*\{[^}]*background:\s*#0b0b0e/i);
    expect(html).toMatch(/#boot\s*\{[^}]*color:\s*#f4f4f6/i);
  });

  it('draws the same arc as the logo', () => {
    // 537/829 at radius 132 is the shared geometry in lib/brandGeometry; the
    // cover starts at zero dash and draws up to the real arc.
    expect(html).toContain('stroke-dasharray="0 829"');
    expect(html).toMatch(/@keyframes boot-arc \{ to \{ stroke-dasharray: 537 829; \} \}/);
    expect(html).toMatch(/r="132"/);
    expect(html).toMatch(/cy="124"/);
  });

  it('dreams up its own theme before the first pixel', () => {
    // IndexedDB cannot answer synchronously, so the resolved theme is mirrored
    // to localStorage and read here — otherwise dark mode flashes light.
    expect(html).toContain("localStorage.getItem('workday.theme.v1')");
    expect(html).toContain("dataset.theme");
    expect(app).toContain("localStorage.setItem('workday.theme.v1'");
  });

  it('is handed over by the app, with a fallback if the bundle never loads', () => {
    expect(main).toContain("getElementById('boot')");
    expect(main).toContain("classList.add('is-done')");
    expect(html).toMatch(/setTimeout\([\s\S]{0,200}is-done/);
  });

  it('respects a reduced-motion preference', () => {
    expect(html).toContain('prefers-reduced-motion: reduce');
  });
});

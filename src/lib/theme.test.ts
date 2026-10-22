import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against the whole class of bug this file was written for: a token that
 * every rule still references being quietly redefined to something that paints
 * nothing.
 *
 * That is not hypothetical. `--grad-primary` was set to `none` when gradients
 * were removed, and 19 rules — the floating add button, every progress bar, the
 * capacity bars — kept using it. Nothing drew. Nobody noticed, because an
 * invisible element looks like a design choice.
 */

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

/** Every `--name: value;` declaration, in source order. */
function tokenDefinitions(name: string): string[] {
  const pattern = new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g');
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) values.push(match[1].trim());
  return values;
}

/** The value that actually applies: the last definition in the cascade. */
function lastDefinition(name: string): string | undefined {
  const all = tokenDefinitions(name);
  return all[all.length - 1];
}

const PAINT_TOKENS = ['--grad-primary', '--grad-success', '--grad-warm', '--grad-danger'];

describe('paint tokens always paint something', () => {
  for (const token of PAINT_TOKENS) {
    it(`${token} resolves to a real colour, not none`, () => {
      const value = lastDefinition(token);
      expect(value, `${token} is never defined`).toBeTruthy();
      expect(value).not.toBe('none');
      expect(value).not.toBe('transparent');
      expect(value).not.toBe('');
    });
  }

  it('every rule that uses a paint token has something to paint with', () => {
    const usages = [...css.matchAll(/var\((--grad-[a-z-]+)\)/g)].map((match) => match[1]);
    expect(usages.length).toBeGreaterThan(0);
    for (const token of new Set(usages)) {
      expect(lastDefinition(token), `${token} used but resolves to nothing`).not.toBe('none');
    }
  });

  it('no gradients came back — the tokens are solids', () => {
    for (const token of PAINT_TOKENS) {
      expect(lastDefinition(token)).not.toContain('gradient');
    }
  });
});

describe('decorative rules are not painted with a dead token', () => {
  it('the page-title rule has a visible colour', () => {
    // It once used `--grad-primary`, which resolved to nothing. The cascade
    // decides this, so the LAST block for the selector is the one that counts.
    const blocks = [...css.matchAll(/\.page-header \.eyebrow::before\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    const body = blocks[blocks.length - 1];
    expect(body).not.toContain('--grad-');
    expect(body).toMatch(/background:\s*var\(--(text|text-soft|ink|border)/);
  });

  it('page titles are solid ink, not gradient-clipped text', () => {
    // Gradient-clipped headings faded out on long titles in dark mode. Media
    // queries add blocks without restating the colour, so the rule is "no block
    // clips the text" rather than "the last block sets the colour".
    const blocks = [...css.matchAll(/\.page-header h1\s*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const body of blocks) {
      expect(body).not.toContain('-webkit-text-fill-color: transparent');
      expect(body).not.toMatch(/background:\s*linear-gradient/);
    }
    expect(blocks.some((body) => body.includes('color: var(--text)'))).toBe(true);
  });
});

describe('motion is opt-out-able', () => {
  it('a reduced-motion block exists and kills animation', () => {
    // Several layers each added one; the last one must be the global opt-out.
    const index = css.lastIndexOf('prefers-reduced-motion: reduce');
    expect(index).toBeGreaterThan(-1);
    const tail = css.slice(index, index + 800);
    expect(tail).toContain('animation-duration: 0.01ms');
    expect(tail).toContain('transition-duration: 0.01ms');
  });

  it('the glow tokens stay switched off — no halo came back', () => {
    expect(lastDefinition('--glow-primary')).toBe('none');
  });
});

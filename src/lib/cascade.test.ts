import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRules, resolve, specificity, type Viewport } from './cascade';

/**
 * What the phone actually computes.
 *
 * Not "does a mobile block exist" — that was true the whole time the mobile
 * screen looked broken. These assertions evaluate the cascade: every rule that
 * could match, its media context, its specificity, and the source order that
 * breaks a tie. If a later layer re-shows a bar on a phone, one of these fails.
 */

const css = readFileSync(resolvePath(process.cwd(), 'src/styles.css'), 'utf8');
const shell = readFileSync(resolvePath(process.cwd(), 'src/components/Shell.tsx'), 'utf8');
const rules = parseRules(css);

const phone: Viewport = { width: 390, height: 844, coarse: true };
const smallPhone: Viewport = { width: 320, height: 640, coarse: true };
const tablet: Viewport = { width: 900, height: 1200, coarse: true };
const laptop: Viewport = { width: 1280, height: 900 };

/** Every selector in the sheet that could match this class on some ancestor. */
function candidatesFor(className: string): string[] {
  const found = new Set<string>();
  for (const rule of rules) {
    const last = rule.selector.split(/[\s>+~]+/).pop() ?? '';
    if (last === `.${className}`) found.add(rule.selector);
  }
  return [...found];
}

function displayOn(className: string, view: Viewport): string | undefined {
  return resolve(rules, candidatesFor(className), 'display', view)?.value;
}

describe('the phone has exactly one top bar', () => {
  it('hides the desktop utility bar below the tablet breakpoint', () => {
    // The bug: `.utility-bar { display: flex }` was appended after the
    // `max-width: 767px` block that hid it, and a media query adds no
    // specificity, so both bars stacked on a phone.
    expect(displayOn('utility-bar', phone)).toBe('none');
    expect(displayOn('utility-bar', smallPhone)).toBe('none');
  });

  it('keeps the utility bar on a laptop and a tablet', () => {
    expect(displayOn('utility-bar', laptop)).toBe('flex');
    expect(displayOn('utility-bar', tablet)).toBe('flex');
  });

  it('shows the mobile bar only where it belongs', () => {
    expect(displayOn('mobile-topbar', phone)).toBe('grid');
    expect(displayOn('mobile-topbar', smallPhone)).toBe('grid');
    expect(displayOn('mobile-topbar', tablet)).toBe('none');
    expect(displayOn('mobile-topbar', laptop)).toBe('none');
  });

  it('shows the bottom bar on phones only', () => {
    expect(displayOn('bottom-nav', phone)).not.toBe('none');
    expect(displayOn('bottom-nav', laptop)).toBe('none');
  });

  it('never shows the sidebar on a phone', () => {
    expect(displayOn('sidebar', phone)).toBe('none');
    expect(displayOn('sidebar', smallPhone)).toBe('none');
  });
});

describe('the header does not strand its actions', () => {
  it('drops the horizontal flex basis once the header stacks', () => {
    // `flex: 1 1 320px` on a column is a 320px *height* — the hole under every
    // mobile page title.
    const block = [...css.matchAll(/\.page-header > div:first-child\s*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(block.length).toBeGreaterThan(1);
    const last = block[block.length - 1];
    expect(last).toMatch(/flex:\s*0 0 auto/);
  });
});

describe('the phone bar is laid out, not squeezed', () => {
  it('has no spacer competing with the wordmark for the leftover width', () => {
    // `.mobile-brand { flex: 1 }` next to `.mobile-spacer { flex: 1 }` split the
    // row in half, which is why the name rendered as "Wor…". The spacer is gone
    // from both the markup and the sheet.
    expect(css).not.toContain('.mobile-spacer');
    expect(shell).not.toContain('mobile-spacer');
  });

  it('gives the name the middle of a three-column grid', () => {
    const block = css.lastIndexOf('.app-shell .mobile-topbar');
    expect(block).toBeGreaterThan(-1);
    const body = css.slice(block, css.indexOf('}', block));
    expect(body).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
  });

  it('draws one hairline under the header, not two', () => {
    // `.brand` used to add a second border above the one `.sidebar-head` draws.
    const brandRules = [...css.matchAll(/\.sidebar \.brand\s*\{([^}]*)\}/g)].map((match) => match[1]);
    const last = brandRules[brandRules.length - 1] ?? '';
    expect(last).toMatch(/border-bottom:\s*0/);
  });
});

describe('the bottom bar draws one marker', () => {
  it('resets the dot geometry instead of inheriting it', () => {
    // Two generations of CSS drew two markers; the later dot inherited
    // `top: 1px` from the first rule and hung off the item's edge.
    const last = css.slice(css.lastIndexOf('.app-shell .bottom-nav .bottom-nav-item.active::after'));
    const body = last.slice(0, last.indexOf('}'));
    expect(body).toContain('top: 0');
    expect(body).toContain('bottom: auto');
    expect(body).toContain('margin-left: -9px');
  });
});

describe('the tablet bar gives way before its buttons do', () => {
  it('collapses the import button to its icon and ellipsises the search', () => {
    const at = css.indexOf('.utility-import span');
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf('}', at));
    expect(body).toMatch(/display:\s*none/);
    // And it must live inside a rule that matches at that width.
    expect(css.lastIndexOf('@media (min-width: 768px) and (max-width: 1080px)', at)).toBeGreaterThan(-1);
    expect(css).toMatch(/\.utility-search span \{[^}]*text-overflow: ellipsis/);
  });
});

describe('phones do not zoom when a field is focused', () => {
  it('sets every text field to 16px', () => {
    // Safari zooms the page when a focused control is under 16px. That zoom is
    // what pushed the New task sheet off-screen and made "+" look dead.
    const at = css.indexOf("input:not([type='checkbox'])");
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf('}', at));
    expect(body).toMatch(/font-size:\s*16px/);
    // Either a phone width or a finger. A landscape phone matches only the second.
    const prelude = css.slice(css.lastIndexOf('@media', at), at);
    expect(prelude).toMatch(/max-width: 767px|pointer: coarse/);
  });

  it('does not stretch page actions into full-width rows', () => {
    const blocks = [...css.matchAll(/\.page-actions \.btn\s*\{([^}]*)\}/g)].map((match) => match[1]);
    const last = blocks[blocks.length - 1] ?? '';
    expect(last).toMatch(/flex:\s*0 1 auto/);
    expect(last).toMatch(/width:\s*auto/);
  });
});

describe('the reader itself', () => {
  it('ranks a class-selector pair above a single class', () => {
    expect(specificity('.app-shell .utility-bar')[1]).toBe(2);
    expect(specificity('.utility-bar')[1]).toBe(1);
  });

  it('breaks a specificity tie by source order', () => {
    const sample = parseRules('.x{display:block}.x{display:none}');
    expect(resolve(sample, ['.x'], 'display', phone)?.value).toBe('none');
  });

  it('lets !important beat specificity', () => {
    const sample = parseRules('.x{display:block !important}.a .x{display:none}');
    expect(resolve(sample, ['.x', '.a .x'], 'display', phone)?.value).toBe('block');
  });

  it('treats a comma as "or"', () => {
    const sample = parseRules('@media (max-width: 767px), (pointer: coarse){.x{display:none}}');
    expect(resolve(sample, ['.x'], 'display', phone)?.value).toBe('none');
    // A wide screen with a mouse matches neither half.
    expect(resolve(sample, ['.x'], 'display', laptop)).toBeNull();
  });

  it('evaluates a media query rather than assuming it applies', () => {
    const sample = parseRules('@media (max-width: 500px){.x{display:none}}');
    expect(resolve(sample, ['.x'], 'display', phone)?.value).toBe('none');
    expect(resolve(sample, ['.x'], 'display', laptop)).toBeNull();
  });

  it('ignores conditions it does not understand', () => {
    const sample = parseRules('@media (min-width: 500px) and (min-resolution: 2dppx){.x{display:none}}');
    expect(resolve(sample, ['.x'], 'display', laptop)).toBeNull();
  });
});

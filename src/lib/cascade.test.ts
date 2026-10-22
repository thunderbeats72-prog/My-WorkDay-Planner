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

/** Every rule body whose prelude contains `needle`, in source order. */
function blocksOf(needle: string): Array<{ index: number; body: string }> {
  const found: Array<{ index: number; body: string }> = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(needle, from);
    if (at === -1) break;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    found.push({ index: at, body: css.slice(open + 1, close) });
    from = at + needle.length;
  }
  return found;
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
    const grid = blocksOf('.app-shell .mobile-topbar').find((block) => block.body.includes('grid-template-columns'));
    expect(grid?.body).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
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

describe('one floating control, on one page', () => {
  it('hides the back-to-top arrow on a phone', () => {
    // It floated in the empty band at the bottom of short pages, in the same
    // corner as the add button, and a tap could land on whichever was on top.
    const hidden = blocksOf('.back-to-top').filter((block) => /display:\s*none/.test(block.body));
    expect(hidden.length).toBeGreaterThan(0);
    const at = hidden[hidden.length - 1].index;
    expect(css.slice(css.lastIndexOf('@media', at), at)).toMatch(/max-width: 767px/);
  });

  it('keeps the page clear of the add button only where it exists', () => {
    // My Tasks reserves room for its +; every other page ends at the bar.
    expect(css).toMatch(/\.app-shell:has\(\.fab\) \.page-container\s*\{[^}]*136px/);
    const plain = blocksOf('.page-container').filter((block) => /96px/.test(block.body));
    expect(plain.length).toBeGreaterThan(0);
  });
});

describe('the sheet is a plain child of the screen', () => {
  it('is in normal flow, not positioned off the viewport', () => {
    // Every earlier attempt gave the sheet `position: fixed`, `inset: 0` or a
    // `dvh` height, and each was a way for it to end up somewhere other than
    // in front of the reader. A normal flex child cannot leave the screen.
    expect(resolve(rules, ['.modal-backdrop .modal'], 'position', phone)?.value).toBe('relative');
    expect(resolve(rules, ['.modal-backdrop .modal'], 'height', phone)?.value).toBe('auto');
    expect(resolve(rules, ['.modal-backdrop .modal'], 'inset', phone)?.value).toBe('auto');
  });

  it('caps itself as a share of the backdrop, which has a definite height', () => {
    const value = resolve(rules, ['.modal-backdrop .modal'], 'max-height', phone)?.value ?? '';
    expect(value).toMatch(/%$/);
  });

  it('sits above the bottom bar, the add button and toasts', () => {
    const z = Number(resolve(rules, ['.modal-backdrop'], 'z-index', phone)?.value ?? 0);
    expect(z).toBeGreaterThan(100);
  });

  it('lets the body scroll while the head and footer stay put', () => {
    const body = blocksOf('.modal-backdrop .modal-body')[0]?.body ?? '';
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('min-height: 0');
  });
});

describe('onboarding clears the notch', () => {
  it('adds the top safe area to the cover', () => {
    const blocks = blocksOf('.onboarding-brand').filter((b) => b.body.includes('safe-area-inset-top'));
    expect(blocks.length).toBeGreaterThan(0);
    const at = blocks[blocks.length - 1].index;
    expect(css.slice(css.lastIndexOf('@media', at), at)).toMatch(/max-width: 767px/);
  });

  it('does not reserve a screenful of height under the cover', () => {
    const blocks = blocksOf('.onboarding-card');
    expect(blocks[blocks.length - 1].body).toMatch(/min-height:\s*0/);
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

/* =========================================================================
   Design v15 — the width of a phone, and the button that floats over it
   ========================================================================= */

const html = readFileSync(resolvePath(process.cwd(), 'index.html'), 'utf8');
const effects = readFileSync(resolvePath(process.cwd(), 'src/hooks/useAmbientEffects.ts'), 'utf8');

/** Declarations for `property` in the last rule whose selector list includes `selector`. */
function lastDeclaration(selector: string, property: string, view: Viewport): string | undefined {
  return resolve(rules, [selector], property, view)?.value;
}

/** Every rule body whose selector is exactly `selector`, in source order. */
function bodiesOf(selector: string): string[] {
  return rules.filter((rule) => rule.selector === selector).map((rule) =>
    rule.declarations.map((declaration) => `${declaration.property}: ${declaration.value}`).join('; '),
  );
}

describe('the week strip never widens a phone', () => {
  it('has no fixed column floor on a phone', () => {
    // Seven 46px tiles plus gaps is 358px — wider than a 320–390px card. The
    // grid then set the page's min-content width and every card on Today was
    // clipped at the right edge.
    const strip = bodiesOf('.week-strip').join(' | ');
    expect(strip).not.toMatch(/repeat\(7,\s*minmax\(4[26]px/);
    expect(strip).toMatch(/repeat\(7,\s*minmax\(0(px)?,\s*1fr\)\)/);
  });

  it('lets a day tile shrink instead of claiming a minimum', () => {
    expect(lastDeclaration('.week-strip-day', 'min-width', phone)).toBe('0');
    expect(lastDeclaration('.week-strip-day', 'min-width', smallPhone)).toBe('0');
  });

  it('does not scroll sideways — it fits by design', () => {
    // An overflow container would have hidden the bug rather than fixed it,
    // and it swallowed the tile edges on a narrow phone.
    expect(lastDeclaration('.week-strip', 'overflow-x', phone)).not.toBe('auto');
  });
});

describe('a page is never wider than the screen', () => {
  it('gives every layout container permission to be narrower than its content', () => {
    for (const selector of ['.app-main', '.page-container', '.page', '.dashboard-grid', '.dashboard-main', '.report-grid']) {
      expect(lastDeclaration(selector, 'min-width', phone)).toBe('0');
    }
  });

  it('caps the document at the viewport', () => {
    expect(lastDeclaration('body', 'max-width', phone)).toBe('100%');
    expect(lastDeclaration('html', 'max-width', phone)).toBe('100%');
  });
});

describe('the add button stays put', () => {
  it('is still fixed, even if something paints inside it', () => {
    // `.ripple-ready` is `position: relative`; on the add button that made it a
    // flex child of the shell, which is what moved it off the corner.
    expect(lastDeclaration('.fab.ripple-ready', 'position', phone)).toBe('fixed');
    expect(lastDeclaration('button.ripple-ready.fab', 'position', phone)).toBe('fixed');
  });

  it('is never a ripple host in the hook', () => {
    expect(effects).toContain("button.classList.contains('fab')");
    expect(effects).toContain("position === 'fixed'");
  });

  it('is not covered by a toast on a phone', () => {
    // Both were pinned to the bottom-right corner, so any message — a saved
    // task included — sat exactly on top of the button for six seconds.
    const bottom = lastDeclaration('.toast-stack', 'bottom', phone) ?? '';
    const px = Number(/([\d.]+)px/.exec(bottom)?.[1] ?? 0);
    // The button's top edge is 80px + its 52px height from the bottom.
    expect(px).toBeGreaterThanOrEqual(80 + 52);
  });
});

describe('zoom is pinned, text is not', () => {
  it('asks the browser not to zoom the phone layout', () => {
    const meta = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(meta).toContain('user-scalable=no');
    expect(meta).toContain('maximum-scale=1');
    expect(meta).toContain('viewport-fit=cover');
  });

  it('keeps a double-tap or a pinch from scaling the page', () => {
    // `manipulation` would be wrong: it still permits pinch zoom.
    expect(lastDeclaration('html', 'touch-action', phone)).toBe('pan-x pan-y');
    expect(lastDeclaration('body', 'touch-action', phone)).toBe('pan-x pan-y');
  });

  it('leaves form fields their own gestures, so a caret still works', () => {
    expect(lastDeclaration('input', 'touch-action', phone)).toBe('auto');
    expect(lastDeclaration('textarea', 'touch-action', phone)).toBe('auto');
  });

  it('does not disable text resizing altogether', () => {
    expect(lastDeclaration('html', 'text-size-adjust', phone)).toBe('100%');
  });
});

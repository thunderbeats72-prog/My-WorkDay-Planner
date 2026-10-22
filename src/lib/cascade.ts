/**
 * A small CSS cascade reader, for tests only.
 *
 * The phone chrome broke twice in the same way: a `display: none` inside a
 * `max-width` media query was undone by an unconditional rule further down the
 * file. A media query does not add specificity, so "it is in the phone block"
 * is not enough — the winner is decided by specificity, then by source order.
 *
 * Reading the cascade properly is a few dozen lines, and it catches the class
 * of bug a grep cannot: it answers "on a 390px screen, what does this element
 * actually compute to?" instead of "does a rule exist somewhere?".
 *
 * It handles the subset this stylesheet uses: media queries with min/max
 * width and height, `prefers-reduced-motion`, `pointer`, `hover`, `print`, and
 * plain rules (no nested selectors). Anything it does not understand is
 * treated as not matching, which fails closed.
 */

export interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

export interface Rule {
  selector: string;
  declarations: Declaration[];
  /** Enclosing `@media` preludes, outermost first. */
  media: string[];
  /** Source order, for the tie-break when specificity is equal. */
  order: number;
}

export interface Viewport {
  width: number;
  height?: number;
  /** `(pointer: coarse)` — a finger, not a mouse. */
  coarse?: boolean;
  /** `(prefers-reduced-motion: reduce)`. */
  reduceMotion?: boolean;
  print?: boolean;
}

/** Skip an at-rule body by matching braces, so keyframes cannot confuse us. */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return css.length - 1;
}

/** Split on `;` while respecting strings and parentheses (data URIs contain both). */
function splitDeclarations(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      current += char;
      if (char === quote && body[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Comments carry no meaning and used to swallow the declaration after them. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function parseDeclarations(body: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const raw of splitDeclarations(stripComments(body))) {
    const colon = raw.indexOf(':');
    if (colon === -1) continue;
    const property = raw.slice(0, colon).trim().toLowerCase();
    if (!/^[a-z-]+$/.test(property)) continue;
    let value = raw.slice(colon + 1).trim();
    const important = /!important\s*$/i.test(value);
    if (important) value = value.replace(/!important\s*$/i, '').trim();
    if (!value) continue;
    declarations.push({ property, value, important });
  }
  return declarations;
}

export function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let order = 0;

  const walk = (chunk: string, media: string[]): void => {
    let index = 0;
    let buffer = '';
    while (index < chunk.length) {
      const char = chunk[index];
      if (char === '/' && chunk[index + 1] === '*') {
        const end = chunk.indexOf('*/', index + 2);
        index = end === -1 ? chunk.length : end + 2;
        continue;
      }
      if (char === '{') {
        const prelude = buffer.trim();
        buffer = '';
        const close = matchingBrace(chunk, index);
        const body = chunk.slice(index + 1, close);
        if (prelude.startsWith('@')) {
          const kind = /^@([a-z-]+)/i.exec(prelude)?.[1]?.toLowerCase() ?? '';
          if (kind === 'media') {
            walk(body, [...media, prelude.replace(/^@media\s*/i, '').trim()]);
          } else if (kind === 'supports' || kind === 'layer') {
            // No conditions to evaluate here; treat as always applied.
            walk(body, media);
          }
          // @keyframes, @font-face, @property: nothing to resolve.
        } else {
          const declarations = parseDeclarations(body);
          for (const selector of prelude.split(',').map((part) => part.replace(/\s+/g, ' ').trim())) {
            if (selector) rules.push({ selector, declarations, media, order: order++ });
          }
        }
        index = close + 1;
        continue;
      }
      if (char === '}') {
        buffer = '';
        index += 1;
        continue;
      }
      buffer += char;
      index += 1;
    }
  };

  walk(css, []);
  return rules;
}

function mediaMatches(query: string, view: Viewport): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;

  // A comma is "or": `(max-width: 767px), (pointer: coarse)`.
  if (trimmed.includes(',')) {
    return trimmed.split(',').some((part) => mediaMatches(part, view));
  }

  return trimmed.split(/\s+and\s+/).every((raw) => {
    const part = raw.trim().replace(/^\(/, '').replace(/\)$/, '');
    if (part === 'print') return Boolean(view.print);
    if (part === 'screen') return !view.print;

    const size = /^(min|max)-(width|height)\s*:\s*([\d.]+)(px|em|rem)?$/.exec(part);
    if (size) {
      const px = Number(size[3]) * (size[4] === 'em' || size[4] === 'rem' ? 16 : 1);
      const actual = size[2] === 'width' ? view.width : (view.height ?? 900);
      return size[1] === 'min' ? actual >= px : actual <= px;
    }

    if (part.startsWith('prefers-reduced-motion')) {
      return part.includes('no-preference') ? !view.reduceMotion : Boolean(view.reduceMotion);
    }
    if (part.startsWith('pointer')) return part.includes('coarse') ? Boolean(view.coarse) : !view.coarse;
    if (part.startsWith('hover')) return view.coarse ? part.includes('none') : !part.includes('none');
    if (part.startsWith('orientation')) return true;

    // Unknown condition: fail closed, so a rule we cannot reason about is
    // never treated as applying.
    return false;
  });
}

/** Specificity as (ids, classes/attributes/pseudo-classes, types/pseudo-elements). */
export function specificity(selector: string): [number, number, number] {
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const attributes = (selector.match(/\[[^\]]*\]/g) ?? []).length;
  const pseudoClasses = (selector.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length;
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const pseudoElements = (selector.match(/::[\w-]+/g) ?? []).length;
  const types = selector
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?/g, ' ')
    .split(/[\s>+~]+/)
    .filter((token) => /^[a-zA-Z][\w-]*$/.test(token)).length;

  return [ids, classes + attributes + pseudoClasses, types + pseudoElements];
}

function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export interface Winner {
  value: string;
  selector: string;
  order: number;
  media: string[];
}

/**
 * Which declaration wins for `property`, given every selector that could match
 * the element. Pass all of them — the point is to compare them honestly rather
 * than to guess which one the browser picked.
 */
export function resolve(
  rules: Rule[],
  selectors: string[],
  property: string,
  view: Viewport,
): Winner | null {
  let best: { winner: Winner; specificity: [number, number, number]; important: boolean } | null = null;

  for (const rule of rules) {
    if (!selectors.includes(rule.selector)) continue;
    if (!rule.media.every((query) => mediaMatches(query, view))) continue;
    const weight = specificity(rule.selector);

    for (const declaration of rule.declarations) {
      if (declaration.property !== property) continue;
      const candidate = {
        winner: { value: declaration.value, selector: rule.selector, order: rule.order, media: rule.media },
        specificity: weight,
        important: declaration.important,
      };
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.important !== best.important) {
        if (candidate.important) best = candidate;
        continue;
      }
      const bySpecificity = compareSpecificity(weight, best.specificity);
      if (bySpecificity > 0 || (bySpecificity === 0 && rule.order >= best.winner.order)) best = candidate;
    }
  }

  return best?.winner ?? null;
}

/**
 * Privacy blur — client names and task titles go soft when you step away.
 *
 * A planner on a desk in a shared office shows other people's company names
 * to whoever walks past. The rule is deliberately mechanical and testable:
 * blur when the tab is hidden, or when nobody has touched the page for a
 * minute; unblur at the first pointer move or key. Nothing is hidden from
 * the app itself — this is a visual wash, not an access control — and the
 * whole layer switches off for anyone who would rather see their screen.
 */

/** How long without input before the screen softens. */
export const PRIVACY_IDLE_MS = 60_000;

export interface PrivacyState {
  /** The setting itself; off means never blur, whatever else is true. */
  enabled: boolean;
  /** The tab is hidden — blurring costs nothing because nobody is looking. */
  hidden: boolean;
  /** Milliseconds since the last pointer or key activity. */
  idleMs: number;
  /** Override for tests and future settings; defaults to `PRIVACY_IDLE_MS`. */
  thresholdMs?: number;
}

/** One sentence the whole feature obeys. */
export function shouldBlur(state: PrivacyState): boolean {
  if (!state.enabled) return false;
  if (state.hidden) return true;
  return state.idleMs >= (state.thresholdMs ?? PRIVACY_IDLE_MS);
}

/** The body attribute CSS hangs off — one value, decided in one place. */
export function privacyAttribute(blurred: boolean): 'true' | 'false' {
  return blurred ? 'true' : 'false';
}

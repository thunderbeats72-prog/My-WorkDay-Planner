/**
 * Haptics — a short buzz when something lands.
 *
 * Only the Vibration API is usable from a web page, which means this works on
 * Android phones and, by Apple's long-standing policy, not on iPhones. The
 * function reports whether the phone actually buzzed, so callers never have to
 * guess and nothing pretends to have happened.
 *
 * Three rules keep it from being annoying:
 *   · off on a desktop, where a mouse has nothing to vibrate;
 *   · off when the reader asked for reduced motion (the same setting usually
 *     means "no buzzing either");
 *   · off when the reader turned it off in Settings → Appearance.
 */

export type HapticPattern = 'tap' | 'press' | 'success' | 'warning';

/** Short enough to feel like a key click, not a notification. */
const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 8,
  press: 14,
  success: [10, 40, 18],
  warning: [18, 50, 18],
};

export const HAPTICS_KEY = 'workday.haptics.v1';

export function hapticsEnabled(): boolean {
  try {
    return window.localStorage.getItem(HAPTICS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(HAPTICS_KEY, enabled ? 'on' : 'off');
  } catch {
    /* Private mode: the preference lasts for this page's life and no longer. */
  }
}

/** True only when this device can buzz at all — used to hide the setting. */
export function canHaptic(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function haptic(pattern: HapticPattern = 'tap'): boolean {
  if (!canHaptic() || !hapticsEnabled()) return false;

  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  if (!coarse) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return false;

  try {
    return navigator.vibrate(PATTERNS[pattern]);
  } catch {
    return false;
  }
}

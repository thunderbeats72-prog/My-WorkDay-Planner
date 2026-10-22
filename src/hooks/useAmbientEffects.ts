import { useEffect } from 'react';

/**
 * Global, delegated micro-interaction: a soft ripple that grows from the
 * pointer on any button.
 *
 * There is deliberately no cursor-tracking highlight — surfaces stay flat and
 * calm when the pointer moves across them. Everything is skipped when the
 * visitor prefers reduced motion, on a coarse pointer (touch), and on controls
 * that do not sit in normal flow, and every listener is cleaned up on unmount.
 */

const RIPPLE_EXCLUDE_SELECTOR = '[data-no-ripple], .menu, .toast-close, .switch';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

/**
 * Fixed and sticky controls are never ripple hosts.
 *
 * Painting the ripple adds `position: relative` so the absolutely-positioned
 * span has something to sit inside. On a floating control that is not a visual
 * detail: a `position: fixed` add button becomes a normal flex child of
 * `.app-shell`, so it drops into the flow — the page narrows by its width, the
 * bottom padding jumps, and the finger that started the press is no longer
 * over the button, which is why the tap "did nothing". The add button is
 * excluded below as well, but the position check covers every future floating
 * control, not just this one.
 */
function isFloating(element: HTMLElement): boolean {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return false;
  const position = window.getComputedStyle(element).position;
  return position === 'fixed' || position === 'sticky';
}

export function useAmbientEffects(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') return;
    if (prefersReducedMotion()) return;

    const onPointerDown = (event: PointerEvent) => {
      /* A ripple under a finger is invisible anyway — the thumb covers it — and
         on touch it can race the tap itself. Only a mouse (or a pen, which is
         precise enough to see it) gets the effect. */
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (isCoarsePointer()) return;
      if (!(event.target instanceof Element)) return;
      /* The add button is the one control where a stray internal span has cost
         a user their tap. Never touch it. */
      const button = event.target.closest<HTMLElement>('button, .ripple-host');
      if (!button) return;
      if (button.classList.contains('fab')) return;
      if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return;
      if (button.closest(RIPPLE_EXCLUDE_SELECTOR)) return;
      if (isFloating(button)) return;

      const rect = button.getBoundingClientRect();
      const diameter = Math.max(rect.width, rect.height) * 2.25;
      if (!diameter) return;

      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.setAttribute('aria-hidden', 'true');
      ripple.style.width = `${diameter}px`;
      ripple.style.height = `${diameter}px`;
      ripple.style.left = `${event.clientX - rect.left - diameter / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - diameter / 2}px`;

      button.classList.add('ripple-ready');
      button.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 700);
    };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.documentElement.classList.add('has-ambient-effects');

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.documentElement.classList.remove('has-ambient-effects');
    };
  }, [enabled]);
}

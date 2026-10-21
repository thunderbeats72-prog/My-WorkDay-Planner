import { useEffect } from 'react';

/**
 * Global, delegated micro-interaction: a soft ripple that grows from the
 * pointer on any button.
 *
 * There is deliberately no cursor-tracking highlight — surfaces stay flat and
 * calm when the pointer moves across them. Everything is skipped when the
 * visitor prefers reduced motion or is on a coarse pointer (touch) device, and
 * every listener is cleaned up on unmount.
 */

const RIPPLE_EXCLUDE_SELECTOR = '[data-no-ripple], .menu, .toast-close, .switch';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useAmbientEffects(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') return;
    if (prefersReducedMotion()) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('button, .ripple-host');
      if (!button) return;
      if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return;
      if (button.closest(RIPPLE_EXCLUDE_SELECTOR)) return;

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

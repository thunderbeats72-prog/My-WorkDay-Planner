import { useEffect } from 'react';

/**
 * Global, delegated micro-interactions that make the UI feel alive without
 * wiring animation state into every component:
 *
 *  - a soft ripple that grows from the pointer on any button
 *  - a cursor-tracking spotlight on cards, panels and the hero
 *
 * Everything is skipped when the visitor prefers reduced motion or is on a
 * coarse pointer (touch) device, and every listener is cleaned up on unmount.
 */

const SPOTLIGHT_SELECTOR = [
  '.card',
  '.task-card',
  '.stat-card',
  '.hero',
  '.timer-card',
  '.onboarding-preview',
  '.dropzone',
  '.palette',
  '.modal',
  '.task-panel',
].join(', ');

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

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    let frame = 0;
    let hovered: HTMLElement | null = null;
    let pointX = 0;
    let pointY = 0;

    const paintSpotlight = () => {
      frame = 0;
      if (!hovered || !hovered.isConnected) return;
      const rect = hovered.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      hovered.style.setProperty('--mx', `${((pointX - rect.left) / rect.width) * 100}%`);
      hovered.style.setProperty('--my', `${((pointY - rect.top) / rect.height) * 100}%`);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!finePointer.matches) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(SPOTLIGHT_SELECTOR) : null;
      if (target !== hovered) {
        if (hovered) hovered.classList.remove('spotlight-active');
        hovered = target;
        if (hovered) hovered.classList.add('spotlight-active');
      }
      if (!hovered) return;
      pointX = event.clientX;
      pointY = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(paintSpotlight);
    };

    const onPointerLeave = () => {
      if (hovered) hovered.classList.remove('spotlight-active');
      hovered = null;
    };

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

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    document.documentElement.classList.add('has-ambient-effects');

    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerleave', onPointerLeave);
      document.documentElement.classList.remove('has-ambient-effects');
      if (hovered) hovered.classList.remove('spotlight-active');
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);
}

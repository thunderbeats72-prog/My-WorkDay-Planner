import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAmbientEffects } from './useAmbientEffects';

/**
 * The ripple must never touch a floating control.
 *
 * `.ripple-ready` is `position: relative`. Painted inside the fixed add button
 * that turns it into a normal flex child: it leaves the bottom-right corner,
 * the page reflows underneath the finger, and the tap lands on nothing. From
 * the outside that reads as "the + button does nothing" — which is exactly how
 * it was reported. These tests keep the hook away from touch input, from
 * fixed controls, and from the add button specifically.
 */

function setMatchMedia(matches: { reduced?: boolean; coarse?: boolean }) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('reduced-motion')
        ? Boolean(matches.reduced)
        : query.includes('coarse')
          ? Boolean(matches.coarse)
          : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** jsdom has no layout, so `getComputedStyle().position` is stubbed per element. */
function positionOf(element: Element, position: string) {
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((target: Element) => {
    const style = original(target);
    if (target === element) return { ...style, position } as CSSStyleDeclaration;
    return style;
  });
}

function pointerDown(target: Element, pointerType = 'mouse') {
  const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }) as PointerEvent;
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

describe('the ambient ripple', () => {
  let host: HTMLButtonElement;
  let floating: HTMLButtonElement;
  let fab: HTMLButtonElement;

  beforeEach(() => {
    setMatchMedia({});
    host = document.createElement('button');
    host.textContent = 'Save';
    floating = document.createElement('button');
    floating.className = 'floating';
    fab = document.createElement('button');
    fab.className = 'fab';
    document.body.append(host, floating, fab);
    // jsdom does not compute layout; a real button has a box, and a zero-size
    // one is skipped by the hook on purpose.
    for (const element of [host, floating, fab]) {
      element.getBoundingClientRect = () =>
        ({ width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    }
  });

  afterEach(() => {
    host.remove();
    floating.remove();
    fab.remove();
    document.documentElement.classList.remove('has-ambient-effects');
  });

  it('paints on an ordinary button for a mouse', () => {
    renderHook(() => useAmbientEffects(true));
    pointerDown(host);
    expect(host.querySelector('.ripple')).not.toBeNull();
    expect(host.classList.contains('ripple-ready')).toBe(true);
  });

  it('leaves the floating add button completely alone', () => {
    renderHook(() => useAmbientEffects(true));
    pointerDown(fab);
    expect(fab.querySelector('.ripple')).toBeNull();
    expect(fab.classList.contains('ripple-ready')).toBe(false);
    expect(fab.getAttribute('style')).toBeNull();
  });

  it('skips a fixed control even when it is not the add button', () => {
    // Any control that has left the flow — a sticky footer button, a floating
    // toolbar — would be moved by `position: relative` just the same.
    positionOf(floating, 'fixed');
    renderHook(() => useAmbientEffects(true));
    pointerDown(floating);
    expect(floating.querySelector('.ripple')).toBeNull();
    expect(floating.classList.contains('ripple-ready')).toBe(false);
  });

  it('does nothing for a finger', () => {
    // A thumb covers the ripple anyway, and on touch the ripple raced the tap.
    renderHook(() => useAmbientEffects(true));
    pointerDown(host, 'touch');
    expect(host.querySelector('.ripple')).toBeNull();
  });

  it('does nothing on a coarse pointer, whatever the event claims', () => {
    setMatchMedia({ coarse: true });
    renderHook(() => useAmbientEffects(true));
    pointerDown(host, 'mouse');
    expect(host.querySelector('.ripple')).toBeNull();
  });

  it('does nothing when motion is reduced', () => {
    setMatchMedia({ reduced: true });
    renderHook(() => useAmbientEffects(true));
    pointerDown(host);
    expect(host.querySelector('.ripple')).toBeNull();
  });

  it('cleans up its listener when the effect goes away', () => {
    const { unmount } = renderHook(() => useAmbientEffects(true));
    unmount();
    pointerDown(host);
    expect(host.querySelector('.ripple')).toBeNull();
    expect(document.documentElement.classList.contains('has-ambient-effects')).toBe(false);
  });
});

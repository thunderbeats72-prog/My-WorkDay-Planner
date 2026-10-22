import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './ui';

/**
 * The sheet must survive the tap that opened it.
 *
 * A phone sends `touchend`, then a compatibility `click` at the same point. If
 * React has mounted the backdrop by then, that click lands on the backdrop and
 * the sheet closes before it is ever seen — which reads as "the + button does
 * nothing". This test reproduces that timing without a phone.
 */

function renderSheet(onClose: () => void) {
  return render(
    <Modal open title="New task" onClose={onClose}>
      <label htmlFor="title">Title</label>
      <input id="title" />
    </Modal>,
  );
}

/** Freeze the clock so "10ms later" means exactly that. */
function freezeClock(start = 1_000_000) {
  let now = start;
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  return {
    advance: (ms: number) => {
      now += ms;
    },
    restore: () => spy.mockRestore(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Modal', () => {
  it('ignores a backdrop tap that arrives with the opening gesture', () => {
    const clock = freezeClock();
    const onClose = vi.fn();
    renderSheet(onClose);

    // Portalled to <body>, so it is not inside the render container.
    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement;
    clock.advance(10); // the compatibility click, a frame after the sheet appeared
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
    clock.restore();
  });

  it('closes when the backdrop is tapped deliberately afterwards', () => {
    const clock = freezeClock();
    const onClose = vi.fn();
    renderSheet(onClose);

    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement;
    clock.advance(600);
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
    clock.restore();
  });

  it('never closes when the tap lands inside the sheet', () => {
    const clock = freezeClock();
    const onClose = vi.fn();
    renderSheet(onClose);

    clock.advance(600);
    fireEvent.click(screen.getByLabelText('Title'));

    expect(onClose).not.toHaveBeenCalled();
    clock.restore();
  });

  it('does not summon the keyboard on a touch screen', async () => {
    // Focusing a field on a phone raises the keyboard, iOS zooms to fit it, and
    // the bottom-anchored sheet ends up behind the keyboard: "+" looked dead.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('coarse'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    vi.useFakeTimers();
    renderSheet(vi.fn());
    vi.advanceTimersByTime(100);

    expect(document.activeElement).not.toBe(screen.getByLabelText('Title'));

    vi.useRealTimers();
    window.matchMedia = original;
  });

  it('lands on the first field on a laptop', async () => {
    vi.useFakeTimers();
    renderSheet(vi.fn());
    vi.advanceTimersByTime(100);

    expect(document.activeElement).toBe(screen.getByLabelText('Title'));

    vi.useRealTimers();
  });

  it('renders nothing when closed', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open={false} title="New task" onClose={onClose}>
        <input aria-label="Title" />
      </Modal>,
    );
    expect(container.querySelector('.modal-backdrop')).toBeNull();
  });
});

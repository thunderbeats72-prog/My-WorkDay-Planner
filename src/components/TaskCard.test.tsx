import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCard, type TaskCardHandlers } from './TaskCard';
import type { Task } from '../lib/types';

/**
 * The "…" menu on a task card has to be reachable on a phone.
 *
 * Two things made it unreachable, and neither was a missing menu item — the
 * items were rendered all along, which is why it looked fine on a laptop and
 * wrong in a pocket:
 *
 *   · The menu lived inside the card, and `.task-card:focus-within` raises the
 *     card to `z-index: 20`. That made a stacking context, so the menu's own
 *     `z-index: 60` could not beat the fixed bottom navigation at 45 —
 *     "Mark blocked" and "Delete" were painted underneath the bar.
 *   · It only ever opened downwards, so the last card on a page pushed the
 *     lower half of the menu off the bottom of the screen.
 *
 * These tests hold the two structural promises that fix both: the menu is
 * portalled out of the card, and it is placed with `position: fixed` above the
 * trigger whenever the bottom of the viewport (or the bottom bar) is nearer
 * than the menu is tall.
 */

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Follow up with Mystery Bakers',
    notes: '',
    client: 'Mystery Bakers',
    category: 'follow_up',
    priority: 'medium',
    estimatedMinutes: 30,
    actualMinutes: 0,
    dueDate: null,
    dueTime: '',
    scheduledFor: null,
    suggestedDate: null,
    suggestedStart: null,
    status: 'todo',
    blocked: false,
    dependencyIds: [],
    deferrals: 0,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    source: 'manual',
    graphRef: null,
    ...overrides,
  };
}

function makeHandlers(): TaskCardHandlers {
  return {
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onToggleComplete: vi.fn(),
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onFinish: vi.fn(),
    onReschedule: vi.fn(),
    onSnooze: vi.fn(),
    onDelete: vi.fn(),
    onToggleBlocked: vi.fn(),
  };
}

function renderCard(handlers: TaskCardHandlers = makeHandlers(), task: Task = makeTask()) {
  return render(
    <TaskCard task={task} now={new Date('2026-10-23T09:00:00.000Z')} elapsedMs={0} isRunning={false} isPaused={false} handlers={handlers} />,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /More actions for/ }));
  return document.querySelector('.menu') as HTMLElement;
}

/** The trigger's wrapper, which is what the menu is positioned against. */
function menuAnchor(): HTMLElement {
  return screen.getByRole('button', { name: /More actions for/ }).parentElement as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('task card menu', () => {
  it('keeps every action, including the ones below the fold', () => {
    renderCard();
    openMenu();

    const items = screen.getAllByRole('menuitem').map((item) => item.textContent?.trim());
    expect(items).toEqual(['Snooze 15m', 'Edit', 'Complete', 'Mark blocked', 'Delete']);
  });

  it('renders outside the card so a stacking context cannot bury it', () => {
    const { container } = renderCard();
    const menu = openMenu();

    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.className).toContain('menu-popover');
  });

  it('flips above the trigger when the bottom bar is closer than the menu is tall', () => {
    /* A short phone with the fixed bar at the very bottom. The anchor sits low
       on the screen — exactly the last-card case in the report. */
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 });

    const nav = document.createElement('div');
    nav.className = 'bottom-nav';
    nav.getBoundingClientRect = () => ({ top: 576, bottom: 640, height: 64, left: 0, right: 360, x: 0, y: 576, width: 360, toJSON: () => ({}) });
    document.body.appendChild(nav);

    renderCard();
    const menu = openMenu();

    /* jsdom has no layout: give the menu and its trigger the sizes a phone
       would produce, then ask the component to place itself again. */
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 232 });
    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 232 });
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 196 });
    const anchor = menuAnchor();
    expect(anchor.className).toContain('menu-wrap');
    anchor.getBoundingClientRect = () => ({ top: 470, bottom: 508, height: 38, left: 296, right: 344, x: 296, y: 470, width: 48, toJSON: () => ({}) });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    const top = Number.parseFloat(menu.style.top);
    const maxHeight = Number.parseFloat(menu.style.maxHeight);
    /* Above the trigger, and the whole menu stays clear of the 576px bar. */
    expect(top).toBeLessThan(470);
    expect(top + Math.min(232, maxHeight)).toBeLessThanOrEqual(576);
    /* Right-aligned to the trigger, then clamped inside the viewport. */
    expect(Number.parseFloat(menu.style.left)).toBe(344 - 196);

    nav.remove();
  });

  it('opens downward and stays inside the viewport when there is room', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    renderCard();
    const menu = openMenu();
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 200 });
    Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 200 });
    Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 196 });
    const anchor = menuAnchor();
    anchor.getBoundingClientRect = () => ({ top: 100, bottom: 138, height: 38, left: 300, right: 344, x: 300, y: 100, width: 48, toJSON: () => ({}) });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(Number.parseFloat(menu.style.top)).toBe(144);
    expect(Number.parseFloat(menu.style.left)).toBe(344 - 196);
  });

  it('closes on Escape, on an outside press, and on the action itself', () => {
    const handlers = makeHandlers();
    renderCard(handlers);

    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.menu')).toBeNull();

    openMenu();
    fireEvent.pointerDown(document.body);
    expect(document.querySelector('.menu')).toBeNull();

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.menu')).toBeNull();
  });

  it('keeps the menu open when the trigger itself is pressed', () => {
    renderCard();
    const trigger = screen.getByRole('button', { name: /More actions for/ });

    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger);
    expect(document.querySelector('.menu')).not.toBeNull();

    fireEvent.click(trigger);
    expect(document.querySelector('.menu')).toBeNull();
  });
});

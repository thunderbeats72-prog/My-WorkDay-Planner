import type { ButtonHTMLAttributes, ComponentType, CSSProperties, ReactNode, RefObject } from 'react';
import { useLayoutEffect, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert, X } from 'lucide-react';
import type { Category, Priority } from '../lib/types';
import { CATEGORIES, PRIORITIES } from '../lib/types';
import { percent } from '../lib/dates';

export type IconComponent = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;

function useCountUp(value: string | number): string | number {
  const target = typeof value === 'number' ? value : null;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (target === null) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof requestAnimationFrame !== 'function') {
      setDisplay(target);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 550);
      setDisplay(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return target === null ? value : display;
}

export function AnimatedValue({ value }: { value: string | number }) {
  const shown = useCountUp(value);
  return <>{shown}</>;
}

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.tone}`}
          style={{ '--toast-index': toasts.length - 1 - index } as CSSProperties}
        >
          <span className="toast-dot" aria-hidden="true" />
          <span className="toast-message">{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.onAction?.();
                onDismiss(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconComponent;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      className={`btn btn-${variant} btn-${size} ${className}`.trim()}
      {...props}
      disabled={props.disabled || loading}
    >
      {Icon ? <Icon size={size === 'sm' ? 14 : 16} className={loading ? 'spin' : ''} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: IconComponent }) {
  return (
    <button type="button" className={`icon-btn ${className}`.trim()} aria-label={label} title={label} {...props}>
      <Icon size={18} />
    </button>
  );
}

/**
 * A menu that cannot be covered or cut off.
 *
 * The card menu used to be a plain child of `.menu-wrap`, which was fine on a
 * laptop and wrong on a phone. Two things compounded:
 *
 *  1. `.task-card:focus-within` raises the card to `z-index: 20`, which creates
 *     a stacking context. The menu's own `z-index: 60` was trapped inside it,
 *     so the fixed bottom navigation (z-index 45) was painted *over* the lower
 *     half of the list — "Edit" and "Complete" showed, "Mark blocked" and
 *     "Delete" did not.
 *  2. It always opened downwards. On the last card of a page there is no room
 *     below, so the menu ran past the bottom of the screen.
 *
 * The menu now lives in `document.body`, which leaves every stacking context
 * behind. It positions itself from the trigger's rectangle, flips above the
 * trigger when the bottom of the screen is nearer than the menu is tall, and
 * stops short of the bottom navigation instead of disappearing underneath it.
 * Whatever still does not fit scrolls inside the menu.
 */
export function MenuPopover({
  open,
  anchorRef,
  onClose,
  align = 'end',
  label,
  className = '',
  children,
}: {
  open: boolean;
  /** The element the menu belongs to — usually the wrapper around the trigger. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: 'start' | 'end';
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const floor = menuFloor();
      const gutter = 8;
      const gap = 6;
      const width = menu.offsetWidth;
      /* `scrollHeight` is the menu's natural height: a `maxHeight` left over
         from the previous placement cannot shrink it and make the menu flip
         back and forth. */
      const naturalHeight = menu.scrollHeight || menu.offsetHeight;
      const roomBelow = floor - rect.bottom - gap;
      const roomAbove = rect.top - gap - gutter;
      const openUp = naturalHeight > roomBelow && roomAbove > roomBelow;
      const maxHeight = Math.max(96, openUp ? roomAbove : roomBelow);
      const height = Math.min(naturalHeight, maxHeight);
      const top = openUp ? Math.max(gutter, rect.bottom - gap - height) : rect.bottom + gap;
      const preferredLeft = align === 'end' ? rect.right - width : rect.left;
      const left = Math.max(gutter, Math.min(preferredLeft, Math.max(gutter, viewportWidth - width - gutter)));
      setFrame({ top, left, maxHeight });
    };
    place();
    /* A second pass after the first paint: the menu is measured while it is
       still parked off-screen, and web fonts or a late-arriving icon can change
       its height between layout and paint. */
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(place) : 0;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      /* A tap on the trigger is the menu's own toggle; closing here as well
         would close and immediately reopen it. */
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={menuRef}
      className={`menu menu-popover ${align === 'end' ? 'menu-right' : ''} ${className}`.trim()}
      role="menu"
      aria-label={label}
      style={{ top: frame?.top ?? -9999, left: frame?.left ?? -9999, maxHeight: frame?.maxHeight }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * The lowest safe edge for a floating menu: the top of the fixed bottom
 * navigation when it is on screen, otherwise the bottom of the viewport.
 */
function menuFloor(): number {
  const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
  const nav = document.querySelector<HTMLElement>('.bottom-nav');
  if (!nav || typeof window.getComputedStyle !== 'function') return viewport;
  const style = window.getComputedStyle(nav);
  if (style.display === 'none' || style.visibility === 'hidden') return viewport;
  const rect = nav.getBoundingClientRect();
  return rect.height > 0 ? Math.min(viewport, rect.top) : viewport;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PriorityBadge({ priority, compact = false }: { priority: Priority; compact?: boolean }) {
  const meta = PRIORITIES[priority];
  return (
    <span className={`priority-badge priority-${priority}`}>
      <span className="priority-bar" aria-hidden="true" />
      <span>{compact ? meta.label.slice(0, 1) : meta.label}</span>
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  const meta = CATEGORIES[category];
  return <span className={`category-badge category-${meta.tone}`}>{meta.label}</span>;
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className = '',
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="field-hint">{hint}</p> : null}
      {error ? (
        <p className="field-error" role="alert">
          <CircleAlert size={13} /> {error}
        </p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: IconComponent;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ProgressBar({ value, tone = 'primary', label }: { value: number; tone?: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`progress ${tone !== 'primary' ? `progress-${tone}` : ''}`.trim()}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Ring({
  value,
  size = 132,
  stroke = 10,
  label,
  sublabel,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  sublabel?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clamped / 100) * circumference}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-label">
        <strong>{label}</strong>
        {sublabel ? <span>{sublabel}</span> : null}
      </div>
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'primary',
}: {
  icon: IconComponent;
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className={`stat-card stat-${tone}`}>
      <span className="stat-icon">
        <Icon size={18} />
      </span>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{shown}</strong>
        {sub ? <span className="stat-sub">{sub}</span> : null}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'segmented-item active' : 'segmented-item'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {typeof option.count === 'number' ? <span className="segmented-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <div className="switch-copy">
        <label htmlFor={id} className="switch-label">
          {label}
        </label>
        {description ? <p className="switch-desc">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'on' : ''}`.trim()}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="switch-knob">{checked ? <Check size={12} /> : null}</span>
      </button>
    </div>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  /**
   * Dismissal has to be earned twice over.
   *
   * A phone sends a compatibility `click` at the same point a moment after
   * `touchend`. If the backdrop has mounted by then, that ghost click lands on
   * it and the sheet closes before it has been seen — which is exactly what
   * "the plus does nothing" feels like from the outside. So a tap closes the
   * sheet only if it *started* on the backdrop and the sheet has been open for
   * a moment. `useLayoutEffect` sets the timestamp before paint, so there is no
   * window in which the guard is still reading zero.
   */
  const openedAt = useRef(0);
  const pressOnBackdrop = useRef(false);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (open) {
      openedAt.current = Date.now();
      pressOnBackdrop.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => {
      const dialog = dialogRef.current;
      if (!dialog) return [] as HTMLElement[];
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === dialogRef.current || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const touch = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    /**
     * Locking the page is what made the layout jump: on a phone the browser
     * re-lays the document when `overflow` flips, so the tap on "+" moved the
     * page and looked like the only thing that happened. On a touch screen the
     * backdrop covers everything and `touch-action: none` already stops the
     * page behind it from scrolling, so the lock buys nothing. A mouse still
     * gets it, because there a scrollbar would appear and shift the width.
     */
    const previousOverflow = document.body.style.overflow;
    if (!touch) document.body.style.overflow = 'hidden';
    /* Focus the first field on a laptop only. On a phone it raises the
       keyboard, iOS zooms to fit it, and the sheet ends up behind it. */
    const focusTimer = touch
      ? 0
      : window.setTimeout(() => {
          const dialog = dialogRef.current;
          if (!dialog) return;
          const target =
            dialog.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ??
            focusables()[0] ??
            dialog;
          target.focus();
        }, 30);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        pressOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        // Must have begun here, and not in the first moments after opening.
        if (!pressOnBackdrop.current) return;
        if (Date.now() - openedAt.current < 400) return;
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton label="Close dialog" icon={X} onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary' | 'success';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
    </Modal>
  );
}

export function SkeletonScreen() {
  return (
    <div className="skeleton-screen" aria-busy="true" aria-label="Loading your planner">
      <p className="skeleton-caption">Preparing your day</p>
      <div className="skeleton skeleton-hero" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="skeleton skeleton-line wide" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line" />
    </div>
  );
}

export function Confetti() {
  const pieces = Array.from({ length: 34 }, (_, index) => index);
  return (
    <>
      <div className="confetti-flash" aria-hidden="true" />
      <div className="confetti" aria-hidden="true">
        {pieces.map((piece) => {
          const drift = Math.round((((piece * 37) % 120) - 60) * 1.6);
          const spin = 280 + ((piece * 61) % 620);
          const delay = ((piece * 29) % 260) / 1000;
          const size = piece % 5 === 0 ? 10 : 7;
          return (
            <span
              key={piece}
              className={`confetti-piece confetti-${piece % 5}`}
              style={
                {
                  left: `${4 + ((piece * 8.7) % 92)}%`,
                  '--drift': `${drift}px`,
                  '--spin': `${spin}deg`,
                  '--delay': `${delay}s`,
                  '--w': `${size}px`,
                  '--h': `${piece % 3 === 0 ? size + 4 : size}px`,
                  '--r': piece % 4 === 0 ? '999px' : '2px',
                } as CSSProperties
              }
            />
          );
        })}
      </div>
    </>
  );
}

export function capacityTone(value: number): string {
  if (value >= 90) return 'danger';
  if (value >= 70) return 'warning';
  return 'success';
}

export function usedPercent(planned: number, capacity: number): number {
  return percent(planned, capacity);
}

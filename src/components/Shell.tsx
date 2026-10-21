import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  AlarmClock,
  ArrowUp,
  CalendarDays,
  ChartColumn,
  CircleCheck as CheckCircleIcon,
  House,
  Image as ImageIcon,
  Inbox,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { PageId, Settings } from '../lib/types';
import { IconButton } from './ui';
import { BrandMark } from './BrandMark';

export const NAV_ITEMS: Array<{ page: PageId; label: string; icon: typeof House; mobile?: boolean }> = [
  { page: 'today', label: 'Today', icon: House, mobile: true },
  { page: 'inbox', label: 'Inbox', icon: Inbox, mobile: true },
  { page: 'schedule', label: 'Schedule', icon: CalendarDays, mobile: true },
  /* Schedule and Overdue both used a calendar glyph — one of them had to change. */
  { page: 'overdue', label: 'Overdue', icon: AlarmClock },
  { page: 'completed', label: 'Completed', icon: CheckCircleIcon },
  { page: 'reports', label: 'Reports', icon: ChartColumn },
  { page: 'import', label: 'Screenshot Import', icon: ImageIcon, mobile: true },
  { page: 'settings', label: 'Settings', icon: SettingsIcon, mobile: true },
];

/** Sidebar is grouped so the busy pages read as "now" and the rest as "later". */
const NAV_GROUPS: Array<{ label: string; pages: PageId[] }> = [
  { label: 'Now', pages: ['today', 'inbox', 'schedule', 'overdue'] },
  { label: 'Reflect', pages: ['completed', 'reports'] },
  { label: 'Tools', pages: ['import', 'settings'] },
];

export interface NavCounts {
  inbox: number;
  overdue: number;
  today: number;
  completed: number;
  reports: number;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'MW';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Sidebar({
  page,
  settings,
  counts,
  online,
  onNavigate,
  collapsed,
  open,
  onToggle,
}: {
  page: PageId;
  settings: Settings;
  counts: NavCounts;
  online: boolean;
  onNavigate: (page: PageId) => void;
  /** Icon rail when true. Driven by the user's choice on desktop, forced on tablets. */
  collapsed: boolean;
  /** Slide-over drawer (tablet/mobile). */
  open: boolean;
  onToggle: () => void;
}) {
  const state = collapsed && !open ? 'rail' : 'full';
  return (
    <aside
      id="app-sidebar"
      className={`sidebar is-${state} ${open ? 'is-open' : ''}`.trim()}
      aria-label="Main navigation"
      data-state={state}
    >
      <div className="sidebar-head">
        <div className="brand">
          <BrandMark size="md" />
          <span className="brand-copy">
            <strong>My Workday</strong>
            <small>Planner</small>
          </span>
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggle}
          aria-controls="app-sidebar"
          aria-expanded={!collapsed || open}
          aria-label={collapsed && !open ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed && !open ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed && !open ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <p className="nav-group-label" aria-hidden="true">
              {group.label}
            </p>
            {group.pages.map((pageId) => {
              const item = NAV_ITEMS.find((candidate) => candidate.page === pageId);
              if (!item) return null;
              const Icon = item.icon;
              const badge =
                item.page === 'inbox'
                  ? counts.inbox
                  : item.page === 'overdue'
                    ? counts.overdue
                    : item.page === 'today'
                      ? counts.today
                      : item.page === 'completed'
                        ? counts.completed
                        : 0;
              return (
                <button
                  key={item.page}
                  type="button"
                  className={`nav-item ${page === item.page ? 'active' : ''}`.trim()}
                  aria-current={page === item.page ? 'page' : undefined}
                  onClick={() => onNavigate(item.page)}
                  title={item.label}
                >
                  <span className="nav-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {badge > 0 ? <span className="nav-badge">{badge > 99 ? '99+' : badge}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="profile-card">
          <span className="avatar" aria-hidden="true">
            {initials(settings.name)}
          </span>
          <span className="profile-copy">
            <strong>{settings.name || 'Your workday'}</strong>
            <small>{settings.role || 'Business Development'}</small>
            <small>{settings.company}</small>
          </span>
          <span className={`online-dot ${online ? 'is-online' : 'is-offline'}`} aria-label={online ? 'Online' : 'Offline'} />
        </div>
      </div>
    </aside>
  );
}

export function MobileTopBar({
  isDark,
  online,
  onToggleTheme,
  onOpenPalette,
  onOpenNav,
  navOpen,
}: {
  isDark: boolean;
  online: boolean;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onOpenNav: () => void;
  navOpen: boolean;
}) {
  return (
    <header className="mobile-topbar">
      <IconButton
        label={navOpen ? 'Close navigation' : 'Open navigation'}
        icon={Menu}
        onClick={onOpenNav}
        aria-expanded={navOpen}
        aria-controls="app-sidebar"
      />
      <BrandMark size="sm" />
      <span className="mobile-brand">My Workday Planner</span>
      <span className={`status-pill ${online ? 'online' : 'offline'}`}>
        {online ? <Wifi size={12} /> : <WifiOff size={12} />}
        {online ? 'Online' : 'Offline'}
      </span>
      <IconButton label="Open command palette" icon={Search} onClick={onOpenPalette} />
      <IconButton label={isDark ? 'Switch to light theme' : 'Switch to dark theme'} icon={isDark ? Sun : Moon} onClick={onToggleTheme} />
    </header>
  );
}

export function BottomNav({
  page,
  onNavigate,
  onAddTask,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onAddTask: () => void;
}) {
  const items = NAV_ITEMS.filter((item) => item.mobile);
  return (
    <>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.page}
              type="button"
              className={`bottom-nav-item ${page === item.page ? 'active' : ''}`.trim()}
              aria-current={page === item.page ? 'page' : undefined}
              onClick={() => onNavigate(item.page)}
            >
              <Icon size={20} />
              <span>{item.page === 'import' ? 'Import' : item.label}</span>
            </button>
          );
        })}
      </nav>
      {/* Today already has an inline quick-add, so the floating button would only
          cover it on small screens. */}
      {page !== 'today' ? (
        <button type="button" className="fab" aria-label="Add task" onClick={onAddTask}>
          <Plus size={24} />
        </button>
      ) : null}
    </>
  );
}

/**
 * Second-accurate local clock. It owns its own interval so the whole app is not
 * re-rendered once a second just to move the seconds hand.
 */
export function LiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const ss = String(time.getSeconds()).padStart(2, '0');
  return (
    <span className="live-clock" title={time.toLocaleString()}>
      <span className="live-clock-dot" aria-hidden="true" />
      <time dateTime={time.toISOString()} aria-label={`Local time ${hh}:${mm}:${ss}`}>
        {hh}:{mm}
        <span className="live-clock-seconds">:{ss}</span>
      </time>
    </span>
  );
}

export function ScrollProgress({ value }: { value: number }) {
  return (
    <div className="scroll-progress" aria-hidden="true">
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

export function BackToTop({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      className="back-to-top"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <ArrowUp size={18} />
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

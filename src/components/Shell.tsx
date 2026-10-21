import type { ReactNode } from 'react';
import {
  ArrowUp,
  CalendarClock,
  ChartColumn,
  CircleCheck as CheckCircleIcon,
  House,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';
import type { PageId, Settings } from '../lib/types';
import { IconButton } from './ui';
import { BrandMark } from './BrandMark';
import { AnalogClock } from './AnalogClock';

export const NAV_ITEMS: Array<{ page: PageId; label: string; icon: typeof House; mobile?: boolean }> = [
  { page: 'today', label: 'Today', icon: House, mobile: true },
  { page: 'tasks', label: 'My Tasks', icon: CalendarClock, mobile: true },
  { page: 'completed', label: 'Completed', icon: CheckCircleIcon, mobile: true },
  { page: 'reports', label: 'Reports', icon: ChartColumn, mobile: true },
  { page: 'settings', label: 'Settings', icon: SettingsIcon },
];

/** Fewer, calmer groups: what is now, what you look back at. */
const NAV_GROUPS: Array<{ label: string; pages: PageId[] }> = [
  { label: 'Work', pages: ['today', 'tasks'] },
  { label: 'Review', pages: ['completed', 'reports'] },
];

export interface NavCounts {
  tasks: number;
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
  /** Slide-over drawer (tablet). Never used on phones — they get the bottom bar. */
  open: boolean;
  onToggle: () => void;
}) {
  const state = collapsed && !open ? 'rail' : 'full';
  const badgeFor = (pageId: PageId) =>
    pageId === 'tasks' ? counts.tasks : pageId === 'today' ? counts.today : pageId === 'completed' ? counts.completed : 0;

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
            <strong>Workday</strong>
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
              const badge = badgeFor(item.page);
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
                    <Icon size={17} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.page === 'tasks' && counts.overdue > 0 ? (
                    <span className="nav-badge is-danger" title={`${counts.overdue} overdue`}>
                      {counts.overdue > 99 ? '99+' : counts.overdue}
                    </span>
                  ) : badge > 0 ? (
                    <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className={`nav-item settings-item ${page === 'settings' ? 'active' : ''}`.trim()}
          aria-current={page === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
          title="Settings"
        >
          <span className="nav-icon" aria-hidden="true">
            <SettingsIcon size={17} />
          </span>
          <span className="nav-label">Settings</span>
        </button>

        <div className="profile-card">
          <span className="avatar" aria-hidden="true">
            {initials(settings.name)}
          </span>
          <span className="profile-copy">
            <strong>{settings.name || 'Your workday'}</strong>
            <small>{settings.role || 'Add your role in Settings'}</small>
          </span>
          <span className={`online-dot ${online ? 'is-online' : 'is-offline'}`} aria-label={online ? 'Online' : 'Offline'} />
        </div>
      </div>
    </aside>
  );
}

export function MobileTopBar({
  isDark,
  online: _online,
  onToggleTheme,
  onOpenPalette,
  onOpenSettings,
  notifications,
}: {
  isDark: boolean;
  online: boolean;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  /** The bell, rendered by App so both bars share one notification state. */
  notifications?: ReactNode;
}) {
  return (
    <header className="mobile-topbar">
      <BrandMark size="sm" />
      <span className="mobile-brand">Workday</span>
      <span className="mobile-spacer" />
      <IconButton label="Open command palette" icon={Search} onClick={onOpenPalette} />
      {notifications}
      <IconButton
        label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        icon={isDark ? Sun : Moon}
        onClick={onToggleTheme}
      />
      <IconButton label="Settings" icon={SettingsIcon} onClick={onOpenSettings} />
    </header>
  );
}

/**
 * Phones get four destinations and nothing else. Everything about the app's
 * configuration lives behind the gear in the top bar.
 */
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
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      {page !== 'today' && page !== 'tasks' ? (
        <button type="button" className="fab" aria-label="Add task" onClick={onAddTask}>
          <Plus size={22} />
        </button>
      ) : null}
    </>
  );
}

/**
 * A real analogue clock: hour, minute and second hands on a hairline dial.
 * Positioned in the utility bar where it reads as instrument, not ornament.
 */
export function LiveClock({ compact = false }: { compact?: boolean }) {
  return <AnalogClock size={compact ? 30 : 36} />;
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

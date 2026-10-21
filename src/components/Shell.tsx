import type { ReactNode } from 'react';
import {
  ArrowUp,
  CalendarDays,
  ChartColumn,
  CircleCheck as CheckCircleIcon,
  House,
  Image as ImageIcon,
  Inbox,
  Moon,
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
  { page: 'overdue', label: 'Overdue', icon: CalendarDays },
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
}: {
  page: PageId;
  settings: Settings;
  counts: NavCounts;
  online: boolean;
  onNavigate: (page: PageId) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand">
        <BrandMark size="md" />
        <span className="brand-copy">
          <strong>My Workday</strong>
          <small>Planner</small>
        </span>
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
        <p className="sync-chip">
          <WifiOff size={12} aria-hidden="true" /> Local-only · Sync not configured
        </p>
      </div>
    </aside>
  );
}

export function MobileTopBar({
  isDark,
  online,
  onToggleTheme,
  onOpenPalette,
}: {
  isDark: boolean;
  online: boolean;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
}) {
  return (
    <header className="mobile-topbar">
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

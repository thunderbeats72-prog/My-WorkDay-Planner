import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  ChartColumn,
  CircleCheck,
  Command,
  Keyboard,
  House,
  Image as ImageIcon,
  Inbox,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Wifi,
} from 'lucide-react';
import type { PageId, Task } from '../lib/types';
import { NAV_ITEMS } from './Shell';
import type { IconComponent } from './ui';
import { Badge } from './ui';

const PAGE_ICONS: Record<PageId, IconComponent> = {
  today: House,
  inbox: Inbox,
  schedule: CalendarDays,
  overdue: CalendarDays,
  completed: CircleCheck,
  reports: ChartColumn,
  import: ImageIcon,
  settings: SettingsIcon,
};

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  group: 'Pages' | 'Actions' | 'Tasks';
  icon: IconComponent;
  run: () => void;
}

export function CommandPalette({
  open,
  tasks,
  onClose,
  onNavigate,
  onNewTask,
  onOpenTask,
  onCheckGraph,
  onShowShortcuts,
}: {
  open: boolean;
  tasks: Task[];
  onClose: () => void;
  onNavigate: (page: PageId) => void;
  onNewTask: () => void;
  onOpenTask: (id: string) => void;
  onCheckGraph: (() => void) | null;
  onShowShortcuts: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const pages: PaletteItem[] = NAV_ITEMS.map((nav) => ({
      id: `page-${nav.page}`,
      label: nav.label,
      hint: 'Go to page',
      group: 'Pages',
      icon: PAGE_ICONS[nav.page],
      run: () => onNavigate(nav.page),
    }));
    const actions: PaletteItem[] = [
      { id: 'action-new', label: 'Add a new task', hint: 'Create', group: 'Actions', icon: Plus, run: onNewTask },
      {
        id: 'action-import',
        label: 'Import a screenshot',
        hint: 'OCR wizard',
        group: 'Actions',
        icon: ImageIcon,
        run: () => onNavigate('import'),
      },
      {
        id: 'action-reports',
        label: 'Open weekly report',
        hint: 'Reports',
        group: 'Actions',
        icon: ChartColumn,
        run: () => onNavigate('reports'),
      },
      {
        id: 'action-shortcuts',
        label: 'Keyboard shortcuts',
        hint: '?',
        group: 'Actions',
        icon: Keyboard,
        run: onShowShortcuts,
      },
    ];
    if (onCheckGraph) {
      actions.push({
        id: 'action-graph',
        label: 'Check Outlook & Teams highlights',
        hint: 'Microsoft Graph',
        group: 'Actions',
        icon: Wifi,
        run: onCheckGraph,
      });
    }
    const matchingPages = pages.filter((item) => (q ? item.label.toLowerCase().includes(q) : true));
    const matchingActions = actions.filter((item) => (q ? item.label.toLowerCase().includes(q) : true));
    const matchingTasks: PaletteItem[] = tasks
      .filter((task) => task.status !== 'completed' && task.deletedAt === null)
      .filter((task) => (q ? `${task.title} ${task.client}`.toLowerCase().includes(q) : true))
      .slice(0, q ? 8 : 4)
      .map((task: Task) => ({
        id: `task-${task.id}`,
        label: task.title,
        hint: task.client || task.priority,
        group: 'Tasks',
        icon: Sparkles,
        run: () => onOpenTask(task.id),
      }));
    const ordered: PaletteItem[] = [...matchingPages, ...matchingActions, ...matchingTasks];
    if (!q) return ordered;
    return ordered.sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts;
    });
  }, [query, tasks, onNavigate, onNewTask, onOpenTask, onCheckGraph, onShowShortcuts]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`palette-item-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;
  const groups: Array<PaletteItem['group']> = ['Pages', 'Actions', 'Tasks'];
  let runningIndex = -1;

  const choose = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  return createPortal(
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Jump to a page, add a task, or find work…"
            aria-label="Search commands and tasks"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((current) => (current + 1) % Math.max(1, items.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => (current - 1 + items.length) % Math.max(1, items.length));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const item = items[active];
                if (item) choose(item);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-results">
          {items.length === 0 ? (
            <p className="palette-empty">No matches. Try a task title or a page name.</p>
          ) : null}
          {groups.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group} className="palette-group">
                <p className="palette-group-label">{group}</p>
                {groupItems.map((item) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      id={`palette-item-${index}`}
                      type="button"
                      className={`palette-item ${index === active ? 'active' : ''}`.trim()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(item)}
                    >
                      <span className="palette-icon">
                        <Icon size={16} />
                      </span>
                      <span className="palette-label">{item.label}</span>
                      <span className="palette-hint">{item.hint}</span>
                      {group === 'Tasks' ? <Badge tone="neutral">task</Badge> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <footer className="palette-footer">
          <span>
            <Command size={12} /> K to toggle
          </span>
          <span>↑↓ navigate · Enter open · Esc close</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { AlarmClock, Bell, BellOff, Check, CheckCheck, Settings as SettingsIcon, Trash2, X } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import type { AppNotification, AppNotificationKind, NativePermission } from '../lib/notifications';
import { unreadCount } from '../lib/notifications';
import { IconButton } from './ui';

function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return formatDistanceToNowStrict(date, { addSuffix: true });
  } catch {
    return '';
  }
}

const CONSEQUENCE: Record<AppNotificationKind, string> = {
  reminder: 'Deadline',
  test: 'Test',
  system: 'Planner',
  upcoming: 'Upcoming',
  due: 'Due now',
  overdue: 'Overdue',
  completed: 'Completed',
  summary: 'Daily summary',
};

export function NotificationCenter({
  notifications,
  permission,
  alertsEnabled,
  onOpenTask,
  onOpenOverdue,
  onSnooze,
  onDismiss,
  onMarkAllRead,
  onMarkRead,
  onClearAll,
  onRequestPermission,
  onSendTest,
  onOpenSettings,
  backgroundMessage,
}: {
  notifications: AppNotification[];
  permission: NativePermission;
  /** The in-app switch in Settings — separate from the browser's permission. */
  alertsEnabled: boolean;
  onOpenTask: (taskId: string, notificationId?: string) => void;
  onOpenOverdue: (notificationId?: string) => void;
  onSnooze: (taskId: string, minutes: number) => void;
  onDismiss: (notification: AppNotification) => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onClearAll: () => void;
  onRequestPermission: () => void;
  onSendTest: () => void;
  onOpenSettings: () => void;
  backgroundMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const unread = unreadCount(notifications);
  const wrap = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="notify" ref={wrap}>
      <button
        type="button"
        className={`icon-btn notify-bell ${open ? 'is-open' : ''} ${unread > 0 ? 'has-unread' : ''}`.trim()}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls={panelId}
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} />
        {unread > 0 ? <span className="notify-badge">{unread > 9 ? '9+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="notify-panel" id={panelId} role="dialog" aria-label="Notifications">
          <header className="notify-head">
            <div>
              <p className="eyebrow">Inbox</p>
              <h2>Notifications</h2>
            </div>
            <div className="notify-head-actions">
              {unread > 0 ? (
                <button type="button" className="link-button" onClick={onMarkAllRead}>
                  <CheckCheck size={14} /> Mark all read
                </button>
              ) : null}
              <IconButton label="Close notifications" icon={X} onClick={() => setOpen(false)} />
            </div>
          </header>

          {permission !== 'granted' || !alertsEnabled ? (
            <div className={`notify-permission is-${permission}`}>
              {permission === 'unsupported' ? (
                <>
                  <BellOff size={16} />
                  <p>This browser cannot show system notifications. Reminders still appear here.</p>
                </>
              ) : permission === 'denied' ? (
                <>
                  <BellOff size={16} />
                  <p>
                    System alerts are blocked for this site. Allow notifications in your browser’s site settings,
                    then reload.
                  </p>
                </>
              ) : permission === 'granted' ? (
                /* The browser already allows banners but the planner's own
                   switch is off — without this the app would look silent while
                   insisting everything was fine. */
                <>
                  <BellOff size={16} />
                  <div>
                    <p>
                      <strong>System alerts are off</strong>
                      <span>This device allows notifications, but the planner is not sending them. Turn them on here.</span>
                    </p>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={onRequestPermission}>
                    Enable system notifications
                  </button>
                </>
              ) : (
                <>
                  <Bell size={16} />
                  <div>
                    <p>
                      <strong>Get alerts on this device</strong>
                      <span>
                        Allow this device to show reminders. Closed-tab delivery also requires a synced account and a configured scheduler.
                      </span>
                    </p>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={onRequestPermission}>
                    Enable system notifications
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="notify-permission is-granted">
              <Check size={15} />
              <p>{backgroundMessage || 'System notification permission is enabled on this device.'}</p>
              <button type="button" className="link-button" onClick={onSendTest}>
                Send test
              </button>
            </div>
          )}

          {notifications.length === 0 ? (
            <div className="notify-empty">
              <span className="notify-empty-mark" aria-hidden="true">
                <AlarmClock size={20} />
              </span>
              <p className="notify-empty-title">All clear</p>
              <p className="notify-empty-copy">
                Reminders land here when a deadline is close. Device banners depend on setup, browser and OS permissions.
              </p>
            </div>
          ) : (
            <ul className="notify-list">
              {notifications.map((item) => (
                <li key={item.id} className={`notify-item ${item.read ? '' : 'is-unread'} ${item.kind === 'overdue' ? 'is-overdue' : ''}`.trim()}>
                  <span className={`notify-dot is-${item.kind}`} aria-hidden="true" />
                  <div className="notify-copy">
                    <p className="notify-title">
                      {item.taskId ? (
                        <button
                          type="button"
                          className="notify-open"
                          onClick={() => {
                            onOpenTask(item.taskId as string, item.id);
                            setOpen(false);
                          }}
                        >
                          {item.title}
                        </button>
                      ) : item.kind === 'summary' ? (
                        <button type="button" className="notify-open" onClick={() => { onOpenOverdue(item.id); setOpen(false); }}>
                          {item.title}
                        </button>
                      ) : (
                        item.title
                      )}
                    </p>
                    <p className="notify-body">{item.body}</p>
                    <p className="notify-meta">
                      <span>{CONSEQUENCE[item.kind]}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{whenLabel(item.createdAt)}</time>
                      {item.delivery === 'pending' ? <span>· Queued</span> : item.delivery === 'failed' ? <span>· Delivery failed</span> : null}
                    </p>
                  </div>
                  <div className="notify-actions">
                    {item.taskId && item.kind !== 'completed' ? (
                      <select
                        className="notify-snooze"
                        aria-label={`Snooze ${item.title}`}
                        value=""
                        onChange={(event) => { if (event.target.value) onSnooze(item.taskId as string, Number(event.target.value)); }}
                      >
                        <option value="">Snooze…</option>
                        <option value="10">10 minutes</option>
                        <option value="30">30 minutes</option>
                        <option value="60">1 hour</option>
                      </select>
                    ) : null}
                    {!item.read ? (
                      <button type="button" className="icon-btn icon-btn-sm" title="Mark as read"
                        aria-label={`Mark ${item.title} as read`} onClick={() => onMarkRead(item.id)}>
                        <Check size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      title="Dismiss"
                      aria-label={`Dismiss notification: ${item.title}`}
                      onClick={() => onDismiss(item)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <footer className="notify-foot">
            <button type="button" className="link-button" onClick={onOpenSettings}>
              <SettingsIcon size={14} /> Reminder settings
            </button>
            {notifications.length > 0 ? (
              <button type="button" className="link-button" onClick={onClearAll}>
                Clear all
              </button>
            ) : null}
          </footer>
        </div>
      ) : null}
    </div>
  );
}

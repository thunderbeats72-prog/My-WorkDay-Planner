import { useEffect, useId, useRef, useState } from 'react';
import { AlarmClock, Bell, BellOff, Check, CheckCheck, Clock, Settings as SettingsIcon, Trash2, X } from 'lucide-react';
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
};

export function NotificationCenter({
  notifications,
  permission,
  onOpenTask,
  onSnooze,
  onDismiss,
  onMarkAllRead,
  onClearAll,
  onRequestPermission,
  onSendTest,
  onOpenSettings,
}: {
  notifications: AppNotification[];
  permission: NativePermission;
  onOpenTask: (taskId: string) => void;
  onSnooze: (taskId: string) => void;
  onDismiss: (notification: AppNotification) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onRequestPermission: () => void;
  onSendTest: () => void;
  onOpenSettings: () => void;
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

          {permission !== 'granted' ? (
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
              ) : (
                <>
                  <Bell size={16} />
                  <div>
                    <p>
                      <strong>Get alerts on this device</strong>
                      <span>
                        Laptop and phone banners, even when the planner is in another tab. Permission is asked
                        once; nothing leaves this browser.
                      </span>
                    </p>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={onRequestPermission}>
                    Turn on
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="notify-permission is-granted">
              <Check size={15} />
              <p>System alerts are on for this device.</p>
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
                Reminders land here when a deadline is close — and on your lock screen if alerts are on.
              </p>
            </div>
          ) : (
            <ul className="notify-list">
              {notifications.map((item) => (
                <li key={item.id} className={`notify-item ${item.read ? '' : 'is-unread'}`.trim()}>
                  <span className={`notify-dot is-${item.kind}`} aria-hidden="true" />
                  <div className="notify-copy">
                    <p className="notify-title">
                      {item.taskId ? (
                        <button
                          type="button"
                          className="notify-open"
                          onClick={() => {
                            onOpenTask(item.taskId as string);
                            setOpen(false);
                          }}
                        >
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
                      <span>{whenLabel(item.createdAt)}</span>
                    </p>
                  </div>
                  <div className="notify-actions">
                    {item.taskId ? (
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        title="Snooze 15 minutes"
                        aria-label={`Snooze ${item.title} for 15 minutes`}
                        onClick={() => onSnooze(item.taskId as string)}
                      >
                        <Clock size={14} />
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

import { ExternalLink, Mail, MessageSquare, RefreshCw, Shield, Wifi, X } from 'lucide-react';
import type { GraphAccount, GraphHighlight } from '../lib/graph';
import { formatTimeAgo } from '../lib/dates';
import { Badge, Button, IconButton } from './ui';

export function GraphCard({
  configured,
  connected,
  account,
  items,
  errors,
  fetchedAt,
  busy,
  onConnect,
  onDisconnect,
  onCheck,
  onCreateTask,
  onDismiss,
  onOpenSettings,
}: {
  configured: boolean;
  connected: boolean;
  account: GraphAccount | null;
  items: GraphHighlight[];
  errors: string[];
  fetchedAt: string | null;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onCheck: () => void;
  onCreateTask: (item: GraphHighlight) => void;
  onDismiss: (id: string) => void;
  onOpenSettings: () => void;
}) {
  if (!configured) {
    return (
      <section className="card graph-card muted-card">
        <div className="section-head">
          <h2>
            <Mail size={16} /> Missed in Outlook &amp; Teams
          </h2>
          <Badge tone="neutral">optional</Badge>
        </div>
        <p className="muted">
          Connect your own Microsoft 365 account to surface unread mail and Teams mentions here. It stays off until you add
          an Azure app client ID — nothing is connected by default.
        </p>
        <Button variant="secondary" icon={Shield} onClick={onOpenSettings}>
          Set up connected accounts
        </Button>
      </section>
    );
  }

  if (!connected) {
    return (
      <section className="card graph-card">
        <div className="section-head">
          <h2>
            <Mail size={16} /> Missed in Outlook &amp; Teams
          </h2>
          <Badge tone="info">configured</Badge>
        </div>
        <p className="muted">
          Read-only highlights with scopes User.Read, Mail.Read, Chat.ReadBasic and ChatMessage.Read. Tokens stay in session
          storage for about an hour.
        </p>
        <div className="graph-actions">
          <Button variant="primary" icon={Wifi} onClick={onConnect}>
            Connect with Microsoft
          </Button>
          <Button variant="ghost" onClick={onOpenSettings}>
            Connection settings
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="card graph-card">
      <div className="section-head">
        <h2>
          <Mail size={16} /> Missed in Outlook &amp; Teams
        </h2>
        <div className="graph-head-actions">
          {account?.displayName ? <Badge tone="success">{account.displayName}</Badge> : <Badge tone="success">connected</Badge>}
          <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy} onClick={onCheck}>
            Check now
          </Button>
          <IconButton label="Disconnect Microsoft" icon={X} onClick={onDisconnect} />
        </div>
      </div>
      <p className="fine-print">
        {fetchedAt ? `Last checked ${formatTimeAgo(fetchedAt)} · ` : ''}
        Read-only · session-only tokens · highlights cached locally.
      </p>

      {errors.length > 0 ? (
        <ul className="graph-errors">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      {busy && items.length === 0 ? <p className="muted">Checking Outlook and Teams…</p> : null}

      {!busy && items.length === 0 && errors.length === 0 ? (
        <p className="muted">Nothing unread and no Teams mentions right now.</p>
      ) : null}

      <ul className="graph-list">
        {items.map((item) => (
          <li key={item.id}>
            <span className={`graph-source ${item.kind}`}>
              {item.kind === 'mail' ? <Mail size={14} /> : <MessageSquare size={14} />}
            </span>
            <div className="graph-copy">
              <p className="graph-title">{item.title}</p>
              <p className="graph-meta">
                {item.from} · {formatTimeAgo(item.receivedAt)}
              </p>
              <p className="graph-preview">{item.preview || 'No preview available.'}</p>
            </div>
            <div className="graph-item-actions">
              <a className="btn btn-ghost btn-sm" href={item.webUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> <span>Open</span>
              </a>
              <Button size="sm" variant="secondary" onClick={() => onCreateTask(item)}>
                Create task
              </Button>
              <IconButton label="Dismiss highlight" icon={X} onClick={() => onDismiss(item.id)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

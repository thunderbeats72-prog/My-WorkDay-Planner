import { Modal } from './ui';

interface ShortcutRow {
  keys: string[];
  label: string;
}

interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    rows: [
      { keys: ['⌘K', 'Ctrl K'], label: 'Open the command palette' },
      { keys: ['?'], label: 'Show this shortcut sheet' },
      { keys: ['Esc'], label: 'Close the palette, panel or dialog' },
    ],
  },
  {
    title: 'Jump to a page',
    rows: [
      { keys: ['D'], label: 'Today' },
      { keys: ['I'], label: 'My Tasks' },
      { keys: ['R'], label: 'Reports' },
      { keys: ['C'], label: 'Completed' },
    ],
  },
  {
    title: 'Capture and plan',
    rows: [
      { keys: ['/'], label: 'Jump to Quick add on Today' },
      { keys: ['Enter'], label: 'Add what you typed in Quick add' },
      { keys: ['Esc'], label: 'Clear the Quick add field while focused' },
      { keys: ['N'], label: 'Open the full new-task form' },
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      title="Keyboard shortcuts"
      subtitle="Shortcuts stay out of the way while you are typing in a field."
      onClose={onClose}
      size="lg"
    >
      <div className="shortcut-grid">
        {GROUPS.map((group) => (
          <section key={group.title} className="shortcut-group">
            <h3>{group.title}</h3>
            <dl>
              {group.rows.map((row) => (
                <div key={`${group.title}-${row.label}`} className="shortcut-row">
                  <dt>
                    {row.keys.map((key, index) => (
                      <span key={key}>
                        {index > 0 ? <span className="shortcut-or">or</span> : null}
                        <kbd>{key}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{row.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="shortcut-tip">
        <strong>One-line tasks</strong>
        <p>
          Quick add understands dates, times, priority, duration, category and client —{' '}
          <code>email Sam tomorrow 3pm !high 30m #email @Nova</code>
        </p>
      </div>
    </Modal>
  );
}

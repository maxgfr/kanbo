import { Button } from './Button.tsx'
import { Icon } from './Icon.tsx'
import { useDialog } from './useDialog.ts'

/**
 * Every key the application answers to, and nothing else.
 *
 * This list is the reason `?` exists: shortcuts nobody can enumerate are
 * shortcuts nobody uses, and the palette used to advertise `n` for an item it
 * had no handler for. Anything printed here is bound; anything bound is printed
 * here.
 */
const GROUPS: readonly { readonly title: string; readonly keys: readonly [string, string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      ['⌘K', 'Search and commands'],
      ['/', 'Filter the work'],
      ['n', 'New item'],
      ['?', 'This list'],
    ],
  },
  {
    title: 'Go to',
    keys: [
      ['g w', 'Work'],
      ['g s', 'Sprints'],
      ['g r', 'Roadmap'],
      ['g l', 'Releases'],
      ['g p', 'People'],
      ['g m', 'Metrics'],
    ],
  },
  {
    title: 'On a focused card',
    keys: [
      ['o', 'Open it'],
      ['space', 'Pick it up, and put it down'],
      ['← →', 'Move it between columns'],
      ['esc', 'Close, or cancel what you were typing'],
    ],
  },
]

export function Shortcuts({ onClose }: { readonly onClose: () => void }) {
  const { ref, onKeyDown } = useDialog<HTMLDivElement>(onClose)

  return (
    <>
      <button
        type="button"
        className="kb-panel__scrim"
        aria-label="Close"
        onClick={onClose}
        onKeyDown={onKeyDown}
      />
      <div
        ref={ref}
        className="kb-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ padding: 'var(--space-4)' }}
      >
        <div className="kb-row" style={{ marginBottom: 'var(--space-3)' }}>
          <Icon name="settings" size={16} />
          <strong>Keyboard</strong>
          <span className="kb-spacer" />
          <Button variant="quiet" icon="close" aria-label="Close" onClick={onClose} />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {GROUPS.map((group) => (
            <section key={group.title} style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <h2 className="kb-field__label">{group.title}</h2>
              {group.keys.map(([key, what]) => (
                <div key={key} className="kb-row">
                  <kbd className="kb-kbd">{key}</kbd>
                  <span>{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  )
}

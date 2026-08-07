import { QUALIFIERS, type Project, search, statusById } from '@kanbo/core'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon, type IconName } from '../design/Icon.tsx'
import { StatusChip, signalForCategory } from '../design/StatusChip.tsx'

/**
 * One box for finding things and doing things.
 *
 * It runs the same query language the CLI runs — `is:blocked`,
 * `assignee:@me`, `points:>3` — because a syntax that only works in one place
 * is a syntax nobody remembers. Typing nothing shows commands; typing anything
 * searches, with the qualifier hints in view so the language is discoverable
 * without documentation.
 */
export type Command = {
  readonly id: string
  readonly label: string
  readonly icon: IconName
  readonly hint?: string
  readonly run: () => void
}

export type CommandPaletteProps = {
  readonly project: Project
  readonly commands: readonly Command[]
  readonly onOpenItem: (itemId: string) => void
  readonly onClose: () => void
}

export function CommandPalette({ project, commands, onOpenItem, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const items = useMemo(
    () => (query.trim() === '' ? [] : search(query, { project, now: Date.now(), meId: null })),
    [query, project],
  )

  const matchingCommands = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return commands
    return commands.filter((command) => command.label.toLowerCase().includes(needle))
  }, [commands, query])

  const rows = [
    ...matchingCommands.map((command) => ({ kind: 'command' as const, command })),
    ...items.slice(0, 20).map((item) => ({ kind: 'item' as const, item })),
  ]

  const clampedCursor = Math.min(cursor, Math.max(0, rows.length - 1))

  function activate(index: number) {
    const row = rows[index]
    if (!row) return
    if (row.kind === 'command') row.command.run()
    else onOpenItem(row.item.id)
    onClose()
  }

  return (
    <>
      <button type="button" className="kb-panel__scrim" aria-label="Close" onClick={onClose} />
      <div className="kb-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="kb-palette__field">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="kb-palette__input"
            value={query}
            placeholder="Search, or type a command…"
            aria-label="Search or run a command"
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCursor((at) => Math.min(at + 1, rows.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCursor((at) => Math.max(at - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                activate(clampedCursor)
              }
            }}
          />
        </div>

        <div className="kb-palette__rows" role="listbox" aria-label="Results">
          {rows.length === 0 && (
            <p className="kb-muted" style={{ padding: 'var(--space-4)', margin: 0 }}>
              Nothing matched.
            </p>
          )}

          {rows.map((row, index) => (
            <button
              key={row.kind === 'command' ? row.command.id : row.item.id}
              type="button"
              role="option"
              aria-selected={index === clampedCursor}
              className="kb-palette__row"
              data-active={index === clampedCursor || undefined}
              onMouseEnter={() => setCursor(index)}
              onClick={() => activate(index)}
            >
              {row.kind === 'command' ? (
                <>
                  <Icon name={row.command.icon} size={14} />
                  <span>{row.command.label}</span>
                  {row.command.hint && (
                    <span className="kb-spacer kb-muted data" style={{ textAlign: 'right' }}>
                      {row.command.hint}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="data kb-muted">{row.item.ref}</span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.item.title}
                  </span>
                  <span className="kb-spacer" />
                  {(() => {
                    const status = statusById(project, row.item.statusId)
                    return status ? (
                      <StatusChip
                        label={status.name}
                        signal={signalForCategory(status.category)}
                        animate={false}
                      />
                    ) : null
                  })()}
                </>
              )}
            </button>
          ))}
        </div>

        <div className="kb-palette__hints">
          {QUALIFIERS.slice(0, 6).map((qualifier) => (
            <button
              key={qualifier.key}
              type="button"
              className="kb-palette__hint"
              title={qualifier.hint}
              onClick={() => {
                setQuery((current) => `${current}${current ? ' ' : ''}${qualifier.key}:`)
                inputRef.current?.focus()
              }}
            >
              {qualifier.key}:
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

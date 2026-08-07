import { type Project, byOrder, sortItems, statusById } from '@kanbo/core'
import { useMemo, useState } from 'react'

import { Icon } from '../design/Icon'
import { StatusChip, signalForCategory } from '../design/StatusChip'
import { blockedBy, isOverdue } from '../board/Card'

type Column = { readonly key: string; readonly label: string; readonly numeric?: boolean }

const COLUMNS: readonly Column[] = [
  { key: 'ref', label: 'Ref' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'estimate', label: 'Points', numeric: true },
  { key: 'dueOn', label: 'Due' },
]

export type TableViewProps = {
  readonly project: Project
  readonly onOpen: (itemId: string) => void
}

export function TableView({ project, onOpen }: TableViewProps) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const day = new Date().toISOString().slice(0, 10)

  const rows = useMemo(() => {
    const visible = project.items.filter((item) => !item.archived)
    return sortKey ? sortItems(visible, [{ key: sortKey, direction }]) : visible.toSorted(byOrder)
  }, [project.items, sortKey, direction])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setDirection(direction === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setDirection('asc')
    }
  }

  if (rows.length === 0) {
    return (
      <div className="kb-empty">
        <Icon name="table" size={28} />
        <p className="kb-empty__title">No items yet</p>
        <p className="kb-empty__body">Items added on the board appear here as rows.</p>
      </div>
    )
  }

  return (
    <div className="kb-table__scroll">
      <table className="kb-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sortKey === column.key
                    ? direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button
                  type="button"
                  className="kb-button kb-button--quiet"
                  style={{ padding: '0.125rem 0.25rem', font: 'inherit' }}
                  onClick={() => toggleSort(column.key)}
                >
                  {column.label}
                  {sortKey === column.key && (
                    <Icon
                      name="chevronDown"
                      size={12}
                      className={direction === 'asc' ? 'kb-flip-y' : undefined}
                    />
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const status = statusById(project, item.statusId)
            const blocked = blockedBy(project, item).length > 0
            return (
              <tr key={item.id}>
                <td className="data kb-muted">
                  <button
                    type="button"
                    className="kb-button kb-button--quiet"
                    style={{ padding: '0.0625rem 0.25rem', fontFamily: 'var(--font-data)' }}
                    onClick={() => onOpen(item.id)}
                  >
                    {item.ref}
                  </button>
                </td>
                <td>
                  <span className="kb-row">
                    {blocked && (
                      <Icon
                        name="blocked"
                        size={13}
                        title="Blocked"
                        className="kb-card__flag--blocked"
                      />
                    )}
                    {item.title}
                  </span>
                </td>
                <td>
                  {status && (
                    <StatusChip
                      label={status.name}
                      signal={signalForCategory(status.category)}
                      animate={false}
                    />
                  )}
                </td>
                <td className="data kb-muted">{item.priority.toUpperCase()}</td>
                <td className="data">{item.estimate ?? '—'}</td>
                <td
                  className="data"
                  style={{ color: isOverdue(item, day) ? 'var(--signal-delayed)' : undefined }}
                >
                  {item.dueOn ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

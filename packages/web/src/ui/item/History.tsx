import { type HistoryEntry, type Project, historyOf, itemById, statusById } from '@kanbo/core'
import { useMemo, useState } from 'react'

import { useLog } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon, type IconName } from '../design/Icon.tsx'

/**
 * What happened to this item, read out of the log the board is built from.
 *
 * Nothing here was recorded for the purpose: every line is an operation some
 * device actually emitted, which is why the history cannot drift from the
 * board and cannot be quietly edited. It also outlives the item — a deleted
 * card is gone from the board but its deletion is still in the log.
 *
 * The domain returns values, not sentences; turning them into English is this
 * component's job, and keeping that split is what would let the app be
 * translated without touching the domain.
 */
const ICONS: Record<string, IconName> = {
  created: 'plus',
  deleted: 'trash',
  moved: 'board',
  reordered: 'grip',
  field: 'settings',
  linked: 'link',
  unlinked: 'close',
  commented: 'person',
  project: 'settings',
  other: 'clock',
}

const FIELD_NAMES: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  estimate: 'Points',
  priority: 'Priority',
  type: 'Type',
  dueOn: 'Due date',
  iterationId: 'Sprint',
  milestoneId: 'Milestone',
  parentId: 'Parent',
  assignees: 'Assignees',
  labels: 'Labels',
  archived: 'Archived',
}

function when(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(at).toISOString().slice(0, 10)
}

function short(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'nothing'
  if (Array.isArray(value)) return value.length === 0 ? 'nothing' : `${value.length} entries`
  const text = String(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

function describe(project: Project, entry: HistoryEntry): string {
  const change = entry.change
  switch (change.kind) {
    case 'created':
      return 'Created'
    case 'deleted':
      return 'Deleted'
    case 'reordered':
      return 'Reordered'
    case 'commented':
      return 'Commented'
    case 'moved': {
      const from = change.fromStatusId ? statusById(project, change.fromStatusId)?.name : null
      const to = statusById(project, change.toStatusId)?.name ?? 'another column'
      return from ? `Moved from ${from} to ${to}` : `Moved to ${to}`
    }
    case 'field': {
      const name = FIELD_NAMES[change.field] ?? change.field
      // Long text is not diffed inline; saying it changed is more useful than
      // a wall of prose in a feed.
      if (change.field === 'description') return 'Description edited'
      return `${name}: ${short(change.from)} → ${short(change.to)}`
    }
    case 'linked':
      return `Linked ${change.linkType.replace('-', ' ')} ${itemById(project, change.targetId)?.ref ?? ''}`.trim()
    case 'unlinked':
      return `Removed ${change.linkType.replace('-', ' ')} link`
    case 'project':
      return `Project ${change.field} changed`
    case 'other':
      return change.operation
  }
}

export function ItemHistory({
  project,
  itemId,
}: {
  readonly project: Project
  readonly itemId: string
}) {
  const log = useLog()
  const [expanded, setExpanded] = useState(false)
  const now = Date.now()

  const entries = useMemo(() => historyOf(log, itemId), [log, itemId])
  const shown = expanded ? entries : entries.slice(0, 6)

  if (entries.length === 0) return null

  return (
    <section className="kb-field">
      <div className="kb-row">
        <span className="kb-field__label">History</span>
        <span className="kb-spacer" />
        <span className="kb-muted data" style={{ fontSize: 'var(--step--1)' }}>
          {entries.length}
        </span>
      </div>

      <ol className="kb-history">
        {shown.map((entry) => (
          <li key={entry.id} className="kb-history__entry">
            <Icon name={ICONS[entry.change.kind] ?? 'clock'} size={12} />
            <span>{describe(project, entry)}</span>
            <span className="kb-spacer" />
            <time
              className="kb-muted data"
              dateTime={new Date(entry.at).toISOString()}
              title={new Date(entry.at).toISOString()}
            >
              {when(entry.at, now)}
            </time>
          </li>
        ))}
      </ol>

      {entries.length > shown.length && (
        <div>
          <Button variant="quiet" onClick={() => setExpanded(true)}>
            Show all {entries.length}
          </Button>
        </div>
      )}

      <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}>
        Read from the log the board is built from, so it cannot disagree with what you see.
      </p>
    </section>
  )
}

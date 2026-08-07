import {
  type Item,
  type ItemType,
  type Priority,
  type Project,
  byOrder,
  itemById,
  statusById,
  wouldCycle,
} from '@kanbo/core'
import { useEffect, useRef, useState } from 'react'

import { useDispatch } from '../../state/useStore.ts'
import { blockedBy } from '../board/Card.tsx'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { Markdown } from '../design/Markdown.tsx'
import { StatusChip, signalForCategory } from '../design/StatusChip.tsx'

const TYPES: readonly ItemType[] = ['epic', 'story', 'task', 'bug', 'spike', 'chore']
const PRIORITIES: readonly Priority[] = ['p0', 'p1', 'p2', 'p3', 'p4']

export type ItemPanelProps = {
  readonly project: Project
  readonly itemId: string
  readonly onClose: () => void
}

export function ItemPanel({ project, itemId, onClose }: ItemPanelProps) {
  const dispatch = useDispatch()
  const item = itemById(project, itemId)
  const [editingBody, setEditingBody] = useState(false)
  const [draft, setDraft] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [itemId])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!item) return null

  const status = statusById(project, item.statusId)
  const blockers = blockedBy(project, item)

  const set = (patch: Partial<Item>) =>
    void dispatch({ kind: 'item.set', itemId: item.id, patch: patch as never })

  return (
    <>
      <button
        type="button"
        className="kb-panel__scrim"
        aria-label="Close the item"
        onClick={onClose}
      />
      <aside className="kb-panel" role="dialog" aria-modal="true" aria-label={item.title}>
        <header className="kb-panel__header">
          <span className="data kb-muted">{item.ref}</span>
          {status && <StatusChip label={status.name} signal={signalForCategory(status.category)} />}
          <span className="kb-spacer" />
          <Button
            ref={closeRef}
            variant="quiet"
            icon="close"
            aria-label="Close"
            onClick={onClose}
          />
        </header>

        <div className="kb-panel__body">
          <div className="kb-field">
            <label className="kb-field__label" htmlFor="kb-title">
              Title
            </label>
            <input
              id="kb-title"
              className="kb-input"
              value={item.title}
              onChange={(event) => set({ title: event.target.value })}
            />
          </div>

          {blockers.length > 0 && (
            <p
              className="kb-row"
              style={{
                color: 'var(--signal-cancelled)',
                background: 'var(--signal-cancelled-dim)',
                border: '1px solid color-mix(in oklab, var(--signal-cancelled) 30%, transparent)',
                borderRadius: 'var(--radius)',
                padding: 'var(--space-2) var(--space-3)',
                margin: 0,
              }}
            >
              <Icon name="blocked" size={14} />
              Blocked by {blockers.map((blocker) => blocker.ref).join(', ')}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <Select
              label="Status"
              value={item.statusId}
              options={project.statuses.toSorted(byOrder).map((s) => [s.id, s.name])}
              onChange={(statusId) =>
                void dispatch({ kind: 'item.move', itemId: item.id, statusId, order: item.order })
              }
            />
            <Select
              label="Type"
              value={item.type}
              options={TYPES.map((type) => [type, type])}
              onChange={(type) => set({ type: type as ItemType })}
            />
            <Select
              label="Priority"
              value={item.priority}
              options={PRIORITIES.map((priority) => [priority, priority.toUpperCase()])}
              onChange={(priority) => set({ priority: priority as Priority })}
            />
            <div className="kb-field">
              <label className="kb-field__label" htmlFor="kb-estimate">
                Points
              </label>
              <input
                id="kb-estimate"
                className="kb-input data"
                type="number"
                min={0}
                inputMode="numeric"
                value={item.estimate ?? ''}
                placeholder="—"
                onChange={(event) =>
                  set({ estimate: event.target.value === '' ? null : Number(event.target.value) })
                }
              />
            </div>
            <div className="kb-field">
              <label className="kb-field__label" htmlFor="kb-due">
                Due
              </label>
              <input
                id="kb-due"
                className="kb-input data"
                type="date"
                value={item.dueOn ?? ''}
                onChange={(event) => set({ dueOn: event.target.value || null })}
              />
            </div>
            <Select
              label="Iteration"
              value={item.iterationId ?? ''}
              options={[
                ['', 'None'],
                ...project.iterations.toSorted(byOrder).map((it) => [it.id, it.name] as const),
              ]}
              onChange={(iterationId) => set({ iterationId: iterationId || null })}
            />
          </div>

          <div className="kb-field">
            <div className="kb-row">
              <span className="kb-field__label">Description</span>
              <span className="kb-spacer" />
              <Button
                variant="quiet"
                onClick={() => {
                  setDraft(item.description)
                  setEditingBody(!editingBody)
                }}
              >
                {editingBody ? 'Preview' : 'Edit'}
              </Button>
            </div>

            {editingBody ? (
              <textarea
                className="kb-textarea"
                value={draft}
                placeholder="Markdown. Round-trips with issue bodies exactly."
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => set({ description: draft })}
              />
            ) : item.description === '' ? (
              <p className="kb-muted" style={{ margin: 0 }}>
                No description yet.
              </p>
            ) : (
              <Markdown source={item.description} />
            )}
          </div>

          <DependencyEditor project={project} item={item} />

          <div className="kb-row" style={{ marginTop: 'auto', paddingTop: 'var(--space-4)' }}>
            <span className="kb-muted data" style={{ fontSize: 'var(--step--1)' }}>
              {item.startedAt
                ? `Started ${new Date(item.startedAt).toISOString().slice(0, 10)}`
                : 'Not started'}
              {item.completedAt
                ? ` · Completed ${new Date(item.completedAt).toISOString().slice(0, 10)}`
                : ''}
            </span>
            <span className="kb-spacer" />
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                void dispatch({ kind: 'item.delete', itemId: item.id })
                onClose()
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly onChange: (value: string) => void
}) {
  const id = `kb-${label.toLowerCase()}`
  return (
    <div className="kb-field">
      <label className="kb-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="kb-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Blocking links, refused before they can create a cycle.
 *
 * A cycle makes the roadmap's critical path non-terminating, and once the
 * operation is in the log every device inherits it — so the check happens here,
 * at the point of intent, rather than being cleaned up later.
 */
function DependencyEditor({ project, item }: { readonly project: Project; readonly item: Item }) {
  const dispatch = useDispatch()
  const [error, setError] = useState<string | null>(null)

  const candidates = project.items.filter(
    (candidate) =>
      candidate.id !== item.id &&
      !candidate.archived &&
      !item.links.some((link) => link.itemId === candidate.id),
  )

  return (
    <div className="kb-field">
      <span className="kb-field__label">Blocked by</span>

      {item.links.filter((link) => link.type === 'blocked-by').length === 0 && (
        <p className="kb-muted" style={{ margin: 0 }}>
          Nothing is blocking this.
        </p>
      )}

      {item.links
        .filter((link) => link.type === 'blocked-by')
        .map((link) => {
          const blocker = itemById(project, link.itemId)
          return (
            <div key={link.itemId} className="kb-row">
              <span className="data kb-muted">{blocker?.ref ?? link.itemId}</span>
              <span>{blocker?.title ?? 'Unknown item'}</span>
              <span className="kb-spacer" />
              <Button
                variant="quiet"
                icon="close"
                aria-label="Remove this dependency"
                onClick={() =>
                  void dispatch({
                    kind: 'item.unlink',
                    itemId: item.id,
                    targetId: link.itemId,
                    linkType: 'blocked-by',
                  })
                }
              />
            </div>
          )
        })}

      <select
        className="kb-select"
        value=""
        aria-label="Add a blocking dependency"
        onChange={(event) => {
          const targetId = event.target.value
          if (!targetId) return
          // `wouldCycle` asks whether the *blocker* already depends on this
          // item, which is the direction that closes the loop.
          if (wouldCycle(project, targetId, item.id)) {
            const blocker = itemById(project, targetId)
            setError(
              `${blocker?.ref ?? 'That item'} already depends on ${item.ref}. Linking these would make the chain circular.`,
            )
            return
          }
          setError(null)
          void dispatch(
            { kind: 'item.link', itemId: item.id, link: { type: 'blocked-by', itemId: targetId } },
            { kind: 'item.link', itemId: targetId, link: { type: 'blocks', itemId: item.id } },
          )
        }}
      >
        <option value="">Add a dependency…</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.ref} — {candidate.title}
          </option>
        ))}
      </select>

      {error && (
        <p style={{ color: 'var(--signal-cancelled)', margin: 0, fontSize: 'var(--step--1)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

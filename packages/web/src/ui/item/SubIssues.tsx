/**
 * The work that sits under an item.
 *
 * `parentId` has been on every item since the first commit, and nothing could
 * set it — an epic was a type you could choose and then never fill. This is
 * both halves of that: the parent an item belongs to, and the children it
 * gathers.
 *
 * Progress counts direct children only, and counts "done" as `completedAt`,
 * the same definition a milestone and the changelog use. A rollup that summed
 * the whole subtree would report an epic as half finished because its stories
 * were, while its own tasks had not been started.
 */
import {
  type Item,
  type Project,
  childrenOf,
  itemById,
  newItem,
  statusById,
  subtreeProgress,
  wouldNestCycle,
} from '@kanbo/core'
import { useState } from 'react'

import { createPorts } from '../../state/store.ts'
import { useDispatch } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { StatusChip, signalForCategory } from '../design/StatusChip.tsx'

export function SubIssues({
  project,
  item,
  onOpen,
}: {
  readonly project: Project
  readonly item: Item
  readonly onOpen: (itemId: string) => void
}) {
  const dispatch = useDispatch()
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parent = item.parentId === null ? null : itemById(project, item.parentId)
  const children = childrenOf(project, item.id)
  const progress = subtreeProgress(project, item.id)

  // Anything that would close a loop or nest too deep is absent from the menu,
  // not offered and then refused. The error below is for the parent picker,
  // where the choice is a single control and hiding options would be stranger.
  const adoptable = project.items.filter(
    (candidate) =>
      !candidate.archived &&
      candidate.parentId === null &&
      candidate.id !== item.id &&
      !wouldNestCycle(project, candidate.id, item.id),
  )

  async function createChild() {
    const title = (adding ?? '').trim()
    setAdding(null)
    if (title === '') return
    const child = newItem(project, createPorts(), { title, parentId: item.id })
    await dispatch({ kind: 'item.create', item: child })
  }

  return (
    <div className="kb-field">
      <div className="kb-row">
        <span className="kb-field__label">Sub-issues</span>
        <span className="kb-spacer" />
        {progress.total > 0 && (
          <span className="kb-muted data" style={{ fontSize: 'var(--step--1)' }}>
            {progress.done}/{progress.total} done
            {progress.points > 0 && ` · ${progress.donePoints}/${progress.points} pts`}
          </span>
        )}
      </div>

      {parent && (
        <div className="kb-row">
          <span className="kb-muted">Part of</span>
          <button
            type="button"
            className="kb-button kb-button--quiet"
            style={{ fontFamily: 'var(--font-data)', padding: '0 0.25rem' }}
            onClick={() => onOpen(parent.id)}
          >
            {parent.ref}
          </button>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {parent.title}
          </span>
          <span className="kb-spacer" />
          <Button
            variant="quiet"
            icon="close"
            aria-label="Detach from parent"
            onClick={() =>
              void dispatch({ kind: 'item.set', itemId: item.id, patch: { parentId: null } })
            }
          />
        </div>
      )}

      {progress.total > 0 && (
        <div className="kb-meter" aria-hidden>
          <span
            className="kb-meter__fill"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>
      )}

      {children.map((child) => (
        <ChildRow key={child.id} project={project} child={child} onOpen={onOpen} />
      ))}

      {children.length === 0 && (
        <p className="kb-muted" style={{ margin: 0 }}>
          Nothing under this yet.
        </p>
      )}

      {adding === null ? (
        <div className="kb-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button variant="quiet" icon="plus" onClick={() => setAdding('')}>
            Sub-issue
          </Button>
          {adoptable.length > 0 && (
            <select
              className="kb-select"
              style={{ width: 'auto' }}
              value=""
              aria-label="Move an existing item under this one"
              onChange={(event) => {
                const childId = event.target.value
                if (!childId) return
                if (wouldNestCycle(project, childId, item.id)) {
                  setError('That would nest too deep, or make the hierarchy circular.')
                  return
                }
                setError(null)
                void dispatch({
                  kind: 'item.set',
                  itemId: childId,
                  patch: { parentId: item.id },
                })
              }}
            >
              <option value="">Move an existing item here…</option>
              {adoptable.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.ref} — {candidate.title}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <input
          className="kb-input"
          autoFocus
          value={adding}
          placeholder="What needs doing?"
          aria-label="Title of the new sub-issue"
          onChange={(event) => setAdding(event.target.value)}
          onBlur={() => void createChild()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void createChild()
            if (event.key === 'Escape') setAdding(null)
          }}
        />
      )}

      {error && (
        <p style={{ color: 'var(--signal-cancelled)', margin: 0, fontSize: 'var(--step--1)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

function ChildRow({
  project,
  child,
  onOpen,
}: {
  readonly project: Project
  readonly child: Item
  readonly onOpen: (itemId: string) => void
}) {
  const dispatch = useDispatch()
  const status = statusById(project, child.statusId)

  return (
    <div className="kb-row">
      <Icon name={child.type === 'bug' ? 'bug' : 'task'} size={12} className="kb-muted" />
      <button
        type="button"
        className="kb-button kb-button--quiet"
        style={{ fontFamily: 'var(--font-data)', padding: '0 0.25rem' }}
        onClick={() => onOpen(child.id)}
      >
        {child.ref}
      </button>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {child.title}
      </span>
      <span className="kb-spacer" />
      {child.estimate !== null && <span className="data kb-muted">{child.estimate}</span>}
      {status && (
        <StatusChip
          label={status.name}
          signal={signalForCategory(status.category)}
          animate={false}
        />
      )}
      <Button
        variant="quiet"
        icon="close"
        aria-label={`Detach ${child.ref}`}
        onClick={() =>
          void dispatch({ kind: 'item.set', itemId: child.id, patch: { parentId: null } })
        }
      />
    </div>
  )
}

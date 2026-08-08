import {
  type Item,
  type ItemType,
  type LinkType,
  type Priority,
  type Project,
  byOrder,
  blockedBy,
  itemById,
  linkClosesCycle,
  mirrorLink,
  statusById,
} from '@kanbo/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createPorts } from '../../state/store.ts'
import { useDispatch } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { Markdown } from '../design/Markdown.tsx'
import { useDialog } from '../design/useDialog.ts'
import { ItemComments } from './ItemComments.tsx'
import { ItemFields } from './ItemFields.tsx'
import { ItemHistory } from './History.tsx'
import { SubIssues } from './SubIssues.tsx'
import { Select, TokenPicker } from './fields.tsx'
import { StatusChip, signalForCategory } from '../design/StatusChip.tsx'

const TYPES: readonly ItemType[] = ['epic', 'story', 'task', 'bug', 'spike', 'chore']
const PRIORITIES: readonly Priority[] = ['p0', 'p1', 'p2', 'p3', 'p4']

/** Kept away from the signal colours, which mean state rather than category. */
const LABEL_COLOURS = ['#6b7280', '#0891b2', '#7c3aed', '#db2777', '#ca8a04', '#0d9488']

export type ItemPanelProps = {
  readonly project: Project
  readonly itemId: string
  readonly onClose: () => void
  /** Opening a relative — a parent, a child — replaces what is on screen. */
  readonly onOpen: (itemId: string) => void
}

export function ItemPanel({ project, itemId, onClose, onOpen }: ItemPanelProps) {
  const dispatch = useDispatch()
  const item = itemById(project, itemId)
  const [editingBody, setEditingBody] = useState(false)
  const [draft, setDraft] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)

  /**
   * The description is the one field that is not written as you type, because
   * a Markdown body is edited in prose rather than in fragments. That makes the
   * draft the only unsaved thing in the panel, and it has to be flushed by
   * something other than blur: closing the panel unmounts the textarea, and no
   * browser fires `focusout` on an element that is being removed. Typing a
   * description and pressing Escape used to lose all of it.
   */
  const pending = useRef<{ itemId: string; body: string } | null>(null)

  const flush = useCallback(() => {
    const held = pending.current
    pending.current = null
    if (!held) return
    void dispatch({ kind: 'item.set', itemId: held.itemId, patch: { description: held.body } })
  }, [dispatch])

  // Changing item mid-edit must commit to the item being left, not carry its
  // text onto the next one — which is what a shared draft with no reset did.
  useEffect(() => {
    return () => {
      flush()
      setEditingBody(false)
      setDraft('')
    }
  }, [itemId, flush])

  const { ref: panelRef, onKeyDown } = useDialog<HTMLElement>(onClose)

  // Opening a relative replaces what is on screen without remounting, so the
  // dialog hook's mount-time focus does not fire. Focus has to follow the item.
  useEffect(() => {
    closeRef.current?.focus()
  }, [itemId])

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
        onKeyDown={onKeyDown}
      />
      <aside
        ref={panelRef}
        className="kb-panel"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        // Focusable so the dialog itself can hold focus when nothing inside it
        // has taken it yet; without that, Escape has nothing to bubble through.
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
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
              label="Sprint"
              value={item.iterationId ?? ''}
              options={[
                ['', 'None'],
                ...project.iterations.toSorted(byOrder).map((it) => [it.id, it.name] as const),
              ]}
              onChange={(iterationId) => set({ iterationId: iterationId || null })}
            />
            <Select
              label="Release"
              value={item.milestoneId ?? ''}
              options={[
                ['', 'None'],
                ...project.milestones.toSorted(byOrder).map((m) => [m.id, m.name] as const),
              ]}
              onChange={(milestoneId) => set({ milestoneId: milestoneId || null })}
            />
          </div>

          <TokenPicker
            label="Assignees"
            available={project.members}
            selected={item.assignees}
            placeholder="Add someone…"
            onChange={(assignees) => set({ assignees })}
            onCreate={(name) => {
              const member = { id: createPorts().random.id(), name, handle: null }
              void dispatch({ kind: 'member.upsert', member })
              return member.id
            }}
          />

          <TokenPicker
            label="Labels"
            available={project.labels}
            selected={item.labels}
            placeholder="Add a label…"
            onChange={(labels) => set({ labels })}
            onCreate={(name) => {
              const label = {
                id: createPorts().random.id(),
                name,
                color: LABEL_COLOURS[project.labels.length % LABEL_COLOURS.length] ?? '#6b7280',
              }
              void dispatch({ kind: 'label.upsert', label })
              return label.id
            }}
          />

          <div className="kb-field">
            <div className="kb-row">
              <span className="kb-field__label">Description</span>
              <span className="kb-spacer" />
              <Button
                variant="quiet"
                onClick={() => {
                  if (editingBody) flush()
                  else setDraft(item.description)
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
                onChange={(event) => {
                  setDraft(event.target.value)
                  pending.current = { itemId: item.id, body: event.target.value }
                }}
                onBlur={flush}
              />
            ) : item.description === '' ? (
              <p className="kb-muted" style={{ margin: 0 }}>
                No description yet.
              </p>
            ) : (
              <Markdown source={item.description} />
            )}
          </div>

          <ItemFields project={project} item={item} />

          <SubIssues project={project} item={item} onOpen={onOpen} />

          <LinksEditor project={project} item={item} />

          <ItemComments project={project} itemId={item.id} />

          <ItemHistory project={project} itemId={item.id} />

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
            {/* Archiving is the answer most of the time: the board stops showing
                it, the history keeps it, and `is:archived` finds it again.
                Delete is beside it rather than instead of it. */}
            <Button
              icon="archive"
              onClick={() => {
                set({ archived: !item.archived })
                if (!item.archived) onClose()
              }}
            >
              {item.archived ? 'Unarchive' : 'Archive'}
            </Button>
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

/**
 * Blocking links, refused before they can create a cycle.
 *
 * A cycle makes the roadmap's critical path non-terminating, and once the
 * operation is in the log every device inherits it — so the check happens here,
 * at the point of intent, rather than being cleaned up later.
 */
/**
 * Every relation an item can carry, not just the one that had an editor.
 *
 * `LinkType` has always had four members. Two of them — `relates-to` and
 * `duplicates` — could be stored, merged, exported and synced, and there was no
 * way to create one: a card could arrive from an import carrying a duplicate
 * link and the panel would not admit it existed.
 *
 * Only blocking has a direction that matters to anything else. The roadmap
 * draws its leaders from `blocked-by`, the board flags a card from it, and
 * `wouldCycle` refuses a loop — because a cycle makes the critical path
 * non-terminating and, once in the log, every device inherits it. The other two
 * are symmetric notes between peers: relating a card to itself is the only
 * nonsense worth refusing, and a loop of "relates to" is not a loop at all.
 */
const RELATIONS: readonly {
  readonly type: LinkType
  readonly label: string
  readonly empty: string
  readonly add: string
}[] = [
  {
    type: 'blocked-by',
    label: 'Blocked by',
    empty: 'Nothing is blocking this.',
    add: 'Add a blocking dependency',
  },
  {
    type: 'blocks',
    label: 'Blocks',
    empty: 'This is not holding anything up.',
    add: 'Add something this blocks',
  },
  {
    type: 'relates-to',
    label: 'Related',
    empty: 'Nothing related yet.',
    add: 'Add a related item',
  },
  {
    type: 'duplicates',
    label: 'Duplicates',
    empty: 'Not a duplicate of anything.',
    add: 'Add an item this duplicates',
  },
]

function LinksEditor({ project, item }: { readonly project: Project; readonly item: Item }) {
  return (
    <div className="kb-field">
      {RELATIONS.map((relation) => (
        <Relation key={relation.type} project={project} item={item} relation={relation} />
      ))}
    </div>
  )
}

function Relation({
  project,
  item,
  relation,
}: {
  readonly project: Project
  readonly item: Item
  readonly relation: (typeof RELATIONS)[number]
}) {
  const dispatch = useDispatch()
  const [error, setError] = useState<string | null>(null)

  const links = item.links.filter((link) => link.type === relation.type)

  // Anything already related in *this* way is out; the same pair may hold two
  // different relations, and hiding it would make the second uncreatable.
  const candidates = project.items.filter(
    (candidate) =>
      candidate.id !== item.id &&
      !candidate.archived &&
      !links.some((link) => link.itemId === candidate.id),
  )

  return (
    <div className="kb-field" style={{ gap: 'var(--space-2)' }}>
      <span className="kb-field__label">{relation.label}</span>

      {links.length === 0 && (
        <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
          {relation.empty}
        </p>
      )}

      {links.map((link) => {
        const other = itemById(project, link.itemId)
        return (
          <div key={link.itemId} className="kb-row">
            <span className="data kb-muted">{other?.ref ?? link.itemId}</span>
            <span>{other?.title ?? 'Unknown item'}</span>
            <span className="kb-spacer" />
            <Button
              variant="quiet"
              icon="close"
              aria-label={`Remove the ${relation.label.toLowerCase()} link to ${other?.ref ?? link.itemId}`}
              onClick={() =>
                void dispatch(
                  {
                    kind: 'item.unlink',
                    itemId: item.id,
                    targetId: link.itemId,
                    linkType: relation.type,
                  },
                  {
                    kind: 'item.unlink',
                    itemId: link.itemId,
                    targetId: item.id,
                    linkType: mirrorLink(relation.type),
                  },
                )
              }
            />
          </div>
        )
      })}

      <select
        className="kb-select"
        value=""
        aria-label={relation.add}
        onChange={(event) => {
          const targetId = event.target.value
          if (!targetId) return

          if (linkClosesCycle(project, item.id, targetId, relation.type)) {
            const other = itemById(project, targetId)
            setError(
              `${other?.ref ?? 'That item'} is already on the other side of this chain. Linking these would make it circular.`,
            )
            return
          }

          setError(null)
          void dispatch(
            { kind: 'item.link', itemId: item.id, link: { type: relation.type, itemId: targetId } },
            {
              kind: 'item.link',
              itemId: targetId,
              link: { type: mirrorLink(relation.type), itemId: item.id },
            },
          )
        }}
      >
        <option value="">{relation.add}…</option>
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

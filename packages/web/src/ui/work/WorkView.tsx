import {
  type Item,
  type ItemDelivery,
  type Project,
  byOrder,
  currentIteration,
  groupItems,
  isoDay,
  search,
} from '@kanbo/core'
import { useMemo, useState } from 'react'

import { readMeId } from '../../state/identity.ts'
import { BoardView, BoardEmpty, SprintProgress } from '../board/BoardView.tsx'
import { Icon } from '../design/Icon.tsx'
import { FilterBar } from './FilterBar.tsx'
import { ListLayout } from './ListLayout.tsx'

/**
 * One place the work is, and controls for how to look at it.
 *
 * Board, Table and Backlog used to be three destinations showing the same
 * items, each freezing one combination of layout and grouping: the board was
 * columns-by-status, the table was a flat sortable list, the backlog was a flat
 * ordered one. You could not have a table grouped by status — what GitHub
 * calls a grouped view and what most people mean by "list mode" — nor columns
 * grouped by sprint, though `groupItems` has been able to produce both since
 * the first commit and had sixteen tests and no callers.
 *
 * Splitting *where you are* from *how you are looking* is the whole change.
 * Filtering, grouping and the layout are three independent controls over one
 * set of items, which is also why the sprint question stops being special:
 * **filtering** by sprint asks "only this one", **grouping** by sprint asks
 * "all of it, in lanes" — and the work in no sprint at all gets a lane rather
 * than disappearing.
 */
export type Layout = 'columns' | 'list'

export type GroupKey = 'status' | 'iteration' | 'assignee' | 'priority' | 'none'

const GROUPS: readonly { key: GroupKey; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'iteration', label: 'Sprint' },
  { key: 'assignee', label: 'Person' },
  { key: 'priority', label: 'Priority' },
  { key: 'none', label: 'Nothing' },
]

export type WorkViewProps = {
  readonly project: Project
  readonly deliveries: ReadonlyMap<string, ItemDelivery>
  /**
   * Held by the shell rather than here, because it decides what a new card
   * belongs to and cards are created from outside this view as well.
   * `null` is every sprint; `''` is the ones in no sprint at all.
   */
  readonly sprint: string | null
  readonly onSprint: (sprint: string | null) => void
  readonly onOpen: (itemId: string) => void
  readonly onAdd: (statusId?: string) => void
}

export function WorkView({ project, deliveries, sprint, onSprint, onOpen, onAdd }: WorkViewProps) {
  const [layout, setLayout] = useState<Layout>('columns')
  const [groupBy, setGroupBy] = useState<GroupKey>('status')
  const [query, setQuery] = useState('')

  const day = isoDay(Date.now())
  const iterations = project.iterations.toSorted(byOrder)
  const current = currentIteration(project, Date.now()) ?? undefined

  const active = useMemo(() => project.items.filter((item) => !item.archived), [project.items])

  const visible = useMemo(() => {
    const bySprint =
      sprint === null ? active : active.filter((item) => (item.iterationId ?? '') === sprint)
    if (query.trim() === '') return bySprint

    // The same language the palette and the CLI run. Searching the whole
    // project and intersecting keeps one implementation of what a query means.
    const matched = new Set(
      search(query, { project, now: Date.now(), meId: readMeId() }).map((item) => item.id),
    )
    return bySprint.filter((item) => matched.has(item.id))
  }, [active, project, query, sprint])

  const groups = useMemo(
    () => groupItems(project, visible, groupBy === 'none' ? null : groupBy),
    [project, visible, groupBy],
  )

  if (project.statuses.length === 0) {
    return (
      <div className="kb-empty">
        <p className="kb-empty__title">This board has no columns</p>
        <p className="kb-empty__body">Add a status in settings to start moving work across it.</p>
      </div>
    )
  }

  const toolbar = (
    <div className="kb-toolbar">
      <div className="kb-toolbar__group" role="group" aria-label="Layout">
        {(['columns', 'list'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="kb-button kb-button--quiet"
            aria-pressed={layout === option}
            data-active={layout === option || undefined}
            onClick={() => setLayout(option)}
          >
            <Icon name={option === 'columns' ? 'board' : 'table'} size={14} />
            {option === 'columns' ? 'Columns' : 'List'}
          </button>
        ))}
      </div>

      <div className="kb-toolbar__group">
        <span className="kb-toolbar__label">Group by</span>
        <select
          className="kb-select"
          aria-label="Group by"
          value={groupBy}
          onChange={(event) => setGroupBy(event.target.value as GroupKey)}
        >
          {GROUPS.map((group) => (
            <option key={group.key} value={group.key}>
              {group.label}
            </option>
          ))}
        </select>
      </div>

      <div className="kb-toolbar__group">
        <span className="kb-toolbar__label">Sprint</span>
        <select
          className="kb-select"
          aria-label="Filter by sprint"
          value={sprint ?? '__all'}
          onChange={(event) => onSprint(event.target.value === '__all' ? null : event.target.value)}
        >
          <option value="__all">All</option>
          {current && <option value={current.id}>Current sprint</option>}
          {iterations.map((iteration) => (
            <option key={iteration.id} value={iteration.id}>
              {iteration.name}
            </option>
          ))}
          <option value="">No sprint</option>
        </select>
      </div>

      {sprint !== null && sprint !== '' && <SprintProgress project={project} sprintId={sprint} />}

      <span className="kb-spacer" />

      {visible.length !== active.length && (
        <span className="kb-toolbar__label data">
          {visible.length} of {active.length}
        </span>
      )}
    </div>
  )

  return (
    <>
      {toolbar}
      <FilterBar
        value={query}
        onChange={setQuery}
        shown={visible.length}
        total={active.length}
        me={readMeId()}
      />

      {active.length === 0 && (
        <BoardEmpty
          onAdd={() => onAdd()}
          {...(sprint ? { into: iterations.find((it) => it.id === sprint)?.name } : {})}
        />
      )}

      {layout === 'list' ? (
        <ListLayout
          project={project}
          groups={groups}
          grouped={groupBy !== 'none'}
          day={day}
          onOpen={onOpen}
        />
      ) : groupBy === 'status' ? (
        <BoardView
          project={project}
          items={visible}
          deliveries={deliveries}
          // Redundant when the board is already narrowed to one sprint.
          showIteration={sprint === null}
          onOpen={onOpen}
          onAdd={onAdd}
        />
      ) : (
        <Swimlanes
          project={project}
          groups={groups}
          deliveries={deliveries}
          showIteration={groupBy !== 'iteration' && sprint === null}
          onOpen={onOpen}
          onAdd={onAdd}
        />
      )}
    </>
  )
}

/**
 * Columns, once per lane.
 *
 * Each lane is its own board with its own drag context, so a card moves between
 * columns inside its lane. It deliberately does not move *between* lanes by
 * drag: dropping a card into another person's row would have to reassign it,
 * and a gesture whose meaning changes with the grouping is a gesture nobody can
 * predict. The lane's own field is edited on the card, or inline in the list.
 */
function Swimlanes({
  project,
  groups,
  deliveries,
  showIteration,
  onOpen,
  onAdd,
}: {
  readonly project: Project
  readonly groups: readonly { key: string | null; label: string; items: readonly Item[] }[]
  readonly deliveries: ReadonlyMap<string, ItemDelivery>
  readonly showIteration: boolean
  readonly onOpen: (itemId: string) => void
  readonly onAdd: (statusId?: string) => void
}) {
  return (
    <div style={{ overflowY: 'auto' }}>
      {groups.map((group) => (
        <section key={group.key ?? '__none'} aria-label={group.label}>
          <h2
            className="kb-toolbar__label"
            style={{
              position: 'sticky',
              left: 0,
              margin: 0,
              padding: 'var(--space-3) var(--space-4) var(--space-1)',
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'baseline',
            }}
          >
            {group.label}
            <span className="data kb-muted">{group.items.length}</span>
          </h2>
          <BoardView
            project={project}
            items={group.items}
            deliveries={deliveries}
            showIteration={showIteration}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        </section>
      ))}
    </div>
  )
}

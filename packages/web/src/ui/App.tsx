import { type Project, byOrder, newItem } from '@kanbo/core'
import { useEffect, useState } from 'react'

import { createPorts, seedOperations } from '../state/store'
import { useDispatch, useProject } from '../state/useStore'
import { BacklogView } from './backlog/BacklogView'
import { BoardEmpty, BoardView } from './board/BoardView'
import { Button } from './design/Button'
import { Icon, type IconName } from './design/Icon'
import { ItemPanel } from './item/ItemPanel'
import { MetricsView } from './metrics/MetricsView'
import { RoadmapView } from './roadmap/RoadmapView'
import { SettingsPanel } from './settings/SettingsPanel'
import { SprintView } from './sprint/SprintView'
import { TableView } from './table/TableView'
import { applyTheme } from './theme'

type ViewKey = 'board' | 'table' | 'backlog' | 'sprint' | 'roadmap' | 'metrics'

const NAV: readonly { key: ViewKey; label: string; icon: IconName }[] = [
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'table', label: 'Table', icon: 'table' },
  { key: 'backlog', label: 'Backlog', icon: 'backlog' },
  { key: 'sprint', label: 'Sprints', icon: 'calendar' },
  { key: 'roadmap', label: 'Roadmap', icon: 'roadmap' },
  { key: 'metrics', label: 'Metrics', icon: 'metrics' },
]

export function App() {
  const project = useProject()
  const dispatch = useDispatch()
  const [view, setView] = useState<ViewKey>('board')
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    applyTheme()
  }, [])

  async function addItem(statusId?: string) {
    const ports = createPorts()
    const first = project.statuses.toSorted(byOrder)[0]
    const item = newItem(project, ports, {
      title: 'Untitled',
      ...((statusId ?? first?.id) ? { statusId: statusId ?? first!.id } : {}),
    })
    await dispatch({ kind: 'item.create', item })
    setOpenItem(item.id)
  }

  if (project.statuses.length === 0) {
    return <FirstRun />
  }

  const active = project.items.filter((item) => !item.archived)

  return (
    <div className="kb-shell">
      <header className="kb-topbar">
        <Icon name="board" size={18} />
        <strong style={{ letterSpacing: '-0.02em' }}>{project.name || 'Kanbo'}</strong>
        <span className="data kb-muted" style={{ fontSize: 'var(--step--1)' }}>
          {project.key}
        </span>
        <span className="kb-spacer" />
        <Button variant="primary" icon="plus" onClick={() => void addItem()}>
          New item
        </Button>
        <Button
          variant="quiet"
          icon="settings"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        />
      </header>

      <nav className="kb-sidebar" aria-label="Views">
        <div>
          <p className="kb-nav__label">Views</p>
          {NAV.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="kb-nav__item"
              aria-current={view === entry.key ? 'page' : undefined}
              onClick={() => setView(entry.key)}
            >
              <Icon name={entry.icon} size={15} />
              {entry.label}
              {entry.key === 'board' && <span className="kb-nav__count">{active.length}</span>}
            </button>
          ))}
        </div>

        <div>
          <p className="kb-nav__label">Columns</p>
          {project.statuses.toSorted(byOrder).map((status) => {
            const count = active.filter((item) => item.statusId === status.id).length
            const over = status.wipLimit !== null && count > status.wipLimit
            return (
              <div key={status.id} className="kb-nav__item" style={{ cursor: 'default' }}>
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: status.color ?? 'var(--ink-faint)',
                  }}
                />
                {status.name}
                <span
                  className="kb-nav__count"
                  style={over ? { color: 'var(--signal-delayed)', fontWeight: 600 } : undefined}
                >
                  {count}
                </span>
              </div>
            )
          })}
        </div>
      </nav>

      <main className="kb-main">
        {active.length === 0 && view === 'board' ? (
          <BoardEmpty onAdd={() => void addItem()} />
        ) : view === 'board' ? (
          <BoardView project={project} onOpen={setOpenItem} onAdd={(id) => void addItem(id)} />
        ) : view === 'table' ? (
          <TableView project={project} onOpen={setOpenItem} />
        ) : view === 'backlog' ? (
          <BacklogView project={project} onOpen={setOpenItem} />
        ) : view === 'sprint' ? (
          <SprintView project={project} onOpen={setOpenItem} />
        ) : view === 'roadmap' ? (
          <RoadmapView project={project} onOpen={setOpenItem} />
        ) : (
          <MetricsView project={project} />
        )}
      </main>

      {openItem && (
        <ItemPanel project={project} itemId={openItem} onClose={() => setOpenItem(null)} />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

/**
 * A first run has to land on something someone can immediately drag a card
 * across. An empty board with no columns is a dead end, not a clean slate.
 */
function FirstRun() {
  const dispatch = useDispatch()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')

  const suggestedKey = (name.trim().split(/\s+/)[0] ?? '').slice(0, 4).toUpperCase()
  const effectiveKey = key.trim().toUpperCase() || suggestedKey || 'KAN'

  return (
    <main className="kb-empty" style={{ height: '100dvh' }}>
      <Icon name="board" size={32} />
      <h1 className="kb-empty__title">Kanbo</h1>
      <p className="kb-empty__body">
        Kanban, sprints and roadmap in your browser. Nothing leaves this machine unless you connect
        a repository, and this page cannot reach the network until you do.
      </p>

      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '18rem' }}
        onSubmit={(event) => {
          event.preventDefault()
          void dispatch(...seedOperations(createPorts(), name.trim() || 'My project', effectiveKey))
        }}
      >
        <div className="kb-field">
          <label className="kb-field__label" htmlFor="kb-project-name">
            Project name
          </label>
          <input
            id="kb-project-name"
            className="kb-input"
            value={name}
            placeholder="Apollo"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="kb-field">
          <label className="kb-field__label" htmlFor="kb-project-key">
            Reference prefix
          </label>
          <input
            id="kb-project-key"
            className="kb-input data"
            value={key}
            placeholder={suggestedKey || 'KAN'}
            maxLength={5}
            onChange={(event) => setKey(event.target.value)}
          />
          <span className="kb-muted data" style={{ fontSize: 'var(--step--1)' }}>
            Items will be numbered {effectiveKey}-1, {effectiveKey}-2, …
          </span>
        </div>
        <Button type="submit" variant="primary">
          Create the board
        </Button>
      </form>
    </main>
  )
}

export type { Project }

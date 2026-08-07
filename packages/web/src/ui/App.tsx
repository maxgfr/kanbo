import { type Project, byOrder, newItem } from '@kanbo/core'
import { useEffect, useState } from 'react'

import { readSyncSettings } from '../boot/syncSettings.ts'
import { createPorts, seedOperations } from '../state/store.ts'
import { type SyncState, runSync, saveToken } from '../state/sync.ts'
import { useDispatch, usePorts, useProject } from '../state/useStore.ts'
import { BacklogView } from './backlog/BacklogView.tsx'
import { BoardEmpty, BoardView } from './board/BoardView.tsx'
import { Button } from './design/Button.tsx'
import { Icon, type IconName } from './design/Icon.tsx'
import { ItemPanel } from './item/ItemPanel.tsx'
import { MetricsView } from './metrics/MetricsView.tsx'
import { type Command, CommandPalette } from './palette/CommandPalette.tsx'
import { ReleasesView } from './releases/ReleasesView.tsx'
import { RoadmapView } from './roadmap/RoadmapView.tsx'
import { SettingsPanel } from './settings/SettingsPanel.tsx'
import { ShareDialog } from './share/ShareDialog.tsx'
import { SprintView } from './sprint/SprintView.tsx'
import { TableView } from './table/TableView.tsx'
import { applyTheme } from './theme.ts'

type ViewKey = 'board' | 'table' | 'backlog' | 'sprint' | 'roadmap' | 'releases' | 'metrics'

const NAV: readonly { key: ViewKey; label: string; icon: IconName }[] = [
  { key: 'board', label: 'Board', icon: 'board' },
  { key: 'table', label: 'Table', icon: 'table' },
  { key: 'backlog', label: 'Backlog', icon: 'backlog' },
  { key: 'sprint', label: 'Sprints', icon: 'calendar' },
  { key: 'roadmap', label: 'Roadmap', icon: 'roadmap' },
  { key: 'releases', label: 'Releases', icon: 'tag' },
  { key: 'metrics', label: 'Metrics', icon: 'metrics' },
]

export function App() {
  const project = useProject()
  const dispatch = useDispatch()
  const [view, setView] = useState<ViewKey>('board')
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  useEffect(() => {
    applyTheme()
  }, [])

  // One shortcut, on the key everyone already presses for this.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
        <Button variant="quiet" icon="search" onClick={() => setPaletteOpen(true)}>
          Search
          <span className="data kb-muted" style={{ fontSize: 'var(--step--1)' }}>
            &#8984;K
          </span>
        </Button>
        <SyncButton />
        <Button variant="quiet" icon="link" aria-label="Share" onClick={() => setShareOpen(true)} />
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
        ) : view === 'releases' ? (
          <ReleasesView project={project} onOpen={setOpenItem} />
        ) : (
          <MetricsView project={project} />
        )}
      </main>

      {openItem && (
        <ItemPanel project={project} itemId={openItem} onClose={() => setOpenItem(null)} />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {shareOpen && <ShareDialog project={project} onClose={() => setShareOpen(false)} />}
      {paletteOpen && (
        <CommandPalette
          project={project}
          commands={
            [
              { id: 'new', label: 'New item', icon: 'plus', hint: 'n', run: () => void addItem() },
              ...NAV.map((entry) => ({
                id: `view-${entry.key}`,
                label: `Go to ${entry.label}`,
                icon: entry.icon,
                run: () => setView(entry.key),
              })),
              {
                id: 'settings',
                label: 'Settings',
                icon: 'settings',
                run: () => setSettingsOpen(true),
              },
            ] satisfies Command[]
          }
          onOpenItem={setOpenItem}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * A first run has to land on something someone can immediately drag a card
 * across. An empty board with no columns is a dead end, not a clean slate.
 */
function FirstRun() {
  const dispatch = useDispatch()
  const store = usePorts()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [token, setToken] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  // A device joining a repository someone else set up has no board to open
  // settings from, so the only route to its first pull has to be here.
  const connected = readSyncSettings().mode === 'connected'

  async function joinExisting() {
    setJoining(true)
    setJoinError(null)
    // Saved first: a joining device has no token yet, and asking for it here
    // rather than sending the user to a settings screen they cannot reach is
    // the difference between a working flow and a dead end.
    if (token.trim() !== '') await saveToken(store, token)
    const state = await runSync(store)
    setJoining(false)
    if (state.kind === 'failed') setJoinError(state.message)
    else if (state.kind === 'unconfigured') setJoinError(state.reason)
  }

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

      {connected && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            alignItems: 'center',
            borderTop: '1px solid var(--rule)',
            paddingTop: 'var(--space-5)',
            width: '22rem',
          }}
        >
          <p className="kb-muted" style={{ margin: 0 }}>
            Or join a project that already exists in your repository.
          </p>
          <input
            className="kb-input data"
            type="password"
            value={token}
            placeholder="Access token"
            autoComplete="off"
            aria-label="Access token"
            onChange={(event) => setToken(event.target.value)}
          />
          <Button icon="sync" disabled={joining} onClick={() => void joinExisting()}>
            {joining ? 'Pulling…' : 'Pull from repository'}
          </Button>
          {joinError && (
            <p style={{ color: 'var(--signal-cancelled)', margin: 0, fontSize: 'var(--step--1)' }}>
              {joinError}
            </p>
          )}
        </div>
      )}
    </main>
  )
}

export type { Project }

/**
 * Sync, where someone can reach it.
 *
 * Only shown in repository mode: a button that cannot do anything is worse
 * than no button, and in local mode there is nothing to sync with.
 */
function SyncButton() {
  const store = usePorts()
  const [state, setState] = useState<SyncState>({ kind: 'idle', at: null })
  if (readSyncSettings().mode !== 'connected') return null

  const failed = state.kind === 'failed' || state.kind === 'unconfigured'

  return (
    <Button
      icon={failed ? 'warning' : 'sync'}
      disabled={state.kind === 'syncing'}
      title={
        failed
          ? state.kind === 'failed'
            ? state.message
            : state.reason
          : 'Pull everyone\u2019s work, then push yours'
      }
      style={failed ? { color: 'var(--signal-delayed)' } : undefined}
      onClick={() => {
        setState({ kind: 'syncing' })
        void runSync(store).then(setState)
      }}
    >
      {state.kind === 'syncing' ? 'Syncing\u2026' : 'Sync'}
    </Button>
  )
}

import { type Project, byOrder, newItem } from '@kanbo/core'
import { useCallback, useEffect, useReducer, useState } from 'react'

import { takeHandover } from '../boot/handover.ts'
import { readSyncSettings } from '../boot/syncSettings.ts'
import { type DeliveryCache, deliveriesFor, refreshDelivery } from '../state/delivery.ts'
import { createPorts, seedOperations } from '../state/store.ts'
import { type SyncState, runSync, saveToken } from '../state/sync.ts'
import { useDispatch, usePersistFailure, usePorts, useProject } from '../state/useStore.ts'
import { Button } from './design/Button.tsx'
import { Icon, type IconName } from './design/Icon.tsx'
import { ItemPanel } from './item/ItemPanel.tsx'
import { MetricsView } from './metrics/MetricsView.tsx'
import { type Command, CommandPalette } from './palette/CommandPalette.tsx'
import { PeopleView } from './people/PeopleView.tsx'
import { ReleasesView } from './releases/ReleasesView.tsx'
import { RoadmapView } from './roadmap/RoadmapView.tsx'
import { SettingsPanel } from './settings/SettingsPanel.tsx'
import { Shortcuts } from './design/Shortcuts.tsx'
import { ShareDialog } from './share/ShareDialog.tsx'
import { SprintView } from './sprint/SprintView.tsx'
import { applyTheme, watchSystemTheme } from './theme.ts'
import { WorkView } from './work/WorkView.tsx'

type ViewKey = 'work' | 'sprint' | 'roadmap' | 'releases' | 'people' | 'metrics'

/**
 * Six destinations, not eight.
 *
 * Board, Table and Backlog were three of them and showed the same items: they
 * differed only in a layout and a grouping, which are now controls inside Work
 * rather than a choice of where to be.
 *
 * The key is the shortcut. `g` then the letter goes there, which is the pattern
 * every forge already trained this audience on.
 */
const NAV: readonly { key: ViewKey; label: string; icon: IconName; keys: string }[] = [
  { key: 'work', label: 'Work', icon: 'board', keys: 'w' },
  { key: 'sprint', label: 'Sprints', icon: 'calendar', keys: 's' },
  { key: 'roadmap', label: 'Roadmap', icon: 'roadmap', keys: 'r' },
  { key: 'releases', label: 'Releases', icon: 'tag', keys: 'l' },
  { key: 'people', label: 'People', icon: 'person', keys: 'p' },
  { key: 'metrics', label: 'Metrics', icon: 'metrics', keys: 'm' },
]

export function App() {
  const store = usePorts()
  const project = useProject()
  const dispatch = useDispatch()
  const [view, setView] = useState<ViewKey>('work')
  const [openItem, setOpenItem] = useState<string | null>(null)
  // Switching between local and repository mode loads the other document, so
  // the panel the switch was made in is destroyed with everything else. The
  // marker is what brings it back, and it is cleared as soon as it is read.
  const [settingsOpen, setSettingsOpen] = useState(() => takeHandover() === 'settings')
  const [switched, setSwitched] = useState(settingsOpen)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [delivery, setDelivery] = useState<DeliveryCache | null>(null)
  // Claiming a seat changes what `@me` resolves to, and both the palette and
  // the filter read it while rendering rather than holding a copy.
  const [, bumpMe] = useReducer((count: number) => count + 1, 0)
  // A write that did not land is the one failure the board cannot show by
  // itself: the screen is updated before the write, so it looks saved.
  const unsaved = usePersistFailure()

  function closeSettings() {
    setSettingsOpen(false)
    setSwitched(false)
  }

  useEffect(() => {
    applyTheme()
    return watchSystemTheme()
  }, [])

  // Pull requests are fetched and cached; the board shows what it last knew
  // rather than nothing when the forge is unreachable. Re-read after a sync as
  // well as at mount — `store` never changes, so this used to run exactly once
  // and the pull-request badges could only be refreshed by reloading the page.
  const refreshPulls = useCallback(
    // Forced after a sync: the cache is deliberately kept for fifteen minutes,
    // which is right on arrival and wrong the moment someone asks for the
    // latest by pressing Sync.
    (force = false) => {
      if (readSyncSettings().mode !== 'connected') return
      void refreshDelivery(store, { force })
        .then(setDelivery)
        // Reported nowhere on purpose: the badges are a convenience, the cache
        // already holds what we last knew, and a failure here must not become
        // an unhandled rejection.
        .catch(() => undefined)
    },
    [store],
  )

  useEffect(() => refreshPulls(), [refreshPulls])

  // Stable enough to be a dependency: the shortcut handler holds it, and a new
  // identity every render would re-register the listener on every keystroke.
  const addItem = useCallback(
    async (statusId?: string) => {
      const ports = createPorts()
      const first = project.statuses.toSorted(byOrder)[0]
      const item = newItem(project, ports, {
        title: 'Untitled',
        ...((statusId ?? first?.id) ? { statusId: statusId ?? first!.id } : {}),
      })
      await dispatch({ kind: 'item.create', item })
      setOpenItem(item.id)
    },
    [project, dispatch],
  )

  /**
   * The keyboard, kept to its word.
   *
   * ⌘K was the only shortcut in the application, and the palette advertised `n`
   * for "New item" against nothing at all — a claim the software could not
   * keep, which is the one thing PRODUCT.md forbids by name. The bare keys are
   * the ones a forge has already trained this audience on: `g` then a letter to
   * go somewhere, `/` to filter, `?` to be told all of this.
   *
   * Nothing fires while a field has focus, or the letter would land in the text
   * instead of the board. A card's own `o` and `space` are handled on the card,
   * where they belong.
   */
  useEffect(() => {
    let goingTo = false
    let clear: number | undefined

    function typing(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false
      return (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.closest('[role="dialog"]') !== null
      )
    }

    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return

      if (goingTo) {
        window.clearTimeout(clear)
        goingTo = false
        const destination = NAV.find((entry) => entry.keys === event.key.toLowerCase())
        if (destination) {
          event.preventDefault()
          setView(destination.key)
        }
        return
      }

      switch (event.key) {
        case 'g':
          // A prefix rather than a chord: `g` alone means nothing yet, and is
          // forgotten a second later so a stray press cannot swallow the next
          // real keystroke.
          goingTo = true
          clear = window.setTimeout(() => {
            goingTo = false
          }, 1200)
          return
        case 'n':
          event.preventDefault()
          void addItem()
          return
        case '/':
          event.preventDefault()
          setView('work')
          // After the view has painted, or there is no field to focus yet.
          requestAnimationFrame(() => document.getElementById('kb-filter')?.focus())
          return
        case '?':
          event.preventDefault()
          setShortcutsOpen(true)
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(clear)
      window.removeEventListener('keydown', onKey)
    }
  }, [addItem])

  if (project.statuses.length === 0) {
    return <FirstRun />
  }

  const active = project.items.filter((item) => !item.archived)

  return (
    <div className="kb-shell" data-unsaved={unsaved ? '' : undefined}>
      {unsaved && (
        <p
          role="alert"
          className="kb-row"
          style={{
            gridColumn: '1 / -1',
            margin: 0,
            padding: 'var(--space-2) var(--space-4)',
            color: 'var(--signal-cancelled)',
            background: 'var(--signal-cancelled-dim)',
            borderBottom: '1px solid var(--signal-cancelled)',
            lineHeight: 1.5,
          }}
        >
          <Icon name="warning" size={14} />
          <span>
            Your last change was not saved to this browser. {unsaved.message} Export before
            reloading — what is on screen is ahead of what is on disk.
          </span>
        </p>
      )}
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
        <SyncButton onSynced={() => refreshPulls(true)} />
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
              {entry.key === 'work' && <span className="kb-nav__count">{active.length}</span>}
            </button>
          ))}
        </div>

        <div>
          <p className="kb-nav__label">Columns</p>
          {project.statuses.toSorted(byOrder).map((status) => {
            const count = active.filter((item) => item.statusId === status.id).length
            const over = status.wipLimit !== null && count > status.wipLimit
            return (
              <button
                key={status.id}
                type="button"
                className="kb-nav__item"
                // Named for what it does. A column and a destination can share
                // a word, and two controls with the same accessible name going
                // to different places is a maze for anyone reading the page
                // rather than looking at it.
                aria-label={`Go to the ${status.name} column`}
                // Scrolls to the column rather than filtering to it. A board
                // with a dozen columns scrolls sideways, and this list is the
                // map of it; filtering here would compete with the sprint
                // filter and with `status:` in the palette, which already
                // answers that question and says so in the query.
                onClick={() => {
                  setView('work')
                  requestAnimationFrame(() =>
                    document.getElementById(`kb-column-${status.id}`)?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'nearest',
                      inline: 'center',
                    }),
                  )
                }}
              >
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
              </button>
            )
          })}
        </div>
      </nav>

      <main className="kb-main">
        {view === 'work' ? (
          <WorkView
            project={project}
            deliveries={deliveriesFor(store, delivery)}
            onOpen={setOpenItem}
            onAdd={(id) => void addItem(id)}
          />
        ) : view === 'sprint' ? (
          <SprintView project={project} onOpen={setOpenItem} />
        ) : view === 'roadmap' ? (
          <RoadmapView project={project} onOpen={setOpenItem} />
        ) : view === 'releases' ? (
          <ReleasesView project={project} onOpen={setOpenItem} />
        ) : view === 'people' ? (
          <PeopleView project={project} onOpen={setOpenItem} onMeChange={bumpMe} />
        ) : (
          <MetricsView project={project} />
        )}
      </main>

      {openItem && (
        <ItemPanel
          project={project}
          itemId={openItem}
          onClose={() => setOpenItem(null)}
          onOpen={setOpenItem}
        />
      )}
      {settingsOpen && <SettingsPanel announceMode={switched} onClose={closeSettings} />}
      {shareOpen && <ShareDialog project={project} onClose={() => setShareOpen(false)} />}
      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
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
                hint: `g ${entry.keys}`,
                run: () => setView(entry.key),
              })),
              {
                id: 'shortcuts',
                label: 'Keyboard shortcuts',
                icon: 'settings',
                hint: '?',
                run: () => setShortcutsOpen(true),
              },
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
    try {
      // Saved first: a joining device has no token yet, and asking for it here
      // rather than sending the user to a settings screen they cannot reach is
      // the difference between a working flow and a dead end.
      if (token.trim() !== '') await saveToken(store, token)
      const state = await runSync(store)
      if (state.kind === 'failed') setJoinError(state.message)
      else if (state.kind === 'unconfigured') setJoinError(state.reason)
      // A sync that worked and found nothing has to say so. Silence here reads
      // as a broken button on the one screen a joining device cannot leave.
      else if (store.getProject().statuses.length === 0) {
        setJoinError('That repository holds no Kanbo project yet. Create the board instead.')
      }
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'The repository could not be reached.')
    } finally {
      // In a finally, because this is the only control on a device with no
      // board: leaving it disabled would be a dead end with no way back.
      setJoining(false)
    }
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
function SyncButton({ onSynced }: { readonly onSynced: () => void }) {
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
        void runSync(store)
          .then((next) => {
            setState(next)
            // What the forge says about work in flight may have moved too.
            if (next.kind === 'idle') onSynced()
          })
          // `runSync` reports rather than throws, and this is what keeps that
          // true if it ever stops being: a button that never comes back is
          // worse than one that says what went wrong.
          .catch((error: unknown) =>
            setState({
              kind: 'failed',
              message: error instanceof Error ? error.message : 'Sync failed.',
            }),
          )
      }}
    >
      {state.kind === 'syncing' ? 'Syncing\u2026' : 'Sync'}
    </Button>
  )
}

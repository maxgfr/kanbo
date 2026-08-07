import {
  type Operation,
  type OperationBody,
  type Ports,
  type Project,
  type View,
  appendLocal,
  defaultStatuses,
  keysBetween,
  mergeLogs,
  operationBuilder,
  reduceOperations,
} from '@kanbo/core'
import { browserClock, browserRandom, browserStorage, deviceId } from '@kanbo/adapters-web'

const LOG_KEY = 'log'

/**
 * The whole application state, and the one place operations are written.
 *
 * There is no reducer here beyond the domain's own: the store holds a log,
 * folds it into a project, and hands both to React. Emitting an operation
 * appends, re-folds and persists — so the screen can only ever show something
 * the log can reproduce, which is the same guarantee another device gets when
 * it replays that log.
 */
export class Store {
  private log: readonly Operation[] = []
  private snapshot: Project = reduceOperations([])
  private listeners = new Set<() => void>()
  private ready = false
  private failure: Error | null = null
  /**
   * The last operation this device authored that nobody else has seen, and so
   * the only one a further edit is allowed to fold into. Cleared by anything
   * that puts the log in front of the outside world.
   */
  private supersedable: Operation | null = null

  private readonly ports: Ports
  /** This device's identity — the name of the file it owns in a repository. */
  readonly device: string

  constructor(ports: Ports, device: string) {
    this.ports = ports
    this.device = device
  }

  /** Exposed so the sync layer can hold the encrypted access token. */
  get storage() {
    return this.ports.storage
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Stable across renders unless something actually changed. */
  getProject = (): Project => this.snapshot

  getLog = (): readonly Operation[] => this.log

  /**
   * Declare that the log has left the building.
   *
   * Called before the log is pushed to a repository or written to an export.
   * After that an operation may exist somewhere we do not control, so folding a
   * later edit into it would only mean the superseded copy comes home on the
   * next pull — which is the noise this is here to avoid, arriving late.
   */
  seal = (): void => {
    this.supersedable = null
  }

  isReady = (): boolean => this.ready

  /**
   * The last write that did not land, or null.
   *
   * Kept as state rather than thrown, because every caller is a click handler
   * and a rejection there is a rejection nobody catches. Read through
   * `useSyncExternalStore` like the project itself, so the identity is stable
   * while nothing has changed.
   */
  getFailure = (): Error | null => this.failure

  async load(): Promise<void> {
    const stored = await this.ports.storage.get(LOG_KEY)
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(stored))
        if (Array.isArray(parsed)) this.log = parsed as readonly Operation[]
      } catch {
        // A log we cannot parse is a log we must not overwrite. Starting empty
        // would silently destroy it on the next write, so refuse instead.
        throw new Error('The stored project could not be read. Export it before continuing.')
      }
    }
    this.snapshot = reduceOperations(this.log)
    this.ready = true
    this.emit()
  }

  /**
   * Apply a batch of changes as one gesture.
   *
   * Batching matters for undo and for ordering: dropping a card that also
   * closes it is one user action, and its operations must not interleave with
   * another device's between the two halves.
   */
  dispatch = async (...bodies: readonly OperationBody[]): Promise<void> => {
    if (bodies.length === 0) return

    const emit = operationBuilder(this.ports, { deviceId: this.device, authorId: null }, this.log)
    const fresh = bodies.map(emit)

    // A run of keystrokes in one field is one edit, and is appended as one.
    // Without this, typing a title writes an operation per character: a history
    // nobody can read, a log that only grows, and a fold over all of it on
    // every keypress.
    const appended = appendLocal(this.log, fresh, { supersedable: this.supersedable })
    this.log = appended.log
    this.supersedable = appended.supersedable
    this.snapshot = reduceOperations(this.log)
    this.emit()

    // Persisted after the screen updates: the board must feel immediate, and a
    // failed write is reported rather than blocking the interaction.
    await this.persist()
  }

  /** Fold in operations that arrived from elsewhere — another device, an import. */
  async absorb(incoming: readonly Operation[]): Promise<void> {
    // Whatever we had pending has now been offered to a repository or an
    // export, and an operation someone else may hold cannot be taken back.
    this.supersedable = null

    const merged = mergeLogs(this.log, incoming)
    if (merged.length === this.log.length) return
    this.log = merged
    this.snapshot = reduceOperations(this.log)
    this.emit()
    await this.persist()
  }

  /**
   * Write the log, and say so when it does not go.
   *
   * The screen updates before this runs, which is what makes the board feel
   * immediate — and what makes a failed write invisible. The log in memory
   * would be ahead of the log on disk, the user would keep working, and the
   * next reload would take everything since the first failure with it. That is
   * the same loss `load()` refuses to risk on the way in, so it is refused on
   * the way out too: the failure is held and reported, and it clears itself the
   * moment a write succeeds.
   */
  async persist(): Promise<void> {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(this.log))
      await this.ports.storage.set(LOG_KEY, bytes)
      if (this.failure === null) return
      this.failure = null
    } catch (error) {
      this.failure =
        error instanceof Error
          ? error
          : new Error('The project could not be saved to this browser.')
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export function createPorts(): Ports {
  return { clock: browserClock, random: browserRandom, storage: browserStorage() }
}

export function createStore(): Store {
  return new Store(createPorts(), deviceId())
}

/**
 * The operations that turn an empty log into a usable project.
 *
 * A first run has to land on something a person can immediately drag a card
 * across — an empty board with no columns is a dead end, not a clean slate.
 */
export function seedOperations(ports: Ports, name: string, key: string): OperationBody[] {
  const statuses = defaultStatuses(() => ports.random.id())
  const viewOrders = keysBetween(null, null, 3)

  const views: View[] = [
    {
      id: ports.random.id(),
      name: 'Board',
      kind: 'board',
      filters: [],
      sorts: [],
      groupBy: 'status',
      visibleFields: [],
      order: viewOrders[0]!,
    },
    {
      id: ports.random.id(),
      name: 'Table',
      kind: 'table',
      filters: [],
      sorts: [],
      groupBy: null,
      visibleFields: [],
      order: viewOrders[1]!,
    },
    {
      id: ports.random.id(),
      name: 'Backlog',
      kind: 'backlog',
      filters: [],
      sorts: [],
      groupBy: null,
      visibleFields: [],
      order: viewOrders[2]!,
    },
  ]

  return [
    { kind: 'project.set', patch: { name, key } },
    ...statuses.map((status) => ({ kind: 'status.upsert' as const, status })),
    ...views.map((view) => ({ kind: 'view.upsert' as const, view })),
  ]
}

import {
  type Operation,
  type OperationBody,
  type Ports,
  type Project,
  type View,
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

  isReady = (): boolean => this.ready

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
  async dispatch(...bodies: readonly OperationBody[]): Promise<void> {
    if (bodies.length === 0) return

    const emit = operationBuilder(this.ports, { deviceId: this.device, authorId: null }, this.log)
    const fresh = bodies.map(emit)

    this.log = mergeLogs(this.log, fresh)
    this.snapshot = reduceOperations(this.log)
    this.emit()

    // Persisted after the screen updates: the board must feel immediate, and a
    // failed write is reported rather than blocking the interaction.
    await this.persist()
  }

  /** Fold in operations that arrived from elsewhere — another device, an import. */
  async absorb(incoming: readonly Operation[]): Promise<void> {
    const merged = mergeLogs(this.log, incoming)
    if (merged.length === this.log.length) return
    this.log = merged
    this.snapshot = reduceOperations(this.log)
    this.emit()
    await this.persist()
  }

  async persist(): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(this.log))
    await this.ports.storage.set(LOG_KEY, bytes)
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

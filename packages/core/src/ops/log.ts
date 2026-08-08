/**
 * Holding operations, ordering them, and merging two devices' worth.
 *
 * The merge is deliberately boring: concatenate, drop duplicates by operation
 * id, sort by the total order. That makes it idempotent (merging twice changes
 * nothing), commutative (either argument order gives the same result) and
 * associative (grouping does not matter) — which together are exactly what
 * "every device converges" means. Those three properties are asserted directly
 * in the tests, because they are the whole guarantee.
 */
import type { Operation } from './types.ts'

/**
 * The total order every device computes identically.
 *
 * Lamport first, so causality is respected: an operation that saw another is
 * always ordered after it. Then device id, then operation id — both arbitrary
 * but *stable*, which is all a tie-break has to be. Wall-clock time is
 * deliberately absent; a device with a skewed clock must not be able to reorder
 * anyone else's history.
 */
export function compareOperations(a: Operation, b: Operation): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Sort a copy into the canonical order. */
export function sortOperations(operations: readonly Operation[]): readonly Operation[] {
  return operations.toSorted(compareOperations)
}

/**
 * Merge any number of logs into one canonical log.
 *
 * Duplicates are dropped by operation id rather than by deep equality: an id is
 * generated once and travels with the operation, so seeing it twice means we
 * received the same operation twice, which is routine when a device re-reads a
 * file it already had.
 */
export function mergeLogs(...logs: readonly (readonly Operation[])[]): readonly Operation[] {
  const byId = new Map<string, Operation>()
  for (const log of logs) {
    for (const operation of log) {
      // First writer wins on duplicate ids. Equal ids are meant to be the same
      // operation; preferring either copy keeps the merge deterministic.
      if (!byId.has(operation.id)) byId.set(operation.id, operation)
    }
  }
  return sortOperations([...byId.values()])
}

/**
 * A Lamport clock: the next counter is one past everything already seen.
 *
 * Reading the maximum from the log rather than persisting a counter means a
 * device that loses its local state, or that pulls a log from far in the
 * future, still issues operations that order after what it has read.
 */
export function nextLamport(log: readonly Operation[]): number {
  let max = 0
  for (const operation of log) {
    if (operation.lamport > max) max = operation.lamport
  }
  return max + 1
}

/**
 * How long a run of edits stays one edit.
 *
 * Long enough that typing a sentence is one change, short enough that coming
 * back to a field after a pause is a second one — which is the distinction a
 * history is actually being asked about.
 */
export const COALESCE_WINDOW = 5_000

/**
 * Does this operation simply replace the one before it?
 *
 * Text fields emit on every keystroke, because the board must never show
 * something the log cannot reproduce. Left alone, that is one operation per
 * character: a history that reads `Title: Ship the boar → Ship the board`
 * twenty-four times over, a log that grows without bound, and a fold over the
 * whole log on every keypress. None of that is information — it is the same
 * edit, observed too often.
 *
 * An operation supersedes another when replaying without the earlier one gives
 * exactly the same project: same device, same target, and either a full replace
 * of one entity or a patch of precisely the same fields, where last-write-wins
 * already discards the earlier values. `item.move` is deliberately absent — a
 * card that visited three columns visited three columns, and that is history
 * rather than noise.
 */
export function supersedes(
  previous: Operation,
  next: Operation,
  window = COALESCE_WINDOW,
): boolean {
  if (previous.deviceId !== next.deviceId) return false
  if (previous.authorId !== next.authorId) return false
  if (previous.kind !== next.kind) return false
  if (next.at - previous.at > window || next.at < previous.at) return false

  switch (next.kind) {
    case 'item.set':
      return (
        previous.kind === 'item.set' &&
        previous.itemId === next.itemId &&
        sameKeys(previous.patch, next.patch)
      )
    case 'project.set':
      return previous.kind === 'project.set' && sameKeys(previous.patch, next.patch)
    case 'item.setField':
      return (
        previous.kind === 'item.setField' &&
        previous.itemId === next.itemId &&
        previous.fieldId === next.fieldId
      )
    // An upsert carries the whole entity, so a later one for the same id says
    // everything the earlier one said.
    case 'status.upsert':
      return previous.kind === 'status.upsert' && previous.status.id === next.status.id
    case 'field.upsert':
      return previous.kind === 'field.upsert' && previous.field.id === next.field.id
    case 'iteration.upsert':
      return previous.kind === 'iteration.upsert' && previous.iteration.id === next.iteration.id
    case 'milestone.upsert':
      return previous.kind === 'milestone.upsert' && previous.milestone.id === next.milestone.id
    case 'label.upsert':
      return previous.kind === 'label.upsert' && previous.label.id === next.label.id
    case 'member.upsert':
      return previous.kind === 'member.upsert' && previous.member.id === next.member.id
    default:
      return false
  }
}

function sameKeys(a: object, b: object): boolean {
  const left = Object.keys(a).toSorted()
  const right = Object.keys(b).toSorted()
  return left.length === right.length && left.every((key, at) => key === right[at])
}

export type LocalAppend = {
  readonly log: readonly Operation[]
  /**
   * The operation a further edit may still fold into, or null. Held by the
   * caller and handed back on the next append.
   */
  readonly supersedable: Operation | null
}

/**
 * Append operations this device just authored.
 *
 * Separate from `mergeLogs` on purpose, and it must stay separate. The merge is
 * the CRDT union — idempotent, commutative, associative — and dropping an
 * operation there would break all three at once, because whether it is dropped
 * would depend on what else happened to be in the same merge. Superseding is a
 * decision about *authoring*: it can only ever discard an operation this device
 * wrote a moment ago and has not yet shown anyone.
 *
 * That last part is what `supersedable` is for. It is cleared whenever the log
 * meets the outside world — a sync, an import — because an operation another
 * device may already hold cannot be taken back. Rewriting it there would not
 * lose data, since the copy would come home on the next pull, but the history
 * would grow back the noise this exists to remove.
 */
export function appendLocal(
  log: readonly Operation[],
  fresh: readonly Operation[],
  options: { readonly supersedable?: Operation | null; readonly window?: number } = {},
): LocalAppend {
  if (fresh.length === 0) return { log, supersedable: options.supersedable ?? null }

  const only = fresh.length === 1 ? fresh[0]! : null
  const previous = options.supersedable ?? null

  // A batch is one deliberate gesture — a drop that also closes a card, a seed.
  // Neither half of it folds into a keystroke on either side.
  if (!only) return { log: mergeLogs(log, fresh), supersedable: null }

  if (previous && supersedes(previous, only, options.window)) {
    const without = log.filter((operation) => operation.id !== previous.id)
    return { log: mergeLogs(without, [only]), supersedable: only }
  }

  return { log: mergeLogs(log, fresh), supersedable: only }
}

/** Operations belonging to one device, in order — the contents of its file. */
export function operationsOf(log: readonly Operation[], deviceId: string): readonly Operation[] {
  return sortOperations(log.filter((operation) => operation.deviceId === deviceId))
}

/** Every device that has ever written to this log. */
export function devicesIn(log: readonly Operation[]): readonly string[] {
  return [...new Set(log.map((operation) => operation.deviceId))].toSorted()
}

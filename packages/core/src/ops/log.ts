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
import type { Operation } from './types'

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

/** Operations belonging to one device, in order — the contents of its file. */
export function operationsOf(log: readonly Operation[], deviceId: string): readonly Operation[] {
  return sortOperations(log.filter((operation) => operation.deviceId === deviceId))
}

/** Every device that has ever written to this log. */
export function devicesIn(log: readonly Operation[]): readonly string[] {
  return [...new Set(log.map((operation) => operation.deviceId))].toSorted()
}

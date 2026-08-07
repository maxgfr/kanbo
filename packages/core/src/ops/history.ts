/**
 * The history, which was there all along.
 *
 * Kanbo stores changes rather than state, so an activity feed needs no
 * recording of its own — it is a reading of the log the board is already built
 * from. That is the difference between a history that can drift from reality
 * and one that cannot: this *is* the reality, described.
 *
 * Two consequences worth stating. Nothing here can show an event that did not
 * happen, because every entry is an operation someone's device actually
 * emitted. And nothing can hide one either: deleting an item removes it from
 * the board but not from the log, so the feed still says it was deleted, and
 * by whom.
 *
 * Entries carry values rather than sentences. Rendering is the UI's job, and a
 * domain that returned English would be a domain that could not be translated.
 */
import type { Item, Project } from '../model/types.ts'
import { sortOperations } from './log.ts'
import type { Operation } from './types.ts'

export type HistoryEntry = {
  readonly id: string
  readonly at: number
  readonly deviceId: string
  readonly authorId: string | null
  /** The item this concerns, when it concerns one. */
  readonly itemId: string | null
  readonly change: HistoryChange
}

export type HistoryChange =
  | { readonly kind: 'created' }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'moved'; readonly fromStatusId: string | null; readonly toStatusId: string }
  | { readonly kind: 'reordered' }
  | {
      readonly kind: 'field'
      readonly field: string
      readonly from: unknown
      readonly to: unknown
    }
  | { readonly kind: 'linked'; readonly targetId: string; readonly linkType: string }
  | { readonly kind: 'unlinked'; readonly targetId: string; readonly linkType: string }
  | { readonly kind: 'commented' }
  | { readonly kind: 'project'; readonly field: string }
  | { readonly kind: 'other'; readonly operation: string }

/**
 * Replay the log, reporting what each operation changed.
 *
 * The previous value comes from folding forward as we go, which is the only
 * way to know it: an operation records what a field became, never what it was.
 * That is right for a merge — a patch that carried the old value would be a
 * patch that could refuse to apply — but it means a readable history has to be
 * derived rather than read off.
 */
export function history(log: readonly Operation[]): readonly HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const items = new Map<string, Record<string, unknown>>()

  for (const operation of sortOperations(log)) {
    const base = {
      id: operation.id,
      at: operation.at,
      deviceId: operation.deviceId,
      authorId: operation.authorId,
    }

    switch (operation.kind) {
      case 'item.create': {
        items.set(operation.item.id, { ...operation.item })
        entries.push({ ...base, itemId: operation.item.id, change: { kind: 'created' } })
        break
      }

      case 'item.delete': {
        items.delete(operation.itemId)
        entries.push({ ...base, itemId: operation.itemId, change: { kind: 'deleted' } })
        break
      }

      case 'item.set': {
        const before = items.get(operation.itemId)
        // An edit to something already deleted is ordinary concurrency, and
        // reporting it as a change to a nonexistent item would be noise.
        if (!before) break
        for (const [field, to] of Object.entries(operation.patch)) {
          const from = before[field]
          // A patch may repeat a value it did not change; a feed full of
          // "title: X → X" is a feed nobody reads.
          if (same(from, to)) continue
          before[field] = to
          entries.push({
            ...base,
            itemId: operation.itemId,
            change: { kind: 'field', field, from, to },
          })
        }
        break
      }

      case 'item.move': {
        const before = items.get(operation.itemId)
        if (!before) break
        const fromStatusId = typeof before['statusId'] === 'string' ? before['statusId'] : null
        before['statusId'] = operation.statusId
        before['order'] = operation.order
        entries.push({
          ...base,
          itemId: operation.itemId,
          // Moving within a column is a reorder, not a status change, and
          // conflating them makes a busy board's history unreadable.
          change:
            fromStatusId === operation.statusId
              ? { kind: 'reordered' }
              : { kind: 'moved', fromStatusId, toStatusId: operation.statusId },
        })
        break
      }

      case 'item.setField': {
        const before = items.get(operation.itemId)
        if (!before) break
        const fields = (before['fields'] ?? {}) as Record<string, unknown>
        const from = fields[operation.fieldId]
        if (same(from, operation.value)) break
        before['fields'] = { ...fields, [operation.fieldId]: operation.value }
        entries.push({
          ...base,
          itemId: operation.itemId,
          change: { kind: 'field', field: operation.fieldId, from, to: operation.value },
        })
        break
      }

      case 'item.link':
        entries.push({
          ...base,
          itemId: operation.itemId,
          change: {
            kind: 'linked',
            targetId: operation.link.itemId,
            linkType: operation.link.type,
          },
        })
        break

      case 'item.unlink':
        entries.push({
          ...base,
          itemId: operation.itemId,
          change: { kind: 'unlinked', targetId: operation.targetId, linkType: operation.linkType },
        })
        break

      case 'comment.upsert':
        entries.push({ ...base, itemId: operation.comment.itemId, change: { kind: 'commented' } })
        break

      case 'project.set':
        for (const field of Object.keys(operation.patch)) {
          entries.push({ ...base, itemId: null, change: { kind: 'project', field } })
        }
        break

      default:
        entries.push({
          ...base,
          itemId: null,
          change: { kind: 'other', operation: operation.kind },
        })
        break
    }
  }

  // Newest first: a feed is read from the top.
  return entries.toReversed()
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, at) => value === b[at])
  }
  return false
}

/** One item's history, which is what an item panel shows. */
export function historyOf(log: readonly Operation[], itemId: string): readonly HistoryEntry[] {
  return history(log).filter((entry) => entry.itemId === itemId)
}

/**
 * The board's own activity, with the noise removed.
 *
 * Reordering is excluded: dragging a card up one place is a real operation and
 * belongs in the log, but a feed showing forty of them buries the changes
 * somebody actually wants to see.
 */
export function activity(log: readonly Operation[], limit = 200): readonly HistoryEntry[] {
  return history(log)
    .filter((entry) => entry.change.kind !== 'reordered')
    .slice(0, limit)
}

/** Which items an item's history refers to, so names can be resolved once. */
export function referencedItems(
  project: Project,
  entries: readonly HistoryEntry[],
): ReadonlyMap<string, Item> {
  const wanted = new Set<string>()
  for (const entry of entries) {
    if (entry.itemId) wanted.add(entry.itemId)
    if (entry.change.kind === 'linked' || entry.change.kind === 'unlinked') {
      wanted.add(entry.change.targetId)
    }
  }
  return new Map(project.items.filter((item) => wanted.has(item.id)).map((item) => [item.id, item]))
}

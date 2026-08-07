/**
 * Folding a log into a project.
 *
 * Pure and total: the same operations in the same order always produce the same
 * project, and an operation that makes no sense against the current state is
 * skipped rather than throwing. That second property matters more than it
 * looks — an edit to an item another device has deleted is not corruption, it
 * is ordinary concurrency, and a reducer that threw would make one device
 * unable to read a log the others read fine.
 *
 * Last-write-wins per field needs no bookkeeping here: an `item.set` patches
 * only the keys it carries, so folding in order leaves each field holding the
 * value written by the last operation that named it.
 */
import { EMPTY_PROJECT } from '../model/project'
import type { Item, Project } from '../model/types'
import { sortOperations } from './log'
import type { Operation } from './types'

/** Replace an entity in a list by id, or append it when it is new. */
function upsert<T extends { readonly id: string }>(list: readonly T[], entity: T): readonly T[] {
  const at = list.findIndex((existing) => existing.id === entity.id)
  if (at === -1) return [...list, entity]
  return list.map((existing, index) => (index === at ? entity : existing))
}

function remove<T extends { readonly id: string }>(list: readonly T[], id: string): readonly T[] {
  return list.filter((entity) => entity.id !== id)
}

function patchItem(
  project: Project,
  itemId: string,
  at: number,
  change: (item: Item) => Item,
): Project {
  const existing = project.items.find((item) => item.id === itemId)
  // Editing something already deleted is normal concurrency, not an error.
  if (!existing) return project
  const updated = change(existing)
  return {
    ...project,
    items: project.items.map((item) =>
      item.id === itemId ? { ...updated, updatedAt: Math.max(at, item.updatedAt) } : item,
    ),
  }
}

/**
 * Move an item, and derive the timestamps the metrics are computed from.
 *
 * `startedAt` and `completedAt` are never typed by anyone — they are what the
 * board *did*, read off the category of the status the item landed in. Pulling
 * a card back to the backlog clears both, because work that was un-started did
 * not have a cycle; reopening a done card clears only the completion, because
 * the work did start.
 */
function applyMove(project: Project, operation: Operation & { kind: 'item.move' }): Project {
  const status = project.statuses.find((candidate) => candidate.id === operation.statusId)
  // A move into a status this device has not heard of yet would put the item
  // somewhere unrenderable; skipping leaves it where it was until the status
  // operation arrives.
  if (!status) return project

  return patchItem(project, operation.itemId, operation.at, (item) => {
    let startedAt = item.startedAt
    let completedAt = item.completedAt

    if (status.category === 'todo') {
      startedAt = null
      completedAt = null
    } else if (status.category === 'in-progress') {
      startedAt ??= operation.at
      completedAt = null
    } else {
      startedAt ??= operation.at
      completedAt ??= operation.at
    }

    return { ...item, statusId: operation.statusId, order: operation.order, startedAt, completedAt }
  })
}

function applyOne(project: Project, operation: Operation): Project {
  switch (operation.kind) {
    case 'project.set':
      return { ...project, ...operation.patch }

    case 'item.create': {
      // Replaying a create we already folded must not duplicate the item.
      if (project.items.some((item) => item.id === operation.item.id)) return project
      return {
        ...project,
        items: [...project.items, operation.item],
        nextRef: Math.max(project.nextRef, refNumber(operation.item.ref) + 1),
      }
    }

    case 'item.set':
      return patchItem(project, operation.itemId, operation.at, (item) => ({
        ...item,
        ...operation.patch,
      }))

    case 'item.move':
      return applyMove(project, operation)

    case 'item.setField':
      return patchItem(project, operation.itemId, operation.at, (item) => ({
        ...item,
        fields: { ...item.fields, [operation.fieldId]: operation.value },
      }))

    case 'item.link':
      return patchItem(project, operation.itemId, operation.at, (item) =>
        item.links.some(
          (link) => link.itemId === operation.link.itemId && link.type === operation.link.type,
        )
          ? item
          : { ...item, links: [...item.links, operation.link] },
      )

    case 'item.unlink':
      return patchItem(project, operation.itemId, operation.at, (item) => ({
        ...item,
        links: item.links.filter(
          (link) => !(link.itemId === operation.targetId && link.type === operation.linkType),
        ),
      }))

    case 'item.delete':
      return {
        ...project,
        items: remove(project.items, operation.itemId),
        // Comments outlive nothing: an item's thread goes with it.
        comments: project.comments.filter((comment) => comment.itemId !== operation.itemId),
      }

    case 'status.upsert':
      return { ...project, statuses: upsert(project.statuses, operation.status) }

    case 'status.delete': {
      if (!project.statuses.some((status) => status.id === operation.moveToId)) return project
      return {
        ...project,
        statuses: remove(project.statuses, operation.statusId),
        // Items are never orphaned by deleting a column; they move.
        items: project.items.map((item) =>
          item.statusId === operation.statusId ? { ...item, statusId: operation.moveToId } : item,
        ),
      }
    }

    case 'field.upsert':
      return { ...project, fields: upsert(project.fields, operation.field) }

    case 'field.delete':
      return {
        ...project,
        fields: remove(project.fields, operation.fieldId),
        items: project.items.map((item) => {
          if (!(operation.fieldId in item.fields)) return item
          const { [operation.fieldId]: _dropped, ...rest } = item.fields
          return { ...item, fields: rest }
        }),
      }

    case 'iteration.upsert':
      return { ...project, iterations: upsert(project.iterations, operation.iteration) }

    case 'iteration.delete':
      return {
        ...project,
        iterations: remove(project.iterations, operation.iterationId),
        items: project.items.map((item) =>
          item.iterationId === operation.iterationId ? { ...item, iterationId: null } : item,
        ),
      }

    case 'milestone.upsert':
      return { ...project, milestones: upsert(project.milestones, operation.milestone) }

    case 'milestone.delete':
      return {
        ...project,
        milestones: remove(project.milestones, operation.milestoneId),
        items: project.items.map((item) =>
          item.milestoneId === operation.milestoneId ? { ...item, milestoneId: null } : item,
        ),
      }

    case 'label.upsert':
      return { ...project, labels: upsert(project.labels, operation.label) }

    case 'label.delete':
      return {
        ...project,
        labels: remove(project.labels, operation.labelId),
        items: project.items.map((item) =>
          item.labels.includes(operation.labelId)
            ? { ...item, labels: item.labels.filter((id) => id !== operation.labelId) }
            : item,
        ),
      }

    case 'member.upsert':
      return { ...project, members: upsert(project.members, operation.member) }

    case 'member.delete':
      return {
        ...project,
        members: remove(project.members, operation.memberId),
        items: project.items.map((item) =>
          item.assignees.includes(operation.memberId)
            ? { ...item, assignees: item.assignees.filter((id) => id !== operation.memberId) }
            : item,
        ),
      }

    case 'view.upsert':
      return { ...project, views: upsert(project.views, operation.view) }

    case 'view.delete':
      return { ...project, views: remove(project.views, operation.viewId) }

    case 'comment.upsert':
      return { ...project, comments: upsert(project.comments, operation.comment) }

    case 'comment.delete':
      return { ...project, comments: remove(project.comments, operation.commentId) }
  }
}

/** The numeric part of a reference like `KAN-42`, or 0 when it has none. */
function refNumber(ref: string): number {
  const parsed = Number.parseInt(ref.slice(ref.lastIndexOf('-') + 1), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Fold a log into a project.
 *
 * `base` lets a compacted snapshot stand in for the operations it replaced, so
 * a long-lived project does not have to replay its entire history to render a
 * board.
 */
export function reduceOperations(
  operations: readonly Operation[],
  base: Project = EMPTY_PROJECT,
): Project {
  let project = base
  for (const operation of sortOperations(operations)) {
    project = applyOne(project, operation)
  }
  return project
}

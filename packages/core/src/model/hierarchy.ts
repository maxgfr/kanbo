/**
 * Items that contain other items.
 *
 * `parentId` has always been on an item; this is the reading of it. Everything
 * here tolerates a broken graph rather than assuming a well-formed one — two
 * devices editing offline can each make a sane change that together form a
 * cycle, and a merge has no way to refuse. The alternative to tolerating that
 * is a board that will not render, which is worse than one that draws a strange
 * hierarchy.
 *
 * "Done" is `completedAt`, never a column name, so a rollup means the same
 * thing here as it does in the changelog and on a milestone.
 */
import { byOrder } from '../order/fractional.ts'
import type { Item, Project } from './types.ts'

/**
 * How deep a hierarchy is allowed to go, counting the root as level one.
 *
 * Three is a limit on nesting rather than on ambition: past it, "how much of
 * this is done" stops having one obvious answer, and a board stops being
 * readable at a glance — which is the only thing a board is for.
 */
export const MAX_DEPTH = 3

/** The children of an item, in board order, ignoring archived work. */
export function childrenOf(project: Project, itemId: string): readonly Item[] {
  return project.items
    .filter((item) => item.parentId === itemId && !item.archived)
    .toSorted(byOrder)
}

/**
 * The chain from an item's parent up to its root, nearest first.
 *
 * Stops on a repeat rather than looping: a cycle that arrived through a merge
 * must not hang the render.
 */
export function ancestorsOf(project: Project, itemId: string): readonly Item[] {
  const found: Item[] = []
  const seen = new Set<string>([itemId])

  let current = project.items.find((item) => item.id === itemId)?.parentId ?? null
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const parent = project.items.find((item) => item.id === current)
    if (!parent) break
    found.push(parent)
    current = parent.parentId
  }

  return found
}

/** Every descendant of an item, at any depth, cycle-safe. */
export function descendantsOf(project: Project, itemId: string): readonly Item[] {
  const found: Item[] = []
  const seen = new Set<string>([itemId])
  const stack = [itemId]

  while (stack.length > 0) {
    for (const child of childrenOf(project, stack.pop()!)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      found.push(child)
      stack.push(child.id)
    }
  }

  return found
}

/** Unestimated work counts as zero rather than being guessed at. */
function sum(items: readonly Item[]): number {
  return items.reduce((total, item) => total + (item.estimate ?? 0), 0)
}

export type SubtreeProgress = {
  readonly total: number
  readonly done: number
  readonly points: number
  readonly donePoints: number
}

/**
 * How much of the work under an item is finished.
 *
 * Deliberately the same shape as `milestoneProgress`, so one component can draw
 * either: a release and an epic are the same question asked of a different
 * grouping, and answering them in two shapes would produce two bars that agree
 * about nothing.
 *
 * Counts direct children only. A rollup that summed the whole subtree would
 * report an epic as half done because its stories were, while its own tasks
 * had not been touched — the number would be true of nothing anyone asked.
 */
export function subtreeProgress(project: Project, itemId: string): SubtreeProgress {
  const children = childrenOf(project, itemId)
  const finished = children.filter((child) => child.completedAt !== null)

  return {
    total: children.length,
    done: finished.length,
    points: sum(children),
    donePoints: sum(finished),
  }
}

/**
 * Would making `parentId` the parent of `itemId` break the hierarchy?
 *
 * Answered before the operation is emitted, like `wouldCycle` and for the same
 * reason: once it is in the log every device inherits it. Refuses a cycle, an
 * item adopting itself, and anything that would nest deeper than `MAX_DEPTH`.
 */
export function wouldNestCycle(project: Project, itemId: string, parentId: string): boolean {
  if (itemId === parentId) return true

  // The proposed parent must not already be somewhere below the item.
  if (descendantsOf(project, itemId).some((item) => item.id === parentId)) return true

  const above = ancestorsOf(project, parentId).length + 2 // the parent, and the item under it
  const below = depthBelow(project, itemId)
  return above + below - 1 > MAX_DEPTH
}

/**
 * How many levels the item's own subtree already occupies, itself included.
 *
 * Breadth-first with a visited set rather than plain recursion: a cycle that
 * arrived through a merge would otherwise recurse until the stack gave out, and
 * this runs on every render of a parent picker.
 */
function depthBelow(project: Project, itemId: string): number {
  const seen = new Set([itemId])
  let level = [itemId]
  let depth = 1

  while (level.length > 0) {
    const next: string[] = []
    for (const id of level) {
      for (const child of childrenOf(project, id)) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        next.push(child.id)
      }
    }
    if (next.length > 0) depth++
    level = next
  }

  return depth
}

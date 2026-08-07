/**
 * A changelog written from what actually shipped.
 *
 * The board already knows which items completed and when, so a release note is
 * a query rather than a document someone has to remember to write. Grouping is
 * by item type because that is the distinction a reader cares about — what was
 * added, what was fixed — rather than by whatever labels a team happened to use.
 */
import type { Item, Milestone, Project } from '../model/types'
import { isoDay } from './flow'

const GROUPS: readonly { readonly heading: string; readonly types: readonly Item['type'][] }[] = [
  { heading: 'Features', types: ['epic', 'story'] },
  { heading: 'Fixes', types: ['bug'] },
  { heading: 'Other', types: ['task', 'chore', 'spike'] },
]

export type ChangelogOptions = {
  readonly from?: number
  readonly to?: number
  readonly milestoneId?: string
  readonly iterationId?: string
}

/** Items completed within the window, in the order they finished. */
export function shipped(project: Project, options: ChangelogOptions = {}): readonly Item[] {
  return project.items
    .filter((item) => {
      if (item.completedAt === null || item.archived) return false
      if (options.from !== undefined && item.completedAt < options.from) return false
      if (options.to !== undefined && item.completedAt > options.to) return false
      if (options.milestoneId !== undefined && item.milestoneId !== options.milestoneId)
        return false
      if (options.iterationId !== undefined && item.iterationId !== options.iterationId)
        return false
      return true
    })
    .toSorted((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
}

/**
 * Render Markdown.
 *
 * Returns an empty string when nothing shipped, rather than a heading over a
 * blank section: a release note claiming a release that did not happen is
 * worse than no note.
 */
export function changelogMarkdown(
  project: Project,
  title: string,
  options: ChangelogOptions = {},
): string {
  const items = shipped(project, options)
  if (items.length === 0) return ''

  const lines: string[] = [`## ${title}`, '']

  for (const group of GROUPS) {
    const inGroup = items.filter((item) => group.types.includes(item.type))
    if (inGroup.length === 0) continue

    lines.push(`### ${group.heading}`, '')
    for (const item of inGroup) {
      lines.push(`- ${item.title} (${item.ref})`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

/** Progress towards a milestone, counted rather than estimated. */
export function milestoneProgress(
  project: Project,
  milestone: Milestone,
): {
  readonly total: number
  readonly done: number
  readonly points: number
  readonly donePoints: number
} {
  const items = project.items.filter((item) => item.milestoneId === milestone.id && !item.archived)
  const done = items.filter((item) => item.completedAt !== null)
  return {
    total: items.length,
    done: done.length,
    points: items.reduce((sum, item) => sum + (item.estimate ?? 0), 0),
    donePoints: done.reduce((sum, item) => sum + (item.estimate ?? 0), 0),
  }
}

/** A default release title, so nobody has to invent one to get a note. */
export function suggestedTitle(now: number): string {
  return `Release ${isoDay(now)}`
}

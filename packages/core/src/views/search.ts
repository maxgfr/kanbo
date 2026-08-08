/**
 * The query language.
 *
 * `status:in-progress assignee:@me sprint:current is:blocked` — the shape
 * developers already type into a forge, because a query language nobody has to
 * learn is the only kind that gets used.
 *
 * Bare words are a title and description search, so someone who does not know
 * the syntax still gets what they expect. An unrecognised qualifier is treated
 * as free text rather than silently matching nothing: a typo should narrow the
 * results visibly, not empty them mysteriously.
 */
import type { Item, Project } from '../model/types.ts'
import { isBlocked } from '../model/project.ts'
import { currentIteration, isoDay } from '../metrics/flow.ts'

export type Token =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'qualifier'
      readonly key: string
      readonly value: string
      readonly negated: boolean
    }

const QUALIFIER = /^(-?)([a-z]+):(.*)$/i

/** Split on spaces, but keep a quoted phrase together. */
export function tokenise(query: string): readonly Token[] {
  const parts = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  return parts.map((part) => {
    const match = QUALIFIER.exec(part)
    if (match && match[3] !== undefined) {
      return {
        kind: 'qualifier',
        key: match[2]!.toLowerCase(),
        value: match[3].replaceAll('"', ''),
        negated: match[1] === '-',
      }
    }
    return { kind: 'text', value: part.replaceAll('"', '') }
  })
}

export type SearchContext = {
  readonly project: Project
  readonly now: number
  /** Which member `@me` refers to; null when nobody has claimed a seat. */
  readonly meId: string | null
}

const KNOWN = new Set([
  'status',
  'type',
  'priority',
  'assignee',
  'label',
  'sprint',
  'iteration',
  'milestone',
  'parent',
  'is',
  'has',
  'points',
  'due',
  'ref',
])

function matchesQualifier(
  item: Item,
  token: Extract<Token, { kind: 'qualifier' }>,
  context: SearchContext,
): boolean {
  const { project, now, meId } = context
  const value = token.value.toLowerCase()

  switch (token.key) {
    case 'status': {
      // Asked of the item's own column rather than by hunting the project for a
      // column the word might mean. Searching first and comparing second was
      // the bug: `status:in-progress` found one matching column and stopped, so
      // a team running In Progress, In Review and Blocked saw a third of its
      // work in progress. Worse, the word is genuinely ambiguous — "in-progress"
      // is both a category and the slug of a column most boards have — and
      // there is no reading of it under which the other columns should vanish.
      const status = project.statuses.find((candidate) => candidate.id === item.statusId)
      if (!status) return false

      return (
        status.id === token.value ||
        status.name.toLowerCase().replaceAll(' ', '-') === value ||
        status.category === value
      )
    }
    case 'type':
      return item.type === value
    case 'priority':
      return item.priority === value
    case 'assignee':
      return value === '@me'
        ? meId !== null && item.assignees.includes(meId)
        : item.assignees.some(
            (id) =>
              id === token.value ||
              project.members.find((member) => member.id === id)?.name.toLowerCase() === value,
          )
    case 'label':
      return item.labels.some(
        (id) =>
          id === token.value ||
          project.labels.find((label) => label.id === id)?.name.toLowerCase() === value,
      )
    case 'sprint':
    case 'iteration': {
      if (value === 'none') return item.iterationId === null
      if (value === 'current') {
        const current = currentIteration(project, now)
        return current !== null && item.iterationId === current.id
      }
      const named = project.iterations.find(
        (it) => it.id === token.value || it.name.toLowerCase() === value,
      )
      return named !== undefined && item.iterationId === named.id
    }
    case 'milestone': {
      if (value === 'none') return item.milestoneId === null
      const named = project.milestones.find(
        (m) => m.id === token.value || m.name.toLowerCase() === value,
      )
      return named !== undefined && item.milestoneId === named.id
    }
    case 'parent': {
      // Answers the question `has:parent` could only ask in general: which
      // items sit under this one. A reference is what a person has in front of
      // them, so it is matched first, then an id, then the title.
      if (value === 'none') return item.parentId === null
      if (item.parentId === null) return false
      const named = project.items.find(
        (candidate) =>
          candidate.id === token.value ||
          candidate.ref.toLowerCase() === value ||
          candidate.title.toLowerCase() === value,
      )
      return named !== undefined && item.parentId === named.id
    }
    case 'is':
      switch (value) {
        case 'blocked':
          return isBlocked(project, item)
        case 'open':
          return item.completedAt === null
        case 'closed':
        case 'done':
          return item.completedAt !== null
        case 'started':
          return item.startedAt !== null && item.completedAt === null
        case 'overdue':
          return item.dueOn !== null && item.completedAt === null && item.dueOn < isoDay(now)
        case 'archived':
          return item.archived
        default:
          return false
      }
    case 'has':
      switch (value) {
        case 'estimate':
          return item.estimate !== null
        case 'assignee':
          return item.assignees.length > 0
        case 'due':
          return item.dueOn !== null
        case 'parent':
          return item.parentId !== null
        default:
          return false
      }
    case 'points': {
      const comparison = /^([<>]=?)?(\d+)$/.exec(value)
      if (!comparison || item.estimate === null) return false
      const target = Number(comparison[2])
      switch (comparison[1]) {
        case '>':
          return item.estimate > target
        case '>=':
          return item.estimate >= target
        case '<':
          return item.estimate < target
        case '<=':
          return item.estimate <= target
        default:
          return item.estimate === target
      }
    }
    case 'due': {
      if (item.dueOn === null) return false
      if (value === 'today') return item.dueOn === isoDay(now)
      if (value.startsWith('<')) return item.dueOn < value.slice(1)
      if (value.startsWith('>')) return item.dueOn > value.slice(1)
      return item.dueOn === value
    }
    case 'ref':
      return item.ref.toLowerCase() === value
    default:
      return false
  }
}

function matchesText(item: Item, text: string): boolean {
  const needle = text.toLowerCase()
  return (
    item.title.toLowerCase().includes(needle) ||
    item.description.toLowerCase().includes(needle) ||
    item.ref.toLowerCase().includes(needle)
  )
}

/** Every token must hold: qualifiers narrow, they never widen. */
export function matchesQuery(
  item: Item,
  tokens: readonly Token[],
  context: SearchContext,
): boolean {
  return tokens.every((token) => {
    if (token.kind === 'text') return matchesText(item, token.value)

    // An unknown qualifier is a typo, and a typo should visibly narrow the
    // results rather than silently emptying them.
    if (!KNOWN.has(token.key)) return matchesText(item, `${token.key}:${token.value}`)

    const hit = matchesQualifier(item, token, context)
    return token.negated ? !hit : hit
  })
}

export function search(query: string, context: SearchContext): readonly Item[] {
  const tokens = tokenise(query.trim())
  if (tokens.length === 0) return []
  return context.project.items.filter((item) => matchesQuery(item, tokens, context))
}

/** The qualifiers a completion menu should offer. */
export const QUALIFIERS: readonly { readonly key: string; readonly hint: string }[] = [
  { key: 'status', hint: 'a column name, or todo / in-progress / done' },
  { key: 'type', hint: 'epic, story, task, bug, spike, chore' },
  { key: 'priority', hint: 'p0 to p4' },
  { key: 'assignee', hint: 'a name, or @me' },
  { key: 'label', hint: 'a label name' },
  { key: 'sprint', hint: 'a sprint name, current, or none' },
  { key: 'milestone', hint: 'a milestone name, or none' },
  { key: 'parent', hint: 'a reference like KAN-4, or none' },
  { key: 'is', hint: 'blocked, open, closed, started, overdue, archived' },
  { key: 'has', hint: 'estimate, assignee, due, parent' },
  { key: 'points', hint: 'a number, or >3 / <=8' },
  { key: 'due', hint: 'today, a date, or <2026-09-01' },
]

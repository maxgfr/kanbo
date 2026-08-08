import {
  type Field,
  type Item,
  type Iteration,
  type Label,
  type Member,
  type Milestone,
  type Project,
  type Status,
  currentIteration,
} from '@kanbo/core'

/**
 * Turning what somebody typed into something the domain recognises.
 *
 * Every one of these used to be an inline `project.items.find(...)` in the
 * middle of a command, which meant two things quietly: the first match won, and
 * a second column called "Done" was unreachable forever. A person typing a name
 * has told you what they meant unless the project contains two of them — in
 * which case the honest answer is to say which two, not to pick.
 *
 * They throw rather than returning a result type, because there are two
 * front-ends and both want the same thing at the same place: the CLI prints the
 * message and exits 1, the MCP server returns it as a tool error. Threading a
 * result through thirty actions would buy neither of them anything.
 */
export class KanboError extends Error {
  /** What else it could have meant, when that is the useful half of the answer. */
  readonly candidates: readonly string[]

  constructor(message: string, candidates: readonly string[] = []) {
    super(message)
    this.name = 'KanboError'
    this.candidates = candidates
  }
}

function fold(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * One match, or an error that names the alternatives.
 *
 * `id` beats a name every time: an id is unambiguous by construction, and the
 * JSON front-ends pass ids.
 */
function one<T extends { readonly id: string }>(
  candidates: readonly T[],
  wanted: string,
  nameOf: (value: T) => string,
  noun: string,
  all: readonly T[],
): T {
  const exactId = candidates.find((candidate) => candidate.id === wanted)
  if (exactId) return exactId

  const matches = candidates.filter((candidate) => fold(nameOf(candidate)) === fold(wanted))
  if (matches.length === 1) return matches[0]!

  if (matches.length > 1) {
    throw new KanboError(
      `More than one ${noun} is called "${wanted}". Say which by id.`,
      matches.map((match) => `${match.id}  ${nameOf(match)}`),
    )
  }

  throw new KanboError(
    all.length === 0 ? `This project has no ${noun} yet.` : `No ${noun} called "${wanted}".`,
    all.map(nameOf),
  )
}

/** A card, by its reference (`APL-12`) or its id. Case does not matter. */
export function resolveItem(project: Project, wanted: string): Item {
  const target = wanted.trim()
  const byRef = project.items.find((item) => fold(item.ref) === fold(target))
  if (byRef) return byRef

  const byId = project.items.find((item) => item.id === target)
  if (byId) return byId

  throw new KanboError(
    `No item called "${target}".`,
    // The whole board would be noise. The reference format is the useful hint.
    project.items.length === 0 ? [] : [`References look like ${project.items[0]!.ref}.`],
  )
}

export function resolveStatus(project: Project, wanted: string): Status {
  return one(project.statuses, wanted, (status) => status.name, 'column', project.statuses)
}

/** A person, by name or by the handle their forge spells them with. */
export function resolveMember(project: Project, wanted: string): Member {
  const target = wanted.trim().replace(/^@/, '')
  const byHandle = project.members.filter((member) => fold(member.handle ?? '') === fold(target))
  if (byHandle.length === 1) return byHandle[0]!

  return one(project.members, target, (member) => member.name, 'person', project.members)
}

/**
 * A sprint, by name, or `current` for the one today falls inside.
 *
 * `current` is the same rule the query language and the board run, because it
 * is the same function.
 */
export function resolveSprint(project: Project, wanted: string, now: number): Iteration {
  if (fold(wanted) === 'current') {
    const running = currentIteration(project, now)
    if (running) return running
    throw new KanboError(
      'No sprint is running today.',
      project.iterations.map((it) => `${it.name}  ${it.startsAt} → ${it.endsAt}`),
    )
  }
  return one(project.iterations, wanted, (it) => it.name, 'sprint', project.iterations)
}

export function resolveMilestone(project: Project, wanted: string): Milestone {
  return one(project.milestones, wanted, (m) => m.name, 'release', project.milestones)
}

export function resolveLabel(project: Project, wanted: string): Label {
  return one(project.labels, wanted, (label) => label.name, 'label', project.labels)
}

export function resolveField(project: Project, wanted: string): Field {
  return one(project.fields, wanted, (field) => field.name, 'field', project.fields)
}

import {
  type Comment,
  type Field,
  type FieldType,
  type FieldValue,
  type Item,
  type Iteration,
  type Label,
  type LinkType,
  type Member,
  type Milestone,
  type OperationBody,
  type Status,
  type StatusCategory,
  byOrder,
  keyBetween,
  linkClosesCycle,
  mirrorLink,
  orderForStatusReorder,
} from '@kanbo/core'

import { parseDate, parsePatch, type PatchSpec } from './patch.ts'
import {
  KanboError,
  resolveField,
  resolveItem,
  resolveLabel,
  resolveMember,
  resolveMilestone,
  resolveSprint,
  resolveStatus,
} from './resolve.ts'
import type { Workspace } from './session.ts'
import type { Outcome } from './write.ts'

/**
 * The rest of what a project can undergo.
 *
 * Everything the board, the sprint view, the roadmap, the settings panel and
 * the item panel can do — which until now the terminal could not, not because
 * the domain was missing anything but because nobody had wired it up. Each of
 * these is two or three lines around an operation that already existed.
 */

const LINK_TYPES: readonly LinkType[] = ['blocks', 'blocked-by', 'relates-to', 'duplicates']
const FIELD_TYPES: readonly FieldType[] = [
  'text',
  'number',
  'select',
  'multi-select',
  'date',
  'checkbox',
  'url',
  'person',
  'iteration',
]

/** The next order key at the end of a list, whatever the list is. */
function appended(entries: readonly { readonly id: string; readonly order: string }[]): string {
  return keyBetween(entries.toSorted(byOrder).at(-1)?.order ?? null, null)
}

// ---------------------------------------------------------------- items

export async function itemUpdate(
  workspace: Workspace,
  ref: string,
  spec: PatchSpec,
  now: number,
): Promise<Outcome<{ item: Item; changed: readonly string[] }>> {
  const item = resolveItem(workspace.project, ref)
  const { patch, invented } = parsePatch(workspace, spec, now, item.id)

  const changed = Object.keys(patch)
  if (changed.length === 0) throw new KanboError('Nothing to change.')

  const after = await workspace.commit(...invented, {
    kind: 'item.set',
    itemId: item.id,
    patch,
  })
  return { workspace: after, result: { item, changed } }
}

export async function itemDelete(
  workspace: Workspace,
  ref: string,
): Promise<Outcome<{ item: Item; children: number }>> {
  const item = resolveItem(workspace.project, ref)
  const children = workspace.project.items.filter((child) => child.parentId === item.id).length

  const after = await workspace.commit({ kind: 'item.delete', itemId: item.id })
  return { workspace: after, result: { item, children } }
}

/**
 * Link two items, refusing to close a loop.
 *
 * `blocks` and `blocked-by` are the two halves of one fact, so a link is stored
 * from both ends — otherwise the roadmap could draw an arrow the board did not
 * know about.
 */
export async function itemLink(
  workspace: Workspace,
  ref: string,
  type: string,
  targetRef: string,
): Promise<Outcome<{ item: Item; target: Item; type: LinkType }>> {
  const linkType = LINK_TYPES.find((candidate) => candidate === type.trim().toLowerCase())
  if (!linkType) throw new KanboError(`"${type}" is not a kind of link.`, [...LINK_TYPES])

  const item = resolveItem(workspace.project, ref)
  const target = resolveItem(workspace.project, targetRef)
  if (item.id === target.id) throw new KanboError('An item cannot link to itself.')

  if (linkClosesCycle(workspace.project, item.id, target.id, linkType)) {
    throw new KanboError(
      `${target.ref} is already on the other side of this chain. Linking these would make it circular.`,
    )
  }

  const after = await workspace.commit(
    { kind: 'item.link', itemId: item.id, link: { type: linkType, itemId: target.id } },
    {
      kind: 'item.link',
      itemId: target.id,
      link: { type: mirrorLink(linkType), itemId: item.id },
    },
  )
  return { workspace: after, result: { item, target, type: linkType } }
}

export async function itemUnlink(
  workspace: Workspace,
  ref: string,
  type: string,
  targetRef: string,
): Promise<Outcome<{ item: Item; target: Item }>> {
  const linkType = LINK_TYPES.find((candidate) => candidate === type.trim().toLowerCase())
  if (!linkType) throw new KanboError(`"${type}" is not a kind of link.`, [...LINK_TYPES])

  const item = resolveItem(workspace.project, ref)
  const target = resolveItem(workspace.project, targetRef)

  const after = await workspace.commit(
    { kind: 'item.unlink', itemId: item.id, targetId: target.id, linkType },
    {
      kind: 'item.unlink',
      itemId: target.id,
      targetId: item.id,
      linkType: mirrorLink(linkType),
    },
  )
  return { workspace: after, result: { item, target } }
}

/** Add or remove one label without disturbing the others. */
export async function itemLabel(
  workspace: Workspace,
  ref: string,
  action: 'add' | 'rm',
  name: string,
): Promise<Outcome<{ item: Item; label: Label }>> {
  const item = resolveItem(workspace.project, ref)

  if (action === 'rm') {
    const label = resolveLabel(workspace.project, name)
    const after = await workspace.commit({
      kind: 'item.set',
      itemId: item.id,
      patch: { labels: item.labels.filter((id) => id !== label.id) },
    })
    return { workspace: after, result: { item, label } }
  }

  const { patch, invented } = parsePatch(workspace, { labels: [...item.labels, name] }, 0, item.id)
  const after = await workspace.commit(...invented, {
    kind: 'item.set',
    itemId: item.id,
    patch,
  })
  const label = resolveLabel(after.project, name)
  return { workspace: after, result: { item, label } }
}

export async function itemField(
  workspace: Workspace,
  ref: string,
  fieldName: string,
  raw: string | null,
): Promise<Outcome<{ item: Item; field: Field; value: FieldValue }>> {
  const item = resolveItem(workspace.project, ref)
  const field = resolveField(workspace.project, fieldName)
  const value = parseFieldValue(field, raw)

  const after = await workspace.commit({
    kind: 'item.setField',
    itemId: item.id,
    fieldId: field.id,
    value,
  })
  return { workspace: after, result: { item, field, value } }
}

function parseFieldValue(field: Field, raw: string | null): FieldValue {
  if (raw === null || raw.trim() === '' || raw.trim().toLowerCase() === 'none') return null

  switch (field.type) {
    case 'number':
      if (!Number.isFinite(Number(raw))) throw new KanboError(`"${raw}" is not a number.`)
      return Number(raw)
    case 'checkbox':
      return ['true', 'yes', '1', 'on'].includes(raw.trim().toLowerCase())
    case 'date':
      return parseDate(raw)
    case 'select':
      if (!field.options.includes(raw)) {
        throw new KanboError(`"${raw}" is not one of ${field.name}'s options.`, field.options)
      }
      return raw
    case 'multi-select': {
      const chosen = raw.split(',').map((entry) => entry.trim())
      const unknown = chosen.filter((entry) => !field.options.includes(entry))
      if (unknown.length > 0) {
        throw new KanboError(
          `${field.name} has no option ${unknown.map((entry) => `"${entry}"`).join(', ')}.`,
          field.options,
        )
      }
      return chosen
    }
    default:
      return raw
  }
}

export async function itemComment(
  workspace: Workspace,
  ref: string,
  body: string,
): Promise<Outcome<{ item: Item; comment: Comment }>> {
  const item = resolveItem(workspace.project, ref)
  if (body.trim() === '') throw new KanboError('A comment needs something in it.')

  const comment: Comment = {
    id: workspace.ports.random.id(),
    itemId: item.id,
    authorId: workspace.meId,
    body,
    createdAt: workspace.ports.clock.now(),
    editedAt: null,
  }

  const after = await workspace.commit({ kind: 'comment.upsert', comment })
  return { workspace: after, result: { item, comment } }
}

export async function commentDelete(
  workspace: Workspace,
  commentId: string,
): Promise<Outcome<{ commentId: string }>> {
  const found = workspace.project.comments.find((comment) => comment.id === commentId)
  if (!found) throw new KanboError(`No comment with id ${commentId}.`)

  const after = await workspace.commit({ kind: 'comment.delete', commentId })
  return { workspace: after, result: { commentId } }
}

// -------------------------------------------------------------- columns

export async function columnSet(
  workspace: Workspace,
  name: string,
  patch: {
    name?: string
    category?: string
    wipLimit?: number | null
    color?: string | null
  },
): Promise<Outcome<Status>> {
  const status = resolveStatus(workspace.project, name)

  const category = patch.category === undefined ? status.category : parseCategory(patch.category)
  const updated: Status = {
    ...status,
    name: patch.name?.trim() || status.name,
    category,
    wipLimit: patch.wipLimit === undefined ? status.wipLimit : patch.wipLimit,
    color: patch.color === undefined ? status.color : patch.color,
  }

  const after = await workspace.commit({ kind: 'status.upsert', status: updated })
  return { workspace: after, result: updated }
}

export function parseCategory(value: string): StatusCategory {
  const categories: readonly StatusCategory[] = ['todo', 'in-progress', 'done']
  const found = categories.find((category) => category === value.trim().toLowerCase())
  if (!found) throw new KanboError(`"${value}" is not a category.`, [...categories])
  return found
}

/**
 * Delete a column, saying where its cards go.
 *
 * The destination is required rather than defaulted: items are never orphaned
 * by deleting a column, and choosing silently which column inherits a team's
 * work is not a decision a tool should make for them.
 */
export async function columnDelete(
  workspace: Workspace,
  name: string,
  intoName: string,
): Promise<Outcome<{ status: Status; into: Status; moved: number }>> {
  const status = resolveStatus(workspace.project, name)
  const into = resolveStatus(workspace.project, intoName)
  if (status.id === into.id) throw new KanboError('A column cannot inherit from itself.')

  const moved = workspace.project.items.filter((item) => item.statusId === status.id).length
  const after = await workspace.commit({
    kind: 'status.delete',
    statusId: status.id,
    moveToId: into.id,
  })
  return { workspace: after, result: { status, into, moved } }
}

export async function columnReorder(
  workspace: Workspace,
  name: string,
  index: number,
): Promise<Outcome<Status>> {
  const status = resolveStatus(workspace.project, name)
  const order = orderForStatusReorder(workspace.project, status.id, index)
  const moved: Status = { ...status, order }

  const after = await workspace.commit({ kind: 'status.upsert', status: moved })
  return { workspace: after, result: moved }
}

// ----------------------------------------------------------- vocabulary

export async function labelUpsert(
  workspace: Workspace,
  name: string,
  color: string | null,
): Promise<Outcome<Label>> {
  const existing = workspace.project.labels.find(
    (label) => label.name.toLowerCase() === name.trim().toLowerCase(),
  )
  const label: Label = {
    id: existing?.id ?? workspace.ports.random.id(),
    name: name.trim(),
    color: color ?? existing?.color ?? '#6b7280',
  }

  const after = await workspace.commit({ kind: 'label.upsert', label })
  return { workspace: after, result: label }
}

export async function labelDelete(workspace: Workspace, name: string): Promise<Outcome<Label>> {
  const label = resolveLabel(workspace.project, name)
  const after = await workspace.commit({ kind: 'label.delete', labelId: label.id })
  return { workspace: after, result: label }
}

export async function fieldUpsert(
  workspace: Workspace,
  name: string,
  type: string,
  options: readonly string[],
): Promise<Outcome<Field>> {
  const fieldType = FIELD_TYPES.find((candidate) => candidate === type.trim().toLowerCase())
  if (!fieldType) throw new KanboError(`"${type}" is not a field type.`, [...FIELD_TYPES])

  if ((fieldType === 'select' || fieldType === 'multi-select') && options.length === 0) {
    throw new KanboError(`A ${fieldType} field needs options to choose from.`)
  }

  const existing = workspace.project.fields.find(
    (field) => field.name.toLowerCase() === name.trim().toLowerCase(),
  )
  const field: Field = {
    id: existing?.id ?? workspace.ports.random.id(),
    name: name.trim(),
    type: fieldType,
    options: [...options],
    order: existing?.order ?? appended(workspace.project.fields),
  }

  const after = await workspace.commit({ kind: 'field.upsert', field })
  return { workspace: after, result: field }
}

export async function fieldDelete(workspace: Workspace, name: string): Promise<Outcome<Field>> {
  const field = resolveField(workspace.project, name)
  const after = await workspace.commit({ kind: 'field.delete', fieldId: field.id })
  return { workspace: after, result: field }
}

// --------------------------------------------------------------- people

export async function personUpsert(
  workspace: Workspace,
  name: string,
  patch: { name?: string; handle?: string | null },
): Promise<Outcome<Member>> {
  const existing = workspace.project.members.find(
    (member) => member.name.toLowerCase() === name.trim().toLowerCase(),
  )

  const member: Member = {
    id: existing?.id ?? workspace.ports.random.id(),
    name: patch.name?.trim() || existing?.name || name.trim(),
    handle:
      patch.handle === undefined
        ? (existing?.handle ?? null)
        : patch.handle === null
          ? null
          : patch.handle.trim().replace(/^@/, '') || null,
  }

  const after = await workspace.commit({ kind: 'member.upsert', member })
  return { workspace: after, result: member }
}

export async function personDelete(workspace: Workspace, name: string): Promise<Outcome<Member>> {
  const member = resolveMember(workspace.project, name)
  const after = await workspace.commit({ kind: 'member.delete', memberId: member.id })
  return { workspace: after, result: member }
}

// -------------------------------------------------------------- sprints

export async function sprintUpsert(
  workspace: Workspace,
  name: string,
  patch: {
    name?: string
    goal?: string
    startsAt?: string
    endsAt?: string
    capacity?: number | null
  },
  now: number,
): Promise<Outcome<Iteration>> {
  const existing = workspace.project.iterations.find(
    (iteration) => iteration.name.toLowerCase() === name.trim().toLowerCase(),
  )

  const startsAt = patch.startsAt ? parseDate(patch.startsAt) : existing?.startsAt
  const endsAt = patch.endsAt ? parseDate(patch.endsAt) : existing?.endsAt

  if (!startsAt || !endsAt) {
    throw new KanboError('A sprint needs a start and an end. Give --start and --end.')
  }
  if (endsAt < startsAt) throw new KanboError('A sprint cannot end before it starts.')

  const iteration: Iteration = {
    id: existing?.id ?? workspace.ports.random.id(),
    name: patch.name?.trim() || existing?.name || name.trim(),
    goal: patch.goal ?? existing?.goal ?? '',
    startsAt,
    endsAt,
    capacity: patch.capacity === undefined ? (existing?.capacity ?? null) : patch.capacity,
    order: existing?.order ?? appended(workspace.project.iterations),
  }

  void now
  const after = await workspace.commit({ kind: 'iteration.upsert', iteration })
  return { workspace: after, result: iteration }
}

/**
 * Close a sprint, and say where the work that did not finish goes.
 *
 * Unfinished work has to land somewhere on purpose. Leaving it attached to a
 * sprint that is over is how a burndown starts lying, and moving it silently
 * into the next one is how a team stops noticing that it always does.
 */
export async function sprintClose(
  workspace: Workspace,
  name: string,
  carryTo: string | null,
  now: number,
): Promise<Outcome<{ sprint: Iteration; carried: readonly Item[]; into: Iteration | null }>> {
  const sprint = resolveSprint(workspace.project, name, now)
  const into = carryTo === null ? null : resolveSprint(workspace.project, carryTo, now)
  if (into?.id === sprint.id) throw new KanboError('A sprint cannot carry into itself.')

  const carried = workspace.project.items.filter(
    (item) => item.iterationId === sprint.id && item.completedAt === null && !item.archived,
  )

  const moves: OperationBody[] = carried.map((item) => ({
    kind: 'item.set',
    itemId: item.id,
    patch: { iterationId: into?.id ?? null },
  }))

  const after = await workspace.commit(...moves)
  return { workspace: after, result: { sprint, carried, into } }
}

export async function sprintDelete(
  workspace: Workspace,
  name: string,
  now: number,
): Promise<Outcome<{ sprint: Iteration; released: number }>> {
  const sprint = resolveSprint(workspace.project, name, now)
  const released = workspace.project.items.filter((item) => item.iterationId === sprint.id).length

  const after = await workspace.commit({ kind: 'iteration.delete', iterationId: sprint.id })
  return { workspace: after, result: { sprint, released } }
}

// ----------------------------------------------------------- milestones

export async function milestoneUpsert(
  workspace: Workspace,
  name: string,
  patch: { name?: string; description?: string; dueOn?: string | null },
): Promise<Outcome<Milestone>> {
  const existing = workspace.project.milestones.find(
    (milestone) => milestone.name.toLowerCase() === name.trim().toLowerCase(),
  )

  const milestone: Milestone = {
    id: existing?.id ?? workspace.ports.random.id(),
    name: patch.name?.trim() || existing?.name || name.trim(),
    description: patch.description ?? existing?.description ?? '',
    dueOn:
      patch.dueOn === undefined
        ? (existing?.dueOn ?? null)
        : patch.dueOn === null
          ? null
          : parseDate(patch.dueOn),
    order: existing?.order ?? appended(workspace.project.milestones),
  }

  const after = await workspace.commit({ kind: 'milestone.upsert', milestone })
  return { workspace: after, result: milestone }
}

export async function milestoneDelete(
  workspace: Workspace,
  name: string,
): Promise<Outcome<{ milestone: Milestone; released: number }>> {
  const milestone = resolveMilestone(workspace.project, name)
  const released = workspace.project.items.filter(
    (item) => item.milestoneId === milestone.id,
  ).length

  const after = await workspace.commit({ kind: 'milestone.delete', milestoneId: milestone.id })
  return { workspace: after, result: { milestone, released } }
}

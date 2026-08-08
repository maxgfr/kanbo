import {
  type Item,
  type ItemPatch,
  type Member,
  type Status,
  type StatusCategory,
  byOrder,
  defaultStatuses,
  importJson,
  keyBetween,
  mergeLogs,
  newItem,
  orderForDrop,
} from '@kanbo/core'

import { KanboError, resolveItem, resolveMember, resolveStatus } from './resolve.ts'
import { type Workspace, replaceLog } from './session.ts'

/**
 * Every change a project can undergo, as a function of a workspace.
 *
 * These are what the terminal and the MCP server both call. Each one resolves
 * what it was given, decides which operations that implies, and commits them —
 * and then returns a value describing what happened, in the domain's own words.
 * None of them prints anything, and none of them knows whether the answer is
 * about to become a line of text or a JSON object.
 *
 * That is the whole reason they exist. A second front-end that re-derived
 * "which operations does moving a card imply" would be the moment the README's
 * central claim stopped being true, and it would stop being true in the place
 * where it matters most.
 */

export type Outcome<T> = {
  readonly workspace: Workspace
  readonly result: T
}

function requireProject(workspace: Workspace): void {
  if (workspace.project.statuses.length === 0 && workspace.log.length === 0) {
    throw new KanboError('No project here yet. Run `kanbo init` first.')
  }
}

export async function init(
  workspace: Workspace,
  name: string,
  key: string | null,
): Promise<Outcome<{ name: string; key: string; root: string }>> {
  /**
   * A project exists if anything was ever written about it — not if it still
   * has columns.
   *
   * The guard used to read `statuses.length > 0`, so a project whose columns
   * had all been deleted would silently initialise a second time and stack
   * another `project.set` onto the same log.
   */
  if (workspace.log.length > 0) {
    throw new KanboError('A project already exists here.')
  }

  const chosen = (key ?? name.slice(0, 3)).toUpperCase()
  const statuses = defaultStatuses(() => workspace.ports.random.id())
  const after = await workspace.commit(
    { kind: 'project.set', patch: { name, key: chosen } },
    ...statuses.map((status) => ({ kind: 'status.upsert' as const, status })),
  )

  return { workspace: after, result: { name, key: chosen, root: workspace.root } }
}

export async function projectSet(
  workspace: Workspace,
  patch: { name?: string; key?: string; description?: string },
): Promise<Outcome<{ changed: readonly string[] }>> {
  requireProject(workspace)
  const changed = Object.keys(patch)
  if (changed.length === 0) throw new KanboError('Nothing to change.')

  const after = await workspace.commit({
    kind: 'project.set',
    patch: patch.key === undefined ? patch : { ...patch, key: patch.key.toUpperCase() },
  })
  return { workspace: after, result: { changed } }
}

export async function columnAdd(
  workspace: Workspace,
  name: string,
  category: StatusCategory,
): Promise<Outcome<Status>> {
  requireProject(workspace)
  if (name.trim() === '') throw new KanboError('A column needs a name.')

  const last = workspace.project.statuses.toSorted(byOrder).at(-1)
  const status: Status = {
    id: workspace.ports.random.id(),
    name: name.trim(),
    category,
    order: keyBetween(last?.order ?? null, null),
    wipLimit: null,
    color: null,
  }

  const after = await workspace.commit({ kind: 'status.upsert', status })
  return { workspace: after, result: status }
}

export async function itemCreate(
  workspace: Workspace,
  patch: Partial<Item> & { readonly title: string },
): Promise<Outcome<Item>> {
  requireProject(workspace)
  if (patch.title.trim() === '') throw new KanboError('An item needs a title.')

  const item = newItem(workspace.project, workspace.ports, patch)
  const after = await workspace.commit({ kind: 'item.create', item })
  return { workspace: after, result: item }
}

export async function itemMove(
  workspace: Workspace,
  ref: string,
  statusName: string,
  index = 0,
): Promise<Outcome<{ item: Item; status: Status }>> {
  requireProject(workspace)
  const item = resolveItem(workspace.project, ref)
  const status = resolveStatus(workspace.project, statusName)

  const after = await workspace.commit({
    kind: 'item.move',
    itemId: item.id,
    statusId: status.id,
    order: orderForDrop(workspace.project, item.id, status.id, index),
  })
  return { workspace: after, result: { item, status } }
}

export async function itemSet(
  workspace: Workspace,
  ref: string,
  patch: ItemPatch,
): Promise<Outcome<{ item: Item; changed: readonly string[] }>> {
  requireProject(workspace)
  const item = resolveItem(workspace.project, ref)
  const changed = Object.keys(patch)
  if (changed.length === 0) throw new KanboError('Nothing to change.')

  const after = await workspace.commit({ kind: 'item.set', itemId: item.id, patch })
  return { workspace: after, result: { item, changed } }
}

/**
 * Assign an item, inventing the person if this project has never seen them.
 *
 * The board lets you invent a person straight from an item, which is the moment
 * you want one; there is no user directory to pick from either way.
 */
export async function itemAssign(
  workspace: Workspace,
  ref: string,
  who: string,
): Promise<Outcome<{ item: Item; member: Member }>> {
  requireProject(workspace)
  const item = resolveItem(workspace.project, ref)

  const existing = workspace.project.members.find(
    (member) => member.name.toLowerCase() === who.trim().toLowerCase(),
  )
  const member = existing ?? { id: workspace.ports.random.id(), name: who.trim(), handle: null }

  const after = await workspace.commit(
    ...(existing ? [] : [{ kind: 'member.upsert' as const, member }]),
    {
      kind: 'item.set',
      itemId: item.id,
      patch: { assignees: [...new Set([...item.assignees, member.id])] },
    },
  )
  return { workspace: after, result: { item, member } }
}

export async function itemUnassign(
  workspace: Workspace,
  ref: string,
): Promise<Outcome<{ item: Item }>> {
  requireProject(workspace)
  const item = resolveItem(workspace.project, ref)
  const after = await workspace.commit({
    kind: 'item.set',
    itemId: item.id,
    patch: { assignees: [] },
  })
  return { workspace: after, result: { item } }
}

/** Say which member is at this machine. Never written to the project. */
export async function claimMe(
  workspace: Workspace,
  wanted: string | null,
): Promise<Outcome<Member | null>> {
  if (wanted === null) return { workspace: await workspace.claim(null), result: null }

  const member = resolveMember(workspace.project, wanted)
  return { workspace: await workspace.claim(member.id), result: member }
}

/** Merge an export into this store. The merge is a union, so twice is once. */
export async function importOperations(
  workspace: Workspace,
  json: string,
): Promise<Outcome<{ added: number }>> {
  const incoming = importJson(json)
  const merged = mergeLogs(workspace.log, incoming)
  const after = await replaceLog(workspace, merged)
  return { workspace: after, result: { added: merged.length - workspace.log.length } }
}

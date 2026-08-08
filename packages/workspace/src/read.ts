import {
  type Item,
  type Project,
  type Status,
  type StatusCategory,
  byOrder,
  itemsInStatus,
  memberById,
  search,
  statusById,
} from '@kanbo/core'

import type { Workspace } from './session.ts'

/**
 * The readings both front-ends serve.
 *
 * Every value here is derived from the log the board is built from. Nothing is
 * recorded twice, so nothing can drift — which is the same argument the
 * activity feed makes, applied to a terminal.
 */

export type BoardColumn = {
  readonly status: Status
  readonly items: readonly Item[]
}

export function board(project: Project): readonly BoardColumn[] {
  return project.statuses.toSorted(byOrder).map((status) => ({
    status,
    items: itemsInStatus(project, status.id).toSorted(byOrder),
  }))
}

export type ColumnSummary = {
  readonly name: string
  readonly category: StatusCategory
  readonly count: number
  readonly wipLimit: number | null
}

export function columns(project: Project): readonly ColumnSummary[] {
  return project.statuses.toSorted(byOrder).map((status) => ({
    name: status.name,
    category: status.category,
    count: itemsInStatus(project, status.id).length,
    wipLimit: status.wipLimit,
  }))
}

export type Found = {
  readonly item: Item
  readonly status: Status | null
}

/** The identical query language the palette runs, unchanged. */
export function find(workspace: Workspace, query: string, now: number): readonly Found[] {
  return search(query, { project: workspace.project, now, meId: workspace.meId }).map((item) => ({
    item,
    status: statusById(workspace.project, item.statusId) ?? null,
  }))
}

export type StoreSummary = {
  readonly name: string
  readonly key: string
  readonly items: number
  readonly operations: number
  readonly device: string
  readonly root: string
}

export function summary(workspace: Workspace): StoreSummary {
  return {
    name: workspace.project.name,
    key: workspace.project.key,
    items: workspace.project.items.length,
    operations: workspace.log.length,
    device: workspace.device,
    root: workspace.root,
  }
}

/** Who is at this machine, if anyone said so. */
export function whoAmI(workspace: Workspace) {
  return memberById(workspace.project, workspace.meId)
}

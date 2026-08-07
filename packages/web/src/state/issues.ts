import {
  ISSUE_FIELD,
  type OperationBody,
  type RemoteIssue,
  hasIssues,
  newItem,
  operationsForImport,
  planIssueSync,
  typeFromLabels,
} from '@kanbo/core'

import { buildProvider } from './sync.ts'
import { createPorts } from './store.ts'
import type { Store } from './store.ts'

export type IssueSyncReport = {
  readonly imported: number
  readonly updated: number
  readonly pushed: number
  readonly message: string
}

/**
 * Reconcile the board with the repository's issues.
 *
 * The plan is computed first and entirely in the domain, so what is about to
 * happen is decided by testable code rather than by the order network calls
 * happen to return in.
 */
export async function syncIssues(store: Store): Promise<IssueSyncReport> {
  const built = await buildProvider(store)
  if ('reason' in built) {
    return { imported: 0, updated: 0, pushed: 0, message: built.reason }
  }
  if (!hasIssues(built.provider)) {
    return { imported: 0, updated: 0, pushed: 0, message: 'This forge does not expose issues.' }
  }

  const project = store.getProject()
  const doneStatuses = new Set(
    project.statuses.filter((status) => status.category === 'done').map((status) => status.id),
  )
  const backlog = project.statuses.find((status) => status.category === 'todo')
  const done = project.statuses.find((status) => status.category === 'done')

  let issues: readonly RemoteIssue[]
  try {
    issues = await built.provider.listIssues({})
  } catch (error) {
    return {
      imported: 0,
      updated: 0,
      pushed: 0,
      message: error instanceof Error ? error.message : 'The issues could not be read.',
    }
  }

  const plan = planIssueSync(project, issues, doneStatuses)
  const ports = createPorts()

  const bodies: OperationBody[] = [
    ...operationsForImport(plan.toCreate, (issue) =>
      newItem(project, ports, {
        title: issue.title,
        description: issue.body,
        type: typeFromLabels(issue.labels),
        ...(issue.state === 'closed' && done
          ? { statusId: done.id }
          : backlog
            ? { statusId: backlog.id }
            : {}),
      }),
    ),
  ]

  for (const { item, issue } of plan.toUpdate) {
    bodies.push({
      kind: 'item.set',
      itemId: item.id,
      patch: { title: issue.title, description: issue.body },
    })
    // The closed state lives in the status, so a change there is a move rather
    // than a field edit — which is also what keeps the metrics honest.
    const target = issue.state === 'closed' ? done : backlog
    if (target && target.id !== item.statusId) {
      bodies.push({ kind: 'item.move', itemId: item.id, statusId: target.id, order: item.order })
    }
  }

  if (bodies.length > 0) await store.dispatch(...bodies)

  // Pushing happens after the local side settles, so a failure upward leaves
  // the board consistent rather than half-reconciled.
  let pushed = 0
  for (const change of plan.toPush) {
    try {
      await built.provider.updateIssue(change.number, { state: change.state })
      pushed++
    } catch {
      // Reported in the count rather than aborting: one issue we cannot write
      // should not stop the rest from reconciling.
    }
  }

  return {
    imported: plan.toCreate.length,
    updated: plan.toUpdate.length,
    pushed,
    message:
      plan.toCreate.length + plan.toUpdate.length + pushed === 0
        ? 'Everything already matches.'
        : `Imported ${plan.toCreate.length}, updated ${plan.toUpdate.length}, pushed ${pushed}.`,
  }
}

/** Create an issue from a card, and remember the link. */
export async function createIssueFrom(store: Store, itemId: string): Promise<string> {
  const built = await buildProvider(store)
  if ('reason' in built) return built.reason
  if (!hasIssues(built.provider)) return 'This forge does not expose issues.'

  const item = store.getProject().items.find((candidate) => candidate.id === itemId)
  if (!item) return 'That item no longer exists.'

  try {
    const issue = await built.provider.createIssue({
      title: item.title,
      body: item.description,
      labels: item.type === 'bug' ? ['bug'] : [],
    })
    await store.dispatch({
      kind: 'item.setField',
      itemId,
      fieldId: ISSUE_FIELD,
      value: issue.number,
    })
    return `Opened issue #${issue.number}.`
  } catch (error) {
    return error instanceof Error ? error.message : 'The issue could not be created.'
  }
}

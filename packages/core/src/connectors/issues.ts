/**
 * Issues and pull requests, on the same boundary as everything else.
 *
 * Optional by design: a provider that cannot do issues is still a perfectly
 * good backend for the operation log, so this is a separate interface a
 * provider may or may not implement. The domain asks whether it can before it
 * offers the feature.
 *
 * The mapping between an item and an issue is deliberately shallow. Kanbo owns
 * sprints, points, dependencies and order — none of which a forge has a place
 * for — while the forge owns the conversation. Trying to round-trip everything
 * would mean inventing labels to smuggle Kanbo's model into a system that does
 * not have it, and those labels become someone else's mess.
 */
import type { Item, ItemType, Project, Status } from '../model/types.ts'
import { byOrder } from '../order/fractional.ts'
import type { OperationBody } from '../ops/types.ts'

export type RemoteIssue = {
  readonly number: number
  readonly title: string
  readonly body: string
  readonly state: 'open' | 'closed'
  readonly labels: readonly string[]
  readonly assignees: readonly string[]
  readonly url: string
  readonly updatedAt: number
}

export type RemotePullRequest = {
  readonly number: number
  readonly title: string
  /** Needed to spot "closes #12" and the item reference people paste in. */
  readonly body: string
  readonly state: 'open' | 'closed' | 'merged'
  readonly draft: boolean
  readonly url: string
  readonly branch: string
  /** Null when no checks have reported yet — which is not the same as passing. */
  readonly checks: 'passing' | 'failing' | 'pending' | null
}

export interface IssueConnector {
  listIssues(options: { readonly since?: number }): Promise<readonly RemoteIssue[]>
  createIssue(input: {
    readonly title: string
    readonly body: string
    readonly labels: readonly string[]
  }): Promise<RemoteIssue>
  updateIssue(
    number: number,
    patch: {
      readonly title?: string
      readonly body?: string
      readonly state?: 'open' | 'closed'
    },
  ): Promise<RemoteIssue>
  listPullRequests(): Promise<readonly RemotePullRequest[]>
}

export function hasIssues(provider: unknown): provider is IssueConnector {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    typeof (provider as IssueConnector).listIssues === 'function'
  )
}

/** The custom field Kanbo uses to remember which issue an item mirrors. */
export const ISSUE_FIELD = 'github.issue'
export const BRANCH_FIELD = 'github.branch'

export function issueNumberOf(item: Item): number | null {
  const value = item.fields[ISSUE_FIELD]
  return typeof value === 'number' ? value : null
}

/**
 * Guess an item type from a forge's labels.
 *
 * Only `bug` is inferred, because it is the one label convention that is close
 * to universal. Guessing further would mean quietly retyping someone's work
 * from a label that meant something else to them.
 */
export function typeFromLabels(labels: readonly string[]): ItemType {
  return labels.some((label) => /^(bug|defect|regression)$/i.test(label)) ? 'bug' : 'task'
}

/**
 * Turn a forge's assignee logins into this project's people.
 *
 * This is what `Member.handle` is for, and until now it was for nothing: both
 * connectors have always read `assignees` off an issue, and nothing ever looked
 * at them. A handle is the only bridge available — a forge knows `@ada`, a
 * board knows "Ada Lovelace", and there is no directory to ask.
 *
 * A login nobody claims is dropped rather than invented as a new member.
 * Importing a repository would otherwise fill the team with every drive-by
 * contributor a project has ever had, and a person on the board is a person
 * somebody agreed to.
 */
export function membersForHandles(project: Project, logins: readonly string[]): readonly string[] {
  const byHandle = new Map<string, string>()
  for (const member of project.members) {
    if (member.handle) byHandle.set(member.handle.toLowerCase().replace(/^@/, ''), member.id)
  }

  const found = logins
    .map((login) => byHandle.get(login.toLowerCase().replace(/^@/, '')))
    .filter((id): id is string => id !== undefined)

  return [...new Set(found)]
}

export type IssueSyncPlan = {
  /** Issues with no matching item: they become new cards. */
  readonly toCreate: readonly RemoteIssue[]
  /** Items whose issue moved on: the card catches up. */
  readonly toUpdate: readonly { readonly item: Item; readonly issue: RemoteIssue }[]
  /** Items closed here whose issue is still open, and the reverse. */
  readonly toPush: readonly {
    readonly item: Item
    readonly number: number
    readonly state: 'open' | 'closed'
  }[]
}

/**
 * Work out what a two-way sync would do, without doing any of it.
 *
 * Pure, so the decision is testable and so the UI can show what is about to
 * happen before anything is written to someone's repository. Reconciliation
 * that surprises people is reconciliation they turn off.
 */
export function planIssueSync(
  project: Project,
  issues: readonly RemoteIssue[],
  doneStatusIds: ReadonlySet<string>,
): IssueSyncPlan {
  const byNumber = new Map<number, Item>()
  for (const item of project.items) {
    const number = issueNumberOf(item)
    if (number !== null) byNumber.set(number, item)
  }

  const toCreate: RemoteIssue[] = []
  const toUpdate: { item: Item; issue: RemoteIssue }[] = []
  const toPush: { item: Item; number: number; state: 'open' | 'closed' }[] = []

  for (const issue of issues) {
    const item = byNumber.get(issue.number)
    if (!item) {
      toCreate.push(issue)
      continue
    }

    const closedHere = doneStatusIds.has(item.statusId)
    const closedThere = issue.state === 'closed'

    if (closedHere !== closedThere) {
      // Whichever side changed more recently wins. `updatedAt` is wall clock
      // from two systems, which is exactly the sort of comparison the internal
      // merge refuses — but here there is no shared counter to appeal to, and
      // saying so is better than pretending the ambiguity does not exist.
      if (item.updatedAt >= issue.updatedAt) {
        toPush.push({ item, number: issue.number, state: closedHere ? 'closed' : 'open' })
      } else {
        toUpdate.push({ item, issue })
      }
      continue
    }

    if (item.title !== issue.title || item.description !== issue.body) {
      if (issue.updatedAt > item.updatedAt) toUpdate.push({ item, issue })
      else if (item.updatedAt > issue.updatedAt) {
        toPush.push({ item, number: issue.number, state: closedHere ? 'closed' : 'open' })
      }
    }
  }

  return { toCreate, toUpdate, toPush }
}

/** Operations that bring imported issues onto the board. */
export function operationsForImport(
  issues: readonly RemoteIssue[],
  makeItem: (issue: RemoteIssue) => Item,
): readonly OperationBody[] {
  return issues.flatMap((issue) => {
    // Called once and held: `makeItem` mints an id, so calling it twice would
    // create the item and then tag a different, non-existent one.
    const item = makeItem(issue)
    return [
      { kind: 'item.create' as const, item },
      {
        kind: 'item.setField' as const,
        itemId: item.id,
        fieldId: ISSUE_FIELD,
        value: issue.number,
      },
    ]
  })
}

/**
 * The two columns reconciliation lands issues in.
 *
 * Sorted before choosing, because a team can have several todo and several done
 * columns. Unsorted, the landing column for an imported issue would be
 * whichever status happened to be created first — invisible on screen, and
 * liable to change the day someone reorders the board.
 */
export function landingStatuses(project: Project): {
  readonly backlog: Status | undefined
  readonly done: Status | undefined
} {
  const inOrder = project.statuses.toSorted(byOrder)
  return {
    backlog: inOrder.find((status) => status.category === 'todo'),
    done: inOrder.find((status) => status.category === 'done'),
  }
}

/**
 * A reconciliation plan, as the operations that carry it out.
 *
 * This is where the policy lives, and it lives here once. A browser and a
 * terminal reconciling the same repository differently would be worse than
 * either of them not reconciling at all: whichever ran last would look like the
 * truth. The decisions it encodes are worth naming —
 *
 * An issue that arrives assigned to somebody the board knows lands on their
 * plate, but only on import: a local assignment is a real decision, and the
 * forge is not more authoritative about it than the person who made it.
 *
 * A closed issue moves the card to a done column rather than setting a field,
 * because in Kanbo "closed" *is* the column — which is also what keeps cycle
 * time honest.
 */
export function operationsForSync(
  project: Project,
  plan: IssueSyncPlan,
  makeItem: (issue: RemoteIssue, statusId: string | undefined) => Item,
): readonly OperationBody[] {
  const { backlog, done } = landingStatuses(project)

  const bodies: OperationBody[] = [
    ...operationsForImport(plan.toCreate, (issue) =>
      makeItem(issue, issue.state === 'closed' ? done?.id : backlog?.id),
    ),
  ]

  for (const { item, issue } of plan.toUpdate) {
    bodies.push({
      kind: 'item.set',
      itemId: item.id,
      patch: { title: issue.title, description: issue.body },
    })
    const target = issue.state === 'closed' ? done : backlog
    if (target && target.id !== item.statusId) {
      bodies.push({ kind: 'item.move', itemId: item.id, statusId: target.id, order: item.order })
    }
  }

  return bodies
}

import { describe, expect, it } from 'vitest'

import { itemById } from '../model/project.ts'
import { reduceOperations } from '../ops/reduce.ts'
import { anItem, op, statusOperations } from '../ops/testing.ts'
import {
  ISSUE_FIELD,
  type RemoteIssue,
  issueNumberOf,
  membersForHandles,
  operationsForImport,
  planIssueSync,
  typeFromLabels,
} from './issues.ts'

function anIssue(number: number, overrides: Partial<RemoteIssue> = {}): RemoteIssue {
  return {
    number,
    title: `Issue ${number}`,
    body: '',
    state: 'open',
    labels: [],
    assignees: [],
    url: `https://github.com/o/r/issues/${number}`,
    updatedAt: 1000,
    ...overrides,
  }
}

const DONE = new Set(['done'])

function projectWith(...bodies: Parameters<typeof op>[2][]) {
  return reduceOperations([
    ...statusOperations(),
    ...bodies.map((body, index) => op('a', 10 + index, body)),
  ])
}

describe('typeFromLabels', () => {
  it('recognises the one convention that is close to universal', () => {
    expect(typeFromLabels(['bug'])).toBe('bug')
    expect(typeFromLabels(['Regression'])).toBe('bug')
  })

  it('does not guess beyond it', () => {
    // Retyping someone's work from a label that meant something else to them
    // is worse than defaulting.
    expect(typeFromLabels(['enhancement', 'epic', 'chore'])).toBe('task')
  })
})

describe('planIssueSync', () => {
  it('imports an issue nothing on the board mirrors', () => {
    const plan = planIssueSync(projectWith(), [anIssue(1)], DONE)
    expect(plan.toCreate.map((issue) => issue.number)).toEqual([1])
  })

  it('does nothing when both sides agree', () => {
    const project = projectWith({
      kind: 'item.create',
      item: anItem('1', { title: 'Issue 1', fields: { [ISSUE_FIELD]: 1 }, updatedAt: 1000 }),
    })
    const plan = planIssueSync(project, [anIssue(1)], DONE)
    expect(plan).toEqual({ toCreate: [], toUpdate: [], toPush: [] })
  })

  it('closes the issue when the card was finished here more recently', () => {
    const project = projectWith({
      kind: 'item.create',
      item: anItem('1', {
        title: 'Issue 1',
        statusId: 'done',
        fields: { [ISSUE_FIELD]: 1 },
        updatedAt: 2000,
      }),
    })
    const plan = planIssueSync(project, [anIssue(1, { updatedAt: 1000 })], DONE)
    expect(plan.toPush).toEqual([{ item: expect.anything(), number: 1, state: 'closed' }])
  })

  it('pulls the closure in when the issue was closed more recently', () => {
    const project = projectWith({
      kind: 'item.create',
      item: anItem('1', { title: 'Issue 1', fields: { [ISSUE_FIELD]: 1 }, updatedAt: 1000 }),
    })
    const plan = planIssueSync(project, [anIssue(1, { state: 'closed', updatedAt: 2000 })], DONE)
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toPush).toHaveLength(0)
  })

  it('takes the newer text when only the wording differs', () => {
    const project = projectWith({
      kind: 'item.create',
      item: anItem('1', { title: 'Old title', fields: { [ISSUE_FIELD]: 1 }, updatedAt: 1000 }),
    })
    const plan = planIssueSync(project, [anIssue(1, { title: 'New title', updatedAt: 2000 })], DONE)
    expect(plan.toUpdate[0]?.issue.title).toBe('New title')
  })

  it('leaves a simultaneous edit alone rather than picking a side', () => {
    // Identical timestamps from two systems carry no information about order.
    // Doing nothing is honest; guessing would silently overwrite someone.
    const project = projectWith({
      kind: 'item.create',
      item: anItem('1', { title: 'Here', fields: { [ISSUE_FIELD]: 1 }, updatedAt: 1000 }),
    })
    const plan = planIssueSync(project, [anIssue(1, { title: 'There', updatedAt: 1000 })], DONE)
    expect(plan.toUpdate).toHaveLength(0)
    expect(plan.toPush).toHaveLength(0)
  })

  it('ignores cards that were never linked to an issue', () => {
    const project = projectWith({ kind: 'item.create', item: anItem('1') })
    const plan = planIssueSync(project, [], DONE)
    expect(plan).toEqual({ toCreate: [], toUpdate: [], toPush: [] })
  })
})

describe('operationsForImport', () => {
  it('creates the item and tags it with the issue number', () => {
    let counter = 0
    const bodies = operationsForImport([anIssue(7)], (issue) =>
      anItem(`generated-${++counter}`, { title: issue.title }),
    )

    const project = reduceOperations([
      ...statusOperations(),
      ...bodies.map((body, index) => op('a', 20 + index, body)),
    ])

    // One item, and the tag reached it: calling the factory twice would create
    // one item and label a different, non-existent one.
    expect(project.items).toHaveLength(1)
    expect(issueNumberOf(project.items[0]!)).toBe(7)
    expect(itemById(project, 'generated-1')?.title).toBe('Issue 7')
  })
})

/**
 * What the forge handle is for — and it was for nothing until now. Both
 * connectors have always read `assignees` off an issue and nothing looked at
 * them, which made the handle a field you could fill in and never spend.
 */
describe('membersForHandles', () => {
  const team = projectWith(
    { kind: 'member.upsert', member: { id: 'ada', name: 'Ada Lovelace', handle: 'ada' } },
    { kind: 'member.upsert', member: { id: 'alan', name: 'Alan Turing', handle: '@alan' } },
    { kind: 'member.upsert', member: { id: 'grace', name: 'Grace Hopper', handle: null } },
  )

  it('maps a login to the person who claims it', () => {
    expect(membersForHandles(team, ['ada'])).toEqual(['ada'])
  })

  it('ignores the @ on either side, since forges and people disagree about it', () => {
    expect(membersForHandles(team, ['@ada'])).toEqual(['ada'])
    expect(membersForHandles(team, ['alan'])).toEqual(['alan'])
  })

  it('matches regardless of case', () => {
    expect(membersForHandles(team, ['ADA'])).toEqual(['ada'])
  })

  it('drops a login nobody claims rather than inventing a member', () => {
    // Importing a repository would otherwise fill the team with every drive-by
    // contributor it ever had, and a person on this board is one somebody
    // agreed to.
    expect(membersForHandles(team, ['stranger'])).toEqual([])
  })

  it('ignores people who never gave a handle', () => {
    expect(membersForHandles(team, ['grace', 'Grace Hopper'])).toEqual([])
  })

  it('returns each person once, however many logins point at them', () => {
    expect(membersForHandles(team, ['ada', '@ada', 'ADA'])).toEqual(['ada'])
  })

  it('answers nothing for a project with no team', () => {
    expect(membersForHandles(projectWith(), ['ada'])).toEqual([])
  })
})

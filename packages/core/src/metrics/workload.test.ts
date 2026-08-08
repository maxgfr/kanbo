import { describe, expect, it } from 'vitest'

import { mergeLogs } from '../ops/log.ts'
import { reduceOperations } from '../ops/reduce.ts'
import { anItem, op, statusOperations } from '../ops/testing.ts'
import { busiest, workloads } from './workload.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

/**
 * `anItem` defaults to the `todo` column; `startedAt` is derived by the reducer
 * from a move into an in-progress one, so the scenarios below move cards rather
 * than setting timestamps by hand.
 */
function board(...items: Parameters<typeof anItem>[1][]) {
  return reduceOperations(
    mergeLogs(
      statusOperations(),
      [
        op('seed', 20, { kind: 'member.upsert', member: { id: 'ada', name: 'Ada', handle: null } }),
        op('seed', 21, {
          kind: 'member.upsert',
          member: { id: 'alan', name: 'Alan', handle: null },
        }),
      ],
      items.map((overrides, at) =>
        op('seed', 30 + at, { kind: 'item.create', item: anItem(String(at + 1), overrides) }),
      ),
    ),
  )
}

const rowFor = (project: Parameters<typeof workloads>[0], id: string | null) =>
  workloads(project, NOW).find((row) => row.memberId === id)!

describe('workloads', () => {
  it('gives every member a row, even one carrying nothing', () => {
    // An empty plate is an answer. Hiding the row would make it look like Alan
    // had left the team.
    const project = board({ assignees: ['ada'] })
    expect(workloads(project, NOW).map((row) => row.name)).toEqual(['Ada', 'Alan', 'Unassigned'])
    expect(rowFor(project, 'alan').open).toHaveLength(0)
  })

  it('counts an item for everyone it is assigned to', () => {
    const project = board({ assignees: ['ada', 'alan'] })
    expect(rowFor(project, 'ada').open).toHaveLength(1)
    expect(rowFor(project, 'alan').open).toHaveLength(1)
  })

  it('collects what nobody has taken into its own lane', () => {
    const project = board({ assignees: [] }, { assignees: ['ada'] })
    expect(rowFor(project, null).open).toHaveLength(1)
  })

  it('leaves finished work out, because it is not a load any more', () => {
    const project = board({ assignees: ['ada'], statusId: 'done' }, { assignees: ['ada'] })
    expect(rowFor(project, 'ada').open).toHaveLength(1)
  })

  it('leaves archived work out', () => {
    const project = board({ assignees: ['ada'], archived: true })
    expect(rowFor(project, 'ada').open).toHaveLength(0)
  })

  it('separates what is in flight from what is merely open', () => {
    const project = board(
      { assignees: ['ada'], statusId: 'doing' },
      { assignees: ['ada'], statusId: 'todo' },
    )
    const ada = rowFor(project, 'ada')
    expect(ada.open).toHaveLength(2)
    expect(ada.inFlight).toHaveLength(1)
  })

  it('adds up points, counting unestimated work as zero rather than guessing', () => {
    const project = board(
      { assignees: ['ada'], estimate: 5 },
      { assignees: ['ada'], estimate: null },
      { assignees: ['ada'], estimate: 3 },
    )
    expect(rowFor(project, 'ada').points).toBe(8)
  })

  it('counts what is blocked, and stops counting once the blocker lands', () => {
    const open = reduceOperations(
      mergeLogs(
        statusOperations(),
        [
          op('seed', 20, {
            kind: 'member.upsert',
            member: { id: 'ada', name: 'Ada', handle: null },
          }),
        ],
        [
          op('seed', 30, { kind: 'item.create', item: anItem('1') }),
          op('seed', 31, {
            kind: 'item.create',
            item: anItem('2', {
              assignees: ['ada'],
              links: [{ type: 'blocked-by', itemId: '1' }],
            }),
          }),
        ],
      ),
    )
    expect(rowFor(open, 'ada').blocked).toHaveLength(1)

    const landed = reduceOperations(
      mergeLogs(
        [
          op('seed', 40, {
            kind: 'item.move',
            itemId: '1',
            statusId: 'done',
            order: 'a0',
          }),
        ],
        // Rebuilt from the same log so the blocker really is finished.
        [],
      ),
      open,
    )
    expect(rowFor(landed, 'ada').blocked).toHaveLength(0)
  })

  it('names the oldest thing in flight, which is the one to talk about', () => {
    const project = reduceOperations(
      mergeLogs(
        statusOperations(),
        [
          op('seed', 20, {
            kind: 'member.upsert',
            member: { id: 'ada', name: 'Ada', handle: null },
          }),
        ],
        [
          op('seed', 30, { kind: 'item.create', item: anItem('old', { assignees: ['ada'] }) }),
          op('seed', 31, { kind: 'item.create', item: anItem('new', { assignees: ['ada'] }) }),
          op(
            'seed',
            32,
            { kind: 'item.move', itemId: 'old', statusId: 'doing', order: 'a0' },
            NOW - 9 * DAY,
          ),
          op(
            'seed',
            33,
            { kind: 'item.move', itemId: 'new', statusId: 'doing', order: 'a1' },
            NOW - 2 * DAY,
          ),
        ],
      ),
    )

    const ada = rowFor(project, 'ada')
    expect(ada.oldest?.item.id).toBe('old')
    expect(ada.oldest?.days).toBe(9)
  })

  it('has no oldest when nothing has started', () => {
    expect(rowFor(board({ assignees: ['ada'] }), 'ada').oldest).toBeNull()
  })
})

describe('busiest', () => {
  it('is the largest open pile, so the bars are drawn against each other', () => {
    const project = board({ assignees: ['ada'] }, { assignees: ['ada'] }, { assignees: ['alan'] })
    expect(busiest(workloads(project, NOW))).toBe(2)
  })

  it('never returns zero, so an empty board does not divide by it', () => {
    expect(busiest(workloads(board(), NOW))).toBe(1)
  })
})

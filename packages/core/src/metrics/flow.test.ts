import { describe, expect, it } from 'vitest'

import type { Iteration } from '../model/types.ts'
import { reduceOperations } from '../ops/reduce.ts'
import { anItem, op, statusOperations } from '../ops/testing.ts'
import {
  DAY,
  ageInProgress,
  averageVelocity,
  burndown,
  cumulativeFlow,
  cycleSummary,
  cycleTime,
  daysBetween,
  isoDay,
  leadTime,
  percentile,
  throughput,
  transitions,
  velocity,
} from './flow.ts'

const DAY_0 = Date.parse('2026-08-01T00:00:00Z')
const at = (days: number, hours = 0) => DAY_0 + days * DAY + hours * 3_600_000

describe('percentile', () => {
  it('is empty for no data rather than guessing zero', () => {
    expect(percentile([], 0.5)).toBeNull()
  })

  it('reports the value at the requested rank', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(values, 0.5)).toBe(5)
    expect(percentile(values, 0.85)).toBe(9)
    expect(percentile(values, 1)).toBe(10)
  })

  it('does not need its input sorted', () => {
    expect(percentile([9, 1, 5], 0.5)).toBe(5)
  })
})

describe('cycle and lead time', () => {
  const finished = anItem('1', {
    createdAt: at(0),
    startedAt: at(1),
    completedAt: at(4),
  })

  it('measures a cycle from starting work to finishing it', () => {
    expect(cycleTime(finished)).toBe(3 * DAY)
  })

  it('measures lead time from creation, which is what a requester waits', () => {
    expect(leadTime(finished)).toBe(4 * DAY)
  })

  it('has no cycle time for unfinished work', () => {
    // A number that shrinks the moment it is written down is worse than none.
    expect(cycleTime(anItem('2', { startedAt: at(1) }))).toBeNull()
  })

  it('ages work in progress against now', () => {
    expect(ageInProgress(anItem('3', { startedAt: at(1) }), at(6))).toBe(5 * DAY)
  })

  it('does not age finished work', () => {
    expect(ageInProgress(finished, at(10))).toBeNull()
  })
})

describe('cycleSummary', () => {
  it('ignores unfinished items instead of counting them as instant', () => {
    const items = [
      anItem('1', { startedAt: at(0), completedAt: at(1) }),
      anItem('2', { startedAt: at(0), completedAt: at(3) }),
      anItem('3', { startedAt: at(0) }),
    ]
    const summary = cycleSummary(items)
    expect(summary.count).toBe(2)
    expect(summary.p50).toBe(DAY)
  })

  it('is empty rather than zero when nothing has finished', () => {
    expect(cycleSummary([anItem('1')])).toEqual({ count: 0, p50: null, p85: null, p95: null })
  })
})

describe('daysBetween', () => {
  it('includes both ends', () => {
    expect(daysBetween('2026-08-01', '2026-08-03')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ])
  })

  it('is empty when the range is backwards or unparseable', () => {
    expect(daysBetween('2026-08-03', '2026-08-01')).toEqual([])
    expect(daysBetween('not-a-date', '2026-08-01')).toEqual([])
  })
})

describe('transitions', () => {
  const project = reduceOperations([
    ...statusOperations(),
    op('a', 10, { kind: 'item.create', item: anItem('1') }, at(0)),
    op('a', 11, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, at(1)),
    op('a', 12, { kind: 'item.move', itemId: '1', statusId: 'done', order: 'a1' }, at(3)),
  ])

  const log = [
    ...statusOperations(),
    op('a', 10, { kind: 'item.create', item: anItem('1') }, at(0)),
    op('a', 11, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, at(1)),
    op('a', 12, { kind: 'item.move', itemId: '1', statusId: 'done', order: 'a1' }, at(3)),
  ]

  it('reads categories, so renaming a column does not break the history', () => {
    expect(transitions(project, log).map((entry) => entry.category)).toEqual([
      'todo',
      'in-progress',
      'done',
    ])
  })

  it('skips a move into a status the project no longer has', () => {
    // Counting a deleted column as work in progress would be a quiet lie.
    const withGhost = [
      ...log,
      op('a', 13, { kind: 'item.move', itemId: '1', statusId: 'ghost', order: 'a1' }, at(4)),
    ]
    expect(transitions(project, withGhost)).toHaveLength(3)
  })
})

describe('cumulativeFlow', () => {
  it('reconstructs each day from the log, including days nobody was looking', () => {
    const log = [
      ...statusOperations(),
      op('a', 10, { kind: 'item.create', item: anItem('1') }, at(0)),
      op('a', 11, { kind: 'item.create', item: anItem('2') }, at(0)),
      op('a', 12, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, at(1)),
      op('a', 13, { kind: 'item.move', itemId: '1', statusId: 'done', order: 'a1' }, at(3)),
    ]
    const project = reduceOperations(log)

    const flow = cumulativeFlow(project, log, '2026-08-01', '2026-08-04')

    expect(flow).toEqual([
      { day: '2026-08-01', todo: 2, inProgress: 0, done: 0 },
      { day: '2026-08-02', todo: 1, inProgress: 1, done: 0 },
      // Nothing happened on the 3rd; the chart still has a point for it.
      { day: '2026-08-03', todo: 1, inProgress: 1, done: 0 },
      { day: '2026-08-04', todo: 1, inProgress: 0, done: 1 },
    ])
  })
})

describe('throughput', () => {
  it('counts completions per day and keeps the empty days', () => {
    const items = [
      anItem('1', { completedAt: at(0, 9) }),
      anItem('2', { completedAt: at(0, 17) }),
      anItem('3', { completedAt: at(2) }),
      anItem('4'),
    ]
    expect(throughput(items, '2026-08-01', '2026-08-03')).toEqual([
      { day: '2026-08-01', count: 2 },
      { day: '2026-08-02', count: 0 },
      { day: '2026-08-03', count: 1 },
    ])
  })
})

describe('burndown', () => {
  const iteration: Iteration = {
    id: 'sprint-1',
    name: 'Sprint 1',
    goal: 'Ship the board',
    startsAt: '2026-08-01',
    endsAt: '2026-08-05',
    capacity: 10,
    order: 'a0',
  }

  const project = reduceOperations([
    ...statusOperations(),
    op('a', 10, {
      kind: 'item.create',
      item: anItem('1', { estimate: 5, iterationId: 'sprint-1', createdAt: at(0) }),
    }),
    op('a', 11, {
      kind: 'item.create',
      item: anItem('2', { estimate: 3, iterationId: 'sprint-1', createdAt: at(0) }),
    }),
    op('a', 12, {
      kind: 'item.create',
      // Added mid-sprint: this is the scope change the chart must expose.
      item: anItem('3', { estimate: 2, iterationId: 'sprint-1', createdAt: at(2) }),
    }),
    op('a', 13, { kind: 'item.move', itemId: '1', statusId: 'done', order: 'a1' }, at(1)),
    ...[{ kind: 'iteration.upsert' as const, iteration }].map((body) => op('a', 9, body)),
  ])

  const chart = burndown(project, iteration, at(10))

  it('has a point for every day of the sprint', () => {
    expect(chart).toHaveLength(5)
  })

  it('starts at the committed total and draws an ideal line to zero', () => {
    expect(chart[0]?.ideal).toBe(10)
    expect(chart.at(-1)?.ideal).toBe(0)
  })

  it('burns down as work completes', () => {
    // 8 points on day one, 5 remaining after the 5-point item finishes.
    expect(chart[0]?.remaining).toBe(8)
    expect(chart[1]?.remaining).toBe(3)
  })

  it('shows scope added mid-sprint rather than hiding it in the remaining line', () => {
    // Without this, a sprint that grew looks like a team that stalled.
    expect(chart[2]?.scopeChange).toBe(2)
    expect(chart[2]?.remaining).toBe(5)
  })

  it('does not draw the future', () => {
    const running = burndown(project, iteration, at(1))
    expect(Number.isNaN(running[3]?.remaining ?? 0)).toBe(true)
  })

  it('is empty for a sprint whose dates make no sense', () => {
    expect(burndown(project, { ...iteration, endsAt: '2026-07-01' }, at(10))).toEqual([])
  })
})

describe('velocity', () => {
  const iterations: readonly Iteration[] = [
    {
      id: 's1',
      name: 'S1',
      goal: '',
      startsAt: '2026-07-01',
      endsAt: '2026-07-14',
      capacity: null,
      order: 'a0',
    },
    {
      id: 's2',
      name: 'S2',
      goal: '',
      startsAt: '2026-07-15',
      endsAt: '2026-07-28',
      capacity: null,
      order: 'a1',
    },
    {
      id: 's3',
      name: 'S3',
      goal: '',
      startsAt: '2026-08-01',
      endsAt: '2026-08-14',
      capacity: null,
      order: 'a2',
    },
  ]

  const project = reduceOperations([
    ...statusOperations(),
    ...iterations.map((iteration, index) =>
      op('a', index + 1, { kind: 'iteration.upsert', iteration }),
    ),
    op('a', 10, {
      kind: 'item.create',
      item: anItem('1', { estimate: 8, iterationId: 's1', completedAt: at(-20) }),
    }),
    op('a', 11, {
      kind: 'item.create',
      item: anItem('2', { estimate: 5, iterationId: 's2', completedAt: at(-5) }),
    }),
    op('a', 12, { kind: 'item.create', item: anItem('3', { estimate: 3, iterationId: 's2' }) }),
    op('a', 13, { kind: 'item.create', item: anItem('4', { estimate: 13, iterationId: 's3' }) }),
  ])

  it('reports committed against completed for each iteration', () => {
    expect(velocity(project)).toEqual([
      { iterationId: 's1', name: 'S1', committed: 8, completed: 8 },
      { iterationId: 's2', name: 'S2', committed: 8, completed: 5 },
      { iterationId: 's3', name: 'S3', committed: 13, completed: 0 },
    ])
  })

  it('excludes the sprint still running, which would drag the average down', () => {
    // S3 is in flight on 2026-08-05, so only S1 and S2 count.
    expect(averageVelocity(project, at(4))).toBe(6.5)
  })

  it('has no average before any sprint has finished', () => {
    expect(averageVelocity(project, Date.parse('2026-06-01T00:00:00Z'))).toBeNull()
  })
})

describe('isoDay', () => {
  it('is stable within a day regardless of the hour', () => {
    expect(isoDay(at(0, 1))).toBe(isoDay(at(0, 23)))
  })
})

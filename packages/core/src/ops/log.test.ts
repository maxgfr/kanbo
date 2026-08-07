import { describe, expect, it } from 'vitest'

import {
  COALESCE_WINDOW,
  appendLocal,
  compareOperations,
  devicesIn,
  mergeLogs,
  nextLamport,
  operationsOf,
  supersedes,
} from './log.ts'
import { anItem, op } from './testing.ts'

const a1 = op('device-a', 1, { kind: 'item.create', item: anItem('1') })
const a2 = op('device-a', 2, { kind: 'item.set', itemId: '1', patch: { title: 'A' } })
const b1 = op('device-b', 1, { kind: 'item.create', item: anItem('2') })
const b3 = op('device-b', 3, { kind: 'item.set', itemId: '2', patch: { title: 'B' } })

/**
 * These three properties together *are* "every device converges". If merging is
 * idempotent, commutative and associative, then no amount of re-sending,
 * re-ordering or re-grouping of operations can make two devices disagree.
 */
describe('mergeLogs algebra', () => {
  it('is idempotent — receiving the same operations twice changes nothing', () => {
    const once = mergeLogs([a1, a2, b1])
    expect(mergeLogs(once, once)).toEqual(once)
    expect(mergeLogs(once, [a1], [a2])).toEqual(once)
  })

  it('is commutative — which device pulled first does not matter', () => {
    expect(mergeLogs([a1, a2], [b1, b3])).toEqual(mergeLogs([b1, b3], [a1, a2]))
  })

  it('is associative — how the pulls were batched does not matter', () => {
    const left = mergeLogs(mergeLogs([a1], [a2]), [b1, b3])
    const right = mergeLogs([a1], mergeLogs([a2], [b1, b3]))
    expect(left).toEqual(right)
  })

  it('drops duplicates by operation id', () => {
    expect(mergeLogs([a1, a1, a1])).toHaveLength(1)
  })
})

describe('compareOperations', () => {
  it('orders by Lamport counter first', () => {
    expect(compareOperations(a1, b3)).toBeLessThan(0)
  })

  it('breaks a tie by device id, so every device agrees', () => {
    // Same counter means the two operations are concurrent: neither saw the
    // other. Any stable rule works; what matters is that it is the same rule
    // everywhere.
    expect(compareOperations(a1, b1)).toBeLessThan(0)
    expect(compareOperations(b1, a1)).toBeGreaterThan(0)
  })

  it('ignores wall-clock time, so a skewed clock cannot reorder history', () => {
    const early = op('device-a', 5, { kind: 'item.delete', itemId: '1' }, 0)
    const late = op('device-a', 4, { kind: 'item.delete', itemId: '2' }, 9_999_999)
    expect(compareOperations(late, early)).toBeLessThan(0)
  })
})

describe('nextLamport', () => {
  it('starts at one for an empty log', () => {
    expect(nextLamport([])).toBe(1)
  })

  it('is one past everything seen, including other devices', () => {
    expect(nextLamport([a1, a2, b3])).toBe(4)
  })

  it('jumps ahead after pulling a log from further along', () => {
    // A device that has been offline must not issue operations that order
    // before what it just read.
    const far = op('device-c', 500, { kind: 'item.delete', itemId: '1' })
    expect(nextLamport([a1, far])).toBe(501)
  })
})

describe('per-device slicing', () => {
  it('returns just that device"s operations, in order', () => {
    const log = mergeLogs([a1, a2], [b1, b3])
    expect(operationsOf(log, 'device-a')).toEqual([a1, a2])
  })

  it('lists every device that ever wrote', () => {
    expect(devicesIn(mergeLogs([a1], [b1]))).toEqual(['device-a', 'device-b'])
  })
})

/**
 * Text fields emit on every keystroke, so that the board can never show
 * something the log cannot reproduce. Folding a run of them back into one edit
 * is what keeps that from turning a history into a keylogger.
 */
const title = (lamport: number, value: string, at?: number) =>
  op('device-a', lamport, { kind: 'item.set', itemId: '1', patch: { title: value } }, at)

const sprintGoal = (lamport: number, text: string) =>
  op('device-a', lamport, {
    kind: 'iteration.upsert',
    iteration: {
      id: 'sprint-1',
      name: 'Sprint 1',
      goal: text,
      startsAt: '2026-01-01',
      endsAt: '2026-01-14',
      capacity: null,
      order: 'a',
    },
  })

describe('supersedes', () => {
  it('folds one keystroke into the one before it', () => {
    expect(supersedes(title(1, 'Shi'), title(2, 'Ship'))).toBe(true)
  })

  it('will not fold across devices, whatever the fields say', () => {
    const mine = title(1, 'Shi')
    const theirs = op('device-b', 2, { kind: 'item.set', itemId: '1', patch: { title: 'Ship' } })
    expect(supersedes(mine, theirs)).toBe(false)
  })

  it('will not fold two different items together', () => {
    const other = op('device-a', 2, { kind: 'item.set', itemId: '2', patch: { title: 'Ship' } })
    expect(supersedes(title(1, 'Shi'), other)).toBe(false)
  })

  it('will not fold patches that touch different fields', () => {
    // The earlier one is the only record that the estimate changed; dropping it
    // would lose the value rather than merely tidy the history.
    const estimate = op('device-a', 1, { kind: 'item.set', itemId: '1', patch: { estimate: 3 } })
    expect(supersedes(estimate, title(2, 'Ship'))).toBe(false)
  })

  it('stops folding once the pause is long enough to be a second edit', () => {
    const first = title(1, 'Ship', 1000)
    expect(supersedes(first, title(2, 'Shipped', 1000 + COALESCE_WINDOW))).toBe(true)
    expect(supersedes(first, title(2, 'Shipped', 1000 + COALESCE_WINDOW + 1))).toBe(false)
  })

  it('never folds a move, because a card that visited three columns did', () => {
    const first = op('device-a', 1, {
      kind: 'item.move',
      itemId: '1',
      statusId: 'doing',
      order: 'a',
    })
    const second = op('device-a', 2, {
      kind: 'item.move',
      itemId: '1',
      statusId: 'done',
      order: 'b',
    })
    expect(supersedes(first, second)).toBe(false)
  })

  it('folds repeated upserts of one entity, which carry the whole thing', () => {
    expect(supersedes(sprintGoal(1, 'Shi'), sprintGoal(2, 'Ship'))).toBe(true)
  })
})

describe('appendLocal', () => {
  it('writes one operation for a word typed a letter at a time', () => {
    let state = appendLocal([a1], [title(2, 'S')])
    for (const [lamport, value] of [
      [3, 'Sh'],
      [4, 'Shi'],
      [5, 'Ship'],
    ] as const) {
      state = appendLocal(state.log, [title(lamport, value)], {
        supersedable: state.supersedable,
      })
    }

    expect(state.log).toHaveLength(2)
    expect(state.log.at(-1)).toMatchObject({ patch: { title: 'Ship' } })
  })

  it('keeps the last value, so nothing typed is lost', () => {
    const first = appendLocal([], [title(1, 'Shi')])
    const second = appendLocal(first.log, [title(2, 'Ship')], {
      supersedable: first.supersedable,
    })
    expect(second.log.at(-1)).toMatchObject({ patch: { title: 'Ship' } })
  })

  it('refuses to fold into an operation the caller has stopped offering', () => {
    // Which is how a sync says "that one has left this machine".
    const first = appendLocal([], [title(1, 'Shi')])
    const second = appendLocal(first.log, [title(2, 'Ship')], { supersedable: null })
    expect(second.log).toHaveLength(2)
  })

  it('never folds a batch, because a batch is one deliberate gesture', () => {
    const first = appendLocal([], [title(1, 'Shi')])
    const batch = appendLocal(
      first.log,
      [title(2, 'Ship'), op('device-a', 3, { kind: 'item.delete', itemId: '2' })],
      { supersedable: first.supersedable },
    )
    expect(batch.log).toHaveLength(3)
    expect(batch.supersedable).toBeNull()
  })

  it('leaves the log alone when there is nothing to append', () => {
    const log = mergeLogs([a1, a2])
    expect(appendLocal(log, []).log).toBe(log)
  })

  it('leaves merging alone — the union stays the union', () => {
    // Superseding belongs to authoring. If it leaked into the merge, whether an
    // operation survived would depend on what else arrived in the same pull,
    // and convergence would go with it.
    const typed = appendLocal([], [title(1, 'Shi')])
    const folded = appendLocal(typed.log, [title(2, 'Ship')], {
      supersedable: typed.supersedable,
    })
    // A device that already had the superseded operation keeps it on merge.
    expect(mergeLogs(folded.log, [title(1, 'Shi')])).toHaveLength(2)
  })
})

import { describe, expect, it } from 'vitest'

import { compareOperations, devicesIn, mergeLogs, nextLamport, operationsOf } from './log.ts'
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

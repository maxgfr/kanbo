import { describe, expect, it } from 'vitest'

import { itemById } from '../model/project'
import { keyBetween } from '../order/fractional'
import { mergeLogs } from './log'
import { reduceOperations } from './reduce'
import { anItem, op, statusOperations } from './testing'

const seed = statusOperations()
const create = op('device-a', 10, { kind: 'item.create', item: anItem('1') })
const base = [...seed, create]

function itemAfter(...logs: readonly (readonly (typeof create)[])[]) {
  return itemById(reduceOperations(mergeLogs(...logs)), '1')
}

describe('folding', () => {
  it('is independent of the order operations arrive in', () => {
    const shuffled = base.toReversed()
    expect(reduceOperations(shuffled)).toEqual(reduceOperations(base))
  })

  it('ignores an operation for an item that was deleted', () => {
    // Not an error: one device deleted while another was still editing. A
    // reducer that threw here would leave that device unable to read the log.
    const log = [
      ...base,
      op('device-a', 11, { kind: 'item.delete', itemId: '1' }),
      op('device-b', 12, { kind: 'item.set', itemId: '1', patch: { title: 'ghost' } }),
    ]
    expect(reduceOperations(log).items).toHaveLength(0)
  })

  it('does not duplicate an item when a create is replayed', () => {
    expect(reduceOperations([...base, create]).items).toHaveLength(1)
  })
})

describe('last write wins, per field', () => {
  it('keeps both edits when two devices change different fields', () => {
    // The reason patches name only the fields they touch. Entity-level LWW
    // would silently discard one of these.
    const a = [op('device-a', 11, { kind: 'item.set', itemId: '1', patch: { title: 'Renamed' } })]
    const b = [op('device-b', 11, { kind: 'item.set', itemId: '1', patch: { priority: 'p0' } })]

    const item = itemAfter(base, a, b)
    expect(item?.title).toBe('Renamed')
    expect(item?.priority).toBe('p0')
  })

  it('resolves a genuine conflict the same way on every device', () => {
    const a = [op('device-a', 11, { kind: 'item.set', itemId: '1', patch: { title: 'from A' } })]
    const b = [op('device-b', 12, { kind: 'item.set', itemId: '1', patch: { title: 'from B' } })]

    // Later Lamport wins, and pulling in either order gives the same answer.
    expect(itemAfter(base, a, b)?.title).toBe('from B')
    expect(itemAfter(base, b, a)?.title).toBe('from B')
  })

  it('settles a truly concurrent edit deterministically', () => {
    // Identical counters: neither device saw the other. The device-id tie-break
    // decides, and it decides identically everywhere.
    const a = [op('device-a', 11, { kind: 'item.set', itemId: '1', patch: { title: 'from A' } })]
    const b = [op('device-b', 11, { kind: 'item.set', itemId: '1', patch: { title: 'from B' } })]

    expect(itemAfter(base, a, b)?.title).toBe('from B')
    expect(itemAfter(base, b, a)?.title).toBe('from B')
  })
})

describe('concurrent moves', () => {
  it('keeps both cards inside the gap they were dropped into', () => {
    const left = keyBetween(null, null)
    const right = keyBetween(left, null)

    const log = [
      ...seed,
      op('device-a', 10, { kind: 'item.create', item: anItem('1', { order: left }) }),
      op('device-a', 11, { kind: 'item.create', item: anItem('2', { order: right }) }),
      op('device-a', 12, { kind: 'item.create', item: anItem('3') }),
      op('device-a', 13, {
        kind: 'item.move',
        itemId: '3',
        statusId: 'doing',
        order: keyBetween(left, right),
      }),
      op('device-b', 13, {
        kind: 'item.create',
        item: anItem('4', { order: keyBetween(left, right) }),
      }),
    ]

    const project = reduceOperations(mergeLogs(log))
    for (const id of ['3', '4']) {
      const order = itemById(project, id)?.order ?? ''
      expect(order > left, `${id} escaped below the gap`).toBe(true)
      expect(order < right, `${id} escaped above the gap`).toBe(true)
    }
  })

  it('applies a move and an unrelated edit from two devices at once', () => {
    const a = [
      op('device-a', 11, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a5' }),
    ]
    const b = [op('device-b', 11, { kind: 'item.set', itemId: '1', patch: { estimate: 5 } })]

    const item = itemAfter(base, a, b)
    expect(item?.statusId).toBe('doing')
    expect(item?.estimate).toBe(5)
  })
})

describe('derived timestamps', () => {
  it('starts the clock when an item first enters an in-progress status', () => {
    const log = [
      ...base,
      op('device-a', 11, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, 5000),
    ]
    expect(itemById(reduceOperations(log), '1')?.startedAt).toBe(5000)
  })

  it('does not restart the clock when moving between two in-progress statuses', () => {
    // "In Review" is still work in progress; cycle time must not reset.
    const log = [
      ...base,
      op('device-a', 11, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, 5000),
      op('device-a', 12, { kind: 'item.move', itemId: '1', statusId: 'review', order: 'a1' }, 9000),
    ]
    expect(itemById(reduceOperations(log), '1')?.startedAt).toBe(5000)
  })

  it('records completion when an item reaches a done status', () => {
    const log = [
      ...base,
      op('device-a', 11, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, 5000),
      op('device-a', 12, { kind: 'item.move', itemId: '1', statusId: 'done', order: 'a1' }, 8000),
    ]
    const item = itemById(reduceOperations(log), '1')
    expect(item?.startedAt).toBe(5000)
    expect(item?.completedAt).toBe(8000)
  })

  it('clears completion when a done item is reopened', () => {
    const log = [
      ...base,
      op('device-a', 11, { kind: 'item.move', itemId: '1', statusId: 'done', order: 'a1' }, 5000),
      op('device-a', 12, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, 6000),
    ]
    const item = itemById(reduceOperations(log), '1')
    expect(item?.completedAt).toBeNull()
    expect(item?.startedAt).toBe(5000)
  })

  it('clears both when an item is pulled back to the backlog', () => {
    // Work that was un-started had no cycle; leaving startedAt set would make
    // its eventual cycle time a lie.
    const log = [
      ...base,
      op('device-a', 11, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, 5000),
      op('device-a', 12, { kind: 'item.move', itemId: '1', statusId: 'todo', order: 'a1' }, 6000),
    ]
    const item = itemById(reduceOperations(log), '1')
    expect(item?.startedAt).toBeNull()
    expect(item?.completedAt).toBeNull()
  })

  it('leaves the item put when the status is not known yet', () => {
    // The status operation has not arrived. Moving into a column that cannot be
    // rendered would strand the card.
    const log = [
      ...base,
      op('device-b', 11, { kind: 'item.move', itemId: '1', statusId: 'unknown', order: 'a1' }),
    ]
    expect(itemById(reduceOperations(log), '1')?.statusId).toBe('todo')
  })
})

describe('cascades', () => {
  it('moves items out of a deleted status rather than orphaning them', () => {
    const log = [
      ...base,
      op('device-a', 11, { kind: 'status.delete', statusId: 'todo', moveToId: 'doing' }),
    ]
    const project = reduceOperations(log)
    expect(project.statuses.some((status) => status.id === 'todo')).toBe(false)
    expect(itemById(project, '1')?.statusId).toBe('doing')
  })

  it('refuses to delete a status when the destination does not exist', () => {
    const log = [
      ...base,
      op('device-a', 11, { kind: 'status.delete', statusId: 'todo', moveToId: 'nowhere' }),
    ]
    expect(reduceOperations(log).statuses).toHaveLength(4)
  })

  it('detaches items from a deleted iteration', () => {
    const iteration = {
      id: 'sprint-1',
      name: 'Sprint 1',
      goal: '',
      startsAt: '2026-08-01',
      endsAt: '2026-08-15',
      capacity: null,
      order: 'a0',
    }
    const log = [
      ...base,
      op('device-a', 11, { kind: 'iteration.upsert', iteration }),
      op('device-a', 12, { kind: 'item.set', itemId: '1', patch: { iterationId: 'sprint-1' } }),
      op('device-a', 13, { kind: 'iteration.delete', iterationId: 'sprint-1' }),
    ]
    expect(itemById(reduceOperations(log), '1')?.iterationId).toBeNull()
  })

  it('strips a deleted field from every item that carried it', () => {
    const field = {
      id: 'risk',
      name: 'Risk',
      type: 'select' as const,
      options: ['low', 'high'],
      order: 'a0',
    }
    const log = [
      ...base,
      op('device-a', 11, { kind: 'field.upsert', field }),
      op('device-a', 12, { kind: 'item.setField', itemId: '1', fieldId: 'risk', value: 'high' }),
      op('device-a', 13, { kind: 'field.delete', fieldId: 'risk' }),
    ]
    expect(itemById(reduceOperations(log), '1')?.fields).toEqual({})
  })
})

describe('links', () => {
  it('does not add the same link twice', () => {
    const link = { type: 'blocks' as const, itemId: '2' }
    const log = [
      ...base,
      op('device-a', 11, { kind: 'item.link', itemId: '1', link }),
      op('device-b', 12, { kind: 'item.link', itemId: '1', link }),
    ]
    expect(itemById(reduceOperations(log), '1')?.links).toHaveLength(1)
  })

  it('removes only the named link', () => {
    const log = [
      ...base,
      op('device-a', 11, { kind: 'item.link', itemId: '1', link: { type: 'blocks', itemId: '2' } }),
      op('device-a', 12, {
        kind: 'item.link',
        itemId: '1',
        link: { type: 'relates-to', itemId: '2' },
      }),
      op('device-a', 13, { kind: 'item.unlink', itemId: '1', targetId: '2', linkType: 'blocks' }),
    ]
    expect(itemById(reduceOperations(log), '1')?.links).toEqual([
      { type: 'relates-to', itemId: '2' },
    ])
  })
})

describe('two devices, offline and then reconnected', () => {
  it('converges on the same project whichever side syncs first', () => {
    const shared = [...base]

    // Both go offline and work from the same starting point.
    const alice = [
      op('device-a', 11, { kind: 'item.set', itemId: '1', patch: { title: 'Alice edit' } }),
      op('device-a', 12, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }),
      op('device-a', 13, { kind: 'item.create', item: anItem('a-new') }),
    ]
    const bob = [
      op('device-b', 11, { kind: 'item.set', itemId: '1', patch: { estimate: 8 } }),
      op('device-b', 12, { kind: 'item.create', item: anItem('b-new') }),
      op('device-b', 14, { kind: 'item.set', itemId: '1', patch: { priority: 'p0' } }),
    ]

    const aliceSees = reduceOperations(mergeLogs(shared, alice, bob))
    const bobSees = reduceOperations(mergeLogs(shared, bob, alice))

    expect(aliceSees).toEqual(bobSees)

    // And nobody's work was lost.
    const item = itemById(aliceSees, '1')
    expect(item?.title).toBe('Alice edit')
    expect(item?.estimate).toBe(8)
    expect(item?.priority).toBe('p0')
    expect(item?.statusId).toBe('doing')
    expect(aliceSees.items).toHaveLength(3)
  })
})

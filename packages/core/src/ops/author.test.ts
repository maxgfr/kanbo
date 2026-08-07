import { describe, expect, it } from 'vitest'

import { itemsInStatus } from '../model/project.ts'
import type { Project } from '../model/types.ts'
import { byOrder, keysBetween } from '../order/fractional.ts'
import type { Ports } from '../ports/index.ts'
import { newItem, operationBuilder, orderForDrop, wouldCycle } from './author.ts'
import { mergeLogs } from './log.ts'
import { reduceOperations } from './reduce.ts'
import { anItem, op, statusOperations } from './testing.ts'

/** Deterministic ports: ids count up, the clock ticks a second at a time. */
function testPorts(): Ports {
  let id = 0
  let now = 1_000_000
  return {
    clock: { now: () => (now += 1000) },
    random: { id: () => `id-${++id}` },
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      keys: async () => [],
      clear: async () => {},
    },
  }
}

const orders = keysBetween(null, null, 3)
const project: Project = reduceOperations([
  ...statusOperations(),
  op('seed', 10, { kind: 'item.create', item: anItem('a', { order: orders[0]! }) }),
  op('seed', 11, { kind: 'item.create', item: anItem('b', { order: orders[1]! }) }),
  op('seed', 12, { kind: 'item.create', item: anItem('c', { order: orders[2]! }) }),
])

/** Apply a drop and read back the resulting column, top to bottom. */
function columnAfterDrop(itemId: string, index: number): readonly string[] {
  const order = orderForDrop(project, itemId, 'todo', index)
  const moved = reduceOperations(
    mergeLogs([
      ...statusOperations(),
      ...project.items.map((item, i) => op('seed', 10 + i, { kind: 'item.create', item })),
      op('device-a', 100, { kind: 'item.move', itemId, statusId: 'todo', order }),
    ]),
  )
  return [...itemsInStatus(moved, 'todo')].toSorted(byOrder).map((item) => item.id)
}

describe('orderForDrop', () => {
  it('moves a card down past its neighbour', () => {
    // The subtle case: the dragged card must be taken out of the column before
    // its new neighbours are read. Leaving it in makes the card compute a key
    // from itself and never actually move.
    expect(columnAfterDrop('a', 1)).toEqual(['b', 'a', 'c'])
  })

  it('moves a card up past its neighbour', () => {
    expect(columnAfterDrop('c', 1)).toEqual(['a', 'c', 'b'])
  })

  it('drops a card at the top', () => {
    expect(columnAfterDrop('c', 0)).toEqual(['c', 'a', 'b'])
  })

  it('drops a card at the bottom', () => {
    expect(columnAfterDrop('a', 2)).toEqual(['b', 'c', 'a'])
  })

  it('clamps an index past the end rather than throwing', () => {
    expect(columnAfterDrop('a', 99)).toEqual(['b', 'c', 'a'])
  })

  it('places the first card of an empty column', () => {
    expect(() => orderForDrop(project, 'a', 'doing', 0)).not.toThrow()
  })
})

describe('newItem', () => {
  it('lands at the top of its column', () => {
    const created = newItem(project, testPorts(), { title: 'New' })
    const top = [...itemsInStatus(project, created.statusId)].toSorted(byOrder)[0]
    expect(created.order < (top?.order ?? 'zz')).toBe(true)
  })

  it('takes the reference from the project counter', () => {
    const created = newItem({ ...project, key: 'KAN', nextRef: 42 }, testPorts(), { title: 'New' })
    expect(created.ref).toBe('KAN-42')
  })

  it('defaults to the first status', () => {
    expect(newItem(project, testPorts(), { title: 'New' }).statusId).toBe('todo')
  })
})

describe('operationBuilder', () => {
  it('advances the counter within a batch so a gesture orders against itself', () => {
    const emit = operationBuilder(testPorts(), { deviceId: 'device-a', authorId: null }, [])
    const first = emit({ kind: 'item.delete', itemId: '1' })
    const second = emit({ kind: 'item.delete', itemId: '2' })
    expect(second.lamport).toBeGreaterThan(first.lamport)
  })

  it('starts past everything already seen', () => {
    const log = [op('device-b', 77, { kind: 'item.delete', itemId: '1' })]
    const emit = operationBuilder(testPorts(), { deviceId: 'device-a', authorId: null }, log)
    expect(emit({ kind: 'item.delete', itemId: '2' }).lamport).toBe(78)
  })
})

describe('wouldCycle', () => {
  const linked = reduceOperations([
    ...statusOperations(),
    op('seed', 10, { kind: 'item.create', item: anItem('a') }),
    op('seed', 11, { kind: 'item.create', item: anItem('b') }),
    op('seed', 12, { kind: 'item.create', item: anItem('c') }),
    op('seed', 13, { kind: 'item.link', itemId: 'a', link: { type: 'blocks', itemId: 'b' } }),
    op('seed', 14, { kind: 'item.link', itemId: 'b', link: { type: 'blocks', itemId: 'c' } }),
  ])

  it('rejects an item blocking itself', () => {
    expect(wouldCycle(linked, 'a', 'a')).toBe(true)
  })

  it('rejects closing a chain into a loop', () => {
    // a → b → c already; c → a would make the critical path non-terminating.
    expect(wouldCycle(linked, 'c', 'a')).toBe(true)
  })

  it('allows a link that keeps the graph acyclic', () => {
    expect(wouldCycle(linked, 'a', 'c')).toBe(false)
  })

  it('ignores non-blocking links, which may form loops freely', () => {
    const related = reduceOperations([
      ...statusOperations(),
      op('seed', 10, { kind: 'item.create', item: anItem('a') }),
      op('seed', 11, { kind: 'item.create', item: anItem('b') }),
      op('seed', 12, { kind: 'item.link', itemId: 'a', link: { type: 'relates-to', itemId: 'b' } }),
    ])
    expect(wouldCycle(related, 'b', 'a')).toBe(false)
  })

  it('terminates on a graph that is already cyclic', () => {
    // Defensive: a log written by an older build could contain a cycle, and the
    // traversal must not hang while telling us so.
    const cyclic = reduceOperations([
      ...statusOperations(),
      op('seed', 10, { kind: 'item.create', item: anItem('a') }),
      op('seed', 11, { kind: 'item.create', item: anItem('b') }),
      op('seed', 12, { kind: 'item.link', itemId: 'a', link: { type: 'blocks', itemId: 'b' } }),
      op('seed', 13, { kind: 'item.link', itemId: 'b', link: { type: 'blocks', itemId: 'a' } }),
    ])
    expect(wouldCycle(cyclic, 'a', 'b')).toBe(true)
  })
})

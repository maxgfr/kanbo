import { describe, expect, it } from 'vitest'

import { activity, history, historyOf } from './history.ts'
import { anItem, op, statusOperations } from './testing.ts'

const seed = statusOperations()

const log = [
  ...seed,
  op('device-a', 10, { kind: 'item.create', item: anItem('1', { title: 'First' }) }, 1000),
  op('device-a', 11, { kind: 'item.set', itemId: '1', patch: { title: 'Renamed' } }, 2000),
  op('device-b', 12, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a1' }, 3000),
  op('device-b', 13, { kind: 'item.move', itemId: '1', statusId: 'doing', order: 'a5' }, 4000),
  op('device-a', 14, { kind: 'item.set', itemId: '1', patch: { estimate: 5 } }, 5000),
]

describe('history', () => {
  it('is newest first, because a feed is read from the top', () => {
    const entries = history(log)
    expect(entries[0]?.at).toBe(5000)
  })

  it('reports what a field was as well as what it became', () => {
    // The operation only records the new value, so the old one has to be
    // derived by folding forward — there is no other way to know it.
    const renamed = history(log).find(
      (entry) => entry.change.kind === 'field' && entry.change.field === 'title',
    )
    expect(renamed?.change).toEqual({ kind: 'field', field: 'title', from: 'First', to: 'Renamed' })
  })

  it('distinguishes a status change from a reorder', () => {
    // Conflating them makes a busy board's history unreadable.
    const changes = history(log).map((entry) => entry.change.kind)
    expect(changes).toContain('moved')
    expect(changes).toContain('reordered')
  })

  it('names the column an item came from', () => {
    const moved = history(log).find((entry) => entry.change.kind === 'moved')
    expect(moved?.change).toMatchObject({ fromStatusId: 'todo', toStatusId: 'doing' })
  })

  it('carries who and when', () => {
    const moved = history(log).find((entry) => entry.change.kind === 'moved')
    expect(moved).toMatchObject({ deviceId: 'device-b', at: 3000, itemId: '1' })
  })

  it('does not report a patch that changed nothing', () => {
    // A feed full of "title: X → X" is a feed nobody reads.
    const noop = [
      ...seed,
      op('a', 10, { kind: 'item.create', item: anItem('1', { title: 'Same' }) }),
      op('a', 11, { kind: 'item.set', itemId: '1', patch: { title: 'Same' } }),
    ]
    expect(history(noop).filter((entry) => entry.change.kind === 'field')).toEqual([])
  })

  it('treats an unchanged list as unchanged', () => {
    const lists = [
      ...seed,
      op('a', 10, { kind: 'item.create', item: anItem('1', { labels: ['x', 'y'] }) }),
      op('a', 11, { kind: 'item.set', itemId: '1', patch: { labels: ['x', 'y'] } }),
      op('a', 12, { kind: 'item.set', itemId: '1', patch: { labels: ['x'] } }),
    ]
    expect(history(lists).filter((entry) => entry.change.kind === 'field')).toHaveLength(1)
  })

  it('still shows a deletion after the item is gone from the board', () => {
    // The board forgets; the log does not.
    const deleted = [
      ...seed,
      op('a', 10, { kind: 'item.create', item: anItem('1') }),
      op('a', 11, { kind: 'item.delete', itemId: '1' }),
    ]
    expect(history(deleted).map((entry) => entry.change.kind)).toContain('deleted')
  })

  it('ignores an edit to an item that was already deleted', () => {
    const late = [
      ...seed,
      op('a', 10, { kind: 'item.create', item: anItem('1') }),
      op('a', 11, { kind: 'item.delete', itemId: '1' }),
      op('b', 12, { kind: 'item.set', itemId: '1', patch: { title: 'ghost' } }),
    ]
    expect(late).toBeDefined()
    expect(history(late).filter((entry) => entry.change.kind === 'field')).toEqual([])
  })

  it('records links in both directions of the relationship', () => {
    const linked = [
      ...seed,
      op('a', 10, { kind: 'item.create', item: anItem('1') }),
      op('a', 11, { kind: 'item.link', itemId: '1', link: { type: 'blocked-by', itemId: '2' } }),
      op('a', 12, { kind: 'item.unlink', itemId: '1', targetId: '2', linkType: 'blocked-by' }),
    ]
    const kinds = history(linked).map((entry) => entry.change.kind)
    expect(kinds).toContain('linked')
    expect(kinds).toContain('unlinked')
  })

  it('reads a custom field change', () => {
    const custom = [
      ...seed,
      op('a', 10, { kind: 'item.create', item: anItem('1') }),
      op('a', 11, { kind: 'item.setField', itemId: '1', fieldId: 'risk', value: 'high' }),
      op('a', 12, { kind: 'item.setField', itemId: '1', fieldId: 'risk', value: 'low' }),
    ]
    const entries = history(custom).filter(
      (entry) => entry.change.kind === 'field' && entry.change.field === 'risk',
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]?.change).toMatchObject({ from: 'high', to: 'low' })
  })

  it('returns nothing for an empty log', () => {
    expect(history([])).toEqual([])
  })
})

describe('historyOf', () => {
  it('is one item"s story and nobody else"s', () => {
    const two = [
      ...seed,
      op('a', 10, { kind: 'item.create', item: anItem('1') }),
      op('a', 11, { kind: 'item.create', item: anItem('2') }),
      op('a', 12, { kind: 'item.set', itemId: '2', patch: { title: 'Other' } }),
    ]
    expect(historyOf(two, '1')).toHaveLength(1)
  })
})

describe('activity', () => {
  it('leaves reordering out, which would otherwise bury everything else', () => {
    expect(activity(log).map((entry) => entry.change.kind)).not.toContain('reordered')
  })

  it('honours a limit, so a long-lived board still renders', () => {
    const many = [
      ...seed,
      ...Array.from({ length: 50 }, (_, at) =>
        op('a', 100 + at, { kind: 'item.create', item: anItem(`i${at}`) }),
      ),
    ]
    expect(activity(many, 10)).toHaveLength(10)
  })
})

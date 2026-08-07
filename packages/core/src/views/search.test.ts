import { describe, expect, it } from 'vitest'

import { DAY } from '../metrics/flow.ts'
import { reduceOperations } from '../ops/reduce.ts'
import { anItem, op, statusOperations } from '../ops/testing.ts'
import { type SearchContext, search, tokenise } from './search.ts'

const NOW = Date.parse('2026-08-07T12:00:00Z')

const project = reduceOperations([
  ...statusOperations(),
  op('a', 5, { kind: 'member.upsert', member: { id: 'me', name: 'Max', handle: null } }),
  op('a', 6, {
    kind: 'iteration.upsert',
    iteration: {
      id: 'now',
      name: 'Sprint 4',
      goal: '',
      startsAt: '2026-08-01',
      endsAt: '2026-08-14',
      capacity: null,
      order: 'a0',
    },
  }),
  op('a', 10, {
    kind: 'item.create',
    item: anItem('1', {
      ref: 'KAN-1',
      title: 'Login crash on Safari',
      type: 'bug',
      priority: 'p0',
      statusId: 'doing',
      estimate: 5,
      assignees: ['me'],
      iterationId: 'now',
      startedAt: NOW - DAY,
      dueOn: '2026-08-01',
    }),
  }),
  op('a', 11, {
    kind: 'item.create',
    item: anItem('2', {
      ref: 'KAN-2',
      title: 'Add search',
      description: 'A query language nobody has to learn.',
      estimate: 8,
    }),
  }),
  op('a', 12, {
    kind: 'item.create',
    item: anItem('3', { ref: 'KAN-3', title: 'Blocked thing' }),
  }),
  op('a', 13, { kind: 'item.link', itemId: '3', link: { type: 'blocked-by', itemId: '2' } }),
  op('a', 14, {
    kind: 'item.create',
    item: anItem('4', { ref: 'KAN-4', title: 'Finished', completedAt: NOW - DAY }),
  }),
])

const context: SearchContext = { project, now: NOW, meId: 'me' }
const refs = (query: string) =>
  search(query, context)
    .map((item) => item.ref)
    .toSorted()

describe('tokenise', () => {
  it('separates qualifiers from free text', () => {
    expect(tokenise('status:doing crash')).toEqual([
      { kind: 'qualifier', key: 'status', value: 'doing', negated: false },
      { kind: 'text', value: 'crash' },
    ])
  })

  it('keeps a quoted phrase together', () => {
    expect(tokenise('"login crash"')).toEqual([{ kind: 'text', value: 'login crash' }])
  })

  it('reads a leading minus as negation', () => {
    expect(tokenise('-is:closed')).toMatchObject([{ kind: 'qualifier', negated: true }])
  })
})

describe('search', () => {
  it('matches free text against title, description and reference', () => {
    expect(refs('crash')).toEqual(['KAN-1'])
    expect(refs('KAN-3')).toEqual(['KAN-3'])
  })

  it('requires every bare word, so extra words narrow', () => {
    expect(refs('query language')).toEqual(['KAN-2'])
    expect(refs('query nonexistent')).toEqual([])
  })

  it('matches a quoted phrase contiguously', () => {
    expect(refs('"query language"')).toEqual(['KAN-2'])
    // The same words, out of order, are not that phrase.
    expect(refs('"language query"')).toEqual([])
  })

  it('matches a status by name, id or category', () => {
    expect(refs('status:in-progress')).toEqual(['KAN-1'])
    expect(refs('status:doing')).toEqual(['KAN-1'])
  })

  it('resolves @me', () => {
    expect(refs('assignee:@me')).toEqual(['KAN-1'])
  })

  it('resolves the current sprint from today', () => {
    expect(refs('sprint:current')).toEqual(['KAN-1'])
    expect(refs('sprint:none').length).toBeGreaterThan(0)
  })

  it('finds blocked work', () => {
    expect(refs('is:blocked')).toEqual(['KAN-3'])
  })

  it('finds overdue work, and does not count finished work as overdue', () => {
    expect(refs('is:overdue')).toEqual(['KAN-1'])
  })

  it('compares points', () => {
    expect(refs('points:>5')).toEqual(['KAN-2'])
    expect(refs('points:5')).toEqual(['KAN-1'])
    expect(refs('points:<=5')).toEqual(['KAN-1'])
  })

  it('negates', () => {
    expect(refs('-is:closed')).toEqual(['KAN-1', 'KAN-2', 'KAN-3'])
  })

  it('narrows with each additional token', () => {
    expect(refs('type:bug priority:p0 assignee:@me')).toEqual(['KAN-1'])
    expect(refs('type:bug priority:p4')).toEqual([])
  })

  it('treats an unknown qualifier as text, so a typo narrows visibly', () => {
    // Silently matching nothing would leave someone staring at an empty board
    // with no idea why.
    expect(refs('stauts:doing')).toEqual([])
    expect(refs('nonsense:crash')).toEqual([])
  })

  it('returns nothing for an empty query rather than everything', () => {
    expect(search('', context)).toEqual([])
    expect(search('   ', context)).toEqual([])
  })

  it('does not match @me when nobody has claimed a seat', () => {
    expect(search('assignee:@me', { ...context, meId: null })).toEqual([])
  })
})

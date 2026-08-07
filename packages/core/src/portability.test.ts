import { describe, expect, it } from 'vitest'

import {
  EXPORT_FORMAT,
  ImportError,
  exportCsv,
  exportJson,
  importJson,
  mergeImport,
} from './portability.ts'
import { reduceOperations } from './ops/reduce.ts'
import { anItem, op, statusOperations } from './ops/testing.ts'

const log = [
  ...statusOperations(),
  op('a', 10, {
    kind: 'item.create',
    item: anItem('1', {
      ref: 'KAN-1',
      title: 'A title, with a comma',
      estimate: 5,
      completedAt: 1000,
    }),
  }),
  op('a', 11, { kind: 'item.set', itemId: '1', patch: { priority: 'p0' } }),
]

describe('exportJson', () => {
  it('carries the operations, not a snapshot of the board', () => {
    // The log is the thing of value; a rendering of the current state would
    // lose the history every metric is computed from.
    const parsed = JSON.parse(exportJson(log, 5000)) as { operations: unknown[] }
    expect(parsed.operations).toHaveLength(log.length)
  })

  it('round-trips exactly', () => {
    const back = importJson(exportJson(log, 5000))
    expect(reduceOperations(back)).toEqual(reduceOperations(log))
  })
})

describe('importJson', () => {
  it('refuses a file that is not JSON', () => {
    expect(() => importJson('nonsense')).toThrow(ImportError)
  })

  it('refuses JSON that is not an export', () => {
    expect(() => importJson('{"hello":"world"}')).toThrow(ImportError)
  })

  it('refuses a newer format outright rather than reading part of it', () => {
    // Importing three quarters of someone's project and calling it done is the
    // worst available outcome.
    const future = JSON.stringify({ kanbo: EXPORT_FORMAT + 1, operations: [] })
    expect(() => importJson(future)).toThrow(/newer version/)
  })

  it('accepts an export with no operations in it', () => {
    expect(importJson(JSON.stringify({ kanbo: EXPORT_FORMAT, operations: [] }))).toEqual([])
  })
})

describe('mergeImport', () => {
  it('adds rather than replaces, and stays idempotent', () => {
    const incoming = importJson(exportJson(log, 5000))
    const once = mergeImport([], incoming)
    expect(mergeImport(once, incoming)).toHaveLength(once.length)
  })

  it('keeps local work that the import does not contain', () => {
    const local = [op('b', 20, { kind: 'item.create', item: anItem('local') })]
    const merged = mergeImport(local, importJson(exportJson(log, 5000)))
    expect(
      reduceOperations(merged)
        .items.map((item) => item.id)
        .toSorted(),
    ).toEqual(['1', 'local'])
  })
})

describe('exportCsv', () => {
  const csv = exportCsv(reduceOperations(log))

  it('starts with a header row', () => {
    expect(csv.split('\n')[0]).toContain('ref,title,type,status')
  })

  it('quotes a value containing a comma, so the file opens correctly', () => {
    expect(csv).toContain('"A title, with a comma"')
  })

  it('resolves ids to names, since a spreadsheet cannot look them up', () => {
    expect(csv).toContain('Backlog')
  })

  it('leaves an unset value blank rather than writing null', () => {
    const empty = exportCsv(
      reduceOperations([
        ...statusOperations(),
        op('a', 10, { kind: 'item.create', item: anItem('2') }),
      ]),
    )
    expect(empty).not.toContain('null')
  })
})

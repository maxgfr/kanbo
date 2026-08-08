import { historyOf, newItem } from '@kanbo/core'
import { describe, expect, it } from 'vitest'

import { Store } from './store.ts'
import { fakePorts } from './testing.tsx'

/** A clock that moves, because coalescing is a claim about time. */
function tickingPorts(step = 10) {
  const ports = fakePorts()
  let at = 1_700_000_000_000
  return {
    ...ports,
    clock: {
      now: () => {
        at += step
        return at
      },
    },
  }
}

async function boardWithAnItem(step?: number) {
  const ports = tickingPorts(step)
  const store = new Store(ports, 'device-a')
  await store.load()
  const item = newItem(store.getProject(), ports, { title: '' })
  await store.dispatch({ kind: 'item.create', item })
  return { store, item, ports }
}

async function type(store: Store, itemId: string, text: string) {
  for (let at = 1; at <= text.length; at++) {
    await store.dispatch({ kind: 'item.set', itemId, patch: { title: text.slice(0, at) } })
  }
}

describe('typing into the board', () => {
  it('records a typed title as one change rather than one per character', async () => {
    const { store, item } = await boardWithAnItem()
    await type(store, item.id, 'Ship the departure board')

    const edits = historyOf(store.getLog(), item.id).filter(
      (entry) => entry.change.kind === 'field',
    )
    expect(edits).toHaveLength(1)
    expect(store.getProject().items[0]?.title).toBe('Ship the departure board')
  })

  it('keeps every character, however few operations it takes', async () => {
    const { store, item } = await boardWithAnItem()
    await type(store, item.id, 'Ship')
    expect(store.getProject().items[0]?.title).toBe('Ship')
  })

  it('starts a second change when the typing stops for long enough', async () => {
    // Ten seconds between keystrokes is not one edit by any reading, and a
    // history that said so would be hiding a revision someone made later.
    const { store, item } = await boardWithAnItem(10_000)
    await type(store, item.id, 'Ship')

    const edits = historyOf(store.getLog(), item.id).filter(
      (entry) => entry.change.kind === 'field',
    )
    expect(edits.length).toBeGreaterThan(1)
  })

  it('does not fold an edit into a different field', async () => {
    const { store, item } = await boardWithAnItem()
    await store.dispatch({ kind: 'item.set', itemId: item.id, patch: { title: 'Ship' } })
    await store.dispatch({ kind: 'item.set', itemId: item.id, patch: { estimate: 5 } })

    expect(store.getProject().items[0]).toMatchObject({ title: 'Ship', estimate: 5 })
  })

  it('stops folding once the log has been offered to a repository', async () => {
    // Sealing is what a sync does before it reads the log. An operation another
    // device may already hold cannot be quietly replaced here: the copy would
    // come home on the next pull and the noise would arrive late.
    const { store, item } = await boardWithAnItem()
    await store.dispatch({ kind: 'item.set', itemId: item.id, patch: { title: 'Shi' } })
    const before = store.getLog().length

    store.seal()
    await store.dispatch({ kind: 'item.set', itemId: item.id, patch: { title: 'Ship' } })

    expect(store.getLog()).toHaveLength(before + 1)
  })

  it('stops folding once operations have arrived from elsewhere', async () => {
    const { store, item } = await boardWithAnItem()
    await store.dispatch({ kind: 'item.set', itemId: item.id, patch: { title: 'Shi' } })
    await store.absorb([])
    const before = store.getLog().length

    await store.dispatch({ kind: 'item.set', itemId: item.id, patch: { title: 'Ship' } })
    expect(store.getLog()).toHaveLength(before + 1)
  })
})

/**
 * Writing is deferred; being written is not optional. The contract `dispatch`
 * keeps is "applied", and `flush` is what makes it "on disk" — so everything
 * below asks for the flush rather than assuming the write already happened.
 */
describe('a write that does not land', () => {
  function refusingPorts() {
    const ports = tickingPorts()
    return {
      ...ports,
      storage: {
        ...ports.storage,
        async set() {
          throw new Error('The database is full.')
        },
      },
    }
  }

  it('is reported rather than swallowed', async () => {
    // The screen updates before the write, so a silent failure looks saved and
    // the next reload loses everything since. Reported, it can be acted on.
    const ports = refusingPorts()
    const store = new Store(ports, 'device-a')
    await store.load()

    const item = newItem(store.getProject(), ports, { title: 'Ship' })
    await store.dispatch({ kind: 'item.create', item })
    await store.flush()

    expect(store.getFailure()?.message).toBe('The database is full.')
  })

  it('clears itself once a write gets through', async () => {
    let refuse = true
    const ports = tickingPorts()
    const store = new Store(
      {
        ...ports,
        storage: {
          ...ports.storage,
          async set(key: string, value: Uint8Array) {
            if (refuse) throw new Error('The database is full.')
            await ports.storage.set(key, value)
          },
        },
      },
      'device-a',
    )
    await store.load()

    const item = newItem(store.getProject(), ports, { title: 'Ship' })
    await store.dispatch({ kind: 'item.create', item })
    await store.flush()
    expect(store.getFailure()).not.toBeNull()

    refuse = false
    await store.dispatch({ kind: 'item.set', itemId: item.id, patch: { title: 'Shipped' } })
    await store.flush()
    expect(store.getFailure()).toBeNull()
  })

  it('reports it without losing the change on screen', async () => {
    const ports = refusingPorts()
    const store = new Store(ports, 'device-a')
    await store.load()

    const item = newItem(store.getProject(), ports, { title: 'Ship' })
    await store.dispatch({ kind: 'item.create', item })
    await store.flush()

    expect(store.getProject().items).toHaveLength(1)
  })
})

describe('deferring the write', () => {
  /** Storage that counts how often the whole log was serialised and handed over. */
  function countingPorts() {
    const ports = tickingPorts()
    let writes = 0
    return {
      ports: {
        ...ports,
        storage: {
          ...ports.storage,
          async set(key: string, value: Uint8Array) {
            writes++
            await ports.storage.set(key, value)
          },
        },
      },
      writes: () => writes,
    }
  }

  it('turns a burst of edits into one write rather than one per character', async () => {
    // The log is serialised in full every time, so this is work proportional to
    // the whole history paid per keystroke — the reason a long-lived board gets
    // slower to type in.
    const { ports, writes } = countingPorts()
    const store = new Store(ports, 'device-a')
    await store.load()

    const item = newItem(store.getProject(), ports, { title: '' })
    await store.dispatch({ kind: 'item.create', item })
    await type(store, item.id, 'Ship the departure board')
    await store.flush()

    expect(writes()).toBeLessThan(4)
  })

  it('has the change on screen before the write, not after', async () => {
    const { ports } = countingPorts()
    const store = new Store(ports, 'device-a')
    await store.load()

    const item = newItem(store.getProject(), ports, { title: 'Ship' })
    await store.dispatch({ kind: 'item.create', item })

    expect(store.getProject().items).toHaveLength(1)
  })

  it('writes what is waiting when the log is about to leave', async () => {
    // `seal` is called before a sync reads the log and before an export writes
    // a file. A repository holding an operation this browser would lose on
    // reload is the worst of both.
    const { ports, writes } = countingPorts()
    const store = new Store(ports, 'device-a')
    await store.load()

    const item = newItem(store.getProject(), ports, { title: 'Ship' })
    await store.dispatch({ kind: 'item.create', item })
    store.seal()
    await store.flush()

    expect(writes()).toBeGreaterThan(0)
  })

  it('writes immediately for work that arrived from elsewhere', async () => {
    // A pull is not a keystroke: those operations cannot be asked for again.
    const { ports, writes } = countingPorts()
    const store = new Store(ports, 'device-a')
    await store.load()

    const item = newItem(store.getProject(), ports, { title: 'From Bob' })
    await store.absorb([
      {
        id: 'b1',
        deviceId: 'device-b',
        lamport: 9,
        at: 1_700_000_000_000,
        authorId: null,
        kind: 'item.create',
        item,
      },
    ])

    expect(writes()).toBeGreaterThan(0)
  })
})

import { describe, expect, it } from 'vitest'

import {
  ConflictError,
  type GitProvider,
  type WriteRequest,
  opsPathFor,
} from '../connectors/provider.ts'
import { itemById } from '../model/project.ts'
import { mergeLogs } from '../ops/log.ts'
import { reduceOperations } from '../ops/reduce.ts'
import { anItem, op, statusOperations } from '../ops/testing.ts'
import {
  parseLog,
  projectFrom,
  pull,
  push,
  serialiseLog,
  synchronise,
  writeManifest,
} from './engine.ts'

/**
 * A repository in memory.
 *
 * Concurrency is modelled the way the real thing behaves — a write with a
 * stale sha is refused — because that is the only part of the provider the
 * engine's correctness actually depends on.
 */
function fakeRepo(seed: Record<string, string> = {}) {
  const files = new Map<string, { content: string; sha: string }>()
  let counter = 0

  for (const [path, content] of Object.entries(seed)) {
    files.set(path, { content, sha: `sha-${++counter}` })
  }

  const provider: GitProvider = {
    id: 'github',
    apiBaseUrl: 'https://api.github.com',

    async readFile(path) {
      const file = files.get(path)
      return file ? { path, content: file.content, sha: file.sha } : null
    },

    async writeFile(request: WriteRequest) {
      const existing = files.get(request.path)
      if (existing && existing.sha !== request.sha) throw new ConflictError(request.path)
      if (!existing && request.sha) throw new ConflictError(request.path)
      const sha = `sha-${++counter}`
      files.set(request.path, { content: request.content, sha })
      return { sha }
    },

    async listFiles(prefix) {
      return [...files.keys()].filter((path) => path.startsWith(`${prefix}/`))
    },
  }

  return { provider, files }
}

const seed = statusOperations('seed')

describe('serialising a log', () => {
  it('round-trips through NDJSON', () => {
    const log = [...seed, op('a', 10, { kind: 'item.create', item: anItem('1') })]
    expect(parseLog(serialiseLog(log))).toEqual(mergeLogs(log))
  })

  it('writes one operation per line, so a device appends rather than rewrites', () => {
    const log = [op('a', 1, { kind: 'item.delete', itemId: '1' })]
    expect(serialiseLog(log).split('\n')).toHaveLength(1)
  })

  it('skips a corrupt line instead of losing the whole file', () => {
    // A half-written push or a hand-resolved merge should cost one operation,
    // never the project.
    const first = op('a', 1, { kind: 'item.delete', itemId: '1' })
    const second = op('a', 2, { kind: 'item.delete', itemId: '2' })
    const content = `${JSON.stringify(first)}\n{ not json\n\n${JSON.stringify(second)}`

    // The corrupt line costs itself and nothing else; both good operations
    // survive, and blank lines are not an error.
    expect(parseLog(content).map((entry) => entry.lamport)).toEqual([1, 2])
  })

  it('skips a line that is valid JSON but not an operation', () => {
    expect(parseLog('{"hello":"world"}')).toEqual([])
  })
})

describe('push', () => {
  it('writes only this device"s own file', async () => {
    const { provider, files } = fakeRepo()
    const log = mergeLogs(
      [op('device-a', 10, { kind: 'item.create', item: anItem('1') })],
      [op('device-b', 11, { kind: 'item.create', item: anItem('2') })],
    )

    await push(provider, 'device-a', log)

    // The entire conflict-avoidance strategy in one assertion.
    expect([...files.keys()]).toEqual([opsPathFor('device-a')])
    expect(parseLog(files.get(opsPathFor('device-a'))!.content)).toHaveLength(1)
  })

  it('does not write when there is nothing new', async () => {
    const { provider, files } = fakeRepo()
    const log = [op('device-a', 10, { kind: 'item.create', item: anItem('1') })]

    await push(provider, 'device-a', log)
    const first = files.get(opsPathFor('device-a'))!.sha
    const second = await push(provider, 'device-a', log)

    // An empty commit per poll would make the repository unreadable.
    expect(second.pushed).toBe(0)
    expect(files.get(opsPathFor('device-a'))!.sha).toBe(first)
  })

  it('merges rather than truncating when the same device wrote from elsewhere', async () => {
    // Two tabs are one device, and each holds part of the history.
    const fromOtherTab = [op('device-a', 5, { kind: 'item.create', item: anItem('other') })]
    const { provider } = fakeRepo({ [opsPathFor('device-a')]: serialiseLog(fromOtherTab) })

    const result = await push(provider, 'device-a', [
      op('device-a', 10, { kind: 'item.create', item: anItem('mine') }),
    ])

    expect(result.log).toHaveLength(2)
  })

  it('recovers from a concurrent write by re-reading and merging', async () => {
    const { provider, files } = fakeRepo()
    await push(provider, 'device-a', [op('device-a', 1, { kind: 'item.delete', itemId: 'x' })])

    // Someone writes between our read and our write, exactly once.
    let interfered = false
    const original = provider.writeFile.bind(provider)
    const flaky: GitProvider = {
      ...provider,
      async writeFile(request) {
        if (!interfered) {
          interfered = true
          files.set(request.path, {
            content: serialiseLog([op('device-a', 2, { kind: 'item.delete', itemId: 'y' })]),
            sha: 'moved-on',
          })
          throw new ConflictError(request.path)
        }
        return original(request)
      },
    }

    const result = await push(flaky, 'device-a', [
      op('device-a', 3, { kind: 'item.delete', itemId: 'z' }),
    ])

    // Nothing is discarded: the merge is a union in both directions.
    expect(result.log.map((entry) => entry.lamport).toSorted()).toEqual([2, 3])
  })

  it('gives up rather than looping forever on a provider that always conflicts', async () => {
    const { provider } = fakeRepo()
    const hostile: GitProvider = {
      ...provider,
      async writeFile(request) {
        throw new ConflictError(request.path)
      },
    }
    await expect(
      push(hostile, 'device-a', [op('device-a', 1, { kind: 'item.delete', itemId: 'x' })]),
    ).rejects.toThrow(ConflictError)
  })
})

describe('pull', () => {
  it('reads every device"s file, not just the ones in the manifest', async () => {
    // A device that pushed before it could update the manifest must still be
    // visible, or its work silently disappears for everyone else.
    const { provider } = fakeRepo({
      [opsPathFor('device-a')]: serialiseLog([
        ...seed,
        op('device-a', 10, { kind: 'item.create', item: anItem('1') }),
      ]),
      [opsPathFor('device-b')]: serialiseLog([
        op('device-b', 11, { kind: 'item.create', item: anItem('2') }),
      ]),
      '.kanbo/manifest.json': JSON.stringify({
        format: 1,
        projectId: 'p',
        devices: ['device-a'],
        watermark: 0,
      }),
    })

    const result = await pull(provider)
    expect(reduceOperations(result.operations).items).toHaveLength(2)
  })

  it('returns an empty log for a repository nobody has synced yet', async () => {
    const { provider } = fakeRepo()
    const result = await pull(provider)
    expect(result.operations).toEqual([])
    expect(result.manifest).toBeNull()
  })

  it('survives an unreadable snapshot by rebuilding from the operations', async () => {
    const { provider } = fakeRepo({
      [opsPathFor('device-a')]: serialiseLog([
        ...seed,
        op('device-a', 10, { kind: 'item.create', item: anItem('1') }),
      ]),
      '.kanbo/snapshot.json': 'not json at all',
    })

    const result = await pull(provider)
    expect(result.snapshot).toBeNull()
    expect(projectFrom(result).items).toHaveLength(1)
  })
})

describe('projectFrom', () => {
  it('replays only operations past the snapshot watermark', async () => {
    const base = reduceOperations([
      ...seed,
      op('device-a', 10, { kind: 'item.create', item: anItem('1', { title: 'From snapshot' }) }),
    ])

    const project = projectFrom({
      snapshot: { format: 1, watermark: 10, project: base },
      manifest: null,
      operations: [
        // Already folded in — replaying it would resurrect what came after.
        op('device-a', 10, { kind: 'item.create', item: anItem('1', { title: 'Stale' }) }),
        op('device-a', 11, { kind: 'item.set', itemId: '1', patch: { title: 'Newer' } }),
      ],
    })

    expect(itemById(project, '1')?.title).toBe('Newer')
  })
})

describe('writeManifest', () => {
  it('accumulates devices rather than replacing them', async () => {
    const { provider } = fakeRepo()
    await writeManifest(provider, 'p', ['device-a'], 0)
    await writeManifest(provider, 'p', ['device-b'], 5)

    const file = await provider.readFile('.kanbo/manifest.json')
    const manifest = JSON.parse(file!.content) as { devices: string[]; watermark: number }
    expect(manifest.devices).toEqual(['device-a', 'device-b'])
    expect(manifest.watermark).toBe(5)
  })

  it('does not rewrite an unchanged manifest', async () => {
    const { provider, files } = fakeRepo()
    await writeManifest(provider, 'p', ['device-a'], 0)
    const sha = files.get('.kanbo/manifest.json')!.sha
    await writeManifest(provider, 'p', ['device-a'], 0)
    expect(files.get('.kanbo/manifest.json')!.sha).toBe(sha)
  })
})

describe('two devices through one repository', () => {
  it('converges, and neither loses work', async () => {
    const { provider } = fakeRepo()

    // Both start from the same seeded project.
    const shared = [...seed, op('seed', 10, { kind: 'item.create', item: anItem('1') })]
    await push(provider, 'seed', shared)

    // Each works offline from that starting point.
    const alice = mergeLogs(shared, [
      op('device-a', 20, { kind: 'item.set', itemId: '1', patch: { title: 'Alice' } }),
      op('device-a', 21, { kind: 'item.create', item: anItem('a') }),
    ])
    const bob = mergeLogs(shared, [
      op('device-b', 20, { kind: 'item.set', itemId: '1', patch: { estimate: 8 } }),
      op('device-b', 22, { kind: 'item.create', item: anItem('b') }),
    ])

    // Alice syncs, then Bob, then Alice again to see Bob's work.
    const afterAlice = await synchronise(provider, 'device-a', alice)
    const afterBob = await synchronise(provider, 'device-b', bob)
    const aliceAgain = await synchronise(provider, 'device-a', afterAlice.log)

    expect(aliceAgain.project).toEqual(afterBob.project)

    const item = itemById(aliceAgain.project, '1')
    expect(item?.title).toBe('Alice')
    expect(item?.estimate).toBe(8)
    expect(aliceAgain.project.items).toHaveLength(3)
  })

  it('keeps each device to its own file, so git never has to merge one', async () => {
    const { provider, files } = fakeRepo()
    await synchronise(provider, 'device-a', [
      op('device-a', 1, { kind: 'item.create', item: anItem('1') }),
    ])
    await synchronise(provider, 'device-b', [
      op('device-b', 1, { kind: 'item.create', item: anItem('2') }),
    ])

    expect([...files.keys()].toSorted()).toEqual([opsPathFor('device-a'), opsPathFor('device-b')])
  })

  it('is idempotent: syncing twice with no changes writes nothing new', async () => {
    const { provider, files } = fakeRepo()
    const log = [op('device-a', 1, { kind: 'item.create', item: anItem('1') })]

    await synchronise(provider, 'device-a', log)
    const sha = files.get(opsPathFor('device-a'))!.sha
    const second = await synchronise(provider, 'device-a', log)

    expect(files.get(opsPathFor('device-a'))!.sha).toBe(sha)
    expect(second.log).toHaveLength(1)
  })
})

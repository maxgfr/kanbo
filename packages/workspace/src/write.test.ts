import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openWorkspace } from './session.ts'
import { claimMe, init, itemAssign, itemCreate, itemMove } from './write.ts'

/**
 * The write actions, against a real store in a scratch directory.
 *
 * Nothing is mocked. The `Storage` port would let these run on a fake, but the
 * thing most likely to break is the boundary between the domain and a disk, and
 * a fake is exactly where that stops being tested.
 */
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kanbo-workspace-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('creating a project', () => {
  it('takes the key from the name when nobody gives one', async () => {
    const { result } = await init(await openWorkspace(root), 'Apollo', null)
    expect(result.key).toBe('APO')
  })

  it('refuses a second time', async () => {
    const { workspace } = await init(await openWorkspace(root), 'Apollo', 'APL')
    await expect(init(workspace, 'Gemini', 'GEM')).rejects.toThrow('already exists')
  })

  /**
   * The guard used to read "has columns", not "has a project".
   *
   * Deleting every column turns out to be impossible — the reducer drops a
   * `status.delete` whose `moveToId` is not a column, so the last one cannot
   * go. But a log with a project and no columns is still reachable the other
   * way: `kanbo import` merges whatever operations it is handed, and an export
   * carrying a `project.set` and no statuses is a perfectly well-formed one.
   * Under the old guard, `init` would then stack a second project onto it.
   */
  it('refuses on a log that names a project but has no columns', async () => {
    const opened = await openWorkspace(root)
    const named = await opened.commit({
      kind: 'project.set',
      patch: { name: 'Apollo', key: 'APL' },
    })

    expect(named.project.statuses).toHaveLength(0)
    expect(named.project.name).toBe('Apollo')
    await expect(init(named, 'Gemini', 'GEM')).rejects.toThrow('already exists')
  })
})

describe('what a terminal writes', () => {
  it('signs its changes with whoever claimed this machine', async () => {
    const opened = await init(await openWorkspace(root), 'Apollo', 'APL')
    const created = await itemCreate(opened.workspace, { title: 'Ship the departure board' })
    const assigned = await itemAssign(created.workspace, 'APL-1', 'Ada Lovelace')
    const claimed = await claimMe(assigned.workspace, 'Ada Lovelace')

    const after = await itemCreate(claimed.workspace, { title: 'Cut the release' })
    const last = after.workspace.log.at(-1)!

    // Every operation used to be authored by null, even with `me` two lines
    // away, so the history could never name a CLI user.
    expect(last.authorId).toBe(claimed.result!.id)
  })

  it('leaves the author null while nobody has claimed the machine', async () => {
    const opened = await init(await openWorkspace(root), 'Apollo', 'APL')
    const created = await itemCreate(opened.workspace, { title: 'Ship it' })

    expect(created.workspace.log.at(-1)!.authorId).toBeNull()
  })

  it('survives being reopened, because the log is the state', async () => {
    const opened = await init(await openWorkspace(root), 'Apollo', 'APL')
    await itemCreate(opened.workspace, { title: 'Ship the departure board' })

    const reopened = await openWorkspace(root)
    expect(reopened.project.items.map((item) => item.title)).toEqual(['Ship the departure board'])
  })
})

describe('moving a card', () => {
  it('names the columns rather than guessing when the name is wrong', async () => {
    const opened = await init(await openWorkspace(root), 'Apollo', 'APL')
    const created = await itemCreate(opened.workspace, { title: 'Ship it' })

    await expect(itemMove(created.workspace, 'APL-1', 'Shipped')).rejects.toThrow(
      'No column called "Shipped"',
    )
  })

  it('moves it, in one operation carrying both status and position', async () => {
    const opened = await init(await openWorkspace(root), 'Apollo', 'APL')
    const created = await itemCreate(opened.workspace, { title: 'Ship it' })
    const moved = await itemMove(created.workspace, 'APL-1', 'in progress')

    expect(moved.result.status.name).toBe('In Progress')
    expect(moved.workspace.log.at(-1)!.kind).toBe('item.move')
  })
})

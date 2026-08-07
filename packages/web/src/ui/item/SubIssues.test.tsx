/** @vitest-environment jsdom */
import { defaultStatuses, itemById, type Item, type OperationBody } from '@kanbo/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Harness, storeWith } from '../../state/testing.tsx'
import { SubIssues } from './SubIssues.tsx'

afterEach(cleanup)

const statuses = defaultStatuses(
  (
    (n = 0) =>
    () =>
      `status-${++n}`
  )(),
)

function anItem(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    ref: `KAN-${id}`,
    title: `Item ${id}`,
    description: '',
    type: 'task',
    statusId: statuses[0]!.id,
    priority: 'p2',
    estimate: null,
    assignees: [],
    labels: [],
    milestoneId: null,
    iterationId: null,
    parentId: null,
    links: [],
    order: `a${id}`,
    fields: {},
    dueOn: null,
    createdAt: 1000,
    updatedAt: 1000,
    startedAt: null,
    completedAt: null,
    archived: false,
    ...overrides,
  }
}

const seed: readonly OperationBody[] = [
  { kind: 'project.set', patch: { name: 'Apollo', key: 'KAN' } },
  ...statuses.map((status) => ({ kind: 'status.upsert' as const, status })),
]

async function board(...items: readonly Item[]) {
  const store = await storeWith(
    ...seed,
    ...items.map((item) => ({ kind: 'item.create' as const, item })),
  )
  return store
}

/** Render the panel section for `itemId`, re-reading the store on each change. */
function show(store: Awaited<ReturnType<typeof board>>, itemId: string) {
  const item = itemById(store.getProject(), itemId)!
  return render(
    <Harness store={store}>
      <SubIssues project={store.getProject()} item={item} onOpen={() => {}} />
    </Harness>,
  )
}

describe('SubIssues', () => {
  it('creates a child already attached to its parent', async () => {
    const store = await board(anItem('1'))
    show(store, '1')

    await userEvent.click(screen.getByRole('button', { name: /Sub-issue/ }))
    await userEvent.type(
      screen.getByLabelText('Title of the new sub-issue'),
      'Write the migration{Enter}',
    )

    const made = store.getProject().items.find((item) => item.title === 'Write the migration')
    // One operation, not "create then correct": a child that exists unattached
    // for an instant is a child another device can see unattached.
    expect(made?.parentId).toBe('1')
    expect(store.getLog().filter((op) => op.kind === 'item.create')).toHaveLength(2)
  })

  it('counts finished children, reading done from completedAt', async () => {
    const store = await board(
      anItem('1'),
      anItem('2', { parentId: '1', estimate: 3, completedAt: 5000 }),
      anItem('3', { parentId: '1', estimate: 5 }),
    )
    show(store, '1')
    expect(screen.getByText(/1\/2 done/)).toBeDefined()
    expect(screen.getByText(/3\/8 pts/)).toBeDefined()
  })

  it('says nothing about sub-issues when there are none', async () => {
    const store = await board(anItem('1'))
    show(store, '1')
    expect(screen.getByText('Nothing under this yet.')).toBeDefined()
    expect(screen.queryByText(/done/)).toBeNull()
  })

  it('does not offer an item that would close a loop', async () => {
    // The grandchild must not be offered as a parent of its own grandparent.
    // Refusing at the point of intent matters because once the operation is in
    // the log, every device inherits the loop.
    const store = await board(
      anItem('1'),
      anItem('2', { parentId: '1' }),
      anItem('3', { parentId: '2' }),
    )
    show(store, '3')

    const picker = screen.queryByLabelText('Move an existing item under this one')
    // Nothing can go under KAN-3: the chain above it is already three deep.
    expect(picker).toBeNull()
  })

  it('offers only items that fit under this one', async () => {
    const store = await board(anItem('1'), anItem('2'), anItem('3', { parentId: '2' }))
    show(store, '1')

    const options = [...screen.getByLabelText('Move an existing item under this one').children].map(
      (option) => option.textContent,
    )
    // KAN-2 is free and shallow enough; KAN-3 already has a parent, and the
    // item itself is never its own candidate.
    expect(options).toEqual(['Move an existing item here…', 'KAN-2 — Item 2'])
  })

  it('detaches a child without deleting it', async () => {
    const store = await board(anItem('1'), anItem('2', { parentId: '1' }))
    show(store, '1')

    await userEvent.click(screen.getByRole('button', { name: 'Detach KAN-2' }))

    expect(itemById(store.getProject(), '2')?.parentId).toBeNull()
    expect(store.getProject().items).toHaveLength(2)
  })

  it('shows the parent an item belongs to', async () => {
    const store = await board(anItem('1', { title: 'The epic' }), anItem('2', { parentId: '1' }))
    show(store, '2')
    expect(screen.getByText('Part of')).toBeDefined()
    expect(screen.getByRole('button', { name: 'KAN-1' })).toBeDefined()
  })
})

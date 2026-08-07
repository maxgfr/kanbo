/** @vitest-environment jsdom */
import { byOrder, defaultStatuses, itemById, type Item, type OperationBody } from '@kanbo/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Harness, storeWith } from '../../state/testing.tsx'
import { ColumnsSection } from './ColumnsSection.tsx'

afterEach(cleanup)

const statuses = defaultStatuses(
  (
    (n = 0) =>
    () =>
      `status-${++n}`
  )(),
)

const backlog = statuses[0]!
const inProgress = statuses[2]!

function anItem(id: string, statusId: string): Item {
  return {
    id,
    ref: `KAN-${id}`,
    title: `Item ${id}`,
    description: '',
    type: 'task',
    statusId,
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
  }
}

const seed: readonly OperationBody[] = [
  { kind: 'project.set', patch: { name: 'Apollo', key: 'KAN' } },
  ...statuses.map((status) => ({ kind: 'status.upsert' as const, status })),
]

async function panel(...items: readonly Item[]) {
  const store = await storeWith(
    ...seed,
    ...items.map((item) => ({ kind: 'item.create' as const, item })),
  )
  const view = render(
    <Harness store={store}>
      <ColumnsSection />
    </Harness>,
  )
  return { store, view }
}

describe('ColumnsSection', () => {
  it('lists every column the project has', async () => {
    const { store } = await panel()
    const names = store
      .getProject()
      .statuses.toSorted(byOrder)
      .map((status) => status.name)
    for (const name of names) {
      expect(screen.getByLabelText(`Name of the ${name} column`)).toBeDefined()
    }
  })

  it('renames a column without touching the cards in it', async () => {
    const { store } = await panel(anItem('1', backlog.id))
    const field = screen.getByLabelText('Name of the Backlog column')
    await userEvent.clear(field)
    await userEvent.type(field, 'Icebox')

    const renamed = store.getProject().statuses.find((status) => status.id === backlog.id)
    expect(renamed?.name).toBe('Icebox')
    expect(itemById(store.getProject(), '1')?.statusId).toBe(backlog.id)
  })

  it('changes a category, which is what the metrics read', async () => {
    const { store } = await panel()
    await userEvent.selectOptions(screen.getByLabelText('Category of Ready'), 'in-progress')
    expect(store.getProject().statuses.find((s) => s.name === 'Ready')?.category).toBe(
      'in-progress',
    )
  })

  it('sets and clears a WIP limit, keeping zero as a real limit', async () => {
    // Zero means "accept nothing new" and must survive the round-trip that an
    // empty field turns into null.
    const { store } = await panel()
    const field = screen.getByLabelText('WIP limit for In Progress')

    await userEvent.type(field, '0')
    expect(store.getProject().statuses.find((s) => s.name === 'In Progress')?.wipLimit).toBe(0)

    await userEvent.clear(field)
    expect(store.getProject().statuses.find((s) => s.name === 'In Progress')?.wipLimit).toBeNull()
  })

  it('moves the cards out of a column before deleting it', async () => {
    const { store } = await panel(anItem('1', inProgress.id), anItem('2', inProgress.id))

    await userEvent.click(screen.getByRole('button', { name: 'Delete the In Progress column' }))
    expect(screen.getByText('Move 2 cards to')).toBeDefined()

    await userEvent.selectOptions(screen.getByLabelText('Destination column'), backlog.id)
    await userEvent.click(screen.getByRole('button', { name: 'Delete column' }))

    const project = store.getProject()
    expect(project.statuses.some((status) => status.id === inProgress.id)).toBe(false)
    // The cards moved. Nothing was destroyed with the column it happened to be
    // sitting in.
    expect(project.items).toHaveLength(2)
    expect(project.items.every((item) => item.statusId === backlog.id)).toBe(true)
  })

  it('says so plainly when the column being deleted is empty', async () => {
    const { store } = await panel()
    await userEvent.click(screen.getByRole('button', { name: 'Delete the Blocked column' }))
    expect(screen.getByText('This column is empty.')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Delete column' }))
    expect(store.getProject().statuses.some((status) => status.name === 'Blocked')).toBe(false)
  })

  it('refuses to delete the last column left', async () => {
    // A board with no columns is not a clean slate, it is a dead end: there is
    // nowhere for an item to be.
    const store = await storeWith(
      { kind: 'project.set', patch: { name: 'Apollo', key: 'KAN' } },
      { kind: 'status.upsert', status: backlog },
    )
    render(
      <Harness store={store}>
        <ColumnsSection />
      </Harness>,
    )
    const only = screen.getByRole('button', { name: 'Delete the Backlog column' })
    expect(only.hasAttribute('disabled')).toBe(true)
  })

  it('adds a column at the end, as work in progress until told otherwise', async () => {
    const { store } = await panel()
    const before = store.getProject().statuses.length

    await userEvent.click(screen.getByRole('button', { name: /Add a column/ }))

    const after = store.getProject().statuses.toSorted(byOrder)
    expect(after).toHaveLength(before + 1)
    expect(after.at(-1)?.name).toBe('New column')
    // Guessing `todo` would reset the cycle time of every card dropped in.
    expect(after.at(-1)?.category).toBe('in-progress')
  })
})

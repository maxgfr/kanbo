/** @vitest-environment jsdom */
import { DndContext, KeyboardSensor, MouseSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { defaultStatuses, type Item, type Project, reduceOperations } from '@kanbo/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Card } from './Card.tsx'

afterEach(cleanup)

const statuses = defaultStatuses(
  (
    (n = 0) =>
    () =>
      `status-${++n}`
  )(),
)

function anItem(overrides: Partial<Item> = {}): Item {
  return {
    id: '1',
    ref: 'KAN-1',
    title: 'Ship the departure board',
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
    order: 'a0',
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

/** The card only works inside the sensors and context the board gives it. */
function Board({
  project,
  items,
  onOpen,
}: {
  project: Project
  items: readonly Item[]
  onOpen: (itemId: string) => void
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )
  return (
    <DndContext sensors={sensors}>
      <SortableContext items={items.map((item) => item.id)}>
        {items.map((item) => (
          <Card key={item.id} project={project} item={item} today="2026-08-07" onOpen={onOpen} />
        ))}
      </SortableContext>
    </DndContext>
  )
}

function show(items: readonly Item[]) {
  const onOpen = vi.fn()
  const project = reduceOperations([])
  const withStatuses: Project = { ...project, statuses, items: [...items] }
  render(<Board project={withStatuses} items={items} onOpen={onOpen} />)
  return { onOpen }
}

describe('Card', () => {
  it('opens on a single click, the gesture every other view uses', async () => {
    // The board was the only place in the app that demanded a double click,
    // and nothing about drag-and-drop required it: the pointer sensor only
    // swallows a click once a drag has actually started.
    const { onOpen } = show([anItem()])
    await userEvent.click(screen.getByRole('button', { name: /KAN-1/ }))
    expect(onOpen).toHaveBeenCalledWith('1')
  })

  it('opens on O, which its own label promises', async () => {
    // The handler used to be declared before dnd-kit's listeners were spread,
    // so the keyboard sensor's onKeyDown replaced it and the shortcut did
    // nothing at all.
    const { onOpen } = show([anItem()])
    const card = screen.getByRole('button', { name: /KAN-1/ })
    card.focus()
    await userEvent.keyboard('o')
    expect(onOpen).toHaveBeenCalledWith('1')
  })

  it('still lets Space reach the drag sensor rather than opening', async () => {
    const { onOpen } = show([anItem()])
    const card = screen.getByRole('button', { name: /KAN-1/ })
    card.focus()
    await userEvent.keyboard(' ')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shows a sub-issue count only when there are sub-issues', () => {
    const parent = anItem()
    const child = anItem({ id: '2', ref: 'KAN-2', parentId: '1', completedAt: 5000 })

    cleanup()
    show([parent])
    expect(screen.queryByTitle(/sub-issues done/)).toBeNull()

    cleanup()
    show([parent, child])
    expect(screen.getByTitle('1 of 1 sub-issues done')).toBeDefined()
  })
})

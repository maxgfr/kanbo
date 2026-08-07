/** @vitest-environment jsdom */
import { type Item, type Project, defaultStatuses, reduceOperations } from '@kanbo/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Command, CommandPalette } from './CommandPalette.tsx'

afterEach(cleanup)

const statuses = defaultStatuses(
  (
    (n = 0) =>
    () =>
      `status-${++n}`
  )(),
)

function anItem(id: string, title: string): Item {
  return {
    id,
    ref: `APL-${id}`,
    title,
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
  }
}

const project: Project = reduceOperations([
  ...statuses.map((status, at) => ({
    id: `s${at}`,
    deviceId: 'd',
    lamport: at + 1,
    at: 1000,
    authorId: null,
    kind: 'status.upsert' as const,
    status,
  })),
  {
    id: 'i1',
    deviceId: 'd',
    lamport: 90,
    at: 1000,
    authorId: null,
    kind: 'item.create' as const,
    item: anItem('1', 'Ship the departure board'),
  },
  {
    id: 'i2',
    deviceId: 'd',
    lamport: 91,
    at: 1000,
    authorId: null,
    kind: 'item.create' as const,
    item: anItem('2', 'Fix the burndown'),
  },
])

function openPalette(commands: readonly Command[] = []) {
  const onClose = vi.fn()
  const onOpenItem = vi.fn()
  render(
    <CommandPalette
      project={project}
      commands={commands}
      onOpenItem={onOpenItem}
      onClose={onClose}
    />,
  )
  return { onClose, onOpenItem, user: userEvent.setup() }
}

const aCommand = (run = vi.fn()): Command => ({
  id: 'new',
  label: 'New item',
  icon: 'plus',
  run,
})

describe('closing', () => {
  it('closes on Escape from the field', () => {
    const { onClose } = openPalette()
    const field = screen.getByLabelText('Search or run a command')
    field.focus()
    return userEvent.keyboard('{Escape}').then(() => expect(onClose).toHaveBeenCalled())
  })

  it('closes on Escape from anywhere inside it, not only from the field', async () => {
    // Escape used to be bound to the input alone, so the palette became
    // undismissable by keyboard the moment focus moved off it — which it could,
    // because the rows were buttons in the tab order.
    const { onClose, user } = openPalette([aCommand()])

    screen.getByRole('dialog', { name: 'Command palette' }).focus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

/**
 * A listbox owns its options through `aria-activedescendant`, with focus
 * staying in the field. Without it, arrowing moved a highlight nobody using a
 * screen reader was told about, and Enter opened something never read out.
 */
describe('the listbox', () => {
  it('names the field a combobox that controls the results', () => {
    openPalette([aCommand()])
    const field = screen.getByRole('combobox', { name: 'Search or run a command' })
    expect(field.getAttribute('aria-controls')).toBe('kb-palette-rows')
    expect(field.getAttribute('aria-expanded')).toBe('true')
  })

  it('points at the current row, and moves the pointer with the arrows', async () => {
    const { user } = openPalette([aCommand()])
    const field = screen.getByRole('combobox', { name: 'Search or run a command' })
    await user.click(field)
    await user.type(field, 'the')

    const first = field.getAttribute('aria-activedescendant')
    expect(first).toBeTruthy()
    expect(document.getElementById(first!)?.getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{ArrowDown}')
    expect(field.getAttribute('aria-activedescendant')).not.toBe(first)
  })

  it('keeps the rows out of the tab order, as a listbox must', async () => {
    // They were `<button>`s, so Tab walked into them — into exactly the place
    // Escape was not bound.
    openPalette([aCommand()])
    const rows = screen.getAllByRole('option')
    expect(rows.every((row) => !row.hasAttribute('tabindex'))).toBe(true)
    expect(rows.every((row) => row.tagName !== 'BUTTON')).toBe(true)
  })
})

describe('searching', () => {
  it('runs the same query language the CLI runs', async () => {
    const { onOpenItem, user } = openPalette()
    await user.type(screen.getByLabelText('Search or run a command'), 'burndown')

    const rows = screen.getAllByRole('option')
    expect(rows).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(onOpenItem).toHaveBeenCalledWith('2')
  })

  it('shows commands before anything is typed, and filters them after', async () => {
    const { user } = openPalette([aCommand()])
    expect(screen.getAllByRole('option')).toHaveLength(1)

    await user.type(screen.getByLabelText('Search or run a command'), 'zzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('Nothing matched.')).toBeTruthy()
  })

  it('runs a command and closes', async () => {
    const run = vi.fn()
    const { onClose, user } = openPalette([aCommand(run)])
    await user.click(screen.getByRole('option', { name: /New item/ }))

    expect(run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

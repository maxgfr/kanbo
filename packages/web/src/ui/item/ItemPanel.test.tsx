/** @vitest-environment jsdom */
import { type Item, defaultStatuses, itemById } from '@kanbo/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Store } from '../../state/store.ts'
import { Harness, storeWith } from '../../state/testing.tsx'
import { ItemPanel } from './ItemPanel.tsx'

afterEach(cleanup)

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => vi.unstubAllGlobals())

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
    ref: `APL-${id}`,
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

async function openPanel(items: readonly Item[] = [anItem('1')]) {
  const store = await storeWith(
    { kind: 'project.set', patch: { name: 'Apollo', key: 'APL' } },
    ...statuses.map((status) => ({ kind: 'status.upsert' as const, status })),
    ...items.map((item) => ({ kind: 'item.create' as const, item })),
  )
  const onClose = vi.fn()
  const view = render(
    <Panel store={store} itemId={items[0]!.id} onClose={onClose} onOpen={() => {}} />,
  )
  return { store, onClose, view, user: userEvent.setup() }
}

function Panel({
  store,
  itemId,
  onClose,
  onOpen,
}: {
  store: Store
  itemId: string
  onClose: () => void
  onOpen: (id: string) => void
}) {
  return (
    <Harness store={store}>
      <ItemPanel project={store.getProject()} itemId={itemId} onClose={onClose} onOpen={onOpen} />
    </Harness>
  )
}

const bodyOf = (store: Store, id: string) => itemById(store.getProject(), id)?.description

/**
 * The description is the one field not written as you type, because a Markdown
 * body is edited in prose rather than in fragments. That makes the draft the
 * only unsaved thing in the panel, and it used to be committed by `onBlur`
 * alone — which no browser fires on an element being removed from the DOM.
 */
describe('the description editor', () => {
  it('keeps what was typed when the panel is closed with Escape', async () => {
    const { store, onClose, user } = await openPanel()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: '' }), 'Three paragraphs of context.')
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
    // The panel is unmounted by its parent in the real app; do it here too.
    cleanup()
    expect(bodyOf(store, '1')).toBe('Three paragraphs of context.')
  })

  it('keeps what was typed when the editor is switched back to preview', async () => {
    const { store, user } = await openPanel()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: '' }), 'A body.')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(bodyOf(store, '1')).toBe('A body.')
  })

  it('commits to the item being left, not to the one being opened', async () => {
    // Opening a relative replaces what is on screen without remounting. With
    // one shared draft and no reset, the text followed to the next card.
    const { store, view, user } = await openPanel([anItem('1'), anItem('2')])

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: '' }), 'Belongs to one.')

    view.rerender(<Panel store={store} itemId="2" onClose={() => {}} onOpen={() => {}} />)

    expect(bodyOf(store, '1')).toBe('Belongs to one.')
    expect(bodyOf(store, '2')).toBe('')
  })
})

describe('Escape inside the panel', () => {
  it('closes the card', async () => {
    const { onClose, user } = await openPanel()
    await user.click(screen.getByLabelText('Title'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('cancels a half-typed sub-issue without closing the card as well', async () => {
    // The handler used to sit on `window`, so it fired for every Escape on the
    // page: abandoning a sub-issue cost you the card it was being added to.
    const { onClose, user } = await openPanel()

    await user.click(screen.getByRole('button', { name: 'Sub-issue' }))
    const field = screen.getByLabelText('Title of the new sub-issue')
    await user.type(field, 'Write the migration')
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Title of the new sub-issue')).toBeNull()
  })

  it('cancels a half-typed label without closing the card as well', async () => {
    const { onClose, user } = await openPanel()

    await user.click(screen.getByRole('button', { name: 'New label' }))
    await user.type(screen.getByLabelText('New label'), 'regression')
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })
})

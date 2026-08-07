/**
 * Adding a column from the board itself.
 *
 * The full editor lives in the settings panel — category, colour, WIP limit,
 * order, deletion — but naming a new column is the one part of that job that
 * belongs where the columns are. Sending someone to a settings screen to answer
 * "what do you want to call it?" is the kind of detour that stops teams from
 * shaping the board at all.
 *
 * A column added here is `in-progress`, because that is the honest default for
 * a column somebody felt the need to add mid-flow. Guessing `todo` would reset
 * `startedAt` on every card dropped in, and guessing `done` would mark work
 * finished that nobody finished; the category is one control away in settings.
 */
import { type Status, byOrder, keyBetween } from '@kanbo/core'
import { useState } from 'react'

import { createPorts } from '../../state/store.ts'
import { useDispatch, useProject } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'

export function AddColumn() {
  const project = useProject()
  const dispatch = useDispatch()
  const [name, setName] = useState<string | null>(null)

  async function create() {
    const trimmed = (name ?? '').trim()
    if (trimmed === '') {
      setName(null)
      return
    }

    const ports = createPorts()
    const last = project.statuses.toSorted(byOrder).at(-1)
    const status: Status = {
      id: ports.random.id(),
      name: trimmed,
      category: 'in-progress',
      order: keyBetween(last?.order ?? null, null),
      wipLimit: null,
      color: null,
    }
    setName(null)
    await dispatch({ kind: 'status.upsert', status })
  }

  if (name === null) {
    return (
      <div className="kb-column kb-column--ghost">
        <Button variant="quiet" icon="plus" onClick={() => setName('')}>
          Add a column
        </Button>
      </div>
    )
  }

  return (
    <div className="kb-column kb-column--ghost">
      <input
        className="kb-input"
        autoFocus
        value={name}
        placeholder="Column name"
        aria-label="Name of the new column"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void create()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void create()
          if (event.key === 'Escape') setName(null)
        }}
      />
      <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
        <Icon name="clock" size={11} /> Counts as work in progress. Change that in Settings.
      </p>
    </div>
  )
}

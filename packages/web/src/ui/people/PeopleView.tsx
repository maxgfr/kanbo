import { type Member, type Project, busiest, workloads } from '@kanbo/core'
import { useState } from 'react'

import { readMeId, writeMeId } from '../../state/identity.ts'
import { createPorts } from '../../state/store.ts'
import { useDispatch } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'

/**
 * Who is carrying what, and which of them is you.
 *
 * The team was editable only as a list of names buried in settings, next to
 * labels and custom fields — which is where a *vocabulary* belongs, and not
 * where anyone looks to ask "what is Ada working on". Every figure here is read
 * off the board, so nothing can drift from it.
 *
 * It is also the only place the application can learn who is at this machine.
 * `assignee:@me` is offered in the README as an example of the query language
 * and could never match anything, because both the palette and the CLI passed a
 * null identity — there was no screen on which to claim a seat.
 */
export function PeopleView({
  project,
  onOpen,
  onMeChange,
}: {
  readonly project: Project
  readonly onOpen: (itemId: string) => void
  readonly onMeChange: () => void
}) {
  const dispatch = useDispatch()
  const [me, setMe] = useState<string | null>(readMeId)
  const rows = workloads(project, Date.now())
  const scale = busiest(rows)

  function claim(memberId: string | null) {
    writeMeId(memberId)
    setMe(memberId)
    // The palette and the filter bar both resolve `@me` at render, so whoever
    // is holding that has to be told the answer moved.
    onMeChange()
  }

  function addPerson() {
    const member: Member = { id: createPorts().random.id(), name: 'New person', handle: null }
    void dispatch({ kind: 'member.upsert', member })
  }

  return (
    <div style={{ overflowY: 'auto', padding: 'var(--space-5)' }}>
      <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: '64rem' }}>
        <div>
          <h1 style={{ fontSize: 'var(--step-2)', margin: 0, letterSpacing: '-0.02em' }}>People</h1>
          <p className="kb-muted" style={{ margin: 'var(--space-2) 0 0', lineHeight: 1.6 }}>
            There is no user directory and no accounts — a person here is a name the team agreed on.
            The handle is optional and exists so assignment can round-trip with a forge. Saying
            which one is you is remembered by this browser and never written to the project, because
            it is true of a machine rather than of a board.
          </p>
        </div>

        {project.members.length === 0 && (
          <p className="kb-muted" style={{ margin: 0 }}>
            Nobody yet. You can also invent someone straight from an item, which is usually the
            moment you want to.
          </p>
        )}

        {rows.map((row) => {
          const member = project.members.find((candidate) => candidate.id === row.memberId) ?? null
          // The unassigned lane is a reading of the board, not a person: it has
          // no name to edit, no handle, and no seat to claim.
          if (row.memberId !== null && !member) return null

          return (
            <section
              key={row.memberId ?? 'unassigned'}
              style={{
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--surface)',
                padding: 'var(--space-4)',
                display: 'grid',
                gap: 'var(--space-3)',
                opacity: row.memberId === null && row.open.length === 0 ? 0.6 : 1,
              }}
            >
              <div className="kb-row" style={{ flexWrap: 'wrap' }}>
                {member ? (
                  <>
                    <input
                      className="kb-input"
                      style={{ flex: '1 1 12rem', minWidth: '8rem' }}
                      value={member.name}
                      aria-label={`Name of ${member.name}`}
                      onChange={(event) =>
                        void dispatch({
                          kind: 'member.upsert',
                          member: { ...member, name: event.target.value },
                        })
                      }
                    />
                    <input
                      className="kb-input data"
                      style={{ width: '10rem' }}
                      value={member.handle ?? ''}
                      placeholder="forge handle"
                      aria-label={`Forge handle for ${member.name}`}
                      onChange={(event) =>
                        void dispatch({
                          kind: 'member.upsert',
                          member: { ...member, handle: event.target.value || null },
                        })
                      }
                    />
                    <Button
                      variant={me === member.id ? 'primary' : 'default'}
                      icon={me === member.id ? 'check' : 'person'}
                      aria-pressed={me === member.id}
                      title="Remembered by this browser only"
                      onClick={() => claim(me === member.id ? null : member.id)}
                    >
                      {me === member.id ? "That's me" : 'This is me'}
                    </Button>
                    <Button
                      variant="quiet"
                      icon="trash"
                      aria-label={`Remove ${member.name}`}
                      onClick={() => {
                        if (me === member.id) claim(null)
                        void dispatch({ kind: 'member.delete', memberId: member.id })
                      }}
                    />
                  </>
                ) : (
                  <>
                    <strong style={{ flex: 1 }}>Unassigned</strong>
                    <span className="kb-muted" style={{ fontSize: 'var(--step--1)' }}>
                      Work nobody has picked up
                    </span>
                  </>
                )}
              </div>

              <Load row={row} scale={scale} />

              {row.oldest && (
                <button
                  type="button"
                  className="kb-row"
                  style={{
                    border: 0,
                    background: 'transparent',
                    color: row.oldest.days >= 7 ? 'var(--signal-delayed)' : 'var(--ink-faint)',
                    font: 'inherit',
                    fontSize: 'var(--step--1)',
                    padding: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onClick={() => onOpen(row.oldest!.item.id)}
                >
                  <Icon name="clock" size={12} />
                  <span className="data">{row.oldest.item.ref}</span>
                  <span>
                    {row.oldest.item.title} — in progress for {row.oldest.days}{' '}
                    {row.oldest.days === 1 ? 'day' : 'days'}
                  </span>
                </button>
              )}
            </section>
          )
        })}

        <div>
          <Button icon="plus" onClick={addPerson}>
            Add a person
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * The bar is scaled against the busiest lane rather than against a fixed
 * number, because "a lot" only means anything relative to this team.
 */
function Load({
  row,
  scale,
}: {
  readonly row: ReturnType<typeof workloads>[number]
  readonly scale: number
}) {
  const filled = Math.round((row.open.length / scale) * 100)

  return (
    <div className="kb-row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      <div
        role="img"
        aria-label={`${row.open.length} open, ${row.inFlight.length} in progress`}
        style={{
          flex: '0 0 12rem',
          height: 8,
          borderRadius: 99,
          background: 'var(--ground)',
          border: '1px solid var(--rule)',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <span
          style={{
            width: `${filled}%`,
            background: row.memberId === null ? 'var(--ink-faint)' : 'var(--signal-boarding)',
          }}
        />
      </div>

      <span className="data" style={{ fontSize: 'var(--step--1)' }}>
        {row.inFlight.length} in progress
      </span>
      <span className="kb-muted data" style={{ fontSize: 'var(--step--1)' }}>
        {row.open.length} open · {row.points} pts
      </span>
      {row.blocked.length > 0 && (
        <span
          className="kb-row data"
          style={{ color: 'var(--signal-cancelled)', fontSize: 'var(--step--1)' }}
        >
          <Icon name="blocked" size={12} />
          {row.blocked.length} blocked
        </span>
      )}
    </div>
  )
}

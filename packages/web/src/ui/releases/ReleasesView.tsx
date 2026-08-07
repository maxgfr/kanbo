import {
  DAY,
  type Milestone,
  type Project,
  byOrder,
  changelogMarkdown,
  isoDay,
  keyBetween,
  milestoneProgress,
  shipped,
  suggestedTitle,
} from '@kanbo/core'
import { useMemo, useState } from 'react'

import { createPorts } from '../../state/store.ts'
import { useDispatch } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { Markdown } from '../design/Markdown.tsx'

export function ReleasesView({
  project,
  onOpen,
}: {
  readonly project: Project
  readonly onOpen: (itemId: string) => void
}) {
  const dispatch = useDispatch()
  const now = Date.now()
  const [windowDays, setWindowDays] = useState(14)
  /** Empty means "by date"; a milestone id means "everything in that release". */
  const [milestoneId, setMilestoneId] = useState('')
  const [title, setTitle] = useState(suggestedTitle(now))
  const [copied, setCopied] = useState(false)

  // A window and a release are two different questions — "what shipped this
  // fortnight" and "what shipped in v2.0" — and `shipped` has always taken
  // both. Only the window was reachable, so notes for a release could not be
  // generated at all. Choosing a release drops the window: work attached to a
  // release belongs in its notes whenever it was finished.
  const scope = useMemo(
    () =>
      milestoneId === ''
        ? { from: now - windowDays * DAY, to: now }
        : { from: 0, to: now, milestoneId },
    [milestoneId, windowDays, now],
  )

  const note = useMemo(() => changelogMarkdown(project, title, scope), [project, title, scope])
  const items = shipped(project, scope)

  async function addMilestone() {
    const ports = createPorts()
    const last = project.milestones.toSorted(byOrder).at(-1)
    const milestone: Milestone = {
      id: ports.random.id(),
      name: `v${project.milestones.length + 1}.0`,
      description: '',
      dueOn: isoDay(now + 30 * DAY),
      order: keyBetween(last?.order ?? null, null),
    }
    await dispatch({ kind: 'milestone.upsert', milestone })
  }

  return (
    <div style={{ overflowY: 'auto', padding: 'var(--space-5)' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
          maxWidth: '72rem',
        }}
      >
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="kb-row">
            <h2 style={{ fontSize: 'var(--step-2)' }}>Milestones</h2>
            <span className="kb-spacer" />
            <Button icon="plus" onClick={() => void addMilestone()}>
              New milestone
            </Button>
          </div>

          {project.milestones.length === 0 ? (
            <p className="kb-muted" style={{ margin: 0 }}>
              No milestones yet. One groups work towards a date without pretending to schedule it.
            </p>
          ) : (
            project.milestones.toSorted(byOrder).map((milestone) => {
              const progress = milestoneProgress(project, milestone)
              const percent =
                progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
              const overdue =
                milestone.dueOn !== null &&
                milestone.dueOn < isoDay(now) &&
                progress.done < progress.total

              return (
                <div
                  key={milestone.id}
                  style={{
                    border: '1px solid var(--rule)',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--surface)',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                  }}
                >
                  <div className="kb-row">
                    <input
                      className="kb-input"
                      style={{ width: 'auto', flex: 1 }}
                      value={milestone.name}
                      aria-label={`Name of ${milestone.name}`}
                      onChange={(event) =>
                        void dispatch({
                          kind: 'milestone.upsert',
                          milestone: { ...milestone, name: event.target.value },
                        })
                      }
                    />
                    <input
                      className="kb-input data"
                      type="date"
                      style={{ width: '10rem' }}
                      value={milestone.dueOn ?? ''}
                      aria-label={`Due date for ${milestone.name}`}
                      onChange={(event) =>
                        void dispatch({
                          kind: 'milestone.upsert',
                          milestone: { ...milestone, dueOn: event.target.value || null },
                        })
                      }
                    />
                    <span
                      className="data"
                      style={{ color: overdue ? 'var(--signal-cancelled)' : 'var(--ink-muted)' }}
                    >
                      {progress.done}/{progress.total}
                    </span>
                    {/* Deleting a release returns its items to no release at
                        all — the reducer clears the link rather than following
                        it. Nothing shipped is un-shipped by tidying up. */}
                    <Button
                      variant="quiet"
                      icon="trash"
                      aria-label={`Delete ${milestone.name}`}
                      onClick={() =>
                        void dispatch({ kind: 'milestone.delete', milestoneId: milestone.id })
                      }
                    />
                  </div>

                  {/* Progress by items closed, not by points: points measure
                      effort, and a milestone is finished when the work is. */}
                  <div
                    className="kb-meter"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${milestone.name} progress`}
                  >
                    <span
                      className="kb-meter__fill"
                      data-late={overdue || undefined}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="kb-row" style={{ flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 'var(--step-2)' }}>Release notes</h2>
            <span className="kb-spacer" />
            <input
              className="kb-input"
              style={{ width: '14rem' }}
              value={title}
              aria-label="Release title"
              onChange={(event) => setTitle(event.target.value)}
            />
            <select
              className="kb-select"
              style={{ width: 'auto' }}
              value={milestoneId === '' ? `days:${windowDays}` : `release:${milestoneId}`}
              aria-label="What to include"
              // Prefixed rather than sniffed: ids come from a base36 generator
              // and are occasionally all digits, so "is it a number?" would
              // sooner or later read a release as a number of days.
              onChange={(event) => {
                const [kind = '', value = ''] = event.target.value.split(':')
                if (kind === 'days') {
                  setMilestoneId('')
                  setWindowDays(Number(value))
                } else {
                  setMilestoneId(value)
                }
              }}
            >
              <option value="days:7">Last 7 days</option>
              <option value="days:14">Last 14 days</option>
              <option value="days:30">Last 30 days</option>
              <option value="days:90">Last 90 days</option>
              {project.milestones.toSorted(byOrder).map((milestone) => (
                <option key={milestone.id} value={`release:${milestone.id}`}>
                  Everything in {milestone.name}
                </option>
              ))}
            </select>
            <Button
              icon={copied ? 'check' : 'link'}
              disabled={note === ''}
              onClick={() => {
                void navigator.clipboard.writeText(note).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {copied ? 'Copied' : 'Copy Markdown'}
            </Button>
          </div>

          {note === '' ? (
            <p className="kb-muted" style={{ margin: 0 }}>
              Nothing was completed in this period. A release note claiming a release that did not
              happen is worse than no note.
            </p>
          ) : (
            <>
              <div
                style={{
                  border: '1px solid var(--rule)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--surface)',
                  padding: 'var(--space-4)',
                }}
              >
                <Markdown source={note} />
              </div>
              <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
                Generated from the {items.length} item{items.length === 1 ? '' : 's'} the board
                recorded as completed. Nothing here was typed twice.
              </p>
              <div className="kb-row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="kb-button kb-button--quiet"
                    style={{ fontFamily: 'var(--font-data)' }}
                    onClick={() => onOpen(item.id)}
                  >
                    <Icon name="check" size={12} />
                    {item.ref}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

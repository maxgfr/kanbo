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

import { createPorts } from '../../state/store'
import { useDispatch } from '../../state/useStore'
import { Button } from '../design/Button'
import { Icon } from '../design/Icon'
import { Markdown } from '../design/Markdown'

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
  const [title, setTitle] = useState(suggestedTitle(now))
  const [copied, setCopied] = useState(false)

  const from = now - windowDays * DAY
  const note = useMemo(
    () => changelogMarkdown(project, title, { from, to: now }),
    [project, title, from, now],
  )
  const items = shipped(project, { from, to: now })

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
                  </div>

                  {/* Progress by items closed, not by points: points measure
                      effort, and a milestone is finished when the work is. */}
                  <div
                    style={{
                      height: 4,
                      borderRadius: 2,
                      background: 'var(--surface-sunken)',
                      overflow: 'hidden',
                    }}
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${milestone.name} progress`}
                  >
                    <div
                      style={{
                        width: `${percent}%`,
                        height: '100%',
                        background: overdue ? 'var(--signal-cancelled)' : 'var(--signal-departed)',
                      }}
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
              value={windowDays}
              aria-label="Period"
              onChange={(event) => setWindowDays(Number(event.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
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

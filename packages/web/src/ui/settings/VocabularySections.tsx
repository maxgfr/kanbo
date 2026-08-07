/**
 * The lists a project labels its work with: labels, people, custom fields.
 *
 * All three were in the model and none of them had an editor. Labels and
 * assignees can now be invented from an item, which is where you actually want
 * them — but renaming one, recolouring it, or removing it from every item at
 * once is a project-level job, and this is where it lives.
 *
 * Deletion says what it costs. `label.delete` and `member.delete` drop the id
 * from every item that carried it, and `field.delete` strips the key from every
 * item's values; that is the reducer's rule, not a warning we could choose to
 * skip.
 */
import { type Field, type FieldType, byOrder, keyBetween } from '@kanbo/core'
import { type ReactNode, useState } from 'react'

import { createPorts } from '../../state/store.ts'
import { useDispatch, useProject } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'

const FIELD_TYPES: readonly FieldType[] = [
  'text',
  'number',
  'select',
  'multi-select',
  'date',
  'checkbox',
  'url',
  'person',
  'iteration',
]

function Row({ children }: { readonly children: ReactNode }) {
  return (
    <div className="kb-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {children}
    </div>
  )
}

/**
 * The choices of a select field, typed as one comma-separated line.
 *
 * The text is held here rather than derived from the stored options on every
 * render, because the two are not the same thing while someone is typing. A
 * controlled input showing `options.join(', ')` unparsed its own value on every
 * keystroke: type `high` then a comma, and the comma split off an empty
 * fragment that was filtered away, so the field re-rendered as `high` with the
 * caret moved. A second choice could not be typed at all — only pasted.
 *
 * Parsed on the way out instead. What you typed stays on screen until you leave
 * the field, and the stored list is the same either way.
 */
function ChoicesInput({ field }: { readonly field: Field }) {
  const dispatch = useDispatch()
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const options = draft
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean)
    setDraft(null)
    // Compared element by element rather than through a joined string, so
    // no separator has to be a character a choice could not contain.
    const unchanged =
      options.length === field.options.length &&
      options.every((option, at) => option === field.options[at])
    if (unchanged) return
    void dispatch({ kind: 'field.upsert', field: { ...field, options } })
  }

  return (
    <input
      className="kb-input"
      value={draft ?? field.options.join(', ')}
      placeholder="Choices, separated by commas"
      aria-label={`Choices for ${field.name}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
    />
  )
}

export function LabelsSection() {
  const project = useProject()
  const dispatch = useDispatch()

  return (
    <section className="kb-field">
      <h2 className="kb-field__label">Labels</h2>

      {project.labels.length === 0 && (
        <p className="kb-muted" style={{ margin: 0 }}>
          None yet. You can invent one straight from an item, which is usually the moment you want
          it.
        </p>
      )}

      {project.labels.map((label) => (
        <Row key={label.id}>
          <input
            className="kb-input"
            type="color"
            style={{ width: '2rem', padding: 0, flex: '0 0 auto' }}
            value={label.color}
            aria-label={`Colour of ${label.name}`}
            onChange={(event) =>
              void dispatch({
                kind: 'label.upsert',
                label: { ...label, color: event.target.value },
              })
            }
          />
          <input
            className="kb-input"
            style={{ flex: 1, minWidth: '8rem' }}
            value={label.name}
            aria-label={`Name of the ${label.name} label`}
            onChange={(event) =>
              void dispatch({ kind: 'label.upsert', label: { ...label, name: event.target.value } })
            }
          />
          <span className="kb-muted data">
            {project.items.filter((item) => item.labels.includes(label.id)).length}
          </span>
          <Button
            variant="quiet"
            icon="trash"
            aria-label={`Delete the ${label.name} label`}
            onClick={() => void dispatch({ kind: 'label.delete', labelId: label.id })}
          />
        </Row>
      ))}

      <div>
        <Button
          icon="plus"
          onClick={() =>
            void dispatch({
              kind: 'label.upsert',
              label: { id: createPorts().random.id(), name: 'New label', color: '#6b7280' },
            })
          }
        >
          Add a label
        </Button>
      </div>
    </section>
  )
}

export function MembersSection() {
  const project = useProject()
  const dispatch = useDispatch()

  return (
    <section className="kb-field">
      <h2 className="kb-field__label">People</h2>
      <p className="kb-muted" style={{ margin: 0, lineHeight: 1.6 }}>
        There is no user directory and no accounts — a person here is a name the team agreed on. The
        handle is optional and only exists so assignment can round-trip with a forge.
      </p>

      {project.members.map((member) => (
        <Row key={member.id}>
          <input
            className="kb-input"
            style={{ flex: 1, minWidth: '8rem' }}
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
            variant="quiet"
            icon="trash"
            aria-label={`Remove ${member.name}`}
            onClick={() => void dispatch({ kind: 'member.delete', memberId: member.id })}
          />
        </Row>
      ))}

      <div>
        <Button
          icon="plus"
          onClick={() =>
            void dispatch({
              kind: 'member.upsert',
              member: { id: createPorts().random.id(), name: 'New person', handle: null },
            })
          }
        >
          Add a person
        </Button>
      </div>
    </section>
  )
}

export function FieldsSection() {
  const project = useProject()
  const dispatch = useDispatch()
  const [deleting, setDeleting] = useState<string | null>(null)

  const fields = project.fields.toSorted(byOrder)

  function addField() {
    const field: Field = {
      id: createPorts().random.id(),
      name: 'New field',
      type: 'text',
      options: [],
      order: keyBetween(fields.at(-1)?.order ?? null, null),
    }
    void dispatch({ kind: 'field.upsert', field })
  }

  return (
    <section className="kb-field">
      <h2 className="kb-field__label">Custom fields</h2>
      <p className="kb-muted" style={{ margin: 0, lineHeight: 1.6 }}>
        Anything the built-in fields do not cover. They appear on every item and travel with an
        export.
      </p>

      {fields.map((field) => (
        <div
          key={field.id}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
        >
          <Row>
            <input
              className="kb-input"
              style={{ flex: 1, minWidth: '8rem' }}
              value={field.name}
              aria-label={`Name of the ${field.name} field`}
              onChange={(event) =>
                void dispatch({
                  kind: 'field.upsert',
                  field: { ...field, name: event.target.value },
                })
              }
            />
            <select
              className="kb-select"
              style={{ width: 'auto' }}
              value={field.type}
              aria-label={`Type of ${field.name}`}
              onChange={(event) =>
                void dispatch({
                  kind: 'field.upsert',
                  field: { ...field, type: event.target.value as FieldType },
                })
              }
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <Button
              variant="quiet"
              icon="trash"
              aria-label={`Delete the ${field.name} field`}
              onClick={() => setDeleting(deleting === field.id ? null : field.id)}
            />
          </Row>

          {(field.type === 'select' || field.type === 'multi-select') && (
            <ChoicesInput field={field} />
          )}

          {deleting === field.id && (
            <Row>
              {/* Said before it happens: the reducer strips the key from every
                  item, so the values go with the field. */}
              <span className="kb-muted">
                Deleting {field.name} removes its value from every item.
              </span>
              <Button
                variant="danger"
                onClick={() => {
                  setDeleting(null)
                  void dispatch({ kind: 'field.delete', fieldId: field.id })
                }}
              >
                Delete field
              </Button>
              <Button variant="quiet" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
            </Row>
          )}
        </div>
      ))}

      <div>
        <Button icon="plus" onClick={addField}>
          Add a field
        </Button>
      </div>
    </section>
  )
}

/**
 * The project's custom fields, on an item.
 *
 * `item.setField` and `Field` have always existed; the connectors even use the
 * same store as a private namespace (`github.issue` remembers which issue a
 * card mirrors). What was missing was any way for a person to define a field
 * and fill it in — so the feature existed for the software and not for the team.
 *
 * Renders nothing at all when a project has no custom fields. An empty section
 * headed "Custom fields" on every item would be a permanent invitation to a
 * feature most boards never need.
 */
import { type Field, type FieldValue, type Item, type Project, byOrder } from '@kanbo/core'

import { useDispatch } from '../../state/useStore.ts'

export function ItemFields({ project, item }: { readonly project: Project; readonly item: Item }) {
  const dispatch = useDispatch()
  const fields = project.fields.toSorted(byOrder)
  if (fields.length === 0) return null

  const set = (fieldId: string, value: FieldValue) =>
    void dispatch({ kind: 'item.setField', itemId: item.id, fieldId, value })

  return (
    <div className="kb-field">
      <span className="kb-field__label">Custom fields</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            project={project}
            value={item.fields[field.id] ?? null}
            onChange={(value) => set(field.id, value)}
          />
        ))}
      </div>
    </div>
  )
}

function FieldInput({
  field,
  project,
  value,
  onChange,
}: {
  readonly field: Field
  readonly project: Project
  readonly value: FieldValue
  readonly onChange: (value: FieldValue) => void
}) {
  const id = `kb-field-${field.id}`
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''

  return (
    <div className="kb-field">
      <label className="kb-field__label" htmlFor={id}>
        {field.name}
      </label>

      {field.type === 'checkbox' ? (
        <input
          id={id}
          type="checkbox"
          style={{ width: '1rem', height: '1rem' }}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : field.type === 'select' ? (
        <select
          id={id}
          className="kb-select"
          value={text}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">None</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === 'multi-select' ? (
        <select
          id={id}
          className="kb-select"
          multiple
          size={Math.min(field.options.length, 4)}
          value={Array.isArray(value) ? [...value] : []}
          onChange={(event) =>
            onChange([...event.target.selectedOptions].map((option) => option.value))
          }
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === 'person' ? (
        <select
          id={id}
          className="kb-select"
          value={text}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">None</option>
          {project.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      ) : field.type === 'iteration' ? (
        <select
          id={id}
          className="kb-select"
          value={text}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">None</option>
          {project.iterations.toSorted(byOrder).map((iteration) => (
            <option key={iteration.id} value={iteration.id}>
              {iteration.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={
            field.type === 'number' || field.type === 'date' ? 'kb-input data' : 'kb-input'
          }
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          inputMode={field.type === 'url' ? 'url' : undefined}
          value={text}
          placeholder={field.type === 'url' ? 'https://' : undefined}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') return onChange(null)
            // Numbers are stored as numbers so that sorting and `points:>3`
            // style comparisons mean what they say.
            onChange(field.type === 'number' ? Number(raw) : raw)
          }}
        />
      )}
    </div>
  )
}

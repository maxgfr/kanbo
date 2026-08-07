/**
 * The two controls the item panel repeats.
 *
 * `TokenPicker` exists because labels, assignees and any future list-of-things
 * are the same interaction wearing different nouns: pick from what the project
 * already has, and add to that list without leaving the item. Sending someone
 * to a settings screen to invent a label before they can apply it is how label
 * vocabularies end up empty.
 */
import { useState } from 'react'

import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly (readonly [string, string])[]
  readonly onChange: (value: string) => void
}) {
  const id = `kb-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <div className="kb-field">
      <label className="kb-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="kb-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}

export type Token = {
  readonly id: string
  readonly name: string
  readonly color?: string | null
}

export type TokenPickerProps = {
  readonly label: string
  /** Everything the project knows about, whether or not this item uses it. */
  readonly available: readonly Token[]
  readonly selected: readonly string[]
  readonly onChange: (ids: readonly string[]) => void
  /** Returns the id of the thing it created, so it can be selected at once. */
  readonly onCreate: (name: string) => string
  readonly placeholder: string
}

export function TokenPicker({
  label,
  available,
  selected,
  onChange,
  onCreate,
  placeholder,
}: TokenPickerProps) {
  const [creating, setCreating] = useState<string | null>(null)

  // "New" alone would be the accessible name of every one of these on the
  // panel; a screen reader reading three identical buttons in a row is telling
  // you nothing.
  const singular = `New ${label.toLowerCase().replace(/s$/, '')}`

  const chosen = selected
    .map((id) => available.find((token) => token.id === id))
    .filter((token): token is Token => token !== undefined)
  const rest = available.filter((token) => !selected.includes(token.id))

  function create() {
    const name = (creating ?? '').trim()
    setCreating(null)
    if (name === '') return
    // An existing name is reused rather than duplicated: two labels called
    // "bug" is a vocabulary that has already started to rot.
    const existing = available.find((token) => token.name.toLowerCase() === name.toLowerCase())
    const id = existing?.id ?? onCreate(name)
    if (!selected.includes(id)) onChange([...selected, id])
  }

  return (
    <div className="kb-field">
      <span className="kb-field__label">{label}</span>

      <div className="kb-row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {chosen.length === 0 && creating === null && <span className="kb-muted">None yet.</span>}

        {chosen.map((token) => (
          <span key={token.id} className="kb-token">
            {token.color != null && (
              <span className="kb-token__dot" style={{ background: token.color }} aria-hidden />
            )}
            {token.name}
            <button
              type="button"
              className="kb-token__remove"
              aria-label={`Remove ${token.name}`}
              onClick={() => onChange(selected.filter((id) => id !== token.id))}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
      </div>

      {creating === null ? (
        <div className="kb-row" style={{ gap: 'var(--space-2)' }}>
          {rest.length > 0 && (
            <select
              className="kb-select"
              value=""
              aria-label={`Add to ${label.toLowerCase()}`}
              onChange={(event) => {
                if (event.target.value) onChange([...selected, event.target.value])
              }}
            >
              <option value="">{placeholder}</option>
              {rest.map((token) => (
                <option key={token.id} value={token.id}>
                  {token.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="quiet" icon="plus" aria-label={singular} onClick={() => setCreating('')}>
            New
          </Button>
        </div>
      ) : (
        <input
          className="kb-input"
          autoFocus
          value={creating}
          placeholder={placeholder}
          aria-label={singular}
          onChange={(event) => setCreating(event.target.value)}
          onBlur={create}
          onKeyDown={(event) => {
            if (event.key === 'Enter') create()
            if (event.key === 'Escape') {
              // Claimed: abandoning a half-typed label is not a request to
              // close the panel it was being typed in.
              event.stopPropagation()
              setCreating(null)
            }
          }}
        />
      )}
    </div>
  )
}

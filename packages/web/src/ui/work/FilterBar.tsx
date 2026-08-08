import { QUALIFIERS } from '@kanbo/core'
import { useRef } from 'react'

import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'

/**
 * The query language, where you can stay in it.
 *
 * It existed only inside ⌘K, which *navigates*: you could type
 * `assignee:@me is:blocked`, open one of the results, and the state that found
 * it was gone. Answering "what is blocked on my plate" therefore meant
 * retyping the question after every card. Here the same string narrows the
 * screen and stays narrowed.
 *
 * The qualifier hints are the palette's, deliberately: a language discoverable
 * in one box and hidden in the other is a language people learn twice.
 */
export function FilterBar({
  value,
  onChange,
  shown,
  total,
}: {
  readonly value: string
  readonly onChange: (query: string) => void
  readonly shown: number
  readonly total: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const active = value.trim() !== ''

  return (
    <div className="kb-filter">
      <label className="kb-filter__field">
        <Icon name="search" size={14} />
        <input
          ref={inputRef}
          id="kb-filter"
          className="kb-filter__input"
          value={value}
          placeholder="Filter — is:blocked, assignee:@me, type:bug points:>3"
          aria-label="Filter the work"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            // Claimed, so it clears the filter rather than reaching whatever
            // else on the page listens for Escape.
            event.stopPropagation()
            onChange('')
          }}
        />
        {active && (
          <span className="data kb-muted" style={{ fontSize: 'var(--step--1)' }}>
            {shown} of {total}
          </span>
        )}
      </label>

      {active ? (
        <Button
          variant="quiet"
          icon="close"
          aria-label="Clear the filter"
          onClick={() => onChange('')}
        />
      ) : (
        <div className="kb-filter__hints">
          {QUALIFIERS.slice(0, 5).map((qualifier) => (
            <button
              key={qualifier.key}
              type="button"
              className="kb-palette__hint"
              title={qualifier.hint}
              onClick={() => {
                onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${qualifier.key}:`)
                inputRef.current?.focus()
              }}
            >
              {qualifier.key}:
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import { QUALIFIERS } from '@kanbo/core'
import { useRef } from 'react'

import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'

/**
 * The questions people actually ask, written in the language they could have
 * typed.
 *
 * These are not a second mechanism: each one puts its query in the box, so what
 * a chip does is visible, editable and combinable with anything else. A preset
 * that filtered by some hidden means would be a second definition of "blocked"
 * waiting to disagree with the first.
 *
 * "Mine" is the reason People can be told who you are.
 */
export const PRESETS: readonly { readonly label: string; readonly query: string }[] = [
  { label: 'Mine', query: 'assignee:@me' },
  { label: 'Blocked', query: 'is:blocked' },
  { label: 'Overdue', query: 'is:overdue' },
  { label: 'Unestimated', query: '-has:estimate' },
  { label: 'This sprint', query: 'sprint:current' },
]

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
  me,
}: {
  readonly value: string
  readonly onChange: (query: string) => void
  readonly shown: number
  readonly total: number
  /** Whose plate "Mine" means, or null when nobody has claimed a seat. */
  readonly me: string | null
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

      <div className="kb-filter__hints">
        {PRESETS.map((preset) => {
          const on = value.trim() === preset.query
          // "Mine" without a seat claimed would silently match nothing, which
          // is exactly the failure this whole thread of work was about. Say why
          // instead of offering a control that does nothing.
          const useless = preset.query === 'assignee:@me' && me === null
          return (
            <button
              key={preset.label}
              type="button"
              className="kb-palette__hint"
              aria-pressed={on}
              data-active={on || undefined}
              disabled={useless}
              title={
                useless
                  ? 'Nobody is claimed on this browser yet — say which person you are in People.'
                  : preset.query
              }
              onClick={() => onChange(on ? '' : preset.query)}
            >
              {preset.label}
            </button>
          )
        })}

        {active ? (
          <Button
            variant="quiet"
            icon="close"
            aria-label="Clear the filter"
            onClick={() => onChange('')}
          />
        ) : (
          QUALIFIERS.slice(0, 3).map((qualifier) => (
            <button
              key={qualifier.key}
              type="button"
              className="kb-palette__hint kb-filter__qualifier"
              title={qualifier.hint}
              onClick={() => {
                onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${qualifier.key}:`)
                inputRef.current?.focus()
              }}
            >
              {qualifier.key}:
            </button>
          ))
        )}
      </div>
    </div>
  )
}

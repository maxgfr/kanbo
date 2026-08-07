import type { StatusCategory } from '@kanbo/core'
import { useEffect, useRef, useState } from 'react'

export type Signal = 'boarding' | 'departed' | 'delayed' | 'cancelled' | 'scheduled'

export function signalForCategory(category: StatusCategory): Signal {
  if (category === 'done') return 'departed'
  if (category === 'in-progress') return 'boarding'
  return 'scheduled'
}

export type StatusChipProps = {
  readonly label: string
  readonly signal: Signal
  /** Suppress the flip where a chip is being rendered in bulk, as in a table. */
  readonly animate?: boolean
}

/**
 * The one authored motion in Kanbo.
 *
 * A departure board announces a change by flipping the character, and that is
 * exactly the event this interface most needs someone to notice: a card whose
 * status changed under them while they were reading the column. The flip is
 * not decoration — it is the only thing that makes a remote change legible
 * without an alert, and it is why status is the only element here that moves.
 *
 * It fires on change, never on mount, so arriving at a board does not set forty
 * chips flapping.
 */
export function StatusChip({ label, signal, animate = true }: StatusChipProps) {
  const [shown, setShown] = useState(label)
  const [flipping, setFlipping] = useState(false)
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      setShown(label)
      return
    }
    if (label === shown) return

    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(label)
      return
    }

    setFlipping(true)
    // Swap at the midpoint, while the panel is edge-on and the old text cannot
    // be read anyway.
    const swap = window.setTimeout(() => setShown(label), 130)
    const settle = window.setTimeout(() => setFlipping(false), 260)
    return () => {
      window.clearTimeout(swap)
      window.clearTimeout(settle)
    }
  }, [label, shown, animate])

  return (
    <span className={`kb-chip kb-chip--${signal}`} data-flipping={flipping || undefined}>
      <span className="kb-chip__face">{shown}</span>
    </span>
  )
}

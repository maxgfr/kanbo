/** @vitest-environment jsdom */
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StatusChip, signalForCategory } from './StatusChip.tsx'

/**
 * The one authored motion in Kanbo, and the only thing that makes a change
 * somebody else made legible without an alert. It used to work for the first
 * change a chip saw and be silently dead after — the flag that drives the
 * animation got stuck on, so the attribute never toggled again and the browser
 * never restarted the keyframes.
 */
function chipOf(container: HTMLElement) {
  return container.querySelector('.kb-chip')!
}

const flipping = (container: HTMLElement) => chipOf(container).hasAttribute('data-flipping')

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('StatusChip', () => {
  it('does not flip on arrival, so a board does not open flapping', () => {
    const { container } = render(<StatusChip label="Backlog" signal="scheduled" />)
    expect(flipping(container)).toBe(false)
    expect(chipOf(container).textContent).toBe('Backlog')
  })

  it('flips when the status changes, and settles afterwards', () => {
    const { container, rerender } = render(<StatusChip label="Backlog" signal="scheduled" />)

    rerender(<StatusChip label="In Progress" signal="boarding" />)
    expect(flipping(container)).toBe(true)

    act(() => vi.advanceTimersByTime(130))
    expect(chipOf(container).textContent).toBe('In Progress')

    act(() => vi.advanceTimersByTime(130))
    expect(flipping(container)).toBe(false)
  })

  it('flips again on the next change, not only on the first', () => {
    // The regression: the swap at the midpoint changed the effect's own
    // dependencies, the cleanup cancelled the timer that would have cleared the
    // flag, and every later change found it already set.
    const { container, rerender } = render(<StatusChip label="Backlog" signal="scheduled" />)

    rerender(<StatusChip label="In Progress" signal="boarding" />)
    // Advanced in two steps, past the swap and then past the settle, so React
    // commits the mid-flip state change in between. Jumping the whole way at
    // once lets the second timer fire before the re-render and hides exactly
    // the interaction that was broken.
    act(() => vi.advanceTimersByTime(130))
    act(() => vi.advanceTimersByTime(130))
    expect(flipping(container)).toBe(false)

    rerender(<StatusChip label="Done" signal="departed" />)
    expect(flipping(container)).toBe(true)

    act(() => vi.advanceTimersByTime(130))
    act(() => vi.advanceTimersByTime(130))
    expect(chipOf(container).textContent).toBe('Done')
    expect(flipping(container)).toBe(false)
  })

  it('swaps without flipping where the flip was switched off', () => {
    const { container, rerender } = render(
      <StatusChip label="Backlog" signal="scheduled" animate={false} />,
    )
    rerender(<StatusChip label="Done" signal="departed" animate={false} />)

    expect(flipping(container)).toBe(false)
    expect(chipOf(container).textContent).toBe('Done')
  })

  it('swaps without flipping for anyone who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const { container, rerender } = render(<StatusChip label="Backlog" signal="scheduled" />)
    rerender(<StatusChip label="Done" signal="departed" />)

    expect(flipping(container)).toBe(false)
    expect(chipOf(container).textContent).toBe('Done')
  })
})

describe('signalForCategory', () => {
  it('reads the category rather than the name, as the metrics do', () => {
    expect(signalForCategory('done')).toBe('departed')
    expect(signalForCategory('in-progress')).toBe('boarding')
    expect(signalForCategory('todo')).toBe('scheduled')
  })
})

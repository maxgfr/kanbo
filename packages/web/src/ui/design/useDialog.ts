import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef } from 'react'

/**
 * What every dialog in Kanbo owes a keyboard.
 *
 * Four panels here claim `aria-modal`, and they used to disagree about every
 * part of what that promises. The item panel closed on Escape; the settings
 * panel and the share dialog had no key at all, so the only way out was to Tab
 * to the Close button; the command palette bound Escape to its own input, which
 * meant it stopped working the moment focus reached a result row — a palette a
 * keyboard user could open and not dismiss. None of them gave focus back to the
 * control that opened them, so every card you opened cost you your place in the
 * page.
 *
 * **Escape belongs to the dialog element, not to the window.** A window
 * listener fires for every Escape anywhere on the page, so cancelling a
 * half-typed sub-issue closed the whole card with it: the inner control handled
 * the key, and the outer one closed regardless. Handled here as a React event,
 * an inner handler that calls `stopPropagation` is the end of the matter —
 * which is the ordinary meaning of "I handled that", and now it holds.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const opener = document.activeElement
    const panel = ref.current

    // Focus has to start inside the dialog, or Escape has nothing to bubble
    // through and the first Tab lands somewhere behind it.
    const wanted = panel?.querySelector<HTMLElement>('[data-dialog-focus]') ?? panel
    wanted?.focus()

    return () => {
      // Back where it came from, so the next Tab continues from the card or the
      // button you were on rather than from the top of the document.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    },
    [onClose],
  )

  return { ref, onKeyDown }
}

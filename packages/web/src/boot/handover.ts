/**
 * What survives the document swap.
 *
 * Switching between local and repository mode is a navigation from one document
 * to the other — that is the whole design, because the policy belongs to the
 * document rather than to our code. But it destroys every piece of React state
 * on the way, including the fact that the settings panel was open, which is
 * where the switch was made. Without something to carry that across, changing
 * mode dumps you on the board with nothing to say it worked.
 *
 * `sessionStorage` rather than the hash or `localStorage`: it is scoped to this
 * tab and this origin, it survives a navigation within the tab, and it dies
 * with the tab — which is exactly the lifetime of "I was in the middle of
 * something". The hash is reserved for shares, and `localStorage` would reopen
 * the panel in a window opened next week.
 */
const KEY = 'kanbo.handover'

/** The one thing worth carrying across, so far. */
export type Handover = 'settings'

export function handOver(what: Handover): void {
  try {
    sessionStorage.setItem(KEY, what)
  } catch {
    // Storage blocked. The switch still happens; only the panel fails to
    // reopen, which is the behaviour we had before this existed.
  }
}

/**
 * Read once, then answer the same way for the rest of the page's life.
 *
 * The marker has to be cleared as soon as it is read, or a later reload would
 * reopen a panel nobody asked for. But a value that vanishes on first read
 * cannot be called twice, and React calls state initialisers twice under
 * `StrictMode` — the second call would see nothing and the panel would stay
 * shut in development only. Caching the answer makes the function safe to ask
 * as often as anyone likes.
 */
let taken: Handover | null | undefined

export function takeHandover(): Handover | null {
  if (taken !== undefined) return taken

  taken = null
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    if (raw === 'settings') taken = raw
  } catch {
    // Nothing stored, nothing to restore.
  }
  return taken
}

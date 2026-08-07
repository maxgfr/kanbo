export type Theme = 'dark' | 'light' | 'system'

const KEY = 'kanbo.theme'

const SYSTEM_IS_LIGHT = '(prefers-color-scheme: light)'

/**
 * The system decides, until someone says otherwise.
 *
 * Kanbo's palette is drawn dark-first — the scene it was designed for is a
 * developer with an editor in dark mode on the next monitor, and a standup
 * where the board is projected onto a wall a white ground would flood. But
 * that is an argument about which theme to *design* well, not about which one
 * to impose: someone who set their machine to light mode has already answered
 * the question, and overriding that is the app telling them they were wrong.
 *
 * Light is a real daylight inversion rather than an afterthought, so following
 * the system costs nothing.
 */
export function currentTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    // Storage blocked; the default below still applies.
  }
  return 'system'
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // The document still updates; only the preference fails to persist.
  }
  applyTheme(theme)
}

export function resolveTheme(theme: Theme = currentTheme()): 'dark' | 'light' {
  if (theme !== 'system') return theme
  try {
    return window.matchMedia(SYSTEM_IS_LIGHT).matches ? 'light' : 'dark'
  } catch {
    // No matchMedia at all: fall back to the palette's own home.
    return 'dark'
  }
}

export function applyTheme(theme: Theme = currentTheme()): void {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset['theme'] = resolved
  document.documentElement.style.colorScheme = resolved
}

/**
 * Follow the system while it is the chosen setting.
 *
 * Without this, "system" would mean "whatever the system was when the tab
 * opened" — which is wrong for anyone whose machine switches at dusk, and
 * wrong for exactly the people who chose the setting. Returns a teardown so
 * the listener does not outlive the app.
 */
export function watchSystemTheme(): () => void {
  let query: MediaQueryList
  try {
    query = window.matchMedia(SYSTEM_IS_LIGHT)
  } catch {
    return () => {}
  }

  const onChange = () => {
    // Re-read the preference rather than closing over it: someone may have
    // picked an explicit theme since, and the system must stop deciding then.
    if (currentTheme() === 'system') applyTheme('system')
  }

  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

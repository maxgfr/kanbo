export type Theme = 'dark' | 'light' | 'system'

const KEY = 'kanbo.theme'

/**
 * Dark is the default, and not by category habit.
 *
 * The scene decides it: a developer with an editor in dark mode on the next
 * monitor, and a standup where this board is projected onto a wall, where a
 * white ground floods the room. Light is a real daylight inversion for bright
 * meeting rooms, and `system` defers to whoever asked.
 */
export function currentTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    // Storage blocked; the default below still applies.
  }
  return 'dark'
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // The document still updates; only the preference fails to persist.
  }
  applyTheme(theme)
}

export function applyTheme(theme: Theme = currentTheme()): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme
  document.documentElement.dataset['theme'] = resolved
  document.documentElement.style.colorScheme = resolved
}

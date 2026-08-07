/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, currentTheme, resolveTheme, setTheme, watchSystemTheme } from './theme.ts'

/**
 * The system decides until someone says otherwise, and that had no test at all
 * — only the browser smoke run, which cannot say why a wrong answer is wrong.
 */
type Listener = () => void

function systemSaysLight(light: boolean) {
  const listeners = new Set<Listener>()
  const query = {
    matches: light,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', () => query)
  return {
    listeners,
    change(nowLight: boolean) {
      query.matches = nowLight
      for (const listener of listeners) listener()
    },
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('currentTheme', () => {
  it('is the system by default, because the machine has already answered', () => {
    expect(currentTheme()).toBe('system')
  })

  it('remembers an explicit choice', () => {
    setTheme('light')
    expect(currentTheme()).toBe('light')
    expect(localStorage.getItem('kanbo.theme')).toBe('light')
  })

  it('ignores a stored value it does not recognise', () => {
    localStorage.setItem('kanbo.theme', 'sepia')
    expect(currentTheme()).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('follows a light system', () => {
    systemSaysLight(true)
    expect(resolveTheme('system')).toBe('light')
  })

  it('follows a dark system', () => {
    systemSaysLight(false)
    expect(resolveTheme('system')).toBe('dark')
  })

  it('does not consult the system once someone has chosen', () => {
    systemSaysLight(true)
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('falls back to the palette"s own home when there is no matchMedia', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('no matchMedia here')
    })
    expect(resolveTheme('system')).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('writes the resolved theme onto the document, colour scheme included', () => {
    systemSaysLight(true)
    applyTheme('system')
    expect(document.documentElement.dataset['theme']).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

describe('watchSystemTheme', () => {
  it('follows the system while the system is the setting', () => {
    // Wrong for anyone whose machine switches at dusk, and wrong for exactly
    // the people who chose to follow it.
    const system = systemSaysLight(false)
    applyTheme('system')
    const stop = watchSystemTheme()

    system.change(true)
    expect(document.documentElement.dataset['theme']).toBe('light')
    stop()
  })

  it('stops deciding once someone picks a theme', () => {
    const system = systemSaysLight(false)
    const stop = watchSystemTheme()
    setTheme('dark')

    system.change(true)
    expect(document.documentElement.dataset['theme']).toBe('dark')
    stop()
  })

  it('removes its listener, so it does not outlive the app', () => {
    const system = systemSaysLight(false)
    watchSystemTheme()()
    expect(system.listeners.size).toBe(0)
  })
})

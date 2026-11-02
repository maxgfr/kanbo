/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KANBO_DATABASES, wipeEverything } from './storage.ts'

/**
 * GitHub Pages serves every project of the account from one origin, so the
 * erase button shares its storage with unrelated apps. It must take Kanbo's
 * data and nothing else.
 */
function fakeIndexedDb() {
  const deleted: string[] = []
  vi.stubGlobal('indexedDB', {
    deleteDatabase(name: string) {
      deleted.push(name)
      const target = new EventTarget()
      queueMicrotask(() => target.dispatchEvent(new Event('success')))
      return target
    },
  })
  return deleted
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('wipeEverything', () => {
  it('deletes both Kanbo databases', async () => {
    const deleted = fakeIndexedDb()
    await wipeEverything()
    expect(deleted.sort()).toEqual([...KANBO_DATABASES].sort())
  })

  it('removes only the kanbo. keys from the shared storage', async () => {
    fakeIndexedDb()
    localStorage.setItem('kanbo.theme', 'dark')
    localStorage.setItem('kanbo.sync', '{}')
    localStorage.setItem('theme', 'light')
    localStorage.setItem('goodscan:settings', '{}')
    sessionStorage.setItem('kanbo.handover', 'settings')
    sessionStorage.setItem('other-app', '1')

    await wipeEverything()

    expect(localStorage.getItem('kanbo.theme')).toBeNull()
    expect(localStorage.getItem('kanbo.sync')).toBeNull()
    expect(localStorage.getItem('theme')).toBe('light')
    expect(localStorage.getItem('goodscan:settings')).toBe('{}')
    expect(sessionStorage.getItem('kanbo.handover')).toBeNull()
    expect(sessionStorage.getItem('other-app')).toBe('1')
  })

  it('leaves other apps’ caches and service workers alone', async () => {
    fakeIndexedDb()
    const removedCaches: string[] = []
    vi.stubGlobal('caches', {
      keys: async () => ['kanbo-assets', 'workbox-precache-v2-https://maxgfr.github.io/cursus/'],
      delete: async (name: string) => removedCaches.push(name) > 0,
    })
    const own = new URL('./', document.baseURI).href
    const unregistered: string[] = []
    const registration = (scope: string) => ({
      scope,
      unregister: async () => unregistered.push(scope) > 0,
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: async () => [
          registration(own),
          registration('https://maxgfr.github.io/cursus/'),
        ],
      },
    })

    try {
      await wipeEverything()
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker')
    }

    expect(removedCaches).toEqual(['kanbo-assets'])
    expect(unregistered).toEqual([own])
  })
})

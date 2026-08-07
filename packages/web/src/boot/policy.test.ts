/** @vitest-environment jsdom */
import { CONNECTED_DOCUMENT } from '@kanbo/core/policy'
import { beforeEach, describe, expect, it } from 'vitest'

import { takeHandover } from './handover.ts'
import { documentMode, documentUrlFor } from './policy.ts'
import { LOCAL_ONLY, readSyncSettings, writeSyncSettings } from './syncSettings.ts'

/**
 * The mode is a property of the document, so which document is loaded is the
 * only honest answer to "what mode am I in" — and reading it from the URL is
 * what lets the settings panel describe the page rather than the setting.
 */
describe('documentMode', () => {
  it('reads the connected document from its name', () => {
    expect(documentMode(`/${CONNECTED_DOCUMENT}`)).toBe('connected')
    expect(documentMode(`/kanbo/${CONNECTED_DOCUMENT}`)).toBe('connected')
    expect(documentMode(CONNECTED_DOCUMENT)).toBe('connected')
  })

  it('calls everything else local, including a bare directory', () => {
    // Which is what the strict document is served as: switching to local
    // navigates to the directory, not to `index.html`.
    expect(documentMode('/')).toBe('local')
    expect(documentMode('/kanbo/')).toBe('local')
    expect(documentMode('/index.html')).toBe('local')
  })

  it('is not fooled by a path that merely contains the name', () => {
    expect(documentMode('/connect.html/board')).toBe('local')
  })
})

const at = (pathname: string, hash = '') => ({ pathname, hash }) as unknown as Location

describe('documentUrlFor', () => {
  it('goes to the connected document from the same directory', () => {
    expect(documentUrlFor('connected', at('/kanbo/'))).toBe('/kanbo/connect.html')
    expect(documentUrlFor('connected', at('/kanbo/connect.html'))).toBe('/kanbo/connect.html')
  })

  it('goes back to the directory for local, not to index.html', () => {
    expect(documentUrlFor('local', at('/kanbo/connect.html'))).toBe('/kanbo/')
  })

  it('carries the hash across, so a share link survives the switch', () => {
    expect(documentUrlFor('connected', at('/', '#s=abc'))).toBe('/connect.html#s=abc')
  })
})

describe('readSyncSettings', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to local, which is the setting that can promise the most', () => {
    expect(readSyncSettings()).toEqual(LOCAL_ONLY)
  })

  it('round-trips what was written', () => {
    const stored = writeSyncSettings({
      mode: 'connected',
      forge: 'gitlab',
      remoteUrl: 'https://gitlab.com/api/v4',
      repository: 'acme/board',
      branch: 'develop',
    })
    expect(stored.remoteUrl).toBe('https://gitlab.com/api/v4')
    expect(readSyncSettings()).toEqual(stored)
  })

  it('fills fields a older version never wrote rather than rejecting the record', () => {
    localStorage.setItem('kanbo.sync', JSON.stringify({ mode: 'connected', remoteUrl: null }))
    expect(readSyncSettings()).toMatchObject({ mode: 'connected', branch: 'main', forge: 'github' })
  })

  it('falls back to local on anything it cannot read', () => {
    // A setting we cannot read is a setting we do not honour: every failure
    // path lands on the mode that cannot make a request.
    localStorage.setItem('kanbo.sync', 'not json at all')
    expect(readSyncSettings()).toEqual(LOCAL_ONLY)

    localStorage.setItem('kanbo.sync', JSON.stringify({ mode: 'whatever' }))
    expect(readSyncSettings()).toEqual(LOCAL_ONLY)
  })
})

/**
 * The mode switch is a navigation between two documents, so the panel it was
 * made in is destroyed on the way. This is the only thing that crosses.
 */
describe('takeHandover', () => {
  it('answers the same way however often it is asked, and clears the marker', () => {
    // React calls state initialisers twice under StrictMode, so a marker that
    // vanished on first read would leave the panel shut in development only.
    // It still has to be cleared, or a later reload reopens a panel nobody
    // asked for — hence read once, cached, removed.
    sessionStorage.setItem('kanbo.handover', 'settings')

    expect(takeHandover()).toBe('settings')
    expect(takeHandover()).toBe('settings')
    expect(sessionStorage.getItem('kanbo.handover')).toBeNull()
  })
})

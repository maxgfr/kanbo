/** @vitest-environment jsdom */
import { defaultStatuses } from '@kanbo/core'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readSyncSettings, writeSyncSettings } from '../../boot/syncSettings.ts'
import { Harness, storeWith } from '../../state/testing.tsx'
import { SettingsPanel } from './SettingsPanel.tsx'

afterEach(cleanup)

const statuses = defaultStatuses(
  (
    (n = 0) =>
    () =>
      `status-${++n}`
  )(),
)

/**
 * `location.replace` is the mode switch, and jsdom neither navigates nor lets
 * the method be redefined in place — so the whole object is stubbed and the
 * calls are collected.
 */
let replaced: string[] = []

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  replaced = []
  vi.stubGlobal('location', {
    pathname: '/',
    hash: '',
    replace: (url: string) => replaced.push(String(url)),
  })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openSettings() {
  const store = await storeWith(
    { kind: 'project.set', patch: { name: 'Apollo', key: 'APL' } },
    ...statuses.map((status) => ({ kind: 'status.upsert' as const, status })),
  )
  const onClose = vi.fn()
  render(
    <Harness store={store}>
      <SettingsPanel onClose={onClose} />
    </Harness>,
  )
  return { store, onClose, user: userEvent.setup() }
}

describe('switching mode', () => {
  it('goes straight to the other document rather than reloading this one', async () => {
    // Reloading landed on this document and let the boot module redirect from
    // there: two loads, and a flash of the wrong document in between.
    const { user } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Repository' }))

    expect(replaced).toHaveLength(1)
    expect(replaced[0]).toContain('connect.html')
    expect(readSyncSettings().mode).toBe('connected')
  })

  it('asks for the panel back, because that is where the switch was made', async () => {
    const { user } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Repository' }))
    expect(sessionStorage.getItem('kanbo.handover')).toBe('settings')
  })

  it('keeps the API path, so GitLab still answers', async () => {
    // The origin is what the policy wants; the API base URL is what requests
    // want. Storing the origin dropped `/api/v4` from a working configuration.
    writeSyncSettings({
      mode: 'local',
      forge: 'gitlab',
      remoteUrl: 'https://gitlab.com/api/v4',
      repository: 'acme/board',
      branch: 'main',
    })
    const { user } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Repository' }))

    expect(readSyncSettings().remoteUrl).toBe('https://gitlab.com/api/v4')
  })

  it('does not put back the repository someone just typed over', async () => {
    // The panel and the repository section each held a copy read at mount, and
    // the mode button wrote the older one back over the newer.
    writeSyncSettings({
      mode: 'connected',
      forge: 'gitlab',
      remoteUrl: 'https://gitlab.com/api/v4',
      repository: '',
      branch: 'main',
    })
    const { user } = await openSettings()

    await user.type(screen.getByLabelText('Project'), 'acme/board')
    await user.clear(screen.getByLabelText('Branch'))
    await user.type(screen.getByLabelText('Branch'), 'develop')
    await user.click(screen.getByRole('button', { name: 'Repository' }))

    expect(readSyncSettings()).toMatchObject({
      forge: 'gitlab',
      repository: 'acme/board',
      branch: 'develop',
    })
  })

  it('refuses to store an address that is not one we would talk to', async () => {
    const { user } = await openSettings()
    const field = screen.getByLabelText('Forge API')
    await user.clear(field)
    await user.type(field, 'http://insecure.example')
    await user.tab()

    // Kept rather than destroyed: an unusable draft must not wipe a usable
    // setting on its way past.
    expect(readSyncSettings().remoteUrl).not.toBe('http://insecure.example')
    expect(screen.getByText(/not an https:\/\/ URL/)).toBeTruthy()
  })
})

describe('the forge API field', () => {
  it('saves when you leave it, without needing a mode switch', async () => {
    // Its only escape route used to be the mode buttons, so an address typed
    // in repository mode was never written at all.
    writeSyncSettings({
      mode: 'connected',
      forge: 'github',
      remoteUrl: 'https://api.github.com',
      repository: 'acme/board',
      branch: 'main',
    })
    const { user } = await openSettings()

    const field = screen.getByLabelText('Forge API')
    await user.clear(field)
    await user.type(field, 'https://git.acme.test/api/v1')
    await user.tab()

    expect(readSyncSettings().remoteUrl).toBe('https://git.acme.test/api/v1')
  })
})

describe('the panel as a dialog', () => {
  it('closes on Escape, like every other panel', async () => {
    const { onClose, user } = await openSettings()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('takes focus, so a keyboard does not have to walk the page to reach it', async () => {
    await openSettings()
    expect(screen.getByRole('dialog', { name: 'Settings' }).contains(document.activeElement)).toBe(
      true,
    )
  })
})

describe('custom field choices', () => {
  it('lets a comma be typed, and a second choice after it', async () => {
    // The input showed `options.join(', ')` and reparsed on every keystroke, so
    // the comma split off an empty fragment, was filtered away, and vanished.
    const { user } = await openSettings()

    await user.click(screen.getByRole('button', { name: 'Add a field' }))
    await user.selectOptions(screen.getByLabelText(/^Type of/), 'select')

    const choices = screen.getByLabelText(/^Choices for/)
    await user.type(choices, 'high, low')
    expect(choices).toHaveProperty('value', 'high, low')

    await user.tab()
    expect(screen.getByLabelText(/^Choices for/)).toHaveProperty('value', 'high, low')
  })
})

import { originOf } from '@kanbo/core'
import { wipeEverything } from '@kanbo/adapters-web'
import { useEffect, useState } from 'react'

import { documentMode } from '../../boot/policy'
import { type SyncState, hasToken, runSync, saveToken } from '../../state/sync'
import { usePorts } from '../../state/useStore'
import { readSyncSettings, writeSyncSettings } from '../../boot/syncSettings'
import { probe } from '../../net/transport'
import { Button } from '../design/Button'
import { Icon } from '../design/Icon'
import { setTheme, type Theme, currentTheme } from '../theme'

export function SettingsPanel({ onClose }: { readonly onClose: () => void }) {
  const [settings, setSettings] = useState(readSyncSettings)
  const [remoteDraft, setRemoteDraft] = useState(settings.remoteUrl ?? 'https://api.github.com')
  const [theme, setThemeState] = useState<Theme>(currentTheme)
  const [probeResult, setProbeResult] = useState<string | null>(null)
  const [confirmingWipe, setConfirmingWipe] = useState(false)

  const loaded = documentMode(window.location.pathname)
  const effective =
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ??
    ''
  const connectSrc = effective.split('; ').find((d) => d.startsWith('connect-src')) ?? 'unknown'

  function applyMode(mode: 'local' | 'connected') {
    const remoteUrl = mode === 'connected' ? (originOf(remoteDraft) ?? null) : settings.remoteUrl
    const stored = writeSyncSettings({ ...settings, mode, remoteUrl })
    setSettings(stored)
    // The policy belongs to the document, so changing mode means loading the
    // other one. Reloading here is the honest thing: nothing about the switch
    // can take effect without it.
    window.location.reload()
  }

  return (
    <>
      <button
        type="button"
        className="kb-panel__scrim"
        aria-label="Close settings"
        onClick={onClose}
      />
      <aside className="kb-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="kb-panel__header">
          <Icon name="settings" size={16} />
          <strong>Settings</strong>
          <span className="kb-spacer" />
          <Button variant="quiet" icon="close" aria-label="Close" onClick={onClose} />
        </header>

        <div className="kb-panel__body">
          <section className="kb-field">
            <h2 className="kb-field__label">Network</h2>
            <p className="kb-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              {loaded === 'local'
                ? 'This page is served with connect-src ‘none’. It cannot make a network request — not to us, not to anyone.'
                : 'This page may reach exactly one host: the forge named below. Nothing else.'}
            </p>

            <p
              className="data"
              style={{ margin: 0, fontSize: 'var(--step--1)', color: 'var(--ink-faint)' }}
            >
              {connectSrc}
            </p>

            <div className="kb-row" style={{ marginTop: 'var(--space-2)' }}>
              <Button
                variant={settings.mode === 'local' ? 'primary' : 'default'}
                icon="lock"
                onClick={() => applyMode('local')}
              >
                Local
              </Button>
              <Button
                variant={settings.mode === 'connected' ? 'primary' : 'default'}
                icon="repo"
                onClick={() => applyMode('connected')}
              >
                Repository
              </Button>
            </div>
          </section>

          <section className="kb-field">
            <label className="kb-field__label" htmlFor="kb-remote">
              Forge API
            </label>
            <input
              id="kb-remote"
              className="kb-input data"
              value={remoteDraft}
              placeholder="https://api.github.com"
              onChange={(event) => setRemoteDraft(event.target.value)}
            />
            <p
              className="kb-muted"
              style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}
            >
              HTTPS only. Any host works — github.com, a GitLab instance, a self-hosted Gitea —
              because the policy is narrowed to whatever you name here when the page boots, rather
              than to a list fixed at build time.
              {originOf(remoteDraft) === null && remoteDraft !== '' && (
                <strong style={{ color: 'var(--signal-cancelled)', display: 'block' }}>
                  That is not an https:// URL, so it will be refused.
                </strong>
              )}
            </p>
          </section>

          {settings.mode === 'connected' && <RepositorySection />}

          <section className="kb-field">
            <h2 className="kb-field__label">Check it yourself</h2>
            <p className="kb-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Ask the browser to reach a host Kanbo never uses. In local mode the request must fail.
            </p>
            <div className="kb-row">
              <Button
                onClick={() =>
                  void probe('https://example.com/').then((result) =>
                    setProbeResult(
                      result.reachable
                        ? 'The request left the page.'
                        : 'Blocked by the browser, as intended.',
                    ),
                  )
                }
              >
                Test an outbound request
              </Button>
              {probeResult && (
                <span
                  className="kb-row"
                  style={{
                    color: probeResult.startsWith('Blocked')
                      ? 'var(--signal-departed)'
                      : 'var(--signal-delayed)',
                  }}
                >
                  <Icon name={probeResult.startsWith('Blocked') ? 'check' : 'warning'} size={14} />
                  {probeResult}
                </span>
              )}
            </div>
          </section>

          <section className="kb-field">
            <h2 className="kb-field__label">Appearance</h2>
            <div className="kb-row">
              {(['dark', 'light', 'system'] as const).map((option) => (
                <Button
                  key={option}
                  variant={theme === option ? 'primary' : 'default'}
                  onClick={() => {
                    setTheme(option)
                    setThemeState(option)
                  }}
                >
                  {option[0]!.toUpperCase() + option.slice(1)}
                </Button>
              ))}
            </div>
          </section>

          <section className="kb-field" style={{ marginTop: 'auto', paddingTop: 'var(--space-5)' }}>
            <h2 className="kb-field__label">Erase everything</h2>
            <p className="kb-muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Deletes the database itself rather than emptying it, along with local storage, caches
              and the service worker. Afterwards a look at this browser profile finds no Kanbo data
              — not an empty store. This cannot be undone.
            </p>
            {confirmingWipe ? (
              <div className="kb-row">
                <Button
                  variant="danger"
                  icon="trash"
                  onClick={() => void wipeEverything().then(() => window.location.reload())}
                >
                  Erase permanently
                </Button>
                <Button variant="quiet" onClick={() => setConfirmingWipe(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div>
                <Button variant="danger" icon="trash" onClick={() => setConfirmingWipe(true)}>
                  Erase all data
                </Button>
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}

/**
 * Repository configuration.
 *
 * Only shown once repository mode is on: asking for a token on a page that
 * cannot make a request would be asking for a secret we have no use for.
 */
function RepositorySection() {
  const store = usePorts()
  const [settings, setSettings] = useState(readSyncSettings)
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState<boolean | null>(null)
  const [state, setState] = useState<SyncState>({ kind: 'idle', at: null })

  useEffect(() => {
    void hasToken(store).then(setSaved)
  }, [store])

  function update(patch: Partial<typeof settings>) {
    setSettings(writeSyncSettings({ ...settings, ...patch }))
  }

  return (
    <section className="kb-field">
      <h2 className="kb-field__label">Repository</h2>

      <label className="kb-field__label" htmlFor="kb-repo">
        Repository
      </label>
      <input
        id="kb-repo"
        className="kb-input data"
        value={settings.repository}
        placeholder="owner/name"
        onChange={(event) => update({ repository: event.target.value })}
      />

      <label className="kb-field__label" htmlFor="kb-branch">
        Branch
      </label>
      <input
        id="kb-branch"
        className="kb-input data"
        value={settings.branch}
        placeholder="main"
        onChange={(event) => update({ branch: event.target.value })}
      />

      <label className="kb-field__label" htmlFor="kb-token">
        Access token
      </label>
      <input
        id="kb-token"
        className="kb-input data"
        type="password"
        value={token}
        placeholder={saved ? '•••••••• saved' : 'ghp_…'}
        autoComplete="off"
        onChange={(event) => setToken(event.target.value)}
      />
      <div className="kb-row">
        <Button
          onClick={() =>
            void saveToken(store, token).then(() => {
              setToken('')
              void hasToken(store).then(setSaved)
            })
          }
        >
          {token === '' && saved ? 'Remove token' : 'Save token'}
        </Button>
        <Button
          variant="primary"
          icon="sync"
          disabled={state.kind === 'syncing'}
          onClick={() => {
            setState({ kind: 'syncing' })
            void runSync(store).then(setState)
          }}
        >
          {state.kind === 'syncing' ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>

      {state.kind === 'failed' && (
        <p className="kb-row" style={{ color: 'var(--signal-cancelled)', margin: 0 }}>
          <Icon name="warning" size={14} />
          {state.message}
        </p>
      )}
      {state.kind === 'unconfigured' && (
        <p className="kb-muted" style={{ margin: 0 }}>
          {state.reason}
        </p>
      )}
      {state.kind === 'idle' && state.at !== null && (
        <p className="kb-row" style={{ color: 'var(--signal-departed)', margin: 0 }}>
          <Icon name="check" size={14} />
          Synced.
        </p>
      )}

      <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}>
        The token needs the <code>repo</code> scope and nothing more. It is encrypted before it is
        stored, under a key the browser will not let JavaScript read back — including ours.
      </p>
      <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}>
        Your device writes only to <code>.kanbo/ops/{store.device.slice(0, 8)}….ndjson</code>.
        Nobody else writes to that file, which is why two people working at once never produce a git
        conflict.
      </p>
    </section>
  )
}

import { exportCsv, exportJson, importJson, originOf } from '@kanbo/core'
import { wipeEverything } from '@kanbo/adapters-web'
import { useEffect, useRef, useState } from 'react'

import { documentMode, documentUrlFor } from '../../boot/policy.ts'
import { handOver } from '../../boot/handover.ts'
import { syncIssues } from '../../state/issues.ts'
import { FORGE_DEFAULTS } from '../../state/sync.ts'
import { type SyncState, hasToken, runSync, saveToken } from '../../state/sync.ts'
import { usePorts, useProject } from '../../state/useStore.ts'
import { type SyncSettings, readSyncSettings, writeSyncSettings } from '../../boot/syncSettings.ts'
import { probe } from '../../net/transport.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { useDialog } from '../design/useDialog.ts'
import { setTheme, type Theme, currentTheme } from '../theme.ts'
import { ColumnsSection } from './ColumnsSection.tsx'
import { ProjectSection } from './ProjectSection.tsx'
import { FieldsSection, LabelsSection } from './VocabularySections.tsx'

/**
 * The forge API address, kept as it was typed.
 *
 * `originOf` is the right answer for the policy and the wrong one here. GitLab
 * answers at `https://gitlab.com/api/v4`, and storing only its origin drops the
 * path every request needs — quietly, on a config that was working. The policy
 * derives the origin for itself in `connectTighteningFor`, so keeping the whole
 * URL here costs the guarantee nothing.
 *
 * Returns null when the draft is not a URL we would ever talk to, which is the
 * caller's cue to keep what is already stored rather than destroy it.
 */
function remoteFrom(draft: string): string | null {
  const trimmed = draft.trim()
  return originOf(trimmed) === null ? null : trimmed
}

export type SettingsPanelProps = {
  readonly onClose: () => void
  /** Set when the panel was reopened by a mode switch, so it can say so. */
  readonly announceMode?: boolean
}

export function SettingsPanel({ onClose, announceMode = false }: SettingsPanelProps) {
  // One owner for the sync settings, and one writer. Two components each
  // holding a copy read at mount is what let a mode switch spread a stale
  // snapshot over the repository, branch and forge somebody had just typed.
  const [settings, setSettings] = useState(readSyncSettings)
  const [remoteDraft, setRemoteDraft] = useState(
    settings.remoteUrl ?? FORGE_DEFAULTS[settings.forge].api,
  )
  const [theme, setThemeState] = useState<Theme>(currentTheme)
  const [probeResult, setProbeResult] = useState<string | null>(null)
  const [confirmingWipe, setConfirmingWipe] = useState(false)
  const { ref: panelRef, onKeyDown } = useDialog<HTMLElement>(onClose)

  const loaded = documentMode(window.location.pathname)
  const effective =
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ??
    ''
  const connectSrc = effective.split('; ').find((d) => d.startsWith('connect-src')) ?? 'unknown'

  function update(patch: Partial<SyncSettings>) {
    setSettings(writeSyncSettings({ ...settings, ...patch }))
  }

  /** Commit whatever is in the Forge API field, unless it would be a downgrade. */
  function commitRemote(next: SyncSettings): SyncSettings {
    const remoteUrl = remoteFrom(remoteDraft)
    if (remoteUrl === null || remoteUrl === next.remoteUrl) return next
    return writeSyncSettings({ ...next, remoteUrl })
  }

  function applyMode(mode: 'local' | 'connected') {
    // Read what is stored rather than the copy taken at mount: the repository
    // section writes as you type, and spreading a snapshot from before that
    // would put the forge, repository and branch back the way they were.
    const stored = commitRemote(readSyncSettings())
    writeSyncSettings({ ...stored, mode })

    // The panel is where the switch was made, so it is where the answer
    // belongs. Nothing else survives the swap.
    handOver('settings')

    // The policy belongs to the document, so changing mode means loading the
    // other one — there is no version of this that avoids a navigation. Going
    // straight there is one load instead of two: reloading this document would
    // only put us in front of the boot module, which would send us on anyway.
    window.location.replace(documentUrlFor(mode))
  }

  return (
    <>
      <button
        type="button"
        className="kb-panel__scrim"
        aria-label="Close settings"
        onClick={onClose}
        onKeyDown={onKeyDown}
      />
      <aside
        ref={panelRef}
        className="kb-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
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

            {announceMode && (
              <p className="kb-row" style={{ color: 'var(--signal-departed)', margin: 0 }}>
                <Icon name="check" size={14} />
                {loaded === 'local'
                  ? 'Local mode is now active. The page was reloaded to get here.'
                  : 'Repository mode is now active. The page was reloaded to get here.'}
              </p>
            )}

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
              placeholder={FORGE_DEFAULTS[settings.forge].api}
              onChange={(event) => setRemoteDraft(event.target.value)}
              // Saved on the way out, like every other field here. Left to the
              // mode buttons, an address typed in repository mode was never
              // written at all — the field looked settled and was not.
              onBlur={() => setSettings(commitRemote(readSyncSettings()))}
            />
            <p
              className="kb-muted"
              style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}
            >
              HTTPS only. Any host works — github.com, a GitLab instance, a self-hosted Gitea —
              because the policy is narrowed to whatever you name here when the page boots, rather
              than to a list fixed at build time. Include the API path if the forge has one, as
              GitLab does.
              {originOf(remoteDraft) === null && remoteDraft !== '' && (
                <strong style={{ color: 'var(--signal-cancelled)', display: 'block' }}>
                  That is not an https:// URL, so it will be refused.
                </strong>
              )}
            </p>
          </section>

          {settings.mode === 'connected' && (
            <RepositorySection
              settings={settings}
              onChange={(patch) => {
                update(patch)
                // The forge button also moves the API address, and the field
                // above must not keep showing the one it replaced.
                if (patch.remoteUrl) setRemoteDraft(patch.remoteUrl)
              }}
            />
          )}

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

          <ProjectSection />

          <ColumnsSection />

          <LabelsSection />

          <FieldsSection />

          <PortabilitySection />

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
function RepositorySection({
  settings,
  onChange,
}: {
  readonly settings: SyncSettings
  readonly onChange: (patch: Partial<SyncSettings>) => void
}) {
  const store = usePorts()
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState<boolean | null>(null)
  const [state, setState] = useState<SyncState>({ kind: 'idle', at: null })
  const [issuesBusy, setIssuesBusy] = useState(false)
  const [issueReport, setIssueReport] = useState<string | null>(null)

  useEffect(() => {
    void hasToken(store)
      .then(setSaved)
      // Whether a token exists is a convenience; failing to find out must not
      // leave the field claiming there is none.
      .catch(() => setSaved(null))
  }, [store])

  const update = onChange

  return (
    <section className="kb-field">
      <h2 className="kb-field__label">Repository</h2>

      <span className="kb-field__label">Forge</span>
      <div className="kb-row">
        {(['github', 'gitlab'] as const).map((forge) => (
          <Button
            key={forge}
            variant={settings.forge === forge ? 'primary' : 'default'}
            icon="repo"
            onClick={() =>
              // Changing forge changes the API too: leaving the old one behind
              // would fail with an error about the wrong host.
              update({ forge, remoteUrl: FORGE_DEFAULTS[forge].api })
            }
          >
            {forge === 'github' ? 'GitHub' : 'GitLab'}
          </Button>
        ))}
      </div>
      <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}>
        Both speak the same interface, so switching changes the connector and nothing else — the
        board, the merge and the history are unaffected. Self-hosted instances work: set the API
        address above to yours.
      </p>

      <label className="kb-field__label" htmlFor="kb-repo">
        {settings.forge === 'gitlab' ? 'Project' : 'Repository'}
      </label>
      <input
        id="kb-repo"
        className="kb-input data"
        value={settings.repository}
        placeholder={FORGE_DEFAULTS[settings.forge].example}
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
            void runSync(store)
              .then(setState)
              .catch((error: unknown) =>
                setState({
                  kind: 'failed',
                  message: error instanceof Error ? error.message : 'Sync failed.',
                }),
              )
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
      <div className="kb-row">
        <Button
          icon="repo"
          disabled={issuesBusy}
          onClick={() => {
            setIssuesBusy(true)
            void syncIssues(store)
              .then((report) => setIssueReport(report.message))
              .catch((error: unknown) =>
                setIssueReport(
                  error instanceof Error ? error.message : 'The issues could not be reconciled.',
                ),
              )
              // Cleared whatever happened: a button stuck on "Reconciling…"
              // cannot be tried again without closing the panel.
              .finally(() => setIssuesBusy(false))
          }}
        >
          {issuesBusy ? 'Reconciling\u2026' : 'Reconcile issues'}
        </Button>
        {issueReport && <span className="kb-muted">{issueReport}</span>}
      </div>
      <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}>
        Issues become cards and closed cards close their issues. Kanbo keeps sprints, points,
        dependencies and order to itself — a forge has no place for them, and inventing labels to
        smuggle them across would leave someone else a mess.
      </p>
      <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}>
        Your device writes only to <code>.kanbo/ops/{store.device.slice(0, 8)}….ndjson</code>.
        Nobody else writes to that file, which is why two people working at once never produce a git
        conflict.
      </p>
    </section>
  )
}

/**
 * Hand a file to the browser without a round trip through any server.
 *
 * The anchor is put in the document and the URL is revoked a tick later rather
 * than on the next line. Revoking in the same tick as the click races the
 * browser's own start of the download, and the browsers that lose that race
 * lose it silently — on the one screen where a missing export is what stands
 * between someone and erasing everything.
 */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * Export and import.
 *
 * The export is the operation log, not a rendering of the board: replaying it
 * reconstructs the project exactly, history and metrics included. A local-first
 * tool whose data cannot leave is a trap wearing privacy's clothes.
 */
function PortabilitySection() {
  const store = usePorts()
  const project = useProject()
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <section className="kb-field">
      <h2 className="kb-field__label">Your data</h2>
      <div className="kb-row" style={{ flexWrap: 'wrap' }}>
        <Button
          icon="archive"
          onClick={() => {
            // Once a file is on someone's disk, the operations in it are out of
            // our hands and none of them may be folded into afterwards.
            store.seal()
            download(
              `kanbo-${project.key || 'project'}.json`,
              exportJson(store.getLog(), Date.now()),
              'application/json',
            )
          }}
        >
          Export JSON
        </Button>
        <Button
          icon="table"
          onClick={() =>
            download(`kanbo-${project.key || 'project'}.csv`, exportCsv(project), 'text/csv')
          }
        >
          Export CSV
        </Button>
        <Button icon="plus" onClick={() => fileRef.current?.click()}>
          Import
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="kb-visually-hidden"
          aria-label="Import a Kanbo export"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so that picking the same path again fires `change` at
            // all. Without it, someone who fixed a rejected file on disk and
            // chose it again got nothing — not even the message updating.
            event.target.value = ''
            if (!file) return
            void (async () => {
              try {
                // Inside the try, unlike before: a read that fails — file
                // moved, permission gone — is a message rather than an
                // unhandled rejection nobody sees.
                const text = await file.text()
                const incoming = importJson(text)
                const before = store.getLog().length
                await store.absorb(incoming)
                setMessage(`Merged ${store.getLog().length - before} new operations.`)
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'That file could not be read.')
              }
            })()
          }}
        />
      </div>
      {message && (
        <p className="kb-muted" style={{ margin: 0 }}>
          {message}
        </p>
      )}
      <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}>
        The JSON export is the full history, so replaying it rebuilds the board and every metric
        exactly. Importing merges — nothing is replaced, and importing the same file twice changes
        nothing. The CSV is a flat view for a spreadsheet and is lossy by nature.
      </p>
    </section>
  )
}

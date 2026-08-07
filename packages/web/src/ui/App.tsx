import { useState } from 'react'

import { documentMode } from '../boot/policy'
import { readSyncSettings, writeSyncSettings } from '../boot/syncSettings'
import { type ProbeResult, probe } from '../net/transport'

/**
 * Phase 1 shell. It exists to make the network guarantee visible and testable
 * before there is any product on top of it — the board, the vault and the
 * design system land in later phases.
 */
export function App() {
  const [settings, setSettings] = useState(readSyncSettings)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const loaded = documentMode(window.location.pathname)

  const policy =
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ??
    '(none)'

  function toggleMode() {
    const next = settings.mode === 'local' ? 'connected' : 'local'
    // The write is followed by a reload rather than a re-render: the policy is
    // a property of the document, so changing mode means changing document.
    const stored = writeSyncSettings({ ...settings, mode: next })
    setSettings(stored)
    window.location.reload()
  }

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Kanbo</h1>
        <p className="mt-1 text-sm opacity-70">
          Local-first project management. Kanban, sprints and roadmap in your browser, with a git
          repo as the only backend.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-current/15 p-5">
        <h2 className="text-sm font-medium">Network</h2>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="opacity-60">Stored mode</dt>
          <dd>{settings.mode}</dd>
          <dt className="opacity-60">Document loaded</dt>
          <dd>{loaded}</dd>
          <dt className="opacity-60">Effective policy</dt>
          <dd className="font-mono text-xs break-all">{policy}</dd>
        </dl>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleMode}
            className="rounded-md border border-current/25 px-3 py-1.5 text-sm hover:bg-current/5"
          >
            Switch to {settings.mode === 'local' ? 'repository' : 'local'} mode
          </button>
          <button
            type="button"
            onClick={() => void probe('https://example.com/').then(setResult)}
            className="rounded-md border border-current/25 px-3 py-1.5 text-sm hover:bg-current/5"
          >
            Test an outbound request
          </button>
        </div>

        {result && (
          <p className="text-sm">
            {result.reachable
              ? '⚠ The request left the page.'
              : '✓ Blocked by the browser, as intended.'}{' '}
            <span className="opacity-60">{result.detail}</span>
          </p>
        )}
      </section>
    </main>
  )
}

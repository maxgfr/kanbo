import {
  type Project,
  type ShareLink,
  ShareError,
  type SharePayload,
  byOrder,
  decodeEnvelope,
  itemsInStatus,
  statusById,
} from '@kanbo/core'
import { decryptShare } from '@kanbo/adapters-web'
import { useEffect, useState } from 'react'

import { blockedBy, isOverdue } from '../board/Card.tsx'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { Markdown } from '../design/Markdown.tsx'
import { StatusChip, signalForCategory } from '../design/StatusChip.tsx'

/**
 * Someone else's board, opened from a link.
 *
 * The reader is deliberately its own screen with no route into the rest of the
 * app. It never reads the vault, never writes to it, and never dispatches an
 * operation — a share is a copy someone handed over, and quietly mixing it
 * into the recipient's own project would be both surprising and unrecoverable.
 */
export function ReaderView({ link }: { readonly link: ShareLink }) {
  const [payload, setPayload] = useState<SharePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [envelope, setEnvelope] = useState(
    link.kind === 'inline' || link.kind === 'passphrase' ? link.envelope : null,
  )

  const needsFile = envelope === null
  const needsPassphrase = link.kind === 'passphrase'

  // An inline share opens by itself: there is nothing to ask for.
  useEffect(() => {
    if (link.kind !== 'inline') return
    setBusy(true)
    decryptShare(link.envelope, { key: link.key })
      .then(setPayload)
      .catch((caught: unknown) => setError(describe(caught)))
      .finally(() => setBusy(false))
  }, [link])

  async function openWith(secret: { key: string } | { passphrase: string }) {
    if (!envelope) return
    setBusy(true)
    setError(null)
    try {
      setPayload(await decryptShare(envelope, secret))
    } catch (caught) {
      setError(describe(caught))
    } finally {
      setBusy(false)
    }
  }

  function takeFile(file: File) {
    void file.text().then((text) => {
      try {
        setEnvelope(decodeEnvelope(text.trim()))
        setError(null)
      } catch (caught) {
        setError(describe(caught))
      }
    })
  }

  if (payload) return <SharedBoard payload={payload} />

  return (
    <main className="kb-empty" style={{ height: '100dvh' }}>
      <Icon name="lock" size={28} />
      <h1 className="kb-empty__title">A shared board</h1>
      <p className="kb-empty__body">
        This is an encrypted, read-only copy. It is decrypted here, in your browser; nothing about
        it was ever sent to a server.
      </p>

      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '22rem' }}
      >
        {needsFile && (
          <div className="kb-field">
            <label className="kb-field__label" htmlFor="kb-share-file">
              The share file
            </label>
            <input
              id="kb-share-file"
              type="file"
              className="kb-input"
              accept=".kanbo-share"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) takeFile(file)
              }}
            />
            <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
              This board was too large to travel inside a link, so it came as a file.
            </p>
          </div>
        )}

        {needsPassphrase && (
          <div className="kb-field">
            <label className="kb-field__label" htmlFor="kb-share-passphrase">
              Passphrase
            </label>
            <input
              id="kb-share-passphrase"
              className="kb-input"
              type="password"
              value={passphrase}
              autoComplete="off"
              disabled={needsFile}
              onChange={(event) => setPassphrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void openWith({ passphrase })
              }}
            />
          </div>
        )}

        {(needsPassphrase || (link.kind === 'file' && !needsFile)) && (
          <Button
            variant="primary"
            icon="lock"
            disabled={busy || needsFile || (needsPassphrase && passphrase === '')}
            onClick={() =>
              void openWith(
                needsPassphrase ? { passphrase } : { key: link.kind === 'file' ? link.key : '' },
              )
            }
          >
            {busy ? 'Decrypting…' : 'Open the board'}
          </Button>
        )}

        {link.kind === 'file' && needsFile && (
          <div className="kb-field">
            <label className="kb-field__label" htmlFor="kb-share-file-2">
              The share file
            </label>
            <input
              id="kb-share-file-2"
              type="file"
              className="kb-input"
              accept=".kanbo-share"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) takeFile(file)
              }}
            />
          </div>
        )}

        {busy && link.kind === 'inline' && <p className="kb-muted">Decrypting…</p>}

        {error && (
          <p className="kb-row" style={{ color: 'var(--signal-cancelled)', margin: 0 }}>
            <Icon name="warning" size={14} />
            {error}
          </p>
        )}
      </div>
    </main>
  )
}

function describe(error: unknown): string {
  if (error instanceof ShareError) return error.message
  return error instanceof Error ? error.message : 'This share could not be opened.'
}

/** The board itself, rendered read-only. Nothing here can be dragged or edited. */
function SharedBoard({ payload }: { readonly payload: SharePayload }) {
  const project: Project = payload.project
  const day = new Date().toISOString().slice(0, 10)

  return (
    <div className="kb-shell" style={{ gridTemplateColumns: '1fr' }}>
      <header className="kb-topbar">
        <Icon name="lock" size={16} />
        <strong style={{ letterSpacing: '-0.02em' }}>{project.name || 'Shared board'}</strong>
        <span className="data kb-muted" style={{ fontSize: 'var(--step--1)' }}>
          {project.key}
        </span>
        <span
          className="kb-chip kb-chip--scheduled"
          title="This is a copy. It does not update, and it is not connected to anything."
        >
          read-only copy
        </span>
        <span className="kb-spacer" />
        <span className="kb-muted data" style={{ fontSize: 'var(--step--1)' }}>
          shared {new Date(payload.sharedAt).toISOString().slice(0, 10)}
        </span>
      </header>

      <main className="kb-main" style={{ gridColumn: '1 / -1' }}>
        {payload.note !== '' && (
          <p
            style={{
              margin: 0,
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid var(--rule)',
              background: 'var(--surface)',
            }}
          >
            {payload.note}
          </p>
        )}

        <div className="kb-board">
          {project.statuses.toSorted(byOrder).map((status) => {
            const items = itemsInStatus(project, status.id).toSorted(byOrder)
            return (
              <section className="kb-column" key={status.id} aria-label={status.name}>
                <header className="kb-column__header">
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      background: status.color ?? 'var(--ink-faint)',
                    }}
                  />
                  <span className="kb-column__name">{status.name}</span>
                  <span className="kb-column__count">{items.length}</span>
                </header>

                <div className="kb-column__body">
                  {items.map((item) => (
                    <article
                      key={item.id}
                      className="kb-card"
                      style={{ cursor: 'default' }}
                      data-blocked={blockedBy(project, item).length > 0 || undefined}
                    >
                      <div className="kb-card__top">
                        <span className="kb-card__ref">{item.ref}</span>
                        {item.estimate !== null && (
                          <span className="kb-card__points">{item.estimate}</span>
                        )}
                        {isOverdue(item, day) && (
                          <span className="kb-card__flag kb-card__flag--overdue">
                            <Icon name="warning" size={12} />
                          </span>
                        )}
                      </div>
                      <span className="kb-card__title">{item.title}</span>
                      {item.description !== '' && (
                        <details>
                          <summary
                            className="kb-muted"
                            style={{ cursor: 'pointer', fontSize: 'var(--step--1)' }}
                          >
                            Description
                          </summary>
                          <Markdown source={item.description} />
                        </details>
                      )}
                    </article>
                  ))}
                  {items.length === 0 && <p className="kb-column__empty">Nothing here</p>}
                </div>
              </section>
            )
          })}
        </div>
      </main>
    </div>
  )
}

/** Statuses are shown as chips in the table below the board on narrow screens. */
export function SharedStatusChip({
  project,
  statusId,
}: {
  readonly project: Project
  readonly statusId: string
}) {
  const status = statusById(project, statusId)
  if (!status) return null
  return (
    <StatusChip label={status.name} signal={signalForCategory(status.category)} animate={false} />
  )
}

import {
  type Project,
  type ShareEnvelope,
  buildFragment,
  encodeEnvelope,
  fitsInLink,
  shareFileName,
} from '@kanbo/core'
import { encryptShare } from '@kanbo/adapters-web'
import { useState } from 'react'

import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'

type Made = {
  readonly link: string
  readonly envelope: ShareEnvelope
  readonly needsFile: boolean
  readonly fileName: string
}

/** The page that will open the share — never the connected document. */
function readerBase(): string {
  const url = new URL(window.location.href)
  url.hash = ''
  url.search = ''
  // A share is read-only and needs no network, so it always opens on the
  // strict document. Handing someone a connect.html link would offer them a
  // network permission the share has no use for.
  url.pathname = url.pathname.replace(/[^/]*$/, 'index.html')
  return url.toString()
}

/** Hand the ciphertext over as a file, without a round trip through anything. */
function downloadFile(share: Made) {
  const url = URL.createObjectURL(
    new Blob([encodeEnvelope(share.envelope)], { type: 'application/octet-stream' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = share.fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function ShareDialog({
  project,
  onClose,
}: {
  readonly project: Project
  readonly onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [usePassphrase, setUsePassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<Made | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function make() {
    setBusy(true)
    setError(null)
    try {
      const result = await encryptShare(project, note, usePassphrase ? passphrase : null)
      const inLink = fitsInLink(result.envelope)

      const link =
        readerBase() +
        buildFragment(
          result.key === null
            ? { kind: 'passphrase', envelope: inLink ? result.envelope : null }
            : inLink
              ? { kind: 'inline', key: result.key, envelope: result.envelope }
              : { kind: 'file', key: result.key },
        )

      setMade({
        link,
        envelope: result.envelope,
        needsFile: !inLink,
        fileName: shareFileName(project),
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The share could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="kb-panel__scrim" aria-label="Close" onClick={onClose} />
      <aside className="kb-panel" role="dialog" aria-modal="true" aria-label="Share this board">
        <header className="kb-panel__header">
          <Icon name="link" size={16} />
          <strong>Share this board</strong>
          <span className="kb-spacer" />
          <Button variant="quiet" icon="close" aria-label="Close" onClick={onClose} />
        </header>

        <div className="kb-panel__body">
          <p className="kb-muted" style={{ margin: 0, lineHeight: 1.6 }}>
            An encrypted, read-only copy of the board. It is encrypted here, in this page, and
            nothing is uploaded — the key travels in the part of the link browsers never send to a
            server, so whoever hosts Kanbo cannot read what it unlocks.
          </p>

          {!made && (
            <>
              <div className="kb-field">
                <label className="kb-field__label" htmlFor="kb-share-note">
                  Note for the recipient
                </label>
                <input
                  id="kb-share-note"
                  className="kb-input"
                  value={note}
                  placeholder="Optional"
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>

              <div className="kb-field">
                <label className="kb-row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={usePassphrase}
                    onChange={(event) => {
                      setUsePassphrase(event.target.checked)
                      setPassphrase('')
                    }}
                  />
                  <span>Protect with a passphrase</span>
                </label>
                <p
                  className="kb-muted"
                  style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}
                >
                  Without one, the link carries its own key: anyone the link reaches can read the
                  board, so a link pasted into a group chat is shared with that group chat. With
                  one, the link is useless on its own — send the passphrase by another route.
                </p>

                {usePassphrase && (
                  <input
                    id="kb-share-new-passphrase"
                    className="kb-input"
                    type="password"
                    value={passphrase}
                    placeholder="A passphrase, not a password"
                    autoComplete="off"
                    aria-label="Passphrase"
                    onChange={(event) => setPassphrase(event.target.value)}
                  />
                )}
              </div>

              <div className="kb-row">
                <Button
                  variant="primary"
                  icon="link"
                  disabled={busy || (usePassphrase && passphrase.length < 8)}
                  onClick={() => void make()}
                >
                  {busy ? 'Encrypting…' : 'Create the share'}
                </Button>
                {usePassphrase && passphrase.length > 0 && passphrase.length < 8 && (
                  <span className="kb-muted">At least eight characters.</span>
                )}
              </div>
              {busy && usePassphrase && (
                <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
                  Deriving the key takes a moment on purpose — the same moment it costs anyone
                  trying to guess the passphrase, several billion times over.
                </p>
              )}
            </>
          )}

          {made && (
            <>
              <div className="kb-field">
                <span className="kb-field__label">Link</span>
                <textarea
                  className="kb-textarea"
                  style={{ minHeight: '6rem' }}
                  readOnly
                  value={made.link}
                  aria-label="Share link"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <div className="kb-row">
                  <Button
                    icon={copied ? 'check' : 'link'}
                    onClick={() =>
                      void navigator.clipboard.writeText(made.link).then(() => {
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1500)
                      })
                    }
                  >
                    {copied ? 'Copied' : 'Copy link'}
                  </Button>
                  {made.needsFile && (
                    <Button variant="primary" icon="archive" onClick={() => downloadFile(made)}>
                      Download the file
                    </Button>
                  )}
                </div>
              </div>

              {made.needsFile && (
                <p
                  className="kb-row"
                  style={{
                    color: 'var(--signal-delayed)',
                    background: 'var(--signal-delayed-dim)',
                    border: '1px solid color-mix(in oklab, var(--signal-delayed) 30%, transparent)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-2) var(--space-3)',
                    margin: 0,
                    lineHeight: 1.6,
                  }}
                >
                  <Icon name="warning" size={14} />
                  This board is too large to travel inside a link — a chat client would truncate it
                  and the share would fail in a way the recipient could not diagnose. Send both the
                  link and the file.
                </p>
              )}

              <section className="kb-field">
                <h2 className="kb-field__label">What you are handing over</h2>
                <ul style={{ margin: 0, paddingLeft: '1.1rem', lineHeight: 1.7 }}>
                  <li>A snapshot of the board — not its history, and not who changed what.</li>
                  <li>
                    Read-only. The recipient cannot edit it, and it is not linked to your vault.
                  </li>
                  <li>
                    <strong>It cannot be revoked.</strong> A share is a copy; once someone has it,
                    they have it, and no interface can take it back.
                  </li>
                  <li>It does not expire, because there is nobody to enforce an expiry.</li>
                </ul>
              </section>

              <div className="kb-row">
                <Button onClick={() => setMade(null)}>Make another</Button>
              </div>
            </>
          )}

          {error && (
            <p className="kb-row" style={{ color: 'var(--signal-cancelled)', margin: 0 }}>
              <Icon name="warning" size={14} />
              {error}
            </p>
          )}
        </div>
      </aside>
    </>
  )
}

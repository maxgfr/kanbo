import {
  type ShareEnvelope,
  type SharePayload,
  ShareError,
  buildFragment,
  decodeEnvelope,
  fitsInLink,
  parseFragment,
  shareFileName,
} from '@kanbo/core'
import { decryptShare, encryptShare } from '@kanbo/crypto/share'

import { KanboError } from './resolve.ts'
import type { Workspace } from './session.ts'

/**
 * A read-only copy of the board, encrypted here and uploaded nowhere.
 *
 * The same AES-GCM-256 the browser uses, from the same module, because
 * `@kanbo/crypto` runs on both. Which matters more than it sounds: a share made
 * at a terminal has to open in a browser, and a second implementation of "how a
 * share is encrypted" would be a second chance to produce something the reader
 * cannot read.
 *
 * The key travels in the URL fragment, which browsers never send to the host —
 * so whoever serves Kanbo cannot read what the link unlocks. When the board is
 * too big to fit in a link, the ciphertext becomes a file and only the key
 * stays in the fragment; the guarantee is unchanged, the delivery is not.
 */
export type ShareResult = {
  readonly envelope: ShareEnvelope
  /** Append this to a Kanbo URL. Everything secret is after the `#`. */
  readonly fragment: string
  /** False when the board had to become a file. */
  readonly fitsInLink: boolean
  readonly fileName: string
  /** The envelope to write out, when the link cannot carry it. */
  readonly file: string
  readonly passphrase: boolean
}

export async function shareCreate(
  workspace: Workspace,
  note: string,
  passphrase: string | null,
): Promise<ShareResult> {
  const { envelope, key } = await encryptShare(workspace.project, note, passphrase)
  const fits = fitsInLink(envelope)

  const fragment = buildFragment(
    key === null
      ? { kind: 'passphrase', envelope: fits ? envelope : null }
      : fits
        ? { kind: 'inline', key, envelope }
        : { kind: 'file', key },
  )

  return {
    envelope,
    fragment,
    fitsInLink: fits,
    fileName: shareFileName(workspace.project),
    file: JSON.stringify(envelope),
    passphrase: key === null,
  }
}

/**
 * Open a share from a link, a file, or both.
 *
 * Somebody was handed one of those and told "open this". Making them work out
 * which of three shapes they are holding is a way of being unhelpful on
 * purpose, so all three are accepted and the missing half is asked for by name.
 */
export async function shareOpen(
  source: string,
  options: { readonly passphrase?: string; readonly file?: string } = {},
): Promise<SharePayload> {
  const text = source.trim()
  const hash = text.includes('#') ? text.slice(text.indexOf('#')) : text
  const link = parseFragment(hash.startsWith('#') ? hash : `#s=${hash}`)

  const fromFile = (): ShareEnvelope => {
    if (options.file === undefined) {
      throw new KanboError(
        'This share is too big for a link, so its board is a separate file. Give it with --file.',
      )
    }
    return readEnvelope(options.file)
  }

  const withPassphrase = (envelope: ShareEnvelope): Promise<SharePayload> => {
    if (options.passphrase === undefined) {
      throw new KanboError('This share is held by a passphrase. Give it with --passphrase.')
    }
    return decryptShare(envelope, { passphrase: options.passphrase })
  }

  if (link) {
    switch (link.kind) {
      case 'inline':
        return decryptShare(link.envelope, { key: link.key })
      case 'file':
        return decryptShare(fromFile(), { key: link.key })
      case 'passphrase':
        return withPassphrase(link.envelope ?? fromFile())
    }
  }

  // Not a link at all, so it should be the envelope itself.
  const envelope = readEnvelope(text)
  if (envelope.kdf === 'argon2id') return withPassphrase(envelope)

  throw new ShareError(
    'This file is unlocked by a key that travels in the link, and no link was given.',
  )
}

function readEnvelope(text: string): ShareEnvelope {
  try {
    return text.trimStart().startsWith('{')
      ? (JSON.parse(text) as ShareEnvelope)
      : decodeEnvelope(text.trim())
  } catch {
    throw new KanboError('That is not a Kanbo share link or file.')
  }
}

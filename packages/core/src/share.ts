/**
 * Sharing a board without a server seeing it.
 *
 * The whole design turns on one property of URLs: **a fragment is never sent
 * to the host.** So the decryption key can travel in `#…` of a link served by
 * GitHub Pages, and GitHub Pages cannot read it — the browser strips the
 * fragment before the request leaves. Nothing is uploaded anywhere; the
 * ciphertext rides in the same fragment, or in a file you hand over yourself.
 *
 * What is shared is the *board*, not the log. A recipient gets a snapshot of
 * what the project looks like, not who moved what and when. That is a smaller
 * payload and a smaller disclosure, and it is why a share cannot be replayed
 * back into a vault as history.
 *
 * The honest limits, which the UI states too:
 *
 * - **A share cannot be revoked.** It is a copy. Once someone has the link,
 *   they have the data, and no amount of interface can take it back.
 * - **A link carries its own key.** Anyone the link reaches can read it, so a
 *   link pasted into a group chat is shared with that group chat. A passphrase
 *   share exists for when that is not acceptable.
 * - **There is no expiry**, because there is nobody to enforce one.
 *
 * This module holds the format and the arithmetic. The cryptography itself is
 * an adapter, because the domain does no I/O and reaches for no global.
 */
import type { Project } from './model/types.ts'

export const SHARE_VERSION = 1

/** How the key was derived. `none` means it is random and travels in the link. */
export type ShareKdf = 'none' | 'argon2id'

export type ShareEnvelope = {
  readonly v: number
  readonly kdf: ShareKdf
  /** Base64url. Present only for a passphrase share. */
  readonly salt?: string
  /** Base64url nonce. Fresh per share; never derived, never reused. */
  readonly iv: string
  /** Base64url ciphertext. */
  readonly data: string
}

export type SharePayload = {
  readonly v: number
  readonly sharedAt: number
  readonly note: string
  readonly project: Project
}

/**
 * Beyond this, a link stops being a link.
 *
 * Browsers accept far more, but chat clients, mail clients and terminals all
 * truncate somewhere unpredictable, and a share that arrives truncated fails
 * in a way the recipient cannot diagnose. Past this size Kanbo hands over a
 * file instead and keeps only the key in the link.
 */
export const MAX_LINK_PAYLOAD = 96 * 1024

export const SHARE_FRAGMENT = 's'
export const SHARE_FILE_EXTENSION = '.kanbo-share'

/* ------------------------------------------------------------ base64url */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const INDEX = new Map<string, number>([...ALPHABET].map((c, at) => [c, at]))

/**
 * Byte-level base64url — unpadded, and safe in a URL fragment.
 *
 * Distinct from `connectors/base64.ts`, which encodes UTF-8 text for a forge
 * API. Ciphertext is arbitrary bytes and `+`, `/` and `=` all need escaping in
 * a fragment, so conflating the two would corrupt every share containing the
 * wrong byte.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at]!
    const b = bytes[at + 1]
    const c = bytes[at + 2]
    out += ALPHABET[a >> 2]
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c !== undefined) out += ALPHABET[c & 63]
  }
  return out
}

export function base64UrlToBytes(encoded: string): Uint8Array {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of encoded) {
    const value = INDEX.get(character)
    if (value === undefined) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

/* -------------------------------------------------------------- payload */

/**
 * What actually gets encrypted.
 *
 * Archived items are dropped and the operation log is absent by construction:
 * a share is a picture of the board, not its history.
 */
export function sharePayload(project: Project, note: string, now: number): SharePayload {
  return {
    v: SHARE_VERSION,
    sharedAt: now,
    note,
    project: { ...project, items: project.items.filter((item) => !item.archived) },
  }
}

export class ShareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareError'
  }
}

export function parsePayload(json: string): SharePayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new ShareError('The share decrypted to something that is not a board.')
  }
  const record = parsed as Record<string, unknown>
  if (typeof record?.['v'] !== 'number' || typeof record['project'] !== 'object') {
    throw new ShareError('The share decrypted to something that is not a board.')
  }
  if (record['v'] > SHARE_VERSION) {
    throw new ShareError(
      `This share was made by a newer version of Kanbo (format ${String(record['v'])}). Update before opening it.`,
    )
  }
  return parsed as SharePayload
}

/* ------------------------------------------------------------- envelope */

export function encodeEnvelope(envelope: ShareEnvelope): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(envelope)))
}

export function decodeEnvelope(encoded: string): ShareEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)))
  } catch {
    throw new ShareError('That share link is damaged. It may have been truncated in transit.')
  }
  const record = parsed as Record<string, unknown>
  if (typeof record?.['iv'] !== 'string' || typeof record['data'] !== 'string') {
    throw new ShareError('That share link is damaged. It may have been truncated in transit.')
  }
  if (typeof record['v'] === 'number' && record['v'] > SHARE_VERSION) {
    throw new ShareError('That share was made by a newer version of Kanbo.')
  }
  return parsed as ShareEnvelope
}

/* ------------------------------------------------------------- fragment */

export type ShareLink =
  /** Everything travels in the link. */
  | { readonly kind: 'inline'; readonly key: string; readonly envelope: ShareEnvelope }
  /** The key is in the link; the ciphertext is a file to hand over. */
  | { readonly kind: 'file'; readonly key: string }
  /** Neither is in the link: the recipient needs the file and the passphrase. */
  | { readonly kind: 'passphrase'; readonly envelope: ShareEnvelope | null }

/**
 * Build the fragment for a share.
 *
 * The separator is `.` because base64url never produces one, so splitting can
 * never cut a payload in half.
 */
export function buildFragment(link: ShareLink): string {
  switch (link.kind) {
    case 'inline':
      return `#${SHARE_FRAGMENT}=${link.key}.${encodeEnvelope(link.envelope)}`
    case 'file':
      return `#${SHARE_FRAGMENT}=${link.key}`
    case 'passphrase':
      return link.envelope
        ? `#${SHARE_FRAGMENT}=p.${encodeEnvelope(link.envelope)}`
        : `#${SHARE_FRAGMENT}=p`
  }
}

export function parseFragment(hash: string): ShareLink | null {
  const raw = hash.replace(/^#/, '')
  if (!raw.startsWith(`${SHARE_FRAGMENT}=`)) return null

  const body = raw.slice(SHARE_FRAGMENT.length + 1)
  if (body === '') return null

  const at = body.indexOf('.')
  if (at === -1) {
    // A key alone, or the passphrase marker alone: the ciphertext is a file.
    return body === 'p' ? { kind: 'passphrase', envelope: null } : { kind: 'file', key: body }
  }

  const head = body.slice(0, at)
  const rest = body.slice(at + 1)

  return head === 'p'
    ? { kind: 'passphrase', envelope: decodeEnvelope(rest) }
    : { kind: 'inline', key: head, envelope: decodeEnvelope(rest) }
}

/** Would this payload survive being pasted into a chat window? */
export function fitsInLink(envelope: ShareEnvelope): boolean {
  return encodeEnvelope(envelope).length <= MAX_LINK_PAYLOAD
}

export function shareFileName(project: Project): string {
  const stem = (project.key || project.name || 'board').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')
  return `${stem}${SHARE_FILE_EXTENSION}`
}

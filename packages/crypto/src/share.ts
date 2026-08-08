import {
  type Project,
  type ShareEnvelope,
  ShareError,
  type SharePayload,
  base64UrlToBytes,
  bytesToBase64Url,
  parsePayload,
  sharePayload,
} from '@kanbo/core'
import { argon2id } from 'hash-wasm'

/**
 * Encrypting a share, with nothing leaving the machine that does it.
 *
 * This file reaches for five things — `crypto.subtle`, `CompressionStream`,
 * `DecompressionStream`, `Blob`, `Response` — and every one of them is a web
 * standard that Node has too. It lived in the browser adapter until a terminal
 * needed it, which was a statement about where it had been written rather than
 * about what it could run on. Nothing here was changed to make it portable; it
 * already was.
 *
 * AES-GCM-256 throughout. Two ways to get the key:
 *
 * **Random key.** Generated here, exported once, and carried in the URL
 * fragment — which browsers never send to the host. GitHub Pages serves the
 * link and cannot read what it unlocks.
 *
 * **Passphrase.** Derived with Argon2id, which is memory-hard: a GPU farm
 * cannot parallelise its way through a weak passphrase the way it can through
 * PBKDF2. The parameters below cost about a quarter-second on a laptop, which
 * is the right trade for something typed once. hash-wasm inlines its module as
 * base64 rather than fetching a `.wasm`, so this works under
 * `connect-src 'none'` — a fetched module would be blocked by our own policy,
 * and the smoke check would catch it. The same property is why it survives
 * being bundled into a single file for npm.
 *
 * Compression comes before encryption, because ciphertext is incompressible by
 * design and a board is mostly repeated field names. It routinely takes a
 * payload from "needs a file" to "fits in a link".
 */

const ARGON2 = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65_536, // 64 MiB
  hashLength: 32,
} as const

/** WebCrypto wants an ArrayBuffer-backed view. */
function buffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

async function compress(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompress(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([buffer(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

async function keyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await argon2id({ password: passphrase, salt, ...ARGON2, outputType: 'binary' })
  return crypto.subtle.importKey('raw', buffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export type ShareResult = {
  readonly envelope: ShareEnvelope
  /** Base64url of the raw key. Null for a passphrase share — there is nothing to carry. */
  readonly key: string | null
}

/**
 * Encrypt a board.
 *
 * A fresh nonce every time. Reusing one under AES-GCM is catastrophic, so it
 * is generated here and never derived from the passphrase, the payload or the
 * clock.
 */
export async function encryptShare(
  project: Project,
  note: string,
  passphrase: string | null,
): Promise<ShareResult> {
  const payload = sharePayload(project, note, Date.now())
  const plaintext = await compress(JSON.stringify(payload))
  const iv = crypto.getRandomValues(new Uint8Array(12))

  if (passphrase !== null && passphrase !== '') {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await keyFromPassphrase(passphrase, salt)
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buffer(iv) },
      key,
      buffer(plaintext),
    )
    return {
      envelope: {
        v: 1,
        kdf: 'argon2id',
        salt: bytesToBase64Url(salt),
        iv: bytesToBase64Url(iv),
        data: bytesToBase64Url(new Uint8Array(data)),
      },
      key: null,
    }
  }

  // Extractable, because the whole point is to hand it to someone. Every other
  // key in Kanbo is not.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buffer(iv) },
    key,
    buffer(plaintext),
  )
  const exported = new Uint8Array(await crypto.subtle.exportKey('raw', key))

  return {
    envelope: {
      v: 1,
      kdf: 'none',
      iv: bytesToBase64Url(iv),
      data: bytesToBase64Url(new Uint8Array(data)),
    },
    key: bytesToBase64Url(exported),
  }
}

/**
 * Decrypt a share.
 *
 * A wrong key and a wrong passphrase both surface as an authentication
 * failure, and both get the same message: distinguishing them would tell an
 * attacker which half they had already guessed.
 */
export async function decryptShare(
  envelope: ShareEnvelope,
  secret: { readonly key: string } | { readonly passphrase: string },
): Promise<SharePayload> {
  const iv = base64UrlToBytes(envelope.iv)
  const data = base64UrlToBytes(envelope.data)

  let key: CryptoKey
  try {
    if ('passphrase' in secret) {
      if (envelope.kdf !== 'argon2id' || !envelope.salt) {
        throw new ShareError('This share does not use a passphrase.')
      }
      key = await keyFromPassphrase(secret.passphrase, base64UrlToBytes(envelope.salt))
    } else {
      key = await crypto.subtle.importKey(
        'raw',
        buffer(base64UrlToBytes(secret.key)),
        'AES-GCM',
        false,
        ['decrypt'],
      )
    }
  } catch (error) {
    if (error instanceof ShareError) throw error
    throw new ShareError('That key is not the right shape for this share.')
  }

  let plaintext: Uint8Array
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(iv) }, key, buffer(data)),
    )
  } catch {
    throw new ShareError(
      'passphrase' in secret
        ? 'That passphrase does not open this share.'
        : 'This link does not open this share. It may have been truncated, or edited in transit.',
    )
  }

  try {
    return parsePayload(await decompress(plaintext))
  } catch (error) {
    if (error instanceof ShareError) throw error
    throw new ShareError('The share decrypted, but its contents could not be read.')
  }
}

/** How long deriving a key takes here — shown before someone waits for it. */
export async function measureArgonCost(): Promise<number> {
  const started = performance.now()
  await keyFromPassphrase('benchmark', new Uint8Array(16))
  return Math.round(performance.now() - started)
}

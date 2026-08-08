import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Ciphertext, Crypto as CryptoPort, Storage } from '@kanbo/core'
import { readToken as unframeToken, storeToken as frameToken } from '@kanbo/crypto'

/**
 * Encryption at rest, and an honest account of what it is worth here.
 *
 * The browser can do something a terminal cannot: hold a **non-extractable**
 * `CryptoKey` in IndexedDB, so that `exportKey` throws and no code path — ours
 * or a compromised dependency's — turns it back into bytes.
 *
 * There is no equivalent on a filesystem. A key that survives a reboot is a key
 * written down, and anything that can read the file can read the key. So this
 * writes 32 random bytes to `crypto.key` with mode `0600` and says so plainly
 * rather than implying a guarantee it cannot keep: on this side, the token is
 * protected from a stray `cat` of the log and from anything that reads the
 * store without reading the key file, and from nothing else.
 *
 * That is still worth doing — the token is the one secret Kanbo holds, and it
 * can write to a repository — but it is a different claim from the browser's,
 * and pretending otherwise would be the kind of quiet overstatement this
 * project exists to avoid.
 */
const KEY_FILE = 'crypto.key'
const KEY_MODE = 0o600

async function keyFor(root: string): Promise<CryptoKey> {
  const path = join(root, KEY_FILE)

  let raw: Uint8Array
  try {
    raw = new Uint8Array(await readFile(path))
    // A key file of the wrong length is not a key. Regenerating would silently
    // orphan whatever it had encrypted, so refuse instead of guessing.
    if (raw.length !== 32) throw new Error(`${path} is not a 32-byte key.`)
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error
    raw = crypto.getRandomValues(new Uint8Array(32))
    await mkdir(root, { recursive: true })
    await writeFile(path, raw, { mode: KEY_MODE })
    // writeFile honours `mode` only when it creates the file; an existing one
    // keeps whatever it had, so say it again rather than assume.
    await chmod(path, KEY_MODE)
  }

  return crypto.subtle.importKey('raw', toBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** Narrow a view to a plain ArrayBuffer, which is what WebCrypto accepts. */
function toBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

export function nodeCrypto(root: string): CryptoPort {
  return {
    async encrypt(plaintext) {
      const key = await keyFor(root)
      // A fresh nonce per message. Reusing one under AES-GCM is catastrophic,
      // so it is generated here and never derived from anything.
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toBuffer(iv) },
        key,
        toBuffer(plaintext),
      )
      return { iv, data: new Uint8Array(data) }
    },

    async decrypt(ciphertext: Ciphertext) {
      const key = await keyFor(root)
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toBuffer(ciphertext.iv) },
        key,
        toBuffer(ciphertext.data),
      )
      return new Uint8Array(plain)
    },
  }
}

/**
 * The token, framed by `@kanbo/crypto` and sealed by the key above.
 *
 * The framing is shared with the browser adapter; only the key differs. A token
 * stored by one runtime therefore opens in the other, given the same key —
 * which is not a thing anyone should do, but is the right reason for the layout
 * to live in one place.
 */
export function storeToken(storage: Storage, root: string, token: string): Promise<void> {
  return frameToken(storage, nodeCrypto(root), token)
}

export function readToken(storage: Storage, root: string): Promise<string | null> {
  return unframeToken(storage, nodeCrypto(root))
}

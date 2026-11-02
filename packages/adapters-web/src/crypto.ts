import type { Storage } from '@kanbo/core'
import { readToken as unframeToken } from '@kanbo/crypto/token'
import { sealedStore } from 'llm-connect/sealed-store'

/**
 * Encryption at rest, with a key JavaScript cannot read.
 *
 * The access token is the one secret Kanbo holds, and it is worth more than
 * the board: it can write to a repository. Keeping it in `localStorage` as
 * plain text means any script that runs on this origin — a compromised
 * dependency, a browser extension — walks off with it.
 *
 * So it is sealed by llm-connect's `sealedStore`: AES-GCM under a
 * **non-extractable** `CryptoKey` kept in IndexedDB by reference, a fresh nonce
 * on every write, and the secret's name bound to the ciphertext. `exportKey` on
 * that key throws; there is no code path, ours or anyone else's, that turns it
 * back into bytes. An attacker with script execution can still ask the browser
 * to decrypt, which is why this is a meaningful raising of the bar rather than
 * a guarantee — but the difference between "steal the token" and "must run code
 * on the page while it is open" is the difference that matters.
 *
 * Its database is prefixed with the app: every project of the account shares
 * this origin's IndexedDB.
 */
export const SEALED_DB = 'kanbo-sealed'
const TOKEN = 'forge.token'

/** Built on each call: it reads `indexedDB` and WebCrypto when it is created. */
const secrets = () => sealedStore({ dbName: SEALED_DB })

/** Raised when the token could not be kept, so nobody is told it was saved. */
export class TokenNotStored extends Error {
  constructor() {
    super(
      'The token could not be stored: storage for this site is full or blocked, so it would be lost on reload.',
    )
    this.name = 'TokenNotStored'
  }
}

/** Store the access token sealed; an empty one removes it. */
export async function storeToken(storage: Storage, token: string): Promise<void> {
  if (token === '') {
    await secrets().delete(TOKEN)
    await dropLegacy(storage)
    return
  }
  if (!(await secrets().set(TOKEN, token))) throw new TokenNotStored()
  // The new token supersedes whatever an earlier version kept.
  await dropLegacy(storage)
}

export async function readToken(storage: Storage): Promise<string | null> {
  const sealed = await secrets().get(TOKEN)
  if (sealed !== null) return sealed

  // A token saved by an earlier version: moved across once, and the old copy
  // removed only when the new one is safely written.
  const legacy = await readLegacyToken(storage)
  if (legacy !== null && (await secrets().set(TOKEN, legacy))) await dropLegacy(storage)
  return legacy
}

/* ────────────────────────────────────────────────────────────────────────────
 * Before the sealed store: the token, framed by `@kanbo/crypto/token`, sat in
 * the board's own storage under `forge.token`, encrypted with a key of its own
 * in the `kanbo-keys` database. Read here only, to migrate it.
 * ──────────────────────────────────────────────────────────────────────────── */

// Also listed in storage.ts's KANBO_DATABASES, so erasing everything takes it.
export const LEGACY_KEY_DB = 'kanbo-keys'
const LEGACY_KEY_STORE = 'keys'
const LEGACY_KEY_RECORD = 'crypto.key'

async function readLegacyToken(storage: Storage): Promise<string | null> {
  // Checked first, so a device that never had one does not grow the old database.
  if (!(await storage.get(TOKEN))) return null

  const key = await legacyKey()
  if (!key) {
    // Its key is gone: that ciphertext can never be opened again.
    await dropLegacy(storage)
    return null
  }
  return unframeToken(storage, {
    encrypt: () => Promise.reject(new Error('The legacy key only decrypts.')),
    async decrypt({ iv, data }) {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toBuffer(iv) },
        key,
        toBuffer(data),
      )
      return new Uint8Array(plain)
    },
  })
}

function legacyKey(): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_KEY_DB, 1)
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(LEGACY_KEY_STORE)) {
        request.result.createObjectStore(LEGACY_KEY_STORE)
      }
    })
    request.addEventListener('error', () =>
      reject(request.error ?? new Error('The key store could not be opened.')),
    )
    request.addEventListener('success', () => {
      const database = request.result
      const read = database
        .transaction(LEGACY_KEY_STORE, 'readonly')
        .objectStore(LEGACY_KEY_STORE)
        .get(LEGACY_KEY_RECORD)
      read.addEventListener('success', () => {
        database.close()
        resolve(read.result instanceof CryptoKey ? read.result : null)
      })
      read.addEventListener('error', () => {
        database.close()
        reject(read.error)
      })
    })
  })
}

async function dropLegacy(storage: Storage): Promise<void> {
  await storage.delete(TOKEN)
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LEGACY_KEY_DB)
    // Best effort: a leftover key with nothing sealed under it opens nothing.
    request.addEventListener('success', () => resolve())
    request.addEventListener('error', () => resolve())
    request.addEventListener('blocked', () => resolve())
  })
}

/** Narrow a view to a plain ArrayBuffer, which is what WebCrypto accepts. */
function toBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

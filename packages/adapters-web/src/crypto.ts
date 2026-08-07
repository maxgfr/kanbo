import type { Ciphertext, Crypto as CryptoPort, Storage } from '@kanbo/core'

/**
 * Encryption at rest, with a key JavaScript cannot read.
 *
 * The access token is the one secret Kanbo holds, and it is worth more than
 * the board: it can write to a repository. Keeping it in `localStorage` as
 * plain text means any script that runs on this origin — a compromised
 * dependency, a browser extension — walks off with it.
 *
 * So the key is generated as a **non-extractable** `CryptoKey` and stored in
 * IndexedDB by reference. `exportKey` on it throws; there is no code path,
 * ours or anyone else's, that turns it back into bytes. An attacker with script
 * execution can still ask the browser to decrypt, which is why this is a
 * meaningful raising of the bar rather than a guarantee — but the difference
 * between "steal the token" and "must run code on the page while it is open"
 * is the difference that matters.
 */
const KEY_RECORD = 'crypto.key'

async function keyFor(storage: Storage): Promise<CryptoKey> {
  // The key is held as a CryptoKey object, which structured clone stores in
  // IndexedDB without ever materialising its bytes.
  const database = await openKeyStore()
  const existing = await read(database, KEY_RECORD)
  if (existing instanceof CryptoKey) return existing

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await write(database, KEY_RECORD, key)
  void storage
  return key
}

const KEY_DB = 'kanbo-keys'
const KEY_STORE = 'keys'

function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB, 1)
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE)
      }
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () =>
      reject(request.error ?? new Error('The key store could not be opened.')),
    )
  })
}

function read(database: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(key)
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error))
  })
}

function write(database: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(KEY_STORE, 'readwrite')
      .objectStore(KEY_STORE)
      .put(value, key)
    request.addEventListener('success', () => resolve())
    request.addEventListener('error', () => reject(request.error))
  })
}

/** Narrow a view to a plain ArrayBuffer, which is what WebCrypto accepts. */
function toBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

export function browserCrypto(storage: Storage): CryptoPort {
  return {
    async encrypt(plaintext) {
      const key = await keyFor(storage)
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
      const key = await keyFor(storage)
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toBuffer(ciphertext.iv) },
        key,
        toBuffer(ciphertext.data),
      )
      return new Uint8Array(plain)
    },
  }
}

const TOKEN_KEY = 'forge.token'

/** Store the access token encrypted, keyed by the non-extractable key above. */
export async function storeToken(storage: Storage, token: string): Promise<void> {
  if (token === '') {
    await storage.delete(TOKEN_KEY)
    return
  }
  const { encrypt } = browserCrypto(storage)
  const { iv, data } = await encrypt(new TextEncoder().encode(token))

  const envelope = new Uint8Array(1 + iv.length + data.length)
  envelope[0] = iv.length
  envelope.set(iv, 1)
  envelope.set(data, 1 + iv.length)
  await storage.set(TOKEN_KEY, envelope)
}

export async function readToken(storage: Storage): Promise<string | null> {
  const envelope = await storage.get(TOKEN_KEY)
  if (!envelope || envelope.length < 2) return null

  try {
    const ivLength = envelope[0]!
    const iv = envelope.slice(1, 1 + ivLength)
    const data = envelope.slice(1 + ivLength)
    const { decrypt } = browserCrypto(storage)
    return new TextDecoder().decode(await decrypt({ iv, data }))
  } catch {
    // A token we cannot decrypt is a token we do not have. Reporting null
    // sends the user to re-enter it rather than failing every sync opaquely.
    return null
  }
}

import type { Storage } from '@kanbo/core'

/**
 * The Storage port over IndexedDB.
 *
 * One object store of opaque byte arrays, keyed by string. The store never
 * learns what it is holding, which is what lets the same interface hold
 * plaintext in local mode and ciphertext once a passphrase is set, with no
 * branch anywhere in the domain.
 */
const DATABASE = 'kanbo'
const STORE = 'vault'
const VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () =>
      reject(request.error ?? new Error('IndexedDB refused to open.')),
    )
    request.addEventListener('blocked', () =>
      reject(new Error('Another Kanbo tab is holding the database open at an older version.')),
    )
  })
}

function run<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode)
    const request = work(transaction.objectStore(STORE))
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () =>
      reject(request.error ?? new Error('IndexedDB request failed.')),
    )
    transaction.addEventListener('abort', () =>
      reject(transaction.error ?? new Error('IndexedDB aborted.')),
    )
  })
}

export function browserStorage(): Storage {
  // Opened once and reused: a handle per call would serialise every read behind
  // its own connection, and the board reads the whole log on load.
  let database: Promise<IDBDatabase> | null = null
  const connection = () => (database ??= open())

  return {
    async get(key) {
      const value = await run<unknown>(await connection(), 'readonly', (store) => store.get(key))
      if (value === undefined) return null
      // Structured clone gives back an ArrayBuffer or a view depending on how
      // it went in; normalise so callers never have to care.
      if (value instanceof Uint8Array) return value
      if (value instanceof ArrayBuffer) return new Uint8Array(value)
      return null
    },

    async set(key, value) {
      await run(await connection(), 'readwrite', (store) => store.put(value, key))
    },

    async delete(key) {
      await run(await connection(), 'readwrite', (store) => store.delete(key))
    },

    async keys(prefix) {
      const all = await run<IDBValidKey[]>(await connection(), 'readonly', (store) =>
        store.getAllKeys(),
      )
      const strings = all.filter((key): key is string => typeof key === 'string')
      return prefix ? strings.filter((key) => key.startsWith(prefix)) : strings
    },

    async clear() {
      await run(await connection(), 'readwrite', (store) => store.clear())
    },
  }
}

/**
 * Erase everything Kanbo has ever written, including the database itself.
 *
 * `clear()` empties the store; this removes it. The difference matters for the
 * promise the settings screen makes — after this, a forensic look at the
 * profile finds no Kanbo database, not an empty one.
 */
export async function wipeEverything(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE)
    // Every outcome resolves: a database that refuses to delete must not leave
    // the user staring at a spinner on the one screen that promised finality.
    request.addEventListener('success', () => resolve())
    request.addEventListener('error', () => resolve())
    request.addEventListener('blocked', () => resolve())
  })

  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // Storage may be blocked entirely; nothing was written in that case either.
  }

  if ('caches' in globalThis) {
    const names = await caches.keys()
    await Promise.all(names.map((name) => caches.delete(name)))
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }
}

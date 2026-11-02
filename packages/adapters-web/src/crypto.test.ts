import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { Storage } from '@kanbo/core'
import { storeToken as frameToken } from '@kanbo/crypto/token'

import { LEGACY_KEY_DB, SEALED_DB, TokenNotStored, readToken, storeToken } from './crypto.ts'

/**
 * The token at rest in a browser.
 *
 * GitHub Pages serves every project of the account from one origin, so this
 * database sits next to those of unrelated apps. What is checked here is what
 * Kanbo itself promises: the token is never stored in clear, a failed write is
 * reported rather than claimed, and a token saved by the previous version
 * survives the move to the sealed store.
 */
const failWrites = vi.hoisted(() => ({ on: false }))

vi.mock('llm-connect', async (original) => {
  const actual = await original<typeof import('llm-connect')>()
  return {
    ...actual,
    sealedStore: (options: { dbName: string }) => {
      const store = actual.sealedStore(options)
      return {
        ...store,
        set: (name: string, value: string) =>
          failWrites.on ? Promise.resolve(false) : store.set(name, value),
      }
    },
  }
})

const TOKEN = 'ghp_notarealtoken'

function memoryStorage(): Storage & { readonly entries: Map<string, Uint8Array> } {
  const entries = new Map<string, Uint8Array>()
  return {
    entries,
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => void entries.delete(key),
    keys: async (prefix = '') => [...entries.keys()].filter((key) => key.startsWith(prefix)),
    clear: async () => entries.clear(),
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener('success', () => resolve(req.result))
    req.addEventListener('error', () => reject(req.error))
  })
}

async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((database) => database.name ?? '')
}

/** Every value of a database, as bytes, to look for the token in it. */
async function dump(name: string): Promise<Uint8Array[]> {
  const opening = indexedDB.open(name)
  const database = await request(opening)
  const values: Uint8Array[] = []
  for (const store of database.objectStoreNames) {
    const all = await request(database.transaction(store).objectStore(store).getAll())
    for (const value of all) {
      if (value instanceof Uint8Array) values.push(value)
      else if (value && typeof value === 'object' && 'ciphertext' in value) {
        values.push(new Uint8Array(value.ciphertext as ArrayBuffer))
      }
    }
  }
  database.close()
  return values
}

function contains(haystack: Uint8Array, needle: string): boolean {
  return new TextDecoder('latin1').decode(haystack).includes(needle)
}

/** What the previous version left behind: a framed token and its key. */
async function legacyToken(storage: Storage, token: string, keepKey = true): Promise<void> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await frameToken(
    storage,
    {
      async encrypt(plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const data = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          new Uint8Array(plaintext),
        )
        return { iv, data: new Uint8Array(data) }
      },
      decrypt: () => Promise.reject(new Error('unused')),
    },
    token,
  )
  if (!keepKey) return
  const opening = indexedDB.open(LEGACY_KEY_DB, 1)
  opening.addEventListener('upgradeneeded', () => opening.result.createObjectStore('keys'))
  const database = await request(opening)
  await request(
    database.transaction('keys', 'readwrite').objectStore('keys').put(key, 'crypto.key'),
  )
  database.close()
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  failWrites.on = false
})

describe('the browser token vault', () => {
  it('gives back the token it was given, and never stores it in clear', async () => {
    const storage = memoryStorage()
    await storeToken(storage, TOKEN)

    expect(await readToken(storage)).toBe(TOKEN)
    expect(await databaseNames()).toContain(SEALED_DB)
    for (const value of await dump(SEALED_DB)) expect(contains(value, TOKEN)).toBe(false)
    expect(storage.entries.size).toBe(0)
  })

  it('removes the token when an empty one is saved', async () => {
    const storage = memoryStorage()
    await storeToken(storage, TOKEN)
    await storeToken(storage, '')

    expect(await readToken(storage)).toBeNull()
  })

  it('says so when the token could not be stored, rather than claiming it was', async () => {
    const storage = memoryStorage()
    failWrites.on = true

    await expect(storeToken(storage, TOKEN)).rejects.toBeInstanceOf(TokenNotStored)
    expect(await readToken(storage)).toBeNull()
  })

  it('reports no token when there is none, without creating the old key database', async () => {
    expect(await readToken(memoryStorage())).toBeNull()
    expect(await databaseNames()).not.toContain(LEGACY_KEY_DB)
  })
})

describe('a token saved by the previous version', () => {
  it('is moved to the sealed store, and the old copy and its key are removed', async () => {
    const storage = memoryStorage()
    await legacyToken(storage, TOKEN)

    expect(await readToken(storage)).toBe(TOKEN)
    expect(storage.entries.has('forge.token')).toBe(false)
    expect(await databaseNames()).not.toContain(LEGACY_KEY_DB)
    for (const value of await dump(SEALED_DB)) expect(contains(value, TOKEN)).toBe(false)

    // Read from the sealed store from now on.
    expect(await readToken(storage)).toBe(TOKEN)
  })

  it('stays where it is while the sealed store cannot take it', async () => {
    const storage = memoryStorage()
    await legacyToken(storage, TOKEN)
    failWrites.on = true

    expect(await readToken(storage)).toBe(TOKEN)
    expect(storage.entries.has('forge.token')).toBe(true)
    expect(await databaseNames()).toContain(LEGACY_KEY_DB)

    failWrites.on = false
    expect(await readToken(storage)).toBe(TOKEN)
    expect(storage.entries.has('forge.token')).toBe(false)
  })

  it('is dropped when its key is gone, since nothing can open it any more', async () => {
    const storage = memoryStorage()
    await legacyToken(storage, TOKEN, false)

    expect(await readToken(storage)).toBeNull()
    expect(storage.entries.has('forge.token')).toBe(false)
  })

  it('is replaced by a newly saved token', async () => {
    const storage = memoryStorage()
    await legacyToken(storage, 'ghp_old')
    await storeToken(storage, TOKEN)

    expect(storage.entries.has('forge.token')).toBe(false)
    expect(await readToken(storage)).toBe(TOKEN)
  })
})

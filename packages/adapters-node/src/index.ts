/**
 * Node implementations of the same ports the browser satisfies.
 *
 * This package is the proof that the architecture works. Not a line of domain
 * logic is repeated here — the board, the merge, the metrics and the query
 * language are all `@kanbo/core`, unchanged and unaware of where they are
 * running. What changes is only what the domain always said it needed: a
 * place to put bytes, a clock, and a source of ids.
 *
 * If this file had to import anything from `@kanbo/web`, or if the domain had
 * reached for `indexedDB` or `window` even once, none of this would compile.
 */
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Clock, Ports, Random, Storage } from '@kanbo/core'

export const nodeClock: Clock = { now: () => Date.now() }

export const nodeRandom: Random = {
  id() {
    let out = ''
    for (const byte of randomBytes(16)) out += byte.toString(36).padStart(2, '0')
    return out
  },
}

/**
 * The Storage port over a directory.
 *
 * Keys become file names, so a project on disk is a directory someone can look
 * inside — which is the right default for a tool whose whole argument is that
 * your data is yours.
 */
export function fileStorage(root: string): Storage {
  const pathFor = (key: string) => join(root, `${encodeURIComponent(key)}.bin`)

  return {
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)))
      } catch {
        return null
      }
    },
    async set(key, value) {
      await mkdir(dirname(pathFor(key)), { recursive: true })
      await writeFile(pathFor(key), value)
    },
    async delete(key) {
      await rm(pathFor(key), { force: true })
    },
    async keys(prefix) {
      let entries: string[]
      try {
        entries = await readdir(root)
      } catch {
        return []
      }
      const keys = entries
        .filter((entry) => entry.endsWith('.bin'))
        .map((entry) => decodeURIComponent(entry.slice(0, -4)))
      return prefix ? keys.filter((key) => key.startsWith(prefix)) : keys
    },
    async clear() {
      await rm(root, { recursive: true, force: true })
    },
  }
}

export function nodePorts(root: string): Ports {
  return { clock: nodeClock, random: nodeRandom, storage: fileStorage(root) }
}

/** This machine's device identity, kept beside the project. */
export async function nodeDeviceId(storage: Storage): Promise<string> {
  const existing = await storage.get('device')
  if (existing) return new TextDecoder().decode(existing)
  const minted = randomUUID()
  await storage.set('device', new TextEncoder().encode(minted))
  return minted
}

export { nodeHttp } from './http.ts'
export { nodeCrypto, storeToken, readToken } from './crypto.ts'

/**
 * Share encryption is deliberately *not* re-exported here.
 *
 * It would be a convenience with a price: this barrel is what the MCP server
 * reaches for its token vault, and re-exporting Argon2id through it drags six
 * hundred kilobytes of wasm into a published bin that never encrypts a share.
 * Whoever wants it imports `@kanbo/crypto` and says so.
 */

import type { SyncMode } from '@kanbo/core/policy'

/**
 * Where the network decision is stored, and why it is not in the vault.
 *
 * The policy is decided by the first module the browser runs — long before
 * there is a key to decrypt anything with, and IndexedDB is asynchronous
 * besides. So this one setting lives in `localStorage`, synchronously readable,
 * and holds nothing secret: a mode and the base URL of a git forge. The access
 * token is a different matter entirely and is kept encrypted in the vault.
 */
const KEY = 'kanbo.sync'

export type SyncSettings = {
  readonly mode: SyncMode
  /** Base URL of the forge API, e.g. `https://api.github.com`. */
  readonly remoteUrl: string | null
}

export const LOCAL_ONLY: SyncSettings = { mode: 'local', remoteUrl: null }

function isSyncSettings(value: unknown): value is SyncSettings {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const modeOk = candidate['mode'] === 'local' || candidate['mode'] === 'connected'
  const remoteOk = candidate['remoteUrl'] === null || typeof candidate['remoteUrl'] === 'string'
  return modeOk && remoteOk
}

/**
 * Every failure mode — storage blocked, quota gone, corrupted JSON, a shape
 * from a future version — lands on the closed answer. A setting we cannot read
 * is a setting we do not honour.
 */
export function readSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return LOCAL_ONLY
    const parsed: unknown = JSON.parse(raw)
    return isSyncSettings(parsed) ? parsed : LOCAL_ONLY
  } catch {
    return LOCAL_ONLY
  }
}

/**
 * Returns what is actually stored afterwards rather than what we asked for.
 * A silent write failure would otherwise leave the UI showing sync as enabled
 * while the next boot serves the strict document.
 */
export function writeSyncSettings(settings: SyncSettings): SyncSettings {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Ignored: the read below reports the truth either way.
  }
  return readSyncSettings()
}

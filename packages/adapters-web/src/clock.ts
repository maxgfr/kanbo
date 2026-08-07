import type { Clock, Random } from '@kanbo/core'

export const browserClock: Clock = {
  now: () => Date.now(),
}

/**
 * Identifiers from the platform CSPRNG.
 *
 * Operation ids must not collide across devices that have never met, so this
 * uses 128 bits of randomness rather than a counter or a timestamp. Base36
 * keeps them short enough to read in a log file without being ambiguous.
 */
export const browserRandom: Random = {
  id() {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    let out = ''
    for (const byte of bytes) out += byte.toString(36).padStart(2, '0')
    return out
  },
}

/**
 * This device's identity, minted once and kept for the life of the profile.
 *
 * It names the file this device owns in a synced repository, so it has to
 * survive reloads — and it must never be shared with another device, or two of
 * them would append to one file and reintroduce exactly the conflict the
 * per-device log exists to remove.
 */
export function deviceId(): string {
  const KEY = 'kanbo.deviceId'
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const minted = browserRandom.id()
    localStorage.setItem(KEY, minted)
    return minted
  } catch {
    // Storage blocked: a per-session identity still keeps this device's
    // operations distinct from everyone else's.
    return browserRandom.id()
  }
}

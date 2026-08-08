/**
 * Browser implementations of the ports declared in `@kanbo/core`.
 *
 * The domain names what it needs — storage, a clock, a source of ids — and this
 * package satisfies those needs with IndexedDB and WebCrypto. A Node package
 * satisfies the identical interfaces with the filesystem and `node:crypto`,
 * which is what lets a CLI drive the same domain logic without a browser and
 * without duplicating a line of it.
 *
 * Share encryption and the token framing are re-exported from `@kanbo/crypto`
 * rather than written here: they use only standards Node has too, so keeping a
 * copy on each side would have been two chances to disagree. What stays here is
 * the part that genuinely differs — where the key lives.
 */
export { browserStorage, wipeEverything } from './storage.ts'
export { browserClock, browserRandom, deviceId } from './clock.ts'
export { browserCrypto, storeToken, readToken } from './crypto.ts'
export { encryptShare, decryptShare, measureArgonCost, type ShareResult } from '@kanbo/crypto'

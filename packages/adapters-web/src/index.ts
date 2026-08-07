/**
 * Browser implementations of the ports declared in `@kanbo/core`.
 *
 * The domain names what it needs — storage, a clock, a source of ids — and this
 * package satisfies those needs with IndexedDB and WebCrypto. A Node package
 * will satisfy the identical interfaces with the filesystem and `node:crypto`,
 * which is what lets a CLI drive the same domain logic without a browser and
 * without duplicating a line of it.
 */
export { browserStorage, wipeEverything } from './storage'
export { browserClock, browserRandom, deviceId } from './clock'

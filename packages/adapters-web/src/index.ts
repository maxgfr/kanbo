/**
 * Browser implementations of the ports declared in `@kanbo/core/ports`.
 *
 * The domain names what it needs — storage, crypto, a clock — and this package
 * satisfies those needs with IndexedDB and WebCrypto. `@kanbo/adapters-node`
 * will satisfy the same interfaces with the filesystem and `node:crypto`, which
 * is what lets the CLI drive the identical domain logic without a browser.
 *
 * Filled in during phase 2.
 */

/** Placeholder until the first port lands, so the package has a public shape. */
export const ADAPTER_TARGET = 'browser' as const

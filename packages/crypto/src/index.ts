/**
 * The cryptography both runtimes share.
 *
 * `@kanbo/core` may not reach for a global, and `crypto.subtle` is one — so
 * this cannot live there. But it is not browser code either: every API it uses
 * is a web standard that Node implements. It is its own package for exactly
 * that reason, and both adapters re-export it, so nothing above them has to
 * know which runtime it is on.
 */
export { encryptShare, decryptShare, measureArgonCost, type ShareResult } from './share.ts'
export { storeToken, readToken } from './token.ts'

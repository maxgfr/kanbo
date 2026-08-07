/**
 * What the domain needs from the outside world, stated as interfaces it does
 * not implement.
 *
 * `@kanbo/core` performs no I/O and reaches for no global. It cannot open a
 * database, read a clock or generate a random number by itself — it asks for
 * those through the ports below, and whoever constructs the domain supplies
 * them. The browser supplies IndexedDB and WebCrypto; a CLI will supply the
 * filesystem and `node:crypto`; a test supplies neither and passes fakes.
 *
 * That is the whole reason the CLI will not duplicate a line of business logic,
 * and the reason these tests need no mocking framework.
 *
 * `Clock` and `Random` look like over-abstraction until you try to test a merge
 * engine: operations are ordered by timestamp and identified by random id, so a
 * domain that calls `Date.now()` directly has no reproducible concurrent tests.
 */

/** Wall-clock time, in milliseconds since the Unix epoch. */
export interface Clock {
  now(): number
}

/** A source of unique identifiers. Must not collide across devices. */
export interface Random {
  /** A short, URL-safe, collision-resistant identifier. */
  id(): string
}

/**
 * A key/value store, scoped to one namespace. Values are opaque bytes so that
 * the storage layer never needs to know whether it is holding ciphertext.
 */
export interface Storage {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<readonly string[]>
  /** Erase everything. Used by the "delete my data" path, which must leave nothing. */
  clear(): Promise<void>
}

export type Ciphertext = {
  readonly iv: Uint8Array
  readonly data: Uint8Array
}

/**
 * Authenticated encryption. The key never leaves the implementation — the
 * domain refers to it by handle only, so no amount of domain logic can leak it.
 */
export interface Crypto {
  encrypt(plaintext: Uint8Array): Promise<Ciphertext>
  decrypt(ciphertext: Ciphertext): Promise<Uint8Array>
}

export type HttpRequest = {
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
}

export type HttpResponse = {
  readonly status: number
  readonly body: string
}

/**
 * The narrowest possible view of the network.
 *
 * Deliberately not `fetch`: the domain must not be able to reach for a global,
 * and the browser adapter behind this interface is the single audited module
 * that enforces the configured origin. A CI guard fails the build if any other
 * file reaches for a network API, which is what makes "the page talks to one
 * host" checkable rather than merely intended.
 */
export interface Http {
  request(url: string, init: HttpRequest): Promise<HttpResponse>
}

/** Everything the domain needs, gathered in one place. */
export type Ports = {
  readonly clock: Clock
  readonly random: Random
  readonly storage: Storage
}

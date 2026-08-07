/**
 * The one thing the domain knows about a git forge.
 *
 * Kanbo talks to GitHub today and should talk to GitLab or a self-hosted Gitea
 * tomorrow by swapping an implementation, not by editing the sync engine. So
 * the engine is written against this interface and has never heard of GitHub;
 * everything provider-specific — URL shapes, base64 quirks, how a concurrent
 * write is reported — lives behind it.
 *
 * The surface is deliberately small. Reading a file, writing a file with an
 * expected version, and listing a prefix is the whole of what storing an
 * operation log in a repository requires. Issue and pull-request methods sit
 * on the same boundary and are optional, because a provider that cannot do
 * them is still a perfectly good backend.
 */

export type RemoteFile = {
  readonly path: string
  readonly content: string
  /** The provider's version marker, passed back on write to detect a conflict. */
  readonly sha: string
}

export type WriteRequest = {
  readonly path: string
  readonly content: string
  /** The sha the caller believes is current; omit when creating the file. */
  readonly sha?: string
  readonly message: string
}

/**
 * Raised when the file changed under us.
 *
 * Distinguished from every other failure because it has a specific and
 * recoverable answer — re-read, merge, write again — while a network error or
 * a bad token does not.
 */
export class ConflictError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`${path} changed since it was read.`)
    this.name = 'ConflictError'
    this.path = path
  }
}

export class ProviderError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

export type ProviderId = 'github' | 'gitlab' | 'gitea'

export interface GitProvider {
  readonly id: ProviderId
  /** Base URL of the API. The CSP is narrowed to this origin at boot. */
  readonly apiBaseUrl: string

  /** Null when the file does not exist — which is not an error on first sync. */
  readFile(path: string): Promise<RemoteFile | null>

  /** Throws ConflictError when `sha` no longer matches. */
  writeFile(request: WriteRequest): Promise<{ readonly sha: string }>

  /** Paths under a prefix, one level deep. */
  listFiles(prefix: string): Promise<readonly string[]>
}

/** Where Kanbo keeps its files in a repository. */
export const KANBO_DIR = '.kanbo'
export const MANIFEST_PATH = `${KANBO_DIR}/manifest.json`
export const OPS_DIR = `${KANBO_DIR}/ops`
export const SNAPSHOT_PATH = `${KANBO_DIR}/snapshot.json`
export const ITEMS_DIR = `${KANBO_DIR}/items`

export function opsPathFor(deviceId: string): string {
  return `${OPS_DIR}/${deviceId}.ndjson`
}

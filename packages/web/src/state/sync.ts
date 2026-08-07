import { readToken, storeToken } from '@kanbo/adapters-web'
import {
  ConflictError,
  type GitProvider,
  ProviderError,
  gitHubProvider,
  parseRepository,
  synchronise,
} from '@kanbo/core'

import { readSyncSettings } from '../boot/syncSettings'
import { browserHttp } from '../net/http'
import type { Store } from './store'

export type SyncState =
  | { readonly kind: 'off' }
  | { readonly kind: 'unconfigured'; readonly reason: string }
  | { readonly kind: 'idle'; readonly at: number | null }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Build the provider from what the user configured, or explain what is missing.
 *
 * Returning the reason rather than null means the settings screen can say
 * "no token yet" instead of a generic failure, which is the difference between
 * a user fixing it in ten seconds and giving up.
 */
export async function buildProvider(
  store: Store,
): Promise<{ provider: GitProvider } | { reason: string }> {
  const settings = readSyncSettings()
  if (settings.mode !== 'connected') return { reason: 'Repository sync is switched off.' }
  if (!settings.remoteUrl) return { reason: 'No forge API has been set.' }

  const repository = parseRepository(settings.repository)
  if (!repository) return { reason: 'The repository should look like owner/name.' }

  const token = await readToken(store.storage)
  if (!token) return { reason: 'No access token has been saved.' }

  return {
    provider: gitHubProvider(browserHttp(settings.remoteUrl), {
      apiBaseUrl: settings.remoteUrl,
      owner: repository.owner,
      repo: repository.repo,
      branch: settings.branch || 'main',
      token,
    }),
  }
}

export async function saveToken(store: Store, token: string): Promise<void> {
  await storeToken(store.storage, token.trim())
}

export async function hasToken(store: Store): Promise<boolean> {
  return (await readToken(store.storage)) !== null
}

/**
 * Pull, merge, push — in that order, always.
 *
 * Pushing first would write a log that has not seen everyone else's work, and
 * while the merge would still converge eventually, the repository would carry a
 * commit that looks like one device overwriting another.
 */
export async function runSync(store: Store): Promise<SyncState> {
  const built = await buildProvider(store)
  if ('reason' in built) return { kind: 'unconfigured', reason: built.reason }

  try {
    const result = await synchronise(built.provider, store.device, store.getLog())
    await store.absorb(result.log)
    return { kind: 'idle', at: Date.now() }
  } catch (error) {
    return { kind: 'failed', message: describe(error) }
  }
}

/**
 * Errors people can act on.
 *
 * A raw status code tells someone nothing about what to change; naming the
 * likely cause and the fix is the whole job of this function. The token is
 * never part of any message.
 */
function describe(error: unknown): string {
  if (error instanceof ConflictError) {
    return 'The repository changed faster than we could write to it. Try again in a moment.'
  }
  if (error instanceof ProviderError) return error.message
  if (error instanceof TypeError) {
    return 'The request could not leave the page. Check the forge API address, and that repository mode is on.'
  }
  return error instanceof Error ? error.message : 'Sync failed for an unknown reason.'
}

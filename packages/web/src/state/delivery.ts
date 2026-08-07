import {
  type ItemDelivery,
  type RemotePullRequest,
  deliveryOf,
  hasIssues,
  linkPullRequests,
  linksByItem,
} from '@kanbo/core'

import { buildProvider } from './sync.ts'
import type { Store } from './store.ts'

/**
 * What the forge says about work in flight.
 *
 * Deliberately not in the operation log. A pull request's state belongs to the
 * forge, changes without anyone here touching the board, and would otherwise
 * fill the history with events nobody performed. It is cached as bytes beside
 * the vault instead, so a board still shows what it last knew while offline —
 * and says how old that is rather than implying it is live.
 */
const CACHE_KEY = 'delivery'
const STALE_AFTER = 15 * 60 * 1000

export type DeliveryCache = {
  readonly fetchedAt: number
  readonly pulls: readonly RemotePullRequest[]
}

export async function readDeliveryCache(store: Store): Promise<DeliveryCache | null> {
  const bytes = await store.storage.get(CACHE_KEY)
  if (!bytes) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const record = parsed as DeliveryCache
    return Array.isArray(record?.pulls) ? record : null
  } catch {
    return null
  }
}

/** Fetch, unless what we already have is fresh enough to be worth keeping. */
export async function refreshDelivery(
  store: Store,
  { force = false } = {},
): Promise<DeliveryCache | null> {
  const cached = await readDeliveryCache(store)
  if (!force && cached && Date.now() - cached.fetchedAt < STALE_AFTER) return cached

  const built = await buildProvider(store)
  if ('reason' in built || !hasIssues(built.provider)) return cached

  try {
    const pulls = await built.provider.listPullRequests()
    const fresh: DeliveryCache = { fetchedAt: Date.now(), pulls }
    await store.storage.set(CACHE_KEY, new TextEncoder().encode(JSON.stringify(fresh)))
    return fresh
  } catch {
    // A forge that is down must not blank out what the board already knew.
    return cached
  }
}

export function deliveriesFor(
  store: Store,
  cache: DeliveryCache | null,
): ReadonlyMap<string, ItemDelivery> {
  if (!cache) return new Map()
  const grouped = linksByItem(linkPullRequests(store.getProject(), cache.pulls))
  const out = new Map<string, ItemDelivery>()
  for (const [itemId, links] of grouped) {
    const delivery = deliveryOf(links)
    if (delivery) out.set(itemId, delivery)
  }
  return out
}

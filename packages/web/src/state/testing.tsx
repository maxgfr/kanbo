/**
 * A store that runs in a test, wired to the same `Store` the app uses.
 *
 * Fake ports rather than a fake store: the component tests are worth having
 * only if what they exercise is the real reducer folding real operations, and
 * a stubbed dispatch would let a component pass while emitting nonsense.
 *
 * Deterministic ids and a frozen clock, for the reason `ports/index.ts` gives —
 * operations are ordered by counter and identified by id, so a test that let
 * either wander would be a test of the machine it ran on.
 */
import type { OperationBody, Ports, Storage } from '@kanbo/core'
import type { ReactNode } from 'react'

import { Store } from './store.ts'
import { StoreContext } from './useStore.ts'

export function fakePorts(): Ports {
  const held = new Map<string, Uint8Array>()
  let next = 0

  const storage: Storage = {
    async get(key) {
      return held.get(key) ?? null
    },
    async set(key, value) {
      held.set(key, value)
    },
    async delete(key) {
      held.delete(key)
    },
    async keys(prefix = '') {
      return [...held.keys()].filter((key) => key.startsWith(prefix))
    },
    async clear() {
      held.clear()
    },
  }

  return {
    clock: { now: () => 1_700_000_000_000 },
    random: { id: () => `id-${++next}` },
    storage,
  }
}

/** A store seeded with `bodies`, ready to render against. */
export async function storeWith(...bodies: readonly OperationBody[]): Promise<Store> {
  const store = new Store(fakePorts(), 'test-device')
  if (bodies.length > 0) await store.dispatch(...bodies)
  return store
}

export function Harness({ store, children }: { store: Store; children: ReactNode }) {
  return <StoreContext value={store}>{children}</StoreContext>
}

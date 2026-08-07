import type { Operation, OperationBody, Project } from '@kanbo/core'
import { createContext, use, useSyncExternalStore } from 'react'

import type { Store } from './store.ts'

export const StoreContext = createContext<Store | null>(null)

function useStoreInstance(): Store {
  const store = use(StoreContext)
  if (!store) throw new Error('Kanbo: a component used the store outside its provider.')
  return store
}

/** The current project, re-rendering only when the log actually changes. */
export function useProject(): Project {
  const store = useStoreInstance()
  return useSyncExternalStore(store.subscribe, store.getProject, store.getProject)
}

export function useLog(): readonly Operation[] {
  const store = useStoreInstance()
  return useSyncExternalStore(store.subscribe, store.getLog, store.getLog)
}

/** The last write that did not land, so the shell can say so rather than pretend. */
export function usePersistFailure(): Error | null {
  const store = useStoreInstance()
  return useSyncExternalStore(store.subscribe, store.getFailure, store.getFailure)
}

/**
 * Emit operations. Every mutation in the interface goes through this — there
 * is no other way to change what is on screen, which is what keeps the display
 * and the log from ever disagreeing.
 */
export function useDispatch(): (...bodies: readonly OperationBody[]) => Promise<void> {
  // Returned as it is rather than re-bound: `Store.dispatch` is an arrow
  // property and so already carries its instance. A fresh `.bind` per render
  // would be a new identity every time, which defeats memoisation and turns
  // any effect that depends on it into a loop.
  return useStoreInstance().dispatch
}

export function usePorts() {
  return useStoreInstance()
}

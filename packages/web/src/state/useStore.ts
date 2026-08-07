import type { Operation, OperationBody, Project } from '@kanbo/core'
import { createContext, use, useSyncExternalStore } from 'react'

import type { Store } from './store'

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

/**
 * Emit operations. Every mutation in the interface goes through this — there
 * is no other way to change what is on screen, which is what keeps the display
 * and the log from ever disagreeing.
 */
export function useDispatch(): (...bodies: readonly OperationBody[]) => Promise<void> {
  const store = useStoreInstance()
  return store.dispatch.bind(store)
}

export function usePorts() {
  return useStoreInstance()
}

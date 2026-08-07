// The policy boot runs on import and must stay the first one: it narrows the
// connected document's CSP, and a policy inserted late is a policy ignored.
import './boot/policy'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { createStore } from './state/store.ts'
import { StoreContext } from './state/useStore.ts'
import { App } from './ui/App.tsx'
import { applyTheme } from './ui/theme.ts'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Kanbo: #root is missing from the document.')

// Before the first paint, so the board never flashes the wrong ground.
applyTheme()

const store = createStore()
const reactRoot = createRoot(root)

store
  .load()
  .then(() => {
    reactRoot.render(
      <StrictMode>
        <StoreContext value={store}>
          <App />
        </StoreContext>
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    // A vault we cannot read must never be silently replaced by an empty one:
    // the next write would destroy it. Say so, and stop.
    reactRoot.render(
      <main className="kb-empty" style={{ height: '100dvh' }}>
        <h1 className="kb-empty__title">Kanbo could not open your data</h1>
        <p className="kb-empty__body">
          {error instanceof Error ? error.message : 'The stored project could not be read.'} Nothing
          has been changed or overwritten.
        </p>
      </main>,
    )
  })

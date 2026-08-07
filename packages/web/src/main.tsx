// The policy boot runs on import and must stay the first one: it narrows the
// connected document's CSP, and a policy inserted late is a policy ignored.
import './boot/policy.ts'

import { ShareError, parseFragment } from '@kanbo/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { createStore } from './state/store.ts'
import { StoreContext } from './state/useStore.ts'
import { App } from './ui/App.tsx'
import { ReaderView } from './ui/share/ReaderView.tsx'
import { applyTheme } from './ui/theme.ts'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Kanbo: #root is missing from the document.')

// Before the first paint, so the board never flashes the wrong ground.
applyTheme()

const reactRoot = createRoot(root)

function fatal(title: string, detail: string): void {
  reactRoot.render(
    <main className="kb-empty" style={{ height: '100dvh' }}>
      <h1 className="kb-empty__title">{title}</h1>
      <p className="kb-empty__body">{detail}</p>
    </main>,
  )
}

/**
 * A share opens before anything else, and without the vault.
 *
 * Deciding this here rather than inside the app is the whole point: someone
 * following a share link must not have their own project opened, read, or
 * touched at all. The reader gets a standalone copy and no route back into the
 * rest of the application.
 */
let share = null
try {
  share = parseFragment(window.location.hash)
} catch (error) {
  fatal(
    'This share could not be opened',
    error instanceof ShareError ? error.message : 'The link is damaged.',
  )
}

if (share) {
  reactRoot.render(
    <StrictMode>
      <ReaderView link={share} />
    </StrictMode>,
  )
} else if (window.location.hash === '' || !window.location.hash.startsWith('#s=')) {
  const store = createStore()
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
      fatal(
        'Kanbo could not open your data',
        `${error instanceof Error ? error.message : 'The stored project could not be read.'} Nothing has been changed or overwritten.`,
      )
    })
}

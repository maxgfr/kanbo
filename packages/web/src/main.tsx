// The policy boot runs on import and must stay the first one: it narrows the
// connected document's CSP, and a policy inserted late is a policy ignored.
import './boot/policy'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './ui/App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Kanbo: #root is missing from the document.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

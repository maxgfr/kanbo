/**
 * The first code the application runs, and the reason it must stay first.
 *
 * `connect.html` is served with the broad `connect-src https:` because no list
 * baked into the build could name a self-hosted forge. Narrowing it to the one
 * origin the user configured is this module's job, and a policy inserted after
 * the document has loaded is ignored — so this has to happen during boot, in
 * the first module, not in a component effect.
 *
 * It also reconciles document with intent: if the stored mode does not match
 * the document that was loaded, we navigate to the one that does. Someone who
 * turned sync off and then followed an old `connect.html` bookmark gets the
 * closed document back.
 */
import { CONNECTED_DOCUMENT, STRICT_DOCUMENT, connectTighteningFor } from '@kanbo/core/policy'

import { readSyncSettings } from './syncSettings.ts'

/** Which document is actually loaded, judged from the URL alone. */
export function documentMode(pathname: string): 'local' | 'connected' {
  return pathname.endsWith(`/${CONNECTED_DOCUMENT}`) || pathname === CONNECTED_DOCUMENT
    ? 'connected'
    : 'local'
}

function tighten(policy: string): void {
  const meta = document.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', policy)
  // Prepending matters: a policy must be in place before anything further down
  // the head has had a chance to run.
  document.head.prepend(meta)
}

function boot(): void {
  const settings = readSyncSettings()
  const loaded = documentMode(window.location.pathname)

  if (loaded === 'connected') {
    // Runs whether or not the mode still says connected — a stale document
    // must be narrowed before we even consider navigating away from it.
    tighten(connectTighteningFor(settings.remoteUrl))
  }

  if (settings.mode === loaded) return

  const target = settings.mode === 'connected' ? CONNECTED_DOCUMENT : STRICT_DOCUMENT
  const base = window.location.pathname.replace(/[^/]*$/, '')
  window.location.replace(
    `${base}${target === STRICT_DOCUMENT ? '' : target}${window.location.hash}`,
  )
}

boot()

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
import {
  CONNECTED_DOCUMENT,
  STRICT_DOCUMENT,
  type SyncMode,
  connectTighteningFor,
  documentFor,
} from '@kanbo/core/policy'

import { readSyncSettings } from './syncSettings.ts'

/** Which document is actually loaded, judged from the URL alone. */
export function documentMode(pathname: string): 'local' | 'connected' {
  return pathname.endsWith(`/${CONNECTED_DOCUMENT}`) || pathname === CONNECTED_DOCUMENT
    ? 'connected'
    : 'local'
}

/**
 * Where a given mode lives, from where we are now.
 *
 * Shared with the settings panel so that switching mode navigates straight to
 * the right document instead of reloading this one and being redirected a
 * moment later. The hash is carried across because a share link must survive
 * the trip; the search string is deliberately not, since nothing in Kanbo puts
 * meaning there.
 */
export function documentUrlFor(mode: SyncMode, at: Location = window.location): string {
  const target = documentFor(mode)
  const base = at.pathname.replace(/[^/]*$/, '')
  return `${base}${target === STRICT_DOCUMENT ? '' : target}${at.hash}`
}

function tighten(policy: string): void {
  const meta = document.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', policy)
  // Prepending matters: a policy must be in place before anything further down
  // the head has had a chance to run.
  document.head.prepend(meta)
}

function boot(): boolean {
  const settings = readSyncSettings()
  const loaded = documentMode(window.location.pathname)

  if (loaded === 'connected') {
    // Runs whether or not the mode still says connected — a stale document
    // must be narrowed before we even consider navigating away from it.
    tighten(connectTighteningFor(settings.remoteUrl))
  }

  if (settings.mode === loaded) return false

  window.location.replace(documentUrlFor(settings.mode))
  return true
}

/**
 * True when this document is already on its way out.
 *
 * `location.replace` does not halt the module it was called from, so without
 * this the rest of the application would boot on a page the browser is about to
 * discard — opening the vault, folding the log and rendering a board nobody
 * will see. Read by `main.tsx`, which stops there.
 */
export const navigatingAway: boolean = boot()

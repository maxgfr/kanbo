/**
 * What the page is allowed to reach, and how that is decided.
 *
 * Kanbo runs in one of two modes. In local mode the page cannot make a request
 * at all: `connect-src 'none'`, enforced by the browser, not by our code. In
 * repository mode the page must reach exactly one host — the git forge holding
 * the project — and nothing else.
 *
 * A Content-Security-Policy delivered in a `<meta>` element applies at parse
 * time and **cannot be loosened afterwards**; a meta inserted once the document
 * has loaded is ignored outright. So a boolean in the settings cannot open the
 * network on a document that was served closed. Two mechanisms carry the whole
 * design instead:
 *
 * 1. **The build emits two documents from one bundle.** They differ in exactly
 *    one directive — `connect-src` — and are byte-identical everywhere else.
 *    The setting picks which document the browser loads; the URL then states
 *    honestly which mode is running.
 *
 * 2. **A policy can be tightened at runtime, never loosened.** Policies
 *    accumulate, and a request must be permitted by every one of them. So
 *    `connect.html` ships the broad `connect-src https:`, and the first module
 *    the browser runs inserts a second policy naming the one origin the user
 *    configured. The intersection is that origin alone.
 *
 * The second mechanism is what makes "GitHub *or something else*" possible. A
 * self-hosted Gitea lives on an arbitrary domain, so no list baked into the
 * build could ever name it — but a policy computed at boot from the user's own
 * configuration can.
 *
 * Boot-time tightening leaves a window: between parse and the first module,
 * `connect.html` is broad. The window is closed by defence in depth rather than
 * by CSP alone — a single audited transport module is the only code permitted
 * to touch the network, it refuses any origin but the configured one, and a CI
 * guard fails the build if a network API appears anywhere else.
 *
 * This module is the single source of truth for the directive strings. The Vite
 * plugin composes the documents from them, the boot module tightens from them,
 * and the CI guard checks the built HTML against them. A directive that lives
 * in only one of those three places is a directive that will drift.
 */

export type SyncMode = 'local' | 'connected'

export const STRICT_DOCUMENT = 'index.html'
export const CONNECTED_DOCUMENT = 'connect.html'

/**
 * The one directive allowed to differ between the two documents. Everything
 * else is shared, and the CI guard treats any other difference as a defect.
 */
export const STRICT_CONNECT = "connect-src 'none'"
export const CONNECTED_CONNECT = 'connect-src https:'

/**
 * `script-src` carries `'wasm-unsafe-eval'` because Argon2id is compiled from
 * WebAssembly; it permits compiling a module, not `eval()`.
 *
 * `style-src` carries `'unsafe-inline'` because drag-and-drop writes transforms
 * to `style` on every animation frame. That is a real concession, and it is the
 * reason `script-src` is kept free of any equivalent escape hatch.
 */
export const SHARED_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
]

/** The policy baked into a document at build time. */
export function policyFor(mode: SyncMode): string {
  const connect = mode === 'connected' ? CONNECTED_CONNECT : STRICT_CONNECT
  return [...SHARED_DIRECTIVES, connect].join('; ')
}

/** Which document a given mode must be served from. */
export function documentFor(mode: SyncMode): string {
  return mode === 'connected' ? CONNECTED_DOCUMENT : STRICT_DOCUMENT
}

/**
 * The second policy, inserted at boot on the connected document.
 *
 * With no remote configured this returns `connect-src 'none'`: enabling sync
 * without naming a host must not leave the document at `https:`. Every failure
 * path below lands on the same closed answer.
 */
export function connectTighteningFor(remoteUrl: string | null | undefined): string {
  const origin = remoteUrl ? originOf(remoteUrl) : null
  return origin ? `connect-src ${origin}` : STRICT_CONNECT
}

/**
 * The origin of a URL, or null if it is not one we will ever talk to.
 *
 * HTTPS only, and no credentials embedded in the URL. A self-hosted forge on
 * plain HTTP is refused rather than downgraded silently — `connect-src https:`
 * in the document would block it a moment later anyway, and failing here gives
 * the user an error they can act on instead of a request that vanishes.
 */
export function originOf(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return url.origin
}

/**
 * Runtime check for the transport module: is this request going to the host the
 * user configured? Enforced independently of CSP so that a failure to tighten
 * still cannot become a leak.
 */
export function isAllowedRequest(remoteUrl: string | null | undefined, target: string): boolean {
  const allowed = remoteUrl ? originOf(remoteUrl) : null
  if (!allowed) return false
  return originOf(target) === allowed
}

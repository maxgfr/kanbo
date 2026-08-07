/**
 * The only module in Kanbo permitted to touch the network.
 *
 * Everything else — the domain, the views, the connectors' logic — is pure and
 * reaches the outside world through here. That is not a style preference: the
 * CI guard fails the build if `fetch`, `XMLHttpRequest`, `WebSocket`,
 * `EventSource` or `sendBeacon` appears in any other file, which is what keeps
 * "the page talks to one host" checkable rather than merely intended.
 *
 * The origin check below duplicates what the tightened CSP already enforces,
 * deliberately. CSP narrowing happens during boot, so there is a window before
 * it lands; and a policy that fails to insert for any reason must not become a
 * leak. Two independent mechanisms, either one sufficient.
 */
import { isAllowedRequest, originOf } from '@kanbo/core/policy'

export class BlockedRequestError extends Error {
  constructor(target: string) {
    super(`Kanbo refused a request to ${originOf(target) ?? 'an unparseable URL'}.`)
    this.name = 'BlockedRequestError'
  }
}

export type TransportInit = {
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly signal?: AbortSignal
}

/**
 * Perform a request, but only to the configured forge.
 *
 * `remoteUrl` is passed in rather than read from settings so that this stays a
 * pure function of its inputs and the caller cannot be confused about which
 * remote it is talking to.
 */
export async function request(
  remoteUrl: string | null,
  target: string,
  init: TransportInit = {},
): Promise<Response> {
  if (!isAllowedRequest(remoteUrl, target)) throw new BlockedRequestError(target)

  const options: RequestInit = {
    method: init.method ?? 'GET',
    // Nothing about a forge API depends on ambient credentials, and sending
    // them would attach the user's session to every call.
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    mode: 'cors',
  }
  if (init.headers) options.headers = { ...init.headers }
  if (init.body !== undefined) options.body = init.body
  if (init.signal) options.signal = init.signal

  return fetch(target, options)
}

export type ProbeResult = { readonly reachable: boolean; readonly detail: string }

/**
 * Ask the browser what it will actually permit, and report it.
 *
 * A diagnostic rather than a feature: the settings screen claims the page
 * cannot reach the network in local mode, and this is how a user checks that
 * claim instead of taking our word for it. A blocked request is the success
 * case here.
 */
export async function probe(target: string): Promise<ProbeResult> {
  try {
    await fetch(target, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
    return { reachable: true, detail: 'The request left the page.' }
  } catch (error) {
    return {
      reachable: false,
      detail: error instanceof Error ? error.message : 'The request was blocked.',
    }
  }
}

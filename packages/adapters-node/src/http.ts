import type { Http } from '@kanbo/core'

/**
 * The Http port over Node's fetch, restricted to one origin.
 *
 * The browser has a CSP behind it as well; here the check is all there is, so
 * it is not optional. A CLI that could be pointed anywhere would be a very
 * convenient way to exfiltrate a token.
 */
export function nodeHttp(allowedOrigin: string): Http {
  return {
    async request(url, init) {
      if (new URL(url).origin !== new URL(allowedOrigin).origin) {
        throw new Error(`Refused a request to ${new URL(url).origin}.`)
      }
      const response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body === undefined ? {} : { body: init.body }),
      })
      return { status: response.status, body: await response.text() }
    },
  }
}

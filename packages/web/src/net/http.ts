import type { Http } from '@kanbo/core'

import { request } from './transport.ts'

/**
 * The Http port, over the one module allowed to touch the network.
 *
 * The domain asks for `Http`; this hands it a function that cannot reach any
 * origin but the configured one. Nothing here bypasses the transport module —
 * doing so would fail the CI guard, which is the point.
 */
export function browserHttp(remoteUrl: string | null): Http {
  return {
    async request(url, init) {
      const response = await request(remoteUrl, url, {
        method: init.method,
        headers: init.headers,
        ...(init.body === undefined ? {} : { body: init.body }),
      })
      return { status: response.status, body: await response.text() }
    },
  }
}

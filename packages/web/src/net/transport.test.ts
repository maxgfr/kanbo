/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockedRequestError, request } from './transport.ts'

/**
 * The one module allowed to touch the network, checked at the boundary it is
 * there to hold.
 *
 * The origin check here duplicates what the tightened CSP already enforces, and
 * that duplication is the point: the policy is narrowed during boot, so there
 * is a window before it lands, and a policy that failed to insert for any
 * reason must not become a leak. Two independent mechanisms, either one
 * sufficient — which is only true if this one is actually tested.
 */
const FORGE = 'https://api.github.com'

afterEach(() => vi.unstubAllGlobals())

function watchFetch() {
  const spy = vi.fn(async (_target: string, _init?: RequestInit) => new Response('{}'))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('request', () => {
  it('reaches the configured host', async () => {
    const fetched = watchFetch()
    await request(FORGE, `${FORGE}/repos/acme/board`)
    expect(fetched).toHaveBeenCalledOnce()
  })

  it('refuses a different host outright, without asking the network', async () => {
    const fetched = watchFetch()
    await expect(request(FORGE, 'https://example.com/')).rejects.toBeInstanceOf(BlockedRequestError)
    expect(fetched).not.toHaveBeenCalled()
  })

  it('refuses a lookalike subdomain', async () => {
    // `api.github.com.evil.test` ends with nothing meaningful in common; origin
    // comparison is exact, and this is the mistake a `endsWith` check makes.
    await expect(request(FORGE, 'https://api.github.com.evil.test/')).rejects.toBeInstanceOf(
      BlockedRequestError,
    )
  })

  it('refuses the same host on a different port', async () => {
    await expect(request(FORGE, 'https://api.github.com:8443/')).rejects.toBeInstanceOf(
      BlockedRequestError,
    )
  })

  it('refuses an http downgrade of the configured host', async () => {
    await expect(request(FORGE, 'http://api.github.com/')).rejects.toBeInstanceOf(
      BlockedRequestError,
    )
  })

  it('refuses everything when no remote is configured', async () => {
    await expect(request(null, `${FORGE}/`)).rejects.toBeInstanceOf(BlockedRequestError)
  })

  it('keeps the refused origin out of nothing but the message', async () => {
    await expect(request(FORGE, 'https://example.com/x')).rejects.toThrow(/https:\/\/example\.com/)
  })

  it('sends no ambient credentials and no referrer', async () => {
    // A forge API needs neither, and sending them would attach the user's own
    // session to every call Kanbo makes.
    const fetched = watchFetch()
    await request(FORGE, `${FORGE}/repos`)
    expect(fetched.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })
  })
})

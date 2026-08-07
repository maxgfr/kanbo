import { describe, expect, it } from 'vitest'

import {
  CONNECTED_CONNECT,
  CONNECTED_DOCUMENT,
  SHARED_DIRECTIVES,
  STRICT_CONNECT,
  STRICT_DOCUMENT,
  connectTighteningFor,
  documentFor,
  isAllowedRequest,
  originOf,
  policyFor,
} from './policy.ts'

describe('policyFor', () => {
  it('closes the network completely in local mode', () => {
    expect(policyFor('local')).toContain("connect-src 'none'")
  })

  it('names no host in the connected document', () => {
    // A host baked into the build could never cover a self-hosted forge, and
    // would be a promise the tightening step is what actually keeps.
    expect(policyFor('connected')).toContain('connect-src https:')
    expect(policyFor('connected')).not.toMatch(/connect-src[^;]*\/\//)
  })

  it('differs between the two documents in connect-src and nothing else', () => {
    const strict = policyFor('local').split('; ')
    const connected = policyFor('connected').split('; ')

    const onlyInStrict = strict.filter((d) => !connected.includes(d))
    const onlyInConnected = connected.filter((d) => !strict.includes(d))

    expect(onlyInStrict).toEqual([STRICT_CONNECT])
    expect(onlyInConnected).toEqual([CONNECTED_CONNECT])
  })

  it('carries every shared directive in both documents', () => {
    for (const directive of SHARED_DIRECTIVES) {
      expect(policyFor('local')).toContain(directive)
      expect(policyFor('connected')).toContain(directive)
    }
  })

  it('never allows eval, plugins, framing or form submission', () => {
    for (const mode of ['local', 'connected'] as const) {
      const policy = policyFor(mode)
      expect(policy).not.toContain("'unsafe-eval'")
      expect(policy).toContain("object-src 'none'")
      expect(policy).toContain("frame-ancestors 'none'")
      expect(policy).toContain("form-action 'none'")
    }
  })

  it('allows compiling wasm without allowing eval', () => {
    // Argon2id is a wasm module; 'wasm-unsafe-eval' permits compiling it and
    // nothing more.
    expect(policyFor('local')).toContain("script-src 'self' 'wasm-unsafe-eval'")
  })
})

describe('documentFor', () => {
  it('serves local mode from the strict document', () => {
    expect(documentFor('local')).toBe(STRICT_DOCUMENT)
  })

  it('serves connected mode from the connected document', () => {
    expect(documentFor('connected')).toBe(CONNECTED_DOCUMENT)
  })
})

describe('connectTighteningFor', () => {
  it('narrows to the exact configured origin', () => {
    expect(connectTighteningFor('https://api.github.com')).toBe(
      'connect-src https://api.github.com',
    )
  })

  it('discards path, query and fragment', () => {
    expect(connectTighteningFor('https://api.github.com/repos/a/b?x=1#y')).toBe(
      'connect-src https://api.github.com',
    )
  })

  it('supports an arbitrary self-hosted forge', () => {
    // The whole reason the document ships `https:` rather than a fixed list.
    expect(connectTighteningFor('https://git.acme.internal:8443/api/v1')).toBe(
      'connect-src https://git.acme.internal:8443',
    )
  })

  it('closes the network when sync is on but no remote is set', () => {
    expect(connectTighteningFor(null)).toBe(STRICT_CONNECT)
    expect(connectTighteningFor(undefined)).toBe(STRICT_CONNECT)
    expect(connectTighteningFor('')).toBe(STRICT_CONNECT)
  })

  it.each([
    ['plain http', 'http://api.github.com'],
    ['not a url', 'api.github.com'],
    ['nonsense', '::::'],
    ['a scheme we never speak', 'ftp://files.example.com'],
    ['javascript', 'javascript:alert(1)'],
    ['credentials embedded in the url', 'https://user:pw@api.github.com'],
  ])('closes the network on %s', (_label, input) => {
    expect(connectTighteningFor(input)).toBe(STRICT_CONNECT)
  })
})

describe('originOf', () => {
  it('keeps the port, which distinguishes two forges on one host', () => {
    expect(originOf('https://git.example.com:8443/x')).toBe('https://git.example.com:8443')
  })

  it('refuses anything that is not https', () => {
    expect(originOf('http://example.com')).toBeNull()
  })
})

describe('isAllowedRequest', () => {
  const remote = 'https://api.github.com'

  it('allows the configured origin', () => {
    expect(isAllowedRequest(remote, 'https://api.github.com/repos/maxgfr/kanbo')).toBe(true)
  })

  it('refuses a different host', () => {
    expect(isAllowedRequest(remote, 'https://evil.example.com/steal')).toBe(false)
  })

  it('refuses a lookalike subdomain', () => {
    expect(isAllowedRequest(remote, 'https://api.github.com.evil.example.com/steal')).toBe(false)
  })

  it('refuses a different port on the configured host', () => {
    expect(isAllowedRequest('https://git.example.com', 'https://git.example.com:8443/x')).toBe(
      false,
    )
  })

  it('refuses everything when no remote is configured', () => {
    expect(isAllowedRequest(null, 'https://api.github.com/repos')).toBe(false)
  })

  it('refuses a downgrade to http on the configured host', () => {
    expect(isAllowedRequest(remote, 'http://api.github.com/repos')).toBe(false)
  })
})

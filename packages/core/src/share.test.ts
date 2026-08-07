import { describe, expect, it } from 'vitest'

import { reduceOperations } from './ops/reduce.ts'
import { anItem, op, statusOperations } from './ops/testing.ts'
import {
  MAX_LINK_PAYLOAD,
  type ShareEnvelope,
  ShareError,
  base64UrlToBytes,
  buildFragment,
  bytesToBase64Url,
  decodeEnvelope,
  encodeEnvelope,
  fitsInLink,
  parseFragment,
  parsePayload,
  shareFileName,
  sharePayload,
} from './share.ts'

const project = reduceOperations([
  ...statusOperations(),
  op('a', 10, { kind: 'item.create', item: anItem('1', { title: 'Visible' }) }),
  op('a', 11, { kind: 'item.create', item: anItem('2', { title: 'Hidden', archived: true }) }),
])

const envelope: ShareEnvelope = { v: 1, kdf: 'none', iv: 'AAAA', data: 'BBBB' }

describe('base64url', () => {
  it('round-trips arbitrary bytes, including the ones base64 escapes', () => {
    // 0xFB 0xFF produce '+' and '/' in standard base64; both are unsafe in a
    // fragment, and conflating the two encodings would corrupt exactly these.
    const bytes = new Uint8Array([0, 1, 62, 63, 250, 251, 252, 253, 254, 255])
    expect([...base64UrlToBytes(bytesToBase64Url(bytes))]).toEqual([...bytes])
  })

  it('never emits a character that needs escaping in a URL', () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, at) => at))
    expect(bytesToBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]*$/)
  })

  it('round-trips an empty payload', () => {
    expect(bytesToBase64Url(new Uint8Array())).toBe('')
    expect([...base64UrlToBytes('')]).toEqual([])
  })

  it('round-trips every length, so no byte is lost to padding', () => {
    for (let length = 1; length <= 24; length++) {
      const bytes = new Uint8Array(Array.from({ length }, (_, at) => (at * 37) % 256))
      expect([...base64UrlToBytes(bytesToBase64Url(bytes))], `length ${length}`).toEqual([...bytes])
    }
  })
})

describe('sharePayload', () => {
  it('shares the board and leaves archived work out of it', () => {
    const payload = sharePayload(project, 'have a look', 5000)
    expect(payload.project.items.map((item) => item.title)).toEqual(['Visible'])
    expect(payload.note).toBe('have a look')
  })

  it('carries no operation log, so a share is not a history', () => {
    const payload = sharePayload(project, '', 5000)
    expect(JSON.stringify(payload)).not.toContain('lamport')
  })
})

describe('parsePayload', () => {
  it('reads what sharePayload wrote', () => {
    const payload = sharePayload(project, 'note', 5000)
    expect(parsePayload(JSON.stringify(payload)).project.items).toHaveLength(1)
  })

  it('refuses something that decrypted to the wrong shape', () => {
    expect(() => parsePayload('not json')).toThrow(ShareError)
    expect(() => parsePayload('{"hello":"world"}')).toThrow(ShareError)
  })

  it('refuses a payload from a newer Kanbo rather than reading part of it', () => {
    const future = JSON.stringify({ v: 99, project: {}, sharedAt: 0, note: '' })
    expect(() => parsePayload(future)).toThrow(/newer version/)
  })
})

describe('fragments', () => {
  it('round-trips an inline share', () => {
    const link = parseFragment(buildFragment({ kind: 'inline', key: 'KEY', envelope }))
    expect(link).toEqual({ kind: 'inline', key: 'KEY', envelope })
  })

  it('round-trips a file share, where only the key is in the link', () => {
    expect(parseFragment(buildFragment({ kind: 'file', key: 'KEY' }))).toEqual({
      kind: 'file',
      key: 'KEY',
    })
  })

  it('round-trips a passphrase share with its ciphertext', () => {
    const link = parseFragment(buildFragment({ kind: 'passphrase', envelope }))
    expect(link).toEqual({ kind: 'passphrase', envelope })
  })

  it('round-trips a passphrase share whose ciphertext is a file', () => {
    expect(parseFragment(buildFragment({ kind: 'passphrase', envelope: null }))).toEqual({
      kind: 'passphrase',
      envelope: null,
    })
  })

  it('ignores a fragment that is not a share', () => {
    expect(parseFragment('')).toBeNull()
    expect(parseFragment('#')).toBeNull()
    expect(parseFragment('#/board')).toBeNull()
    expect(parseFragment('#s=')).toBeNull()
  })

  it('reports a truncated link rather than failing obscurely', () => {
    // The failure people actually hit: a chat client cut the URL short.
    const whole = buildFragment({ kind: 'inline', key: 'KEY', envelope })
    expect(() => parseFragment(whole.slice(0, whole.length - 12))).toThrow(/damaged|truncated/i)
  })

  it('splits on a character base64url can never produce', () => {
    // If the separator could occur inside a payload, every share containing it
    // would be cut in half.
    expect(encodeEnvelope(envelope)).not.toContain('.')
  })
})

describe('decodeEnvelope', () => {
  it('refuses an envelope missing what decryption needs', () => {
    const partial = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1 })))
    expect(() => decodeEnvelope(partial)).toThrow(ShareError)
  })
})

describe('fitsInLink', () => {
  it('accepts a small board', () => {
    expect(fitsInLink(envelope)).toBe(true)
  })

  it('refuses a payload that a chat client would truncate', () => {
    const huge: ShareEnvelope = { ...envelope, data: 'A'.repeat(MAX_LINK_PAYLOAD + 1) }
    expect(fitsInLink(huge)).toBe(false)
  })
})

describe('shareFileName', () => {
  it('is derived from the project so two shares do not collide in Downloads', () => {
    expect(shareFileName({ ...project, key: 'APL' })).toBe('apl.kanbo-share')
  })

  it('falls back when a project has no key', () => {
    expect(shareFileName({ ...project, key: '', name: '' })).toBe('board.kanbo-share')
  })
})

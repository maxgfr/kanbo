import { describe, expect, it } from 'vitest'

import { decodeBase64, encodeBase64 } from './base64.ts'

/** What the platform would produce, for the cases the platform can handle. */
const reference = (text: string) => Buffer.from(text, 'utf8').toString('base64')

describe('encodeBase64', () => {
  it('agrees with the platform on plain ASCII', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'hello world', '{"format":1}']) {
      expect(encodeBase64(text)).toBe(reference(text))
    }
  })

  it('pads to a multiple of four, at every remainder', () => {
    // One, two and three trailing bytes each pad differently, and getting the
    // padding wrong produces output a decoder accepts and truncates.
    expect(encodeBase64('a')).toBe('YQ==')
    expect(encodeBase64('ab')).toBe('YWI=')
    expect(encodeBase64('abc')).toBe('YWJj')
  })

  it('handles text above U+00FF, which is where btoa gives up', () => {
    // The reason this module exists rather than calling the platform: `btoa`
    // throws on anything a person might actually write in an issue.
    for (const text of ['héllo', 'ça va', '日本語', 'Ω≈ç√', 'naïve café']) {
      expect(encodeBase64(text)).toBe(reference(text))
    }
  })

  it('handles astral characters, which take four bytes', () => {
    for (const text of ['🚀', 'ship it 🚀🔥', '𝄞']) {
      expect(encodeBase64(text)).toBe(reference(text))
    }
  })
})

describe('decodeBase64', () => {
  it('round-trips everything it encodes', () => {
    for (const text of [
      '',
      'a',
      'ab',
      'abc',
      '{"format":1,"devices":["a","b"]}',
      'héllo',
      '日本語',
      'ship it 🚀',
      'line one\nline two\n',
    ]) {
      expect(decodeBase64(encodeBase64(text))).toBe(text)
    }
  })

  it('reads a payload the forge wrapped in line breaks', () => {
    // The Contents API returns base64 with newlines in it. It is legal, and a
    // decoder that treats a newline as data produces mojibake from a file whose
    // only crime was being longer than sixty characters.
    const wrapped = reference('{"format":1}').replace(/(.{4})/g, '$1\n')
    expect(decodeBase64(wrapped)).toBe('{"format":1}')
  })

  it('reads a payload wrapped with carriage returns as well', () => {
    const wrapped = reference('a longer manifest than sixty characters would ever be')
      .replace(/(.{60})/g, '$1\r\n')
      .concat('\r\n')
    expect(decodeBase64(wrapped)).toBe('a longer manifest than sixty characters would ever be')
  })

  it('decodes what the platform encoded', () => {
    expect(decodeBase64(reference('interoperability matters'))).toBe('interoperability matters')
  })

  it('is empty for empty input', () => {
    expect(decodeBase64('')).toBe('')
    expect(decodeBase64('\n\n')).toBe('')
  })

  it('survives a long payload without drifting', () => {
    // A real ops file is thousands of lines; an off-by-one in the bit buffer
    // shows up only past a certain length.
    const text = Array.from({ length: 2000 }, (_, at) => `{"lamport":${at}}`).join('\n')
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })
})

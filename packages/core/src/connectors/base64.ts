/**
 * Base64 for UTF-8 text, written out rather than taken from the platform.
 *
 * `btoa` exists only in browsers and mangles anything above U+00FF; `Buffer`
 * exists only in Node. The domain runs in both and depends on neither, so it
 * carries its own — sixty lines against a permanent fork in the code.
 *
 * The forge Contents API returns base64 with line breaks in it, which is legal
 * and which naive decoders trip over.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const INDEX = new Map<string, number>()
for (const [at, character] of [...ALPHABET].entries()) INDEX.set(character, at)

function toUtf8(text: string): number[] {
  const bytes: number[] = []
  for (const character of text) {
    let code = character.codePointAt(0)!
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
      code = 0
    }
  }
  return bytes
}

function fromUtf8(bytes: readonly number[]): string {
  let out = ''
  let at = 0
  while (at < bytes.length) {
    const byte = bytes[at]!
    let code: number
    if (byte < 0x80) {
      code = byte
      at += 1
    } else if (byte < 0xe0) {
      code = ((byte & 0x1f) << 6) | (bytes[at + 1]! & 0x3f)
      at += 2
    } else if (byte < 0xf0) {
      code = ((byte & 0x0f) << 12) | ((bytes[at + 1]! & 0x3f) << 6) | (bytes[at + 2]! & 0x3f)
      at += 3
    } else {
      code =
        ((byte & 0x07) << 18) |
        ((bytes[at + 1]! & 0x3f) << 12) |
        ((bytes[at + 2]! & 0x3f) << 6) |
        (bytes[at + 3]! & 0x3f)
      at += 4
    }
    out += String.fromCodePoint(code)
  }
  return out
}

export function encodeBase64(text: string): string {
  const bytes = toUtf8(text)
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at]!
    const b = bytes[at + 1]
    const c = bytes[at + 2]
    out += ALPHABET[a >> 2]
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : ALPHABET[c & 63]
  }
  return out
}

export function decodeBase64(encoded: string): string {
  // Whitespace is legal in the forge's output and is not part of the data.
  const clean = encoded.replaceAll(/[\s=]/g, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0

  for (const character of clean) {
    const value = INDEX.get(character)
    if (value === undefined) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  return fromUtf8(bytes)
}

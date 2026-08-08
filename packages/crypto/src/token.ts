import type { Crypto as CryptoPort, Storage } from '@kanbo/core'

/**
 * The access token at rest, framed the same way everywhere.
 *
 * What differs between a browser and a terminal is where the key lives, and
 * that difference is exactly what the `Crypto` port exists to absorb. What does
 * *not* differ is the framing around it: a length byte, a nonce, then the body.
 * Writing that twice would be two chances to disagree about the layout, and a
 * token written by one runtime would stop opening in the other.
 *
 * So the framing is here, parameterised by whichever `Crypto` the caller has,
 * and each adapter supplies its own key.
 */
const TOKEN_KEY = 'forge.token'

/** Store the access token encrypted, under whatever key this runtime holds. */
export async function storeToken(
  storage: Storage,
  crypto: CryptoPort,
  token: string,
): Promise<void> {
  if (token === '') {
    await storage.delete(TOKEN_KEY)
    return
  }
  const { iv, data } = await crypto.encrypt(new TextEncoder().encode(token))

  const envelope = new Uint8Array(1 + iv.length + data.length)
  envelope[0] = iv.length
  envelope.set(iv, 1)
  envelope.set(data, 1 + iv.length)
  await storage.set(TOKEN_KEY, envelope)
}

export async function readToken(storage: Storage, crypto: CryptoPort): Promise<string | null> {
  const envelope = await storage.get(TOKEN_KEY)
  if (!envelope || envelope.length < 2) return null

  try {
    const ivLength = envelope[0]!
    const iv = envelope.slice(1, 1 + ivLength)
    const data = envelope.slice(1 + ivLength)
    return new TextDecoder().decode(await crypto.decrypt({ iv, data }))
  } catch {
    // A token we cannot decrypt is a token we do not have. Reporting null
    // sends the user to re-enter it rather than failing every sync opaquely.
    return null
  }
}

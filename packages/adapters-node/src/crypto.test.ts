import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fileStorage } from './index.ts'
import { nodeCrypto, readToken, storeToken } from './crypto.ts'

/**
 * The token vault on a filesystem.
 *
 * The interesting assertion is the mode: the browser's key cannot be exported
 * at all, and this one can be read by anything with the file, so `0600` is the
 * whole of the protection and deserves to be checked rather than assumed.
 */
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kanbo-crypto-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the node token vault', () => {
  it('gives back the token it was given', async () => {
    const storage = fileStorage(root)

    await storeToken(storage, root, 'ghp_notarealtoken')
    expect(await readToken(storage, root)).toBe('ghp_notarealtoken')
  })

  it('writes the key readable by nobody else', async () => {
    const storage = fileStorage(root)
    await storeToken(storage, root, 'ghp_notarealtoken')

    const { mode } = await stat(join(root, 'crypto.key'))
    expect(mode & 0o777).toBe(0o600)
  })

  it('never stores the token in the clear', async () => {
    const storage = fileStorage(root)
    await storeToken(storage, root, 'ghp_notarealtoken')

    const stored = await storage.get('forge.token')
    expect(new TextDecoder().decode(stored!)).not.toContain('ghp_notarealtoken')
  })

  it('reports no token rather than failing when the key no longer opens it', async () => {
    const storage = fileStorage(root)
    await storeToken(storage, root, 'ghp_notarealtoken')

    // The key file is the only thing standing between the store and the token.
    // Losing it must send someone to re-enter the token, not break every sync.
    await rm(join(root, 'crypto.key'))
    expect(await readToken(storage, root)).toBeNull()
  })

  it('has no token to report before one is stored', async () => {
    expect(await readToken(fileStorage(root), root)).toBeNull()
  })

  it('forgets the token when it is set to nothing', async () => {
    const storage = fileStorage(root)
    await storeToken(storage, root, 'ghp_notarealtoken')
    await storeToken(storage, root, '')

    expect(await readToken(storage, root)).toBeNull()
  })

  it('encrypts and decrypts arbitrary bytes through the port', async () => {
    const port = nodeCrypto(root)
    const plaintext = new TextEncoder().encode('a board is not a secret, a token is')

    const sealed = await port.encrypt(plaintext)
    expect(await port.decrypt(sealed)).toEqual(plaintext)
  })
})

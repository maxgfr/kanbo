import { EMPTY_PROJECT, type Project, ShareError } from '@kanbo/core'

import { decryptShare, encryptShare } from './share.ts'

/**
 * The share crypto, run with no browser anywhere near it.
 *
 * These tests are the claim this package exists to make. They use
 * `crypto.subtle`, `CompressionStream` and `Blob` under Node's default vitest
 * environment — no jsdom, no `@vitest-environment` docblock. If any of those
 * were really browser-only, this file would not run at all, and the CLI could
 * never have offered `kanbo share`.
 */
const project: Project = {
  ...EMPTY_PROJECT,
  name: 'Apollo',
  key: 'APL',
}

describe('a share', () => {
  it('comes back out the way it went in, carrying its key', async () => {
    const { envelope, key } = await encryptShare(project, 'for the team', null)

    expect(envelope.kdf).toBe('none')
    expect(key).not.toBeNull()

    const payload = await decryptShare(envelope, { key: key! })
    expect(payload.project.name).toBe('Apollo')
    expect(payload.note).toBe('for the team')
  })

  it('carries no key of its own when a passphrase holds it', async () => {
    const { envelope, key } = await encryptShare(project, '', 'correct horse battery')

    expect(envelope.kdf).toBe('argon2id')
    expect(envelope.salt).toBeTruthy()
    // Nothing to put in the link: the passphrase travels by another route.
    expect(key).toBeNull()

    const payload = await decryptShare(envelope, { passphrase: 'correct horse battery' })
    expect(payload.project.key).toBe('APL')
  })

  it('refuses a wrong passphrase without saying which half was wrong', async () => {
    const { envelope } = await encryptShare(project, '', 'correct horse battery')

    await expect(decryptShare(envelope, { passphrase: 'incorrect horse' })).rejects.toThrow(
      ShareError,
    )
  })

  it('refuses a link edited in transit rather than half-reading it', async () => {
    const { envelope, key } = await encryptShare(project, '', null)
    const damaged = { ...envelope, data: envelope.data.slice(0, -4) }

    await expect(decryptShare(damaged, { key: key! })).rejects.toThrow(ShareError)
  })

  it('never reuses a nonce', async () => {
    const first = await encryptShare(project, '', null)
    const second = await encryptShare(project, '', null)

    expect(first.envelope.iv).not.toBe(second.envelope.iv)
  })
})

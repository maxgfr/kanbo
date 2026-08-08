import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@kanbo/core/policy': resolve(import.meta.dirname, 'packages/core/src/policy.ts'),
      '@kanbo/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      // The subpaths come first: an alias is a prefix match, so a bare
      // '@kanbo/crypto' entry would rewrite '@kanbo/crypto/token' into a path
      // underneath index.ts.
      '@kanbo/crypto/share': resolve(import.meta.dirname, 'packages/crypto/src/share.ts'),
      '@kanbo/crypto/token': resolve(import.meta.dirname, 'packages/crypto/src/token.ts'),
      '@kanbo/crypto': resolve(import.meta.dirname, 'packages/crypto/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
  },
})

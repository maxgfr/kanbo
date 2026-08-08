import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@kanbo/core/policy': resolve(import.meta.dirname, 'packages/core/src/policy.ts'),
      '@kanbo/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      '@kanbo/crypto': resolve(import.meta.dirname, 'packages/crypto/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
  },
})

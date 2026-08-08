/**
 * The two commands, as files somebody can run without this repository.
 *
 * Everything in `packages/` is raw TypeScript that Node executes by stripping
 * the types, which is what makes `pnpm check:cli` drive the real source rather
 * than a build of it. That trick stops at the edge of the workspace: **Node
 * refuses to strip types from anything under `node_modules`**, and `npx`
 * installs into `node_modules`. A published `bin` pointing at a `.ts` file
 * therefore throws on every single invocation. So the published thing is
 * bundled, and the bundling is not a preference.
 *
 * The settings below each carry a reason rather than a habit:
 *
 * **ESM.** esbuild refuses top-level await in `cjs` and `iife`, and both
 * entry points are top-level code that awaits before it does anything.
 *
 * **Two invocations, no code splitting.** Splitting a shared chunk out of two
 * top-level-await entry points is exactly where evaluation-order bugs live, and
 * it buys nothing: each command is self-contained, readable and checkable on
 * its own, at a cost of some duplicated domain code measured in kilobytes.
 *
 * **`mainFields` before `main`.** `platform: 'node'` makes esbuild prefer the
 * CommonJS build of a dependency, which for hash-wasm is the bundle carrying
 * every algorithm's base64 wasm and for the MCP SDK is `__commonJS` wrappers
 * around zod. Both quietly multiply the tarball. Asking for ESM first is what
 * lets tree-shaking work at all.
 *
 * **No minification.** The checks downstream are assertions about strings in
 * the artifact, gzip erases most of the size difference in a tarball anyway,
 * and a project whose entire argument is "verify rather than believe" should
 * not distribute something nobody can read.
 *
 * **A sourcemap with `sourcesContent`.** The tarball therefore carries a byte
 * copy of every `.ts` that went into it. `check:dist` asserts one of those
 * copies still matches the file on disk, which turns "what we shipped is the
 * source" into a checked statement rather than a promise.
 *
 * Run with `node scripts/build-dist.ts`.
 */
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analyzeMetafile, build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SHEBANG = '#!/usr/bin/env node'

const BINS = [
  { name: 'kanbo.js', entry: 'packages/cli/src/main.ts' },
  { name: 'kanbo-mcp.js', entry: 'packages/mcp/src/main.ts' },
] as const

/**
 * Where each bin has to land.
 *
 * `npx <name>` resolves a *package* called `<name>`, never a bin inside another
 * one — so `npx -y kanbo-mcp` can only work if a package by that name exists.
 * Rather than depend on `kanbo` and make every cold start fetch two tarballs,
 * the second package carries a byte-identical copy of the same bundle, and
 * `check:dist` asserts it is byte-identical.
 */
const PACKAGES = ['packages/npm', 'packages/npm-mcp'] as const
const CARRIES: Record<(typeof PACKAGES)[number], readonly string[]> = {
  'packages/npm': ['kanbo.js', 'kanbo-mcp.js'],
  'packages/npm-mcp': ['kanbo-mcp.js'],
}

const staging = join(ROOT, 'packages/npm/dist')
const meta = join(ROOT, 'packages/npm/meta')

await rm(staging, { recursive: true, force: true })
await rm(join(ROOT, 'packages/npm-mcp/dist'), { recursive: true, force: true })
await mkdir(staging, { recursive: true })
await mkdir(meta, { recursive: true })

const sizes: Record<string, number> = {}

for (const bin of BINS) {
  const result = await build({
    entryPoints: [join(ROOT, bin.entry)],
    outfile: join(staging, bin.name),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    mainFields: ['module', 'main'],
    sourcemap: true,
    sourcesContent: true,
    metafile: true,
    minify: false,
    logLevel: 'warning',
  })

  await writeFile(join(meta, `${bin.name}.json`), JSON.stringify(result.metafile, null, 2), 'utf8')

  const emitted = join(staging, bin.name)
  const code = await readFile(emitted, 'utf8')

  // esbuild preserves the entry point's own hashbang. Depended on rather than
  // added, because adding one with `banner` when the source already has it
  // emits two — and the second is a syntax error nobody sees until `npx`.
  if (!code.startsWith(SHEBANG)) {
    throw new Error(`${bin.name} lost its shebang. The published bin would not be executable.`)
  }
  await chmod(emitted, 0o755)
  sizes[bin.name] = Buffer.byteLength(code)

  console.log(await analyzeMetafile(result.metafile, { verbose: false }))
}

// The second package gets the same bytes, not a second build.
for (const target of PACKAGES) {
  if (target === 'packages/npm') continue
  const into = join(ROOT, target, 'dist')
  await mkdir(into, { recursive: true })

  for (const name of CARRIES[target]) {
    await writeFile(join(into, name), await readFile(join(staging, name)))
    await writeFile(join(into, `${name}.map`), await readFile(join(staging, `${name}.map`)))
    await chmod(join(into, name), 0o755)
  }
}

for (const [name, bytes] of Object.entries(sizes)) {
  console.log(`  ${name.padEnd(16)} ${(bytes / 1024).toFixed(0)} KiB`)
}
console.log('\n✓ Built two dependency-free bins.')

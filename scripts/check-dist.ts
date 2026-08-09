/**
 * The published thing, checked as the thing people will actually run.
 *
 * Everything else in this repository tests the source. `npx kanbo` runs a
 * bundle, installed by npm, out of a tarball, on a machine with no pnpm and no
 * TypeScript — and the interesting failures live in the gap between those two
 * sentences: a `files` field that forgot `dist`, a bin that lost its shebang,
 * an `--packages=external` that turns every install into a resolution error.
 *
 * None of the behavioural assertions are written twice. `scripts/check-cli.ts`
 * takes `KANBO_CLI`, so its fifteen checks run here a second time against the
 * bundle and a third against the tarball. If a published artifact behaves
 * differently from the source, one of those runs says so in the same words.
 *
 * Run with `node scripts/check-dist.ts` (after `pnpm build:dist`).
 */
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NPM = join(ROOT, 'packages/npm')

const failures: string[] = []
const checks: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) checks.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

/**
 * What may be inlined into a published bin.
 *
 * Every byte in here is code somebody runs from `npx`, so adding one is a
 * supply-chain decision. Making that decision a line in this table means it
 * arrives as a diff somebody reviewed rather than as a transitive surprise.
 */
const BUNDLED_DEPENDENCIES: Record<string, readonly string[]> = {
  // hash-wasm is Argon2id, for share passphrases. It is in this bin and must
  // not be in the other: `@kanbo/adapters-node` deliberately does not
  // re-export share encryption, because the MCP server reaches that barrel for
  // its token vault and would otherwise carry 600 KiB of wasm it never runs.
  'kanbo.js': ['fractional-indexing', 'hash-wasm'],
  // All of these arrive with the MCP SDK, which validates tool arguments with
  // zod and publishes JSON Schema through ajv.
  'kanbo-mcp.js': [
    '@modelcontextprotocol/sdk',
    'ajv',
    'ajv-formats',
    'fast-deep-equal',
    'fast-uri',
    'fractional-indexing',
    'json-schema-traverse',
    'zod',
    'zod-to-json-schema',
  ],
}

/**
 * Ceilings, set from the first real build at roughly 1.5×.
 *
 * Not a style rule: the failure they catch is `mainFields` quietly reverting to
 * the CommonJS build of a dependency, which pulls in every algorithm hash-wasm
 * ships and every parser zod has, and which nothing else would notice.
 */
const SIZE_LIMIT: Record<string, number> = {
  'kanbo.js': 340 * 1024,
  'kanbo-mcp.js': 1300 * 1024,
}

const SHEBANG = '#!/usr/bin/env node'

// ---- 1. shape

for (const bin of ['kanbo.js', 'kanbo-mcp.js'] as const) {
  {
    const path = join(NPM, 'dist', bin)
    try {
      const info = await stat(path)
      const code = await readFile(path, 'utf8')

      check(`${bin} starts with a shebang`, code.startsWith(SHEBANG), code.slice(0, 40))
      // A missing executable bit passes on Windows, where npm writes .cmd
      // shims that call node explicitly, and fails everywhere else.
      check(`${bin} is executable`, (info.mode & 0o111) !== 0, info.mode.toString(8))
      check(
        `${bin} is within its size ceiling`,
        info.size <= SIZE_LIMIT[bin]!,
        `${(info.size / 1024).toFixed(0)} KiB of ${(SIZE_LIMIT[bin]! / 1024).toFixed(0)} KiB`,
      )
    } catch (error) {
      failures.push(`${path} — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// ---- 2. dependency-free, proven from the metafile rather than by reading code

type Metafile = {
  outputs: Record<
    string,
    {
      imports?: { path: string; external?: boolean }[]
      inputs?: Record<string, { bytesInOutput: number }>
    }
  >
  inputs: Record<string, unknown>
}

for (const bin of Object.keys(BUNDLED_DEPENDENCIES)) {
  const meta = JSON.parse(await readFile(join(NPM, 'meta', `${bin}.json`), 'utf8')) as Metafile

  const external = Object.values(meta.outputs)
    .flatMap((output) => output.imports ?? [])
    .filter((entry) => entry.external)
    .map((entry) => entry.path)

  // The failure this catches is `--packages=external`, which would emit a
  // runtime `import '@kanbo/core'` resolving to a .ts file under node_modules
  // — the one thing Node refuses to strip types from.
  check(
    `${bin} imports nothing but node: builtins at runtime`,
    external.every((path) => path.startsWith('node:')),
    external.filter((path) => !path.startsWith('node:')).join(', '),
  )

  /**
   * What actually ships, not what esbuild looked at.
   *
   * A module can be in the graph and contribute nothing — which is exactly what
   * tree-shaking is for, and reading `meta.inputs` would report Argon2id as
   * bundled into a server that shakes every byte of it away.
   */
  const packages = new Set<string>()
  for (const output of Object.values(meta.outputs)) {
    for (const [input, contribution] of Object.entries(output.inputs ?? {})) {
      if (contribution.bytesInOutput === 0) continue
      const at = input.lastIndexOf('node_modules/')
      if (at === -1) continue
      const rest = input.slice(at + 'node_modules/'.length).split('/')
      packages.add(rest[0]!.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]!)
    }
  }

  const expected = [...BUNDLED_DEPENDENCIES[bin]!].toSorted()
  const actual = [...packages].toSorted()
  check(
    `${bin} inlines exactly the packages it declares`,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${expected.join(', ')} — found ${actual.join(', ')}`,
  )
}

// ---- 3. the bundle carries its own source

const map = JSON.parse(await readFile(join(NPM, 'dist/kanbo.js.map'), 'utf8')) as {
  sources: string[]
  sourcesContent: string[]
}
const mainAt = map.sources.findIndex((source) => source.endsWith('cli/src/main.ts'))
const shipped = mainAt === -1 ? null : map.sourcesContent[mainAt]
const onDisk = await readFile(join(ROOT, 'packages/cli/src/main.ts'), 'utf8')

check(
  'the tarball carries the TypeScript it was built from, byte for byte',
  shipped === onDisk,
  mainAt === -1 ? 'main.ts is not in the sourcemap' : 'the shipped copy has drifted',
)

// ---- 4. every name npx might be given resolves to a bin

const manifest = JSON.parse(await readFile(join(NPM, 'package.json'), 'utf8')) as {
  name: string
  bin: Record<string, string>
}

/**
 * `npx <name>` looks for a bin called `<name>`, and with several bins it
 * refuses to guess. One package with two commands therefore needs a third bin
 * entry spelled like the package, or `npx kanbo-board` fails with "could not
 * determine executable to run" — which reads like a broken package rather than
 * like a missing flag.
 */
for (const wanted of ['kanbo', 'kanbo-mcp', manifest.name]) {
  check(
    `\`npx ${wanted}\` has a bin to resolve to`,
    wanted in manifest.bin,
    Object.keys(manifest.bin).join(', '),
  )
}

// ---- 5. cold start

const timing = await mkdtemp(join(tmpdir(), 'kanbo-dist-'))
const startedAt = Date.now()
await run(process.execPath, [join(NPM, 'dist/kanbo.js'), 'status'], {
  env: { ...process.env, KANBO_HOME: timing },
})
const coldStart = Date.now() - startedAt
await rm(timing, { recursive: true, force: true })

check(`a cold start is under a second (${coldStart}ms)`, coldStart < 1000, `${coldStart}ms`)

// ---- 6. the same behaviour, against the bundle

async function driveCheckCli(entry: string, label: string): Promise<void> {
  const finished = await new Promise<number | null>((settle) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/check-cli.ts')], {
      env: { ...process.env, KANBO_CLI: entry },
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    child.once('close', settle)
  })
  check(`every CLI assertion passes against ${label}`, finished === 0, `exit ${finished}`)
}

await driveCheckCli(join(NPM, 'dist/kanbo.js'), 'the bundle')

// ---- 7. and against a tarball, installed with npm, outside this repository

const staging = await mkdtemp(join(tmpdir(), 'kanbo-pack-'))
const installed = await mkdtemp(join(tmpdir(), 'kanbo-install-'))

try {
  const published: readonly {
    readonly pkg: string
    readonly name: string
    readonly wanted: readonly string[]
  }[] = [
    {
      pkg: NPM,
      name: manifest.name,
      wanted: ['package.json', 'dist/kanbo.js', 'dist/kanbo-mcp.js', 'LICENSE', 'README.md'],
    },
  ]

  for (const { pkg, name, wanted } of published) {
    const { stdout } = await run('npm', ['pack', '--dry-run', '--json'], { cwd: pkg })
    const [described] = JSON.parse(stdout) as { files: { path: string }[] }[]
    const shippedFiles = (described?.files ?? []).map((entry) => entry.path)

    // Sourcemaps ride along; everything else is named. The assertion that
    // matters is that `dist` is in there at all — `.gitignore` lists `dist/`,
    // and that is a famous way to publish an empty package.
    check(
      `the ${name} tarball contains what it should and nothing else`,
      wanted.every((file) => shippedFiles.includes(file)) &&
        shippedFiles.every(
          (file) => wanted.includes(file) || file.endsWith('.map') || file === 'README.md',
        ),
      shippedFiles.join(', '),
    )

    await run('npm', ['pack', '--pack-destination', staging], { cwd: pkg })
  }

  // npm, not pnpm: npm is what `npx` uses, so this is the real code path.
  // --ignore-scripts both hardens the check and proves nothing needs to run.
  await writeFile(
    join(installed, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, version: '0.0.0' }),
  )
  const { stdout: packed } = await run('ls', [staging])
  const tarballs = packed
    .trim()
    .split('\n')
    .map((file) => join(staging, file))

  await run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--prefer-offline', ...tarballs],
    { cwd: installed },
  )

  await driveCheckCli(join(installed, 'node_modules/.bin/kanbo'), 'the installed tarball')

  const { stdout: version } = await run(join(installed, 'node_modules/.bin/kanbo'), ['status'], {
    env: { ...process.env, KANBO_HOME: installed },
  })
  check('the installed bin runs with no pnpm and no TypeScript', version.includes('store'), version)

  // One package, three commands. The MCP config people copy says
  // `--package=kanbo-board kanbo-mcp`, and that only works if the install put
  // every one of these on the path.
  for (const wanted of ['kanbo', 'kanbo-mcp', manifest.name]) {
    const path = join(installed, 'node_modules/.bin', wanted)
    check(`${wanted} is on the path after an install`, (await stat(path)).isFile())
  }
  const mcpBin = join(installed, 'node_modules/.bin/kanbo-mcp')

  const handshake = await new Promise<{ code: number | null; out: string }>((settle) => {
    const child = spawn(mcpBin, ['--home', installed], { stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.once('close', (code) => settle({ code, out }))
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'check-dist', version: '0' },
        },
      })}\n`,
    )
    setTimeout(() => child.stdin.end(), 1500)
  })

  check(
    'the installed MCP server answers a handshake',
    handshake.out.includes('"kanbo"'),
    handshake.out.slice(0, 200),
  )
  check(
    'and writes nothing to stdout that is not a message',
    handshake.out
      .split('\n')
      .filter((line) => line.trim() !== '')
      .every((line) => {
        try {
          return (JSON.parse(line) as { jsonrpc?: string }).jsonrpc === '2.0'
        } catch {
          return false
        }
      }),
    handshake.out.slice(0, 200),
  )
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
} finally {
  await rm(staging, { recursive: true, force: true })
  await rm(installed, { recursive: true, force: true })
}

for (const passed of checks) console.log(`  ✓ ${passed}`)

if (failures.length > 0) {
  console.error(`\n✗ Dist: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  • ${failure}`)
  process.exit(1)
}

console.log(`\n✓ Dist: ${checks.length} checks passed against a packed and installed tarball.`)

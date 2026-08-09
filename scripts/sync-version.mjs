/**
 * One version, written in five places, and a way to prove it.
 *
 * The published manifest is the source of truth. But a version leaks: the MCP
 * server introduces itself with one, and three documents pin the package in a
 * config people copy. Left alone, those drift — and the failure is quiet in the
 * worst way, because a server that reports 0.2.0 while running 0.4.1 sends
 * whoever is debugging it to read the wrong source.
 *
 * semantic-release calls this with the version it just decided:
 *
 *     node scripts/sync-version.mjs 0.3.0
 *
 * With `--check` it writes nothing and fails if anything has drifted, which is
 * what `pnpm verify` runs. So the same file both performs the sync and is the
 * gate on it, and there is no second description of where a version lives.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'packages/npm/package.json')

const argument = process.argv[2]
const checking = argument === '--check'

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
const version = checking ? manifest.version : argument

if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/sync-version.mjs <version> | --check')
  process.exit(1)
}

/** A minor pin: patches flow, a breaking change does not arrive unannounced. */
const pin = version.split('.').slice(0, 2).join('.')

/**
 * Every place the version appears, and how to rewrite it.
 *
 * Each entry is a regex with one capture group around the part that changes,
 * so a file that stops matching is a file that moved on without telling us —
 * which `--check` reports rather than silently skipping.
 */
const SITES = [
  {
    file: 'packages/npm/package.json',
    find: /("version":\s*")([^"]+)(")/,
    to: version,
  },
  {
    file: 'packages/mcp/src/version.ts',
    find: /(export const VERSION = ')([^']+)(')/,
    to: version,
  },
  // The closing quote is captured rather than merely implied, for two reasons.
  // The replacement below is `$1…$3`, so a two-group regex leaves a literal
  // `$3` in the file — which is precisely what 0.3.0 published, three times
  // over. And an unanchored match would then still find `0.3` inside the
  // wreckage `0.3$3` and call it up to date, so the damage was invisible to
  // `--check` as well. Anchored, a corrupted line matches nothing and is
  // reported as such.
  { file: 'README.md', find: /(kanbo-board@)(\d+\.\d+)(")/, to: pin },
  { file: 'skills/kanbo/SKILL.md', find: /(kanbo-board@)(\d+\.\d+)(")/, to: pin },
  { file: 'packages/npm/README.md', find: /(kanbo-board@)(\d+\.\d+)(")/, to: pin },
]

const drifted = []

for (const site of SITES) {
  const path = join(ROOT, site.file)
  const before = await readFile(path, 'utf8')
  const match = before.match(site.find)

  if (!match) {
    drifted.push(`${site.file} — nothing matched ${site.find}; the version moved or vanished`)
    continue
  }

  if (match[2] === site.to) continue

  if (checking) {
    drifted.push(`${site.file} says ${match[2]}, the manifest says ${site.to}`)
    continue
  }

  await writeFile(path, before.replace(site.find, `$1${site.to}$3`), 'utf8')
  console.log(`  ${site.file.padEnd(32)} ${match[2]} → ${site.to}`)
}

if (drifted.length > 0) {
  console.error(`\n✗ Version: ${drifted.length} place(s) out of step\n`)
  for (const line of drifted) console.error(`  • ${line}`)
  console.error('\nRun `node scripts/sync-version.mjs <version>` to bring them into line.')
  process.exit(1)
}

console.log(
  checking
    ? `✓ Version: ${version} in all ${SITES.length} places that carry it.`
    : `\n✓ Version: synced to ${version}.`,
)

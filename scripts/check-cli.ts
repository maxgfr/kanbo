/**
 * The architecture claim, checked rather than asserted.
 *
 * README says the domain runs without a browser and that a CLI drives it with
 * no duplicated logic. That is easy to say and easy to break — one
 * `indexedDB`, one `window`, one extensionless import, and it stops being
 * true while every other test stays green.
 *
 * So this runs the real binary in a scratch directory and reads what it
 * prints. It is deliberately end-to-end: nothing here is mocked, and the same
 * reducer, merge and query language the board uses do the work.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'packages/cli/src/main.ts')

const failures: string[] = []
const checks: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) checks.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const home = await mkdtemp(join(tmpdir(), 'kanbo-cli-'))
const second = await mkdtemp(join(tmpdir(), 'kanbo-cli-'))

async function kanbo(where: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('node', [CLI, ...args], {
    env: { ...process.env, KANBO_HOME: where },
  })
  return stdout
}

try {
  await kanbo(home, 'init', 'Apollo', 'APL')
  const added = await kanbo(home, 'add', 'Ship the departure board')
  check('the CLI creates a project and an item without a browser', added.includes('APL-1'), added)

  await kanbo(home, 'add', 'Fix the login crash')
  await kanbo(home, 'move', 'APL-2', 'In Progress')

  const board = await kanbo(home, 'board')
  check(
    'the same reducer produces the same board in a terminal',
    board.includes('In Progress  (1)') && board.includes('Backlog  (1)'),
    board,
  )

  const open = await kanbo(home, 'search', 'is:open')
  check('the query language works unchanged outside the browser', open.includes('APL-1'), open)

  const bugs = await kanbo(home, 'search', 'type:bug')
  check('a query that should match nothing matches nothing', bugs.includes('Nothing matched.'))

  // The export is the log, so replaying it elsewhere must rebuild the project.
  const exported = await kanbo(home, 'export')
  const file = join(second, 'export.json')
  await writeFile(file, exported)
  await run('sh', ['-c', `KANBO_HOME=${second} node ${CLI} import < ${file}`])

  const rebuilt = await kanbo(second, 'board')
  check(
    'an export replays into a different store and rebuilds the board',
    rebuilt.includes('Ship the departure board') && rebuilt.includes('In Progress  (1)'),
    rebuilt,
  )

  // Importing the same file twice must be a no-op: the merge is a union.
  const before = await kanbo(second, 'status')
  await run('sh', ['-c', `KANBO_HOME=${second} node ${CLI} import < ${file}`])
  const after = await kanbo(second, 'status')
  check('importing twice changes nothing', before === after)

  const csv = await kanbo(home, 'export', '--csv')
  check('the CSV export resolves names rather than ids', csv.includes('In Progress'), csv)

  // The point of the whole exercise: the domain must never have reached for a
  // browser global, or none of the above could have run at all.
  const core = await readFile(join(ROOT, 'packages/core/src/index.ts'), 'utf8')
  check('core exports without importing an adapter', !core.includes('adapters'))
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
} finally {
  await rm(home, { recursive: true, force: true })
  await rm(second, { recursive: true, force: true })
}

for (const passed of checks) console.log(`  ✓ ${passed}`)

if (failures.length > 0) {
  console.error(`\n✗ CLI: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  • ${failure}`)
  process.exit(1)
}

console.log(`\n✓ CLI: ${checks.length} checks passed with no browser involved.`)

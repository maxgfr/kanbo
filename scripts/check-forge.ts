/**
 * Repository mode, driven from a terminal, against a forge that is not there.
 *
 * Everything else that touches the forge stops short of a socket. The connector
 * tests hand `gitHubProvider` a fake `Http`; the smoke test intercepts
 * `api.github.com` with a Playwright route, which covers the browser and only
 * the browser. So the pieces the CLI alone assembles — `nodeHttp`, the token
 * vault at 0600, the https guard in `remoteSet`, and `synchronise` running with
 * the filesystem underneath it — were each tested and never tested together.
 *
 * That gap is not theoretical. It hid a bug in `operationsForSync` that gave
 * every issue imported in one pass the same reference, which no unit test saw
 * because none of them imported more than one issue at a time.
 *
 * So: a real HTTPS server on the loopback speaking the GitHub endpoints the
 * command actually reaches, and the command spawned against it exactly
 * as a person would run it. The certificate is self-signed and generated here,
 * which is the one concession — TLS verification is off for the spawned
 * command, and nothing else is. In particular the origin check is untouched,
 * and is asserted directly at the end.
 *
 * Run with `node scripts/check-forge.ts`.
 */
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { nodeHttp } from '../packages/adapters-node/src/http.ts'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = process.env['KANBO_CLI'] ?? join(ROOT, 'packages/cli/src/main.ts')

/**
 * A token that must never appear anywhere a person or a log can read it. The
 * value is asserted against every byte the command prints, so it is written
 * here rather than generated: a check that cannot say what it is looking for
 * cannot tell you what it found.
 */
const TOKEN = 'ghp_a_token_that_must_never_be_printed'

const failures: string[] = []
const checks: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) checks.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

// --------------------------------------------------------------- certificate

const workspace = await mkdtemp(join(tmpdir(), 'kanbo-forge-'))

try {
  await run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(workspace, 'key.pem'),
    '-out',
    join(workspace, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ])
} catch {
  console.error('✗ Forge: openssl is needed to generate the loopback certificate, and is missing.')
  process.exit(1)
}

// ------------------------------------------------------------------ the forge

/** Files in the repository, as the Contents API sees them. */
const files = new Map<string, { content: string; sha: string }>()
let revision = 0

type Issue = {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  labels: { name: string }[]
  assignees: { login: string }[]
  html_url: string
  updated_at: string
}

const issues: Issue[] = []
let pulls: unknown[] = []
const runsByBranch = new Map<string, { status: string; conclusion: string }[]>()

/** Every Authorization header the server saw, so the token can be accounted for. */
const seenAuth: string[] = []

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let text = ''
    request.on('data', (chunk) => (text += String(chunk)))
    request.on('end', () => done(text))
  })
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'https://127.0.0.1')
  const method = request.method ?? 'GET'
  seenAuth.push(request.headers.authorization ?? '')

  const repository = /^\/repos\/[^/]+\/[^/]+(\/.*)?$/.exec(url.pathname)
  if (!repository) return json(response, 404, {})
  const rest = repository[1] ?? ''

  // ---------------------------------------------------------------- contents
  if (rest.startsWith('/contents/')) {
    const path = decodeURIComponent(rest.slice('/contents/'.length))

    if (method === 'GET') {
      const file = files.get(path)
      if (file) {
        return json(response, 200, {
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          sha: file.sha,
        })
      }
      // A directory listing, which is how a device discovers the others.
      const under = [...files.keys()].filter((key) => key.startsWith(`${path}/`))
      if (under.length > 0) {
        return json(
          response,
          200,
          under.map((key) => ({ path: key, type: 'file' })),
        )
      }
      return json(response, 404, {})
    }

    if (method === 'PUT') {
      const sent = JSON.parse(await readBody(request)) as { content: string; sha?: string }
      const existing = files.get(path)
      // The documented answer to a concurrent write, which is the one the sync
      // engine is written to survive.
      if (existing && existing.sha !== sent.sha) return json(response, 409, {})
      const sha = `sha-${++revision}`
      files.set(path, { content: Buffer.from(sent.content, 'base64').toString('utf8'), sha })
      return json(response, 200, { content: { sha } })
    }

    return json(response, 405, {})
  }

  // ------------------------------------------------------------------ issues
  if (rest === '/issues' && method === 'GET') return json(response, 200, issues)

  const oneIssue = /^\/issues\/(\d+)$/.exec(rest)
  if (oneIssue && method === 'PATCH') {
    const sent = JSON.parse(await readBody(request)) as { state?: 'open' | 'closed' }
    const issue = issues.find((entry) => entry.number === Number(oneIssue[1]))
    if (!issue) return json(response, 404, {})
    if (sent.state) issue.state = sent.state
    return json(response, 200, issue)
  }

  // ------------------------------------------------------- pulls and checks
  if (rest === '/pulls' && method === 'GET') return json(response, 200, pulls)

  const checkRuns = /^\/commits\/(.+)\/check-runs$/.exec(rest)
  if (checkRuns && method === 'GET') {
    const branch = decodeURIComponent(checkRuns[1] ?? '')
    return json(response, 200, { check_runs: runsByBranch.get(branch) ?? [] })
  }

  return json(response, 404, {})
}

const server = createServer(
  {
    cert: await readFile(join(workspace, 'cert.pem')),
    key: await readFile(join(workspace, 'key.pem')),
  },
  (request, response) => {
    handle(request, response).catch(() => json(response, 500, {}))
  },
)

await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
const listening = server.address()
const port = typeof listening === 'object' && listening !== null ? listening.port : 0
const API = `https://127.0.0.1:${port}`

// -------------------------------------------------------------------- the CLI

type Run = { code: number; out: string; err: string }

/** Every byte the command ever printed, for the token audit at the end. */
const transcript: string[] = []

function kanbo(home: string, args: readonly string[], stdin?: string): Promise<Run> {
  const [command, argv] = /\.[cm]?ts$/.test(CLI) ? ['node', [CLI, ...args]] : [CLI, [...args]]

  return new Promise((done) => {
    const child = spawn(command, argv, {
      cwd: ROOT,
      env: {
        ...process.env,
        KANBO_HOME: home,
        // The certificate is self-signed. Nothing else about the transport is
        // relaxed — the origin refusal is asserted for real at the end.
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += String(chunk)))
    child.stderr.on('data', (chunk) => (err += String(chunk)))
    if (stdin !== undefined) child.stdin.write(stdin)
    child.stdin.end()
    child.on('close', (code) => {
      transcript.push(out, err)
      done({ code: code ?? 0, out, err })
    })
  })
}

/** Run a command that is expected to succeed, and record it if it does not. */
async function succeeds(home: string, args: readonly string[], stdin?: string): Promise<Run> {
  const result = await kanbo(home, args, stdin)
  if (result.code !== 0) {
    failures.push(
      `kanbo ${args.join(' ')} exited ${result.code} — ${result.err.trim() || result.out.trim()}`,
    )
  }
  return result
}

async function asJson<T>(home: string, args: readonly string[]): Promise<T> {
  const result = await succeeds(home, [...args, '--json'])
  try {
    return JSON.parse(result.out) as T
  } catch {
    failures.push(`kanbo ${args.join(' ')} --json printed no JSON — ${result.out.slice(0, 120)}`)
    return {} as T
  }
}

type Found = { item: { ref: string; title: string } }[]

// ------------------------------------------------------------------ the story

const alice = await mkdtemp(join(tmpdir(), 'kanbo-forge-alice-'))
const bob = await mkdtemp(join(tmpdir(), 'kanbo-forge-bob-'))

// A board, somebody with a forge handle, and one card.
await succeeds(alice, ['init', 'Shared', 'SHR'])
await succeeds(alice, ['person', 'add', 'Ada Lovelace', '--handle', '@ada'])
await succeeds(alice, ['add', 'Written by Alice'])

// The https guard refuses a typo before a token can be sent through it.
const overHttp = await kanbo(alice, [
  'remote',
  'set',
  '--forge',
  'github',
  '--repo',
  'acme/board',
  '--api',
  `http://127.0.0.1:${port}`,
])
check(
  'a plain-http forge API is refused before any request is made',
  overHttp.code !== 0 && /https/i.test(overHttp.err),
  overHttp.err.trim(),
)

const nonsense = await kanbo(alice, ['remote', 'set', '--repo', 'not a repository at all'])
check(
  'a repository that is not owner/name is a sentence, not a stack trace',
  nonsense.code !== 0 && /owner\/name/.test(nonsense.err) && !/\bat \w+ \(/.test(nonsense.err),
  nonsense.err.trim(),
)

await succeeds(alice, [
  'remote',
  'set',
  '--forge',
  'github',
  '--repo',
  'acme/board',
  '--branch',
  'main',
  '--api',
  API,
])

// Missing pieces are reported one at a time, in the order somebody supplies them.
const untokened = await kanbo(alice, ['sync'])
check(
  'sync without a token names the command that fixes it',
  untokened.code !== 0 && /token set/.test(untokened.err),
  untokened.err.trim(),
)

// The token arrives on stdin, never as an argument.
await succeeds(alice, ['token', 'set'], `${TOKEN}\n`)

const settings = await asJson<{ remote: { forge: string; repository: string }; token: boolean }>(
  alice,
  ['remote', 'show'],
)
check(
  'remote show reports the configuration and that a token is held',
  settings.remote?.forge === 'github' &&
    settings.remote?.repository === 'acme/board' &&
    settings.token,
  JSON.stringify(settings),
)

const pushed = await asJson<{ added: number; total: number }>(alice, ['sync'])
check('a first sync pushes the log', pushed.total > 0, JSON.stringify(pushed))
check(
  'the device wrote exactly one log file',
  [...files.keys()].filter((path) => path.endsWith('.ndjson')).length === 1,
  [...files.keys()].join(', '),
)
check(
  'every request carried the stored token',
  seenAuth.length > 0 && seenAuth.every((header) => header === `Bearer ${TOKEN}`),
  `${seenAuth.length} requests`,
)

// A machine with no board at all: its only way in is to sync.
await succeeds(bob, [
  'remote',
  'set',
  '--forge',
  'github',
  '--repo',
  'acme/board',
  '--branch',
  'main',
  '--api',
  API,
])
await succeeds(bob, ['token', 'set'], `${TOKEN}\n`)
await succeeds(bob, ['sync'])

const joined = await asJson<Found>(bob, ['search', '-is:archived'])
const store = await asJson<{ name: string; key: string }>(bob, ['status'])
check(
  'a machine with no board joins the repository and sees the work',
  joined.length === 1 && joined[0]?.item.title === 'Written by Alice',
  JSON.stringify(joined.map((row) => row.item.title)),
)
check(
  'and it is the same project, not a new one beside it',
  store.name === 'Shared' && store.key === 'SHR',
  `${store.name} ${store.key}`,
)

await succeeds(bob, ['add', 'Written by Bob'])
await succeeds(bob, ['sync'])
check(
  'each machine owns its own log file, so git never has to merge one',
  [...files.keys()].filter((path) => path.endsWith('.ndjson')).length === 2,
  [...files.keys()].join(', '),
)

await succeeds(alice, ['sync'])
const converged = await asJson<Found>(alice, ['search', '-is:archived'])
check(
  'the two machines converge on the same board',
  converged.length === 2,
  JSON.stringify(converged.map((row) => row.item.title)),
)

// ---------------------------------------------------------------- the issues

issues.push(
  {
    number: 1,
    title: 'Login throws on an empty password',
    body: 'Steps to reproduce…',
    state: 'open',
    labels: [{ name: 'bug' }],
    assignees: [{ login: 'ada' }],
    html_url: 'https://example.invalid/issues/1',
    updated_at: new Date('2026-08-01').toISOString(),
  },
  {
    number: 2,
    title: 'Document the export format',
    body: '',
    state: 'open',
    labels: [],
    assignees: [{ login: 'a-login-nobody-claims' }],
    html_url: 'https://example.invalid/issues/2',
    updated_at: new Date('2026-08-02').toISOString(),
  },
)

const beforePlan = await asJson<Found>(alice, ['search', '-is:archived'])
const planned = await asJson<{ plan: { toCreate: unknown[] } }>(alice, ['issues'])
const afterPlan = await asJson<Found>(alice, ['search', '-is:archived'])
check(
  'issues without --apply plans the imports and writes nothing',
  planned.plan?.toCreate?.length === 2 && afterPlan.length === beforePlan.length,
  `${planned.plan?.toCreate?.length} planned, ${beforePlan.length} → ${afterPlan.length} items`,
)

const applied = await asJson<{ imported: number }>(alice, ['issues', '--apply'])
check('issues --apply imports them', applied.imported === 2, JSON.stringify(applied))

const everything = await asJson<Found>(alice, ['search', '-is:archived'])
const refs = everything.map((row) => row.item.ref)
check(
  'each imported issue gets its own reference',
  new Set(refs).size === refs.length,
  refs.join(', '),
)

const bugs = await asJson<Found>(alice, ['search', 'type:bug'])
check(
  'a bug label becomes a bug, and only a bug label does',
  bugs.length === 1 && /Login throws/.test(bugs[0]?.item.title ?? ''),
  JSON.stringify(bugs.map((row) => row.item.title)),
)

const hers = await asJson<Found>(alice, ['search', 'assignee:"Ada Lovelace"'])
check(
  'an issue assigned to a claimed handle lands on that person',
  hers.length === 1 && /Login throws/.test(hers[0]?.item.title ?? ''),
  JSON.stringify(hers.map((row) => row.item.title)),
)

const team = await asJson<{ name: string }[]>(alice, ['people'])
check(
  'and a login nobody claims invents nobody',
  !JSON.stringify(team).includes('a-login-nobody-claims'),
  JSON.stringify(team.map((row) => row.name)),
)

// Closing a card here closes the issue there.
const bugRef = bugs[0]?.item.ref ?? ''
const columns = await asJson<{ name: string; category: string }[]>(alice, ['columns'])
const done = columns.find((column) => column.category === 'done')?.name ?? 'Done'
await succeeds(alice, ['move', bugRef, done])
const reconciled = await asJson<{ pushed: number }>(alice, ['issues', '--apply'])
check(
  'a card moved to a done column closes its issue on the forge',
  reconciled.pushed === 1 && issues.find((issue) => issue.number === 1)?.state === 'closed',
  `pushed ${reconciled.pushed}, issue #1 is ${issues.find((issue) => issue.number === 1)?.state}`,
)

// ----------------------------------------------------------- pull requests

pulls = [
  {
    number: 10,
    title: `${bugRef} fix the login crash`,
    body: '',
    state: 'closed',
    merged_at: '2026-08-05T00:00:00Z',
    draft: false,
    html_url: 'https://example.invalid/pull/10',
    head: { ref: `fix/${bugRef}-login` },
  },
  {
    number: 11,
    title: 'Docs pass',
    body: 'closes #2',
    state: 'open',
    merged_at: null,
    draft: false,
    html_url: 'https://example.invalid/pull/11',
    head: { ref: 'docs/export-format' },
  },
  {
    number: 12,
    title: 'Some unrelated refactor',
    body: 'No ticket, no mention.',
    state: 'open',
    merged_at: null,
    draft: true,
    html_url: 'https://example.invalid/pull/12',
    head: { ref: 'chore/refactor' },
  },
]
runsByBranch.set(`fix/${bugRef}-login`, [{ status: 'completed', conclusion: 'success' }])
runsByBranch.set('docs/export-format', [{ status: 'completed', conclusion: 'failure' }])
// `chore/refactor` reports nothing at all, which must read as unknown.

type Delivery = {
  ref: string
  title: string
  delivery: { merged: boolean; draftOnly: boolean; open: number; checks: string | null }
}
const delivered = await asJson<Delivery[]>(alice, ['prs'])
const byRef = new Map(delivered.map((row) => [row.ref, row]))
const docs = delivered.find((row) => row.ref !== bugRef)

check(
  'a merged pull request matched by the card reference is reported as merged',
  byRef.get(bugRef)?.delivery.merged === true,
  JSON.stringify(delivered),
)
check(
  'its passing checks are read from the check-runs endpoint',
  byRef.get(bugRef)?.delivery.checks === 'passing',
  String(byRef.get(bugRef)?.delivery.checks),
)
check(
  'a closing keyword links a pull request to the card mirroring that issue',
  docs !== undefined,
  JSON.stringify(delivered.map((row) => row.ref)),
)
check(
  'a failing check is reported as failing, never as unknown',
  docs?.delivery.checks === 'failing',
  String(docs?.delivery.checks),
)
check(
  'a pull request mentioning nothing recognisable is left unlinked',
  delivered.length === 2 && !JSON.stringify(delivered).includes('unrelated refactor'),
  JSON.stringify(delivered.map((row) => row.ref)),
)

// ------------------------------------------------------- the guard, and the token

let refused = ''
try {
  await nodeHttp(API).request('https://example.com/anything', { method: 'GET', headers: {} })
} catch (error) {
  refused = (error as Error).message
}
check(
  'the transport refuses an origin other than the configured one',
  /Refused a request to https:\/\/example\.com/.test(refused),
  refused,
)

check(
  'the token never appears in anything the command printed',
  !transcript.join('\n').includes(TOKEN),
  'a command printed it',
)

const onDisk = await readFile(join(alice, 'remote'), 'utf8').catch(() => '')
check('and the remote settings on disk do not carry it either', !onDisk.includes(TOKEN))

// ----------------------------------------------------------------------- done

server.close()
await Promise.all([workspace, alice, bob].map((path) => rm(path, { recursive: true, force: true })))

if (failures.length > 0) {
  console.error(`\n✗ Forge: ${failures.length} of ${checks.length + failures.length} failed\n`)
  for (const failure of failures) console.error(`  • ${failure}`)
  process.exit(1)
}

console.log(`✓ Forge: ${checks.length} checks, through a real socket, with nothing mocked.`)

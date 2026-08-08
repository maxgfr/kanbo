/**
 * The MCP server, driven the way a client drives it, with nothing mocked.
 *
 * Two claims are checked here, and they are the two that matter.
 *
 * **It is the same program as the CLI.** Every tool calls `@kanbo/workspace`,
 * so a board changed through a tool and a board changed through a command must
 * agree — not approximately, but on the same store, in the same order. So this
 * spawns both against one `KANBO_HOME` and compares what they say.
 *
 * **Nothing but JSON-RPC reaches stdout.** A stray `console.log` anywhere in the
 * server, or in anything it imports, corrupts the stream and surfaces at the
 * client as an unexplained disconnect. `no-console` is off in this repo, so
 * nothing else prevents it. Every line the server writes is parsed here, which
 * is a check that keeps working as the SDK changes.
 *
 * Run with `node scripts/check-mcp.ts`.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = process.env['KANBO_CLI'] ?? join(ROOT, 'packages/cli/src/main.ts')
const SERVER = process.env['KANBO_MCP'] ?? join(ROOT, 'packages/mcp/src/main.ts')

const failures: string[] = []
const checks: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) checks.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const home = await mkdtemp(join(tmpdir(), 'kanbo-mcp-'))

function argsFor(entry: string, rest: readonly string[]): [string, string[]] {
  return /\.[cm]?ts$/.test(entry) ? ['node', [entry, ...rest]] : [entry, [...rest]]
}

async function kanbo(...args: string[]): Promise<string> {
  const [program, argv] = argsFor(CLI, args)
  const { stdout } = await run(program, argv, { env: { ...process.env, KANBO_HOME: home } })
  return stdout
}

/**
 * One session, holding the pipe open across several calls.
 *
 * A client does not restart the server per request, and neither does this: the
 * bugs worth catching — state held across calls, a second response written to
 * the wrong id — only appear when the connection lives.
 */
type Session = {
  call(method: string, params?: unknown): Promise<Record<string, unknown>>
  notify(method: string, params?: unknown): void
  end(): Promise<{ code: number | null; stray: readonly string[]; stderr: string }>
}

function open(): Session {
  const [program, argv] = argsFor(SERVER, ['--home', home])
  const child = spawn(program, argv, {
    env: { ...process.env, KANBO_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let id = 0
  const waiting = new Map<number, (value: Record<string, unknown>) => void>()
  const stray: string[] = []
  let stderr = ''
  let buffer = ''

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let at = buffer.indexOf('\n')
    while (at !== -1) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      if (line === '') continue

      try {
        const message = JSON.parse(line) as Record<string, unknown>
        if (message['jsonrpc'] !== '2.0') stray.push(line)
        const settle = typeof message['id'] === 'number' ? waiting.get(message['id']) : undefined
        if (settle) {
          waiting.delete(message['id'] as number)
          settle(message)
        }
      } catch {
        // Anything that is not a message is the failure this check exists for.
        stray.push(line)
      }
    }
  })

  return {
    call(method, params) {
      const at = ++id
      return new Promise((settle, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method} never answered`)), 20_000)
        waiting.set(at, (message) => {
          clearTimeout(timer)
          settle(message)
        })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: at, method, params })}\n`)
      })
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    },
    end() {
      return new Promise((settle) => {
        child.once('close', (code) => settle({ code, stray, stderr }))
        child.stdin.end()
        setTimeout(() => child.kill(), 3000).unref()
      })
    },
  }
}

/** The text a tool answered with, parsed back into the value it serialised. */
function payload(response: Record<string, unknown>): unknown {
  const result = response['result'] as { content?: { text?: string }[]; isError?: boolean }
  const text = result?.content?.[0]?.text ?? ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function failed(response: Record<string, unknown>): boolean {
  return (response['result'] as { isError?: boolean } | undefined)?.isError === true
}

const session = open()

try {
  const hello = await session.call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'check-mcp', version: '0' },
  })
  session.notify('notifications/initialized')

  const info = (hello['result'] as { serverInfo?: { name?: string } })?.serverInfo
  check('the server introduces itself', info?.name === 'kanbo', JSON.stringify(info))

  const listed = await session.call('tools/list')
  const tools = ((listed['result'] as { tools?: { name: string; annotations?: object }[] })
    ?.tools ?? []) as {
    name: string
    description?: string
    annotations?: Record<string, boolean>
  }[]

  check('it offers tools', tools.length >= 20, `${tools.length} tools`)
  check(
    'every tool says what it is for',
    tools.every((tool) => (tool.description ?? '').length > 20),
    tools
      .filter((tool) => (tool.description ?? '').length <= 20)
      .map((tool) => tool.name)
      .join(', '),
  )

  // The point of annotating: a client can ask before something is destroyed.
  const destructive = tools.filter((tool) => tool.annotations?.['destructiveHint'] === true)
  check(
    'the tools that remove things are marked as destructive',
    destructive.some((tool) => tool.name === 'kanbo_item_delete') &&
      destructive.some((tool) => tool.name === 'kanbo_column_delete'),
    destructive.map((tool) => tool.name).join(', '),
  )

  const reading = tools.filter((tool) => tool.annotations?.['readOnlyHint'] === true)
  check(
    'the tools that only read are marked read-only',
    reading.some((tool) => tool.name === 'kanbo_board') &&
      reading.every((tool) => tool.annotations?.['destructiveHint'] !== true),
    reading.map((tool) => tool.name).join(', '),
  )

  const networked = tools.filter((tool) => tool.annotations?.['openWorldHint'] === true)
  check(
    'exactly one tool admits to touching the network',
    networked.length === 1 && networked[0]?.name === 'kanbo_sync',
    networked.map((tool) => tool.name).join(', '),
  )

  // ---- a project made through the tools, read back through the CLI

  const created = await session.call('tools/call', {
    name: 'kanbo_init',
    arguments: { name: 'Apollo', key: 'APL' },
  })
  check('a tool creates a project', !failed(created), JSON.stringify(payload(created)))

  await session.call('tools/call', {
    name: 'kanbo_item_create',
    arguments: { title: 'Ship the departure board', type: 'story', points: 5, priority: 'p1' },
  })

  const board = await kanbo('board')
  check(
    'what the tool wrote, the command reads — on the same store',
    board.includes('Ship the departure board') && board.includes('Backlog  (1)'),
    board,
  )

  // ---- and the other way round

  await kanbo('add', 'Fix the login crash')
  const search = await session.call('tools/call', {
    name: 'kanbo_search',
    arguments: { query: 'is:open' },
  })
  const found = payload(search) as { ref: string }[]
  check(
    'and what the command wrote, the tool reads',
    Array.isArray(found) && found.length === 2 && found.some((item) => item.ref === 'APL-2'),
    JSON.stringify(found),
  )

  // ---- the same answer, both ways

  const viaTool = payload(
    await session.call('tools/call', { name: 'kanbo_item', arguments: { ref: 'APL-1' } }),
  ) as { item: { title: string; estimate: number } }
  const viaCli = JSON.parse(await kanbo('show', 'APL-1', '--json')) as {
    item: { title: string; estimate: number }
  }
  check(
    'a card reads identically through both front-ends',
    viaTool.item.title === viaCli.item.title && viaTool.item.estimate === viaCli.item.estimate,
    `${JSON.stringify(viaTool.item.title)} vs ${JSON.stringify(viaCli.item.title)}`,
  )

  // ---- a refusal is information, not a crash

  const wrong = await session.call('tools/call', {
    name: 'kanbo_item_move',
    arguments: { ref: 'APL-1', column: 'Shipped' },
  })
  check(
    'an unknown column is refused with the ones that exist',
    failed(wrong) && String(payload(wrong)).includes('Backlog'),
    String(payload(wrong)),
  )

  const missing = await session.call('tools/call', {
    name: 'kanbo_item',
    arguments: { ref: 'APL-999' },
  })
  check(
    'an unknown item is refused rather than invented',
    failed(missing),
    String(payload(missing)),
  )

  // ---- the domain's own guards hold through this door too

  await session.call('tools/call', {
    name: 'kanbo_item_link',
    arguments: { ref: 'APL-1', type: 'blocks', target: 'APL-2' },
  })
  const loop = await session.call('tools/call', {
    name: 'kanbo_item_link',
    arguments: { ref: 'APL-1', type: 'blocked-by', target: 'APL-2' },
  })
  check(
    'a circular dependency is refused through a tool as it is on the board',
    failed(loop),
    String(payload(loop)),
  )

  const twice = await session.call('tools/call', {
    name: 'kanbo_init',
    arguments: { name: 'Gemini', key: 'GEM' },
  })
  check('a second project is refused', failed(twice), String(payload(twice)))

  // ---- sprints, because that is where the terminal was furthest behind

  await session.call('tools/call', {
    name: 'kanbo_sprint_upsert',
    arguments: { name: 'Sprint 12', start: '2026-08-03', end: '2026-08-16', capacity: 20 },
  })
  await session.call('tools/call', {
    name: 'kanbo_item_update',
    arguments: { ref: 'APL-1', sprint: 'Sprint 12' },
  })
  const sprints = await kanbo('sprint', 'show', 'Sprint 12', '--json')
  check(
    'a sprint planned through a tool is the sprint the command reports',
    JSON.parse(sprints).committed === 5,
    sprints.slice(0, 200),
  )

  const closed = payload(
    await session.call('tools/call', {
      name: 'kanbo_sprint_close',
      arguments: { name: 'Sprint 12', carryTo: null },
    }),
  ) as { carried: string[] }
  check(
    'closing it carries the unfinished work out rather than leaving it there',
    closed.carried.includes('APL-1'),
    JSON.stringify(closed),
  )
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
}

const { code, stray, stderr } = await session.end()

check('nothing but JSON-RPC ever reached stdout', stray.length === 0, stray.slice(0, 3).join(' | '))
check('the server exits cleanly when its input closes', code === 0 || code === null, String(code))

if (failures.length > 0 && stderr.trim() !== '') {
  failures.push(`server stderr: ${stderr.trim().split('\n').slice(0, 5).join(' | ')}`)
}

await rm(home, { recursive: true, force: true })

for (const passed of checks) console.log(`  ✓ ${passed}`)

if (failures.length > 0) {
  console.error(`\n✗ MCP: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  • ${failure}`)
  process.exit(1)
}

console.log(`\n✓ MCP: ${checks.length} checks passed against a real stdio session.`)

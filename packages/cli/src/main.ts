#!/usr/bin/env node
/**
 * Kanbo from a terminal.
 *
 * The point of this command is not convenience — it is evidence. Every
 * behaviour below is `@kanbo/core` called directly: the same reducer the board
 * uses, the same merge the sync engine uses, the same query language the
 * command palette uses. Nothing about a project is re-implemented for the
 * terminal, and nothing could be, because the domain has no branch for where
 * it is running.
 *
 * Run with `node packages/cli/src/main.ts <command>`.
 */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  type Operation,
  type OperationBody,
  type Status,
  type StatusCategory,
  byOrder,
  defaultStatuses,
  exportCsv,
  exportJson,
  importJson,
  itemsInStatus,
  keyBetween,
  memberById,
  mergeLogs,
  newItem,
  operationBuilder,
  orderForDrop,
  reduceOperations,
  search,
  statusById,
} from '@kanbo/core'
import { nodeDeviceId, nodePorts } from '@kanbo/adapters-node'

const ROOT = process.env['KANBO_HOME'] ?? join(homedir(), '.kanbo')
const LOG_KEY = 'log'
/**
 * Who is at this terminal.
 *
 * Beside the log rather than in it, for the same reason the browser keeps it in
 * localStorage: "I am Ada" is true of a machine, not of a project. Syncing it
 * would tell every other device that they are Ada too.
 */
const ME_KEY = 'me'

const [, , command = 'help', ...args] = process.argv

async function loadLog(storage: ReturnType<typeof nodePorts>['storage']) {
  const stored = await storage.get(LOG_KEY)
  if (!stored) return [] as readonly Operation[]
  const parsed: unknown = JSON.parse(new TextDecoder().decode(stored))
  return Array.isArray(parsed) ? (parsed as readonly Operation[]) : []
}

async function readMe(storage: ReturnType<typeof nodePorts>['storage']) {
  const stored = await storage.get(ME_KEY)
  return stored ? new TextDecoder().decode(stored) : null
}

async function saveLog(
  storage: ReturnType<typeof nodePorts>['storage'],
  log: readonly Operation[],
) {
  await storage.set(LOG_KEY, new TextEncoder().encode(JSON.stringify(log)))
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

await mkdir(ROOT, { recursive: true })
const ports = nodePorts(ROOT)
const device = await nodeDeviceId(ports.storage)
const log = await loadLog(ports.storage)
const project = reduceOperations(log)
const meId = await readMe(ports.storage)

async function commit(...bodies: readonly OperationBody[]) {
  const emit = operationBuilder(ports, { deviceId: device, authorId: null }, log)
  await saveLog(ports.storage, mergeLogs(log, bodies.map(emit)))
}

switch (command) {
  case 'init': {
    if (project.statuses.length > 0) fail('A project already exists here.')
    const name = args[0] ?? 'My project'
    const key = (args[1] ?? name.slice(0, 3)).toUpperCase()
    const statuses = defaultStatuses(() => ports.random.id())
    await commit(
      { kind: 'project.set', patch: { name, key } },
      ...statuses.map((status) => ({ kind: 'status.upsert' as const, status })),
    )
    console.log(`Created ${name} (${key}) in ${ROOT}`)
    break
  }

  case 'board': {
    if (project.statuses.length === 0) fail('No project here yet. Run `kanbo init` first.')
    for (const status of project.statuses.toSorted(byOrder)) {
      const items = itemsInStatus(project, status.id).toSorted(byOrder)
      console.log(`\n${status.name}  (${items.length})`)
      for (const item of items) {
        const points = item.estimate === null ? '' : `  ${item.estimate}pt`
        console.log(`  ${item.ref.padEnd(10)} ${item.title}${points}`)
      }
      if (items.length === 0) console.log('  —')
    }
    console.log('')
    break
  }

  case 'columns': {
    if (project.statuses.length === 0) fail('No project here yet. Run `kanbo init` first.')
    for (const status of project.statuses.toSorted(byOrder)) {
      const limit = status.wipLimit === null ? '' : `  wip ${status.wipLimit}`
      const count = itemsInStatus(project, status.id).length
      console.log(`  ${status.name.padEnd(16)} ${status.category.padEnd(12)} ${count}${limit}`)
    }
    break
  }

  case 'column': {
    // Columns are ordinary domain entities, so the terminal edits them with the
    // same operation the settings panel emits. Nothing here knows it is a CLI.
    const [action, ...rest] = args
    if (action !== 'add') fail('Usage: kanbo column add <name> [todo|in-progress|done]')
    if (project.statuses.length === 0) fail('No project here yet. Run `kanbo init` first.')

    const tail = rest.at(-1)
    const named = tail === 'todo' || tail === 'in-progress' || tail === 'done'
    const category: StatusCategory = named ? tail : 'in-progress'
    const name = (named ? rest.slice(0, -1) : rest).join(' ').trim()
    if (name === '') fail('Usage: kanbo column add <name> [todo|in-progress|done]')

    const last = project.statuses.toSorted(byOrder).at(-1)
    const status: Status = {
      id: ports.random.id(),
      name,
      category,
      order: keyBetween(last?.order ?? null, null),
      wipLimit: null,
      color: null,
    }
    await commit({ kind: 'status.upsert', status })
    console.log(`Added ${status.name} (${status.category})`)
    break
  }

  case 'add': {
    const title = args.join(' ').trim()
    if (title === '') fail('Usage: kanbo add <title>')
    const item = newItem(project, ports, { title })
    await commit({ kind: 'item.create', item })
    console.log(`${item.ref}  ${item.title}`)
    break
  }

  case 'move': {
    const [ref, statusName] = args
    if (!ref || !statusName) fail('Usage: kanbo move <ref> <status>')
    const item = project.items.find((candidate) => candidate.ref === ref.toUpperCase())
    if (!item) fail(`No item with reference ${ref}.`)
    const status = project.statuses.find(
      (candidate) => candidate.name.toLowerCase() === statusName.toLowerCase(),
    )
    if (!status) {
      fail(
        `No status called ${statusName}. Try: ${project.statuses.map((s) => s.name).join(', ')}.`,
      )
    }
    await commit({
      kind: 'item.move',
      itemId: item.id,
      statusId: status.id,
      order: orderForDrop(project, item.id, status.id, 0),
    })
    console.log(`${item.ref} → ${status.name}`)
    break
  }

  case 'search': {
    const query = args.join(' ')
    // The identical query language the palette uses, unchanged.
    const found = search(query, { project, now: Date.now(), meId })
    if (found.length === 0) console.log('Nothing matched.')
    for (const item of found) {
      const status = statusById(project, item.statusId)
      console.log(`${item.ref.padEnd(10)} ${(status?.name ?? '').padEnd(12)} ${item.title}`)
    }
    break
  }

  case 'assign': {
    // The board lets you invent a person straight from an item, which is the
    // moment you want one; there is no user directory to pick from either way.
    // Doing the same here keeps `me` from being half a feature.
    const [ref, ...rest] = args
    const who = rest.join(' ').trim()
    if (!ref || who === '') fail('Usage: kanbo assign <ref> <name>   (or --nobody)')

    const item = project.items.find(
      (candidate) => candidate.ref.toUpperCase() === ref.toUpperCase(),
    )
    if (!item) fail(`No item called ${ref}.`)

    if (who === '--nobody') {
      await commit({ kind: 'item.set', itemId: item.id, patch: { assignees: [] } })
      console.log(`${item.ref} is assigned to nobody.`)
      break
    }

    const existing = project.members.find(
      (member) => member.name.toLowerCase() === who.toLowerCase(),
    )
    const member = existing ?? { id: ports.random.id(), name: who, handle: null }
    await commit(...(existing ? [] : [{ kind: 'member.upsert' as const, member }]), {
      kind: 'item.set',
      itemId: item.id,
      patch: { assignees: [...new Set([...item.assignees, member.id])] },
    })
    console.log(`${item.ref} is assigned to ${member.name}.`)
    break
  }

  case 'me': {
    // `assignee:@me` is offered in the README as an example of the query
    // language and could never match anything from here, because there was no
    // way to say who "me" was. The palette had the same gap.
    const wanted = args.join(' ').trim()
    if (wanted === '') {
      const me = memberById(project, meId)
      console.log(
        me
          ? `You are ${me.name}${me.handle ? ` (${me.handle})` : ''}.`
          : 'Nobody claimed on this machine.',
      )
      break
    }

    if (wanted === '--none') {
      await ports.storage.delete(ME_KEY)
      console.log('Nobody claimed on this machine.')
      break
    }

    const found = project.members.find(
      (member) =>
        member.name.toLowerCase() === wanted.toLowerCase() ||
        member.handle?.toLowerCase() === wanted.toLowerCase().replace(/^@/, ''),
    )
    if (!found) {
      fail(
        project.members.length === 0
          ? 'This project has nobody on it yet. Assign someone to an item first.'
          : `No such person. This project has: ${project.members.map((member) => member.name).join(', ')}`,
      )
    }
    await ports.storage.set(ME_KEY, new TextEncoder().encode(found.id))
    console.log(`You are ${found.name}.`)
    break
  }

  case 'export': {
    console.log(args[0] === '--csv' ? exportCsv(project) : exportJson(log, Date.now()))
    break
  }

  case 'import': {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    const incoming = importJson(Buffer.concat(chunks).toString('utf8'))
    const merged = mergeLogs(log, incoming)
    await saveLog(ports.storage, merged)
    console.log(`Merged ${merged.length - log.length} new operations.`)
    break
  }

  case 'status': {
    console.log(`project   ${project.name || '(none)'} ${project.key}`)
    console.log(`items     ${project.items.length}`)
    console.log(`operations ${log.length}`)
    console.log(`device    ${device}`)
    console.log(`store     ${ROOT}`)
    break
  }

  default:
    console.log(`kanbo — project management from the terminal

  init [name] [key]     create a project in ${ROOT}
  board                 print the board
  columns               print the columns and their categories
  column add <name> [category]
                        add a column (todo, in-progress or done)
  add <title>           add an item
  move <ref> <status>   move an item
  assign <ref> <name>   assign an item, inventing the person if new
  me [name|--none]      who you are here, for assignee:@me
  search <query>        e.g. "is:blocked", "type:bug points:>3"
  export [--csv]        write the operation log, or a flat CSV
  import                merge an export from stdin
  status                what is stored, and where

Set KANBO_HOME to work on a different project.`)
    break
}

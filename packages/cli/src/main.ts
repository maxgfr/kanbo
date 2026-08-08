#!/usr/bin/env node
/**
 * Kanbo from a terminal.
 *
 * The point of this command is not convenience — it is evidence. Every
 * behaviour below is `@kanbo/core` called through `@kanbo/workspace`: the same
 * reducer the board uses, the same merge the sync engine uses, the same query
 * language the command palette uses. Nothing about a project is re-implemented
 * for the terminal, and nothing could be, because the domain has no branch for
 * where it is running.
 *
 * What is left in this file is the only thing that is really about a terminal:
 * reading argv, and writing text. The MCP server is the same program with the
 * other two-thirds and a different last step.
 *
 * Run with `node packages/cli/src/main.ts <command>`.
 */
import {
  KanboError,
  type Workspace,
  board,
  claimMe,
  columnAdd,
  columns,
  find,
  importOperations,
  init,
  itemAssign,
  itemCreate,
  itemMove,
  itemUnassign,
  openWorkspace,
  summary,
  whoAmI,
} from '@kanbo/workspace'
import { type StatusCategory, exportCsv, exportJson } from '@kanbo/core'

const [, , command = 'help', ...args] = process.argv

function fail(message: string, candidates: readonly string[] = []): never {
  console.error(message)
  for (const candidate of candidates) console.error(`  ${candidate}`)
  process.exit(1)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const HELP = `kanbo — project management from the terminal

  init [name] [key]     create a project in ${'{root}'}
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

Set KANBO_HOME to work on a different project.`

async function run(workspace: Workspace): Promise<void> {
  switch (command) {
    case 'init': {
      const { result } = await init(workspace, args[0] ?? 'My project', args[1] ?? null)
      console.log(`Created ${result.name} (${result.key}) in ${result.root}`)
      return
    }

    case 'board': {
      for (const column of board(workspace.project)) {
        const points = (item: { estimate: number | null }) =>
          item.estimate === null ? '' : `  ${item.estimate}pt`
        console.log(`\n${column.status.name}  (${column.items.length})`)
        for (const item of column.items) {
          console.log(`  ${item.ref.padEnd(10)} ${item.title}${points(item)}`)
        }
        if (column.items.length === 0) console.log('  —')
      }
      console.log('')
      return
    }

    case 'columns': {
      for (const column of columns(workspace.project)) {
        const limit = column.wipLimit === null ? '' : `  wip ${column.wipLimit}`
        console.log(
          `  ${column.name.padEnd(16)} ${column.category.padEnd(12)} ${column.count}${limit}`,
        )
      }
      return
    }

    case 'column': {
      const [action, ...rest] = args
      if (action !== 'add') fail('Usage: kanbo column add <name> [todo|in-progress|done]')

      const tail = rest.at(-1)
      const named = tail === 'todo' || tail === 'in-progress' || tail === 'done'
      const category: StatusCategory = named ? tail : 'in-progress'
      const name = (named ? rest.slice(0, -1) : rest).join(' ')
      if (name.trim() === '') fail('Usage: kanbo column add <name> [todo|in-progress|done]')

      const { result } = await columnAdd(workspace, name, category)
      console.log(`Added ${result.name} (${result.category})`)
      return
    }

    case 'add': {
      const { result } = await itemCreate(workspace, { title: args.join(' ').trim() })
      console.log(`${result.ref}  ${result.title}`)
      return
    }

    case 'move': {
      const [ref, statusName] = args
      if (!ref || !statusName) fail('Usage: kanbo move <ref> <status>')
      const { result } = await itemMove(workspace, ref, statusName)
      console.log(`${result.item.ref} → ${result.status.name}`)
      return
    }

    case 'search': {
      const found = find(workspace, args.join(' '), Date.now())
      if (found.length === 0) console.log('Nothing matched.')
      for (const { item, status } of found) {
        console.log(`${item.ref.padEnd(10)} ${(status?.name ?? '').padEnd(12)} ${item.title}`)
      }
      return
    }

    case 'assign': {
      const [ref, ...rest] = args
      const who = rest.join(' ').trim()
      if (!ref || who === '') fail('Usage: kanbo assign <ref> <name>   (or --nobody)')

      if (who === '--nobody') {
        const { result } = await itemUnassign(workspace, ref)
        console.log(`${result.item.ref} is assigned to nobody.`)
        return
      }

      const { result } = await itemAssign(workspace, ref, who)
      console.log(`${result.item.ref} is assigned to ${result.member.name}.`)
      return
    }

    case 'me': {
      const wanted = args.join(' ').trim()
      if (wanted === '') {
        const me = whoAmI(workspace)
        console.log(
          me
            ? `You are ${me.name}${me.handle ? ` (${me.handle})` : ''}.`
            : 'Nobody claimed on this machine.',
        )
        return
      }

      if (wanted === '--none') {
        await claimMe(workspace, null)
        console.log('Nobody claimed on this machine.')
        return
      }

      const { result } = await claimMe(workspace, wanted)
      console.log(`You are ${result!.name}.`)
      return
    }

    case 'export': {
      console.log(
        args[0] === '--csv' ? exportCsv(workspace.project) : exportJson(workspace.log, Date.now()),
      )
      return
    }

    case 'import': {
      const { result } = await importOperations(workspace, await readStdin())
      console.log(`Merged ${result.added} new operations.`)
      return
    }

    case 'status': {
      const store = summary(workspace)
      console.log(`project   ${store.name || '(none)'} ${store.key}`)
      console.log(`items     ${store.items}`)
      console.log(`operations ${store.operations}`)
      console.log(`device    ${store.device}`)
      console.log(`store     ${store.root}`)
      return
    }

    case 'help':
    case '--help':
    case '-h': {
      console.log(HELP.replace('{root}', workspace.root))
      return
    }

    default:
      // A typo used to print the help and exit 0, so a broken line in a script
      // passed in silence. Asking for something that does not exist is an error.
      console.error(HELP.replace('{root}', workspace.root))
      process.exit(1)
  }
}

const workspace = await openWorkspace()

try {
  await run(workspace)
} catch (error) {
  if (error instanceof KanboError) fail(error.message, error.candidates)
  throw error
}

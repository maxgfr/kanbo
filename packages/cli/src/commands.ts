import {
  type Workspace,
  board,
  claimMe,
  columnAdd,
  columnDelete,
  columnReorder,
  columnSet,
  columns,
  commentDelete,
  fieldDelete,
  fieldUpsert,
  find,
  history,
  importOperations,
  init,
  itemAssign,
  itemComment,
  itemCreate,
  itemDelete,
  itemDetail,
  itemField,
  itemLabel,
  itemLink,
  itemMove,
  itemUnassign,
  itemUnlink,
  itemUpdate,
  labelDelete,
  labelUpsert,
  metrics,
  milestoneDelete,
  milestoneUpsert,
  people,
  personDelete,
  personUpsert,
  projectSet,
  releaseNotes,
  releases,
  roadmap,
  sprintClose,
  sprintDelete,
  sprintReport,
  sprintUpsert,
  summary,
  velocities,
  whoAmI,
  type PatchSpec,
} from '@kanbo/workspace'
import { KanboError } from '@kanbo/workspace'
import { type StatusCategory, byOrder, exportCsv, exportJson } from '@kanbo/core'

import { type Flags, optional } from './flags.ts'

/**
 * Every command, in one table.
 *
 * The help is generated from this rather than written beside it, so the two
 * cannot disagree — a `kanbo help` listing a command that does not exist is a
 * lie told to whoever reads it, and a model reads it more literally than a
 * person does. `scripts/check-parity.ts` walks this table for the same reason.
 *
 * Not one of these functions decides anything about a project. They read
 * arguments, call `@kanbo/workspace`, and print.
 */
export type Context = {
  readonly workspace: Workspace
  readonly flags: Flags
  /** Positional arguments after the command name. */
  readonly args: readonly string[]
  readonly now: number
  readonly json: boolean
  readonly out: (line: string) => void
}

export type Command = {
  readonly usage: string
  readonly summary: string
  readonly group: Group
  run(context: Context): Promise<void>
}

export type Group =
  | 'project'
  | 'columns'
  | 'items'
  | 'relations'
  | 'content'
  | 'vocabulary'
  | 'people'
  | 'sprints'
  | 'releases'
  | 'metrics'
  | 'portability'

/** JSON when asked for, and the same values either way. */
function emit(context: Context, value: unknown, lines: () => void): void {
  if (context.json) context.out(JSON.stringify(value, null, 2))
  else lines()
}

function required(context: Context, index: number, what: string): string {
  const value = context.args[index]
  if (value === undefined || value === '') throw new KanboError(`Usage: kanbo ${what}`)
  return value
}

/** The flags every item-shaped command shares, read once. */
function patchFrom(flags: Flags): PatchSpec {
  const spec: Record<string, unknown> = {}

  if (flags.has('title')) spec['title'] = flags.get('title')
  if (flags.has('description')) spec['description'] = flags.get('description')
  if (flags.has('type')) spec['type'] = flags.get('type')
  if (flags.has('priority')) spec['priority'] = flags.get('priority')
  if (flags.has('points')) spec['points'] = optional(flags, 'points')
  if (flags.has('due')) spec['due'] = optional(flags, 'due')
  if (flags.has('sprint')) spec['sprint'] = optional(flags, 'sprint')
  if (flags.has('release')) spec['release'] = optional(flags, 'release')
  if (flags.has('parent')) spec['parent'] = optional(flags, 'parent')
  if (flags.all('label').length > 0) spec['labels'] = flags.all('label')
  if (flags.all('assignee').length > 0) spec['assignees'] = flags.all('assignee')
  if (flags.has('archived')) spec['archived'] = flags.bool('archived')

  return spec as PatchSpec
}

function pad(value: string, width: number): string {
  return value.padEnd(width)
}

/**
 * A flag that is present, as a definite value.
 *
 * `exactOptionalPropertyTypes` will not let `undefined` be assigned to an
 * optional property, and it is right to refuse: "absent" and "present but
 * undefined" are different, and every one of these is written behind a
 * `has()` guard that has already answered the first question.
 */
function text(flags: Flags, name: string): string {
  return flags.get(name) ?? ''
}

function clearable(flags: Flags, name: string): string | null {
  return optional(flags, name) ?? null
}

export const COMMANDS: Record<string, Command> = {
  // -------------------------------------------------------------- project

  init: {
    group: 'project',
    usage: 'init [name] [key]',
    summary: 'create a project here',
    async run(context) {
      const { result } = await init(
        context.workspace,
        context.args[0] ?? 'My project',
        context.args[1] ?? null,
      )
      emit(context, result, () =>
        context.out(`Created ${result.name} (${result.key}) in ${result.root}`),
      )
    },
  },

  project: {
    group: 'project',
    usage: 'project set [--name x] [--key ABC] [--description x]',
    summary: 'rename the project, or change its reference prefix',
    async run(context) {
      if (context.args[0] !== 'set') throw new KanboError(`Usage: kanbo ${this.usage}`)
      const patch: Record<string, string> = {}
      for (const key of ['name', 'key', 'description'] as const) {
        const value = context.flags.get(key)
        if (value !== undefined) patch[key] = value
      }
      const { result } = await projectSet(context.workspace, patch)
      emit(context, result, () => context.out(`Changed ${result.changed.join(', ')}.`))
    },
  },

  status: {
    group: 'project',
    usage: 'status',
    summary: 'what is stored, and where',
    async run(context) {
      const store = summary(context.workspace)
      emit(context, store, () => {
        context.out(`project   ${store.name || '(none)'} ${store.key}`)
        context.out(`items     ${store.items}`)
        context.out(`operations ${store.operations}`)
        context.out(`device    ${store.device}`)
        context.out(`store     ${store.root}`)
      })
    },
  },

  // -------------------------------------------------------------- columns

  board: {
    group: 'columns',
    usage: 'board',
    summary: 'print the board',
    async run(context) {
      const bo = board(context.workspace.project)
      emit(context, bo, () => {
        for (const column of bo) {
          context.out(`\n${column.status.name}  (${column.items.length})`)
          for (const item of column.items) {
            const points = item.estimate === null ? '' : `  ${item.estimate}pt`
            context.out(`  ${pad(item.ref, 10)} ${item.title}${points}`)
          }
          if (column.items.length === 0) context.out('  —')
        }
        context.out('')
      })
    },
  },

  columns: {
    group: 'columns',
    usage: 'columns',
    summary: 'the columns and their categories',
    async run(context) {
      const list = columns(context.workspace.project)
      emit(context, list, () => {
        for (const column of list) {
          const limit = column.wipLimit === null ? '' : `  wip ${column.wipLimit}`
          context.out(
            `  ${pad(column.name, 16)} ${pad(column.category, 12)} ${column.count}${limit}`,
          )
        }
      })
    },
  },

  column: {
    group: 'columns',
    usage: 'column add|set|move|rm <name> …',
    summary: 'add, rename, reorder or remove a column',
    async run(context) {
      const [action, ...rest] = context.args
      const { flags } = context

      switch (action) {
        case 'add': {
          const tail = rest.at(-1)
          const named = tail === 'todo' || tail === 'in-progress' || tail === 'done'
          const category: StatusCategory = named ? tail : 'in-progress'
          const name = (named ? rest.slice(0, -1) : rest).join(' ')
          const { result } = await columnAdd(context.workspace, name, category)
          emit(context, result, () => context.out(`Added ${result.name} (${result.category})`))
          return
        }

        case 'set': {
          const name = rest.join(' ')
          const patch: Parameters<typeof columnSet>[2] = {}
          if (flags.has('name')) patch.name = text(flags, 'name')
          if (flags.has('category')) patch.category = text(flags, 'category')
          if (flags.has('wip')) patch.wipLimit = flags.number('wip') ?? null
          if (flags.has('color')) patch.color = clearable(flags, 'color')
          const { result } = await columnSet(context.workspace, name, patch)
          emit(context, result, () => context.out(`${result.name} (${result.category})`))
          return
        }

        case 'move': {
          const name = rest.join(' ')
          const index = flags.number('to')
          if (index === undefined)
            throw new KanboError('Say where: --to <position>, counting from 1.')
          const { result } = await columnReorder(context.workspace, name, index - 1)
          emit(context, result, () => context.out(`${result.name} is now at ${index}.`))
          return
        }

        case 'rm': {
          const name = rest.join(' ')
          const into = flags.get('into')
          if (into === undefined) {
            throw new KanboError(
              'Say where its cards go: --into <column>. Items are never orphaned by deleting a column.',
            )
          }
          const { result } = await columnDelete(context.workspace, name, into)
          emit(context, result, () =>
            context.out(
              `Removed ${result.status.name}; ${result.moved} card(s) moved to ${result.into.name}.`,
            ),
          )
          return
        }

        default:
          throw new KanboError(`Usage: kanbo ${this.usage}`)
      }
    },
  },

  // ---------------------------------------------------------------- items

  add: {
    group: 'items',
    usage:
      'add <title> [--type --priority --points --due --sprint --release --parent --label --assignee --status --description]',
    summary: 'add an item',
    async run(context) {
      const title = context.args.join(' ').trim()
      if (title === '') throw new KanboError('Usage: kanbo add <title>')

      const statusName = context.flags.get('status')
      const { workspace, result } = await itemCreate(context.workspace, { title })

      // Everything else is an ordinary edit of the item that now exists, so
      // there is exactly one place that knows what `--priority` means.
      const spec = patchFrom(context.flags)
      let latest = workspace
      if (Object.keys(spec).length > 0) {
        latest = (await itemUpdate(latest, result.ref, spec, context.now)).workspace
      }
      if (statusName !== undefined) {
        latest = (await itemMove(latest, result.ref, statusName)).workspace
      }

      emit(context, result, () => context.out(`${result.ref}  ${result.title}`))
    },
  },

  show: {
    group: 'items',
    usage: 'show <ref>',
    summary: 'everything on one card',
    async run(context) {
      const detail = itemDetail(context.workspace, required(context, 0, 'show <ref>'), context.now)
      emit(context, detail, () => {
        const { item } = detail
        context.out(`${item.ref}  ${item.title}`)
        context.out(`  status    ${detail.status?.name ?? '—'}`)
        context.out(`  type      ${item.type}   priority ${item.priority}`)
        context.out(`  points    ${item.estimate ?? '—'}   due ${item.dueOn ?? '—'}`)
        context.out(`  sprint    ${detail.sprint?.name ?? '—'}`)
        context.out(`  release   ${detail.release?.name ?? '—'}`)
        context.out(`  assignees ${detail.assignees.join(', ') || '—'}`)
        context.out(`  labels    ${detail.labels.join(', ') || '—'}`)
        if (detail.parent) context.out(`  parent    ${detail.parent.ref}  ${detail.parent.title}`)
        if (detail.blockedBy.length > 0) {
          context.out(`  blocked   ${detail.blockedBy.map((b) => b.ref).join(', ')}`)
        }
        for (const link of detail.links) {
          context.out(`  ${pad(link.type, 12)}${link.item.ref}  ${link.item.title}`)
        }
        for (const child of detail.children) {
          context.out(`  child     ${child.ref}  ${child.title}`)
        }
        for (const field of detail.fields) {
          context.out(`  ${pad(field.name, 10)}${String(field.value)}`)
        }
        if (item.description.trim() !== '') {
          context.out('')
          context.out(item.description)
        }
        for (const comment of detail.comments) {
          context.out('')
          context.out(`  ${comment.author ?? 'someone'} — ${comment.id}`)
          context.out(`  ${comment.body}`)
        }
      })
    },
  },

  set: {
    group: 'items',
    usage:
      'set <ref> [--title --description --type --priority --points --due --sprint --release --parent --label --assignee --archived]',
    summary: 'change fields on an item',
    async run(context) {
      const ref = required(context, 0, 'set <ref> [flags]')
      const { result } = await itemUpdate(
        context.workspace,
        ref,
        patchFrom(context.flags),
        context.now,
      )
      emit(context, result, () =>
        context.out(`${result.item.ref}: ${result.changed.join(', ')} changed.`),
      )
    },
  },

  describe: {
    group: 'items',
    usage: 'describe <ref> [text]',
    summary: 'set the Markdown description, or read it from stdin with -',
    async run(context) {
      const ref = required(context, 0, 'describe <ref> [text|-]')
      const rest = context.args.slice(1).join(' ')
      const description = rest === '-' || rest === '' ? await readStdin() : rest

      const { result } = await itemUpdate(context.workspace, ref, { description }, context.now)
      emit(context, result, () => context.out(`${result.item.ref} described.`))
    },
  },

  move: {
    group: 'items',
    usage: 'move <ref> <column> [--index n]',
    summary: 'move an item',
    async run(context) {
      const ref = required(context, 0, 'move <ref> <column>')
      const column = required(context, 1, 'move <ref> <column>')
      const index = context.flags.number('index') ?? 0

      const { result } = await itemMove(context.workspace, ref, column, index)
      emit(context, result, () => context.out(`${result.item.ref} → ${result.status.name}`))
    },
  },

  rm: {
    group: 'items',
    usage: 'rm <ref>',
    summary: 'delete an item (its deletion stays in the history)',
    async run(context) {
      const ref = required(context, 0, 'rm <ref>')
      const { result } = await itemDelete(context.workspace, ref)
      emit(context, result, () => {
        context.out(`Deleted ${result.item.ref}  ${result.item.title}`)
        if (result.children > 0) {
          context.out(`${result.children} child item(s) released, not deleted.`)
        }
      })
    },
  },

  assign: {
    group: 'items',
    usage: 'assign <ref> <name>   (or --nobody)',
    summary: 'assign an item, inventing the person if new',
    async run(context) {
      const ref = required(context, 0, 'assign <ref> <name>   (or --nobody)')
      const who = context.args.slice(1).join(' ').trim()

      if (who === '--nobody' || context.flags.has('nobody')) {
        const { result } = await itemUnassign(context.workspace, ref)
        emit(context, result, () => context.out(`${result.item.ref} is assigned to nobody.`))
        return
      }
      if (who === '') throw new KanboError('Usage: kanbo assign <ref> <name>   (or --nobody)')

      const { result } = await itemAssign(context.workspace, ref, who)
      emit(context, result, () =>
        context.out(`${result.item.ref} is assigned to ${result.member.name}.`),
      )
    },
  },

  // ------------------------------------------------------------ relations

  link: {
    group: 'relations',
    usage: 'link <ref> blocks|blocked-by|relates-to|duplicates <ref>',
    summary: 'link two items, refusing a circular dependency',
    async run(context) {
      const usage = 'link <ref> blocks|blocked-by|relates-to|duplicates <ref>'
      const { result } = await itemLink(
        context.workspace,
        required(context, 0, usage),
        required(context, 1, usage),
        required(context, 2, usage),
      )
      emit(context, result, () =>
        context.out(`${result.item.ref} ${result.type} ${result.target.ref}`),
      )
    },
  },

  unlink: {
    group: 'relations',
    usage: 'unlink <ref> <kind> <ref>',
    summary: 'remove a link, from both ends',
    async run(context) {
      const usage = 'unlink <ref> <kind> <ref>'
      const { result } = await itemUnlink(
        context.workspace,
        required(context, 0, usage),
        required(context, 1, usage),
        required(context, 2, usage),
      )
      emit(context, result, () =>
        context.out(`${result.item.ref} and ${result.target.ref} are no longer linked.`),
      )
    },
  },

  parent: {
    group: 'relations',
    usage: 'parent <ref> <ref|none>',
    summary: 'put an item under another, or take it out',
    async run(context) {
      const ref = required(context, 0, 'parent <ref> <ref|none>')
      const parent = required(context, 1, 'parent <ref> <ref|none>')
      const { result } = await itemUpdate(
        context.workspace,
        ref,
        { parent: parent.toLowerCase() === 'none' ? null : parent },
        context.now,
      )
      emit(context, result, () => context.out(`${result.item.ref} reparented.`))
    },
  },

  children: {
    group: 'relations',
    usage: 'children <ref>',
    summary: 'what is under an item, and how far along',
    async run(context) {
      const detail = itemDetail(
        context.workspace,
        required(context, 0, 'children <ref>'),
        context.now,
      )
      emit(context, { children: detail.children, progress: detail.progress }, () => {
        context.out(`${detail.progress.done}/${detail.progress.total} done`)
        for (const child of detail.children) {
          context.out(`  ${pad(child.ref, 10)} ${child.title}`)
        }
        if (detail.children.length === 0) context.out('  —')
      })
    },
  },

  label: {
    group: 'vocabulary',
    usage: 'label <ref> add|rm <name>   ·   label new|rm <name> [--color]',
    summary: "put a label on an item, or edit the project's labels",
    async run(context) {
      const [first, second, ...rest] = context.args

      if (first === 'new') {
        const name = [second, ...rest].join(' ')
        const { result } = await labelUpsert(
          context.workspace,
          name,
          context.flags.get('color') ?? null,
        )
        emit(context, result, () => context.out(`Label ${result.name} (${result.color})`))
        return
      }
      if (first === 'rm' && second !== undefined && context.args.length === 2) {
        const { result } = await labelDelete(context.workspace, second)
        emit(context, result, () => context.out(`Removed the label ${result.name}.`))
        return
      }

      const usage = 'label <ref> add|rm <name>'
      const action = required(context, 1, usage)
      if (action !== 'add' && action !== 'rm') throw new KanboError(`Usage: kanbo ${usage}`)

      const { result } = await itemLabel(
        context.workspace,
        required(context, 0, usage),
        action,
        [second === action ? undefined : second, ...rest].filter(Boolean).join(' ') ||
          rest.join(' '),
      )
      emit(context, result, () =>
        context.out(
          action === 'add'
            ? `${result.item.ref} is labelled ${result.label.name}.`
            : `${result.label.name} taken off ${result.item.ref}.`,
        ),
      )
    },
  },

  labels: {
    group: 'vocabulary',
    usage: 'labels',
    summary: "the project's labels",
    async run(context) {
      const list = context.workspace.project.labels
      emit(context, list, () => {
        for (const label of list) context.out(`  ${pad(label.name, 20)} ${label.color}`)
        if (list.length === 0) context.out('  —')
      })
    },
  },

  field: {
    group: 'vocabulary',
    usage:
      'field <ref> <field> <value>   ·   field new <name> <type> [--options a,b]   ·   field rm <name>',
    summary: 'set a custom field on an item, or define one',
    async run(context) {
      const [first, second, ...rest] = context.args

      if (first === 'new') {
        const name = second ?? ''
        const type = rest[0] ?? ''
        const options = (context.flags.get('options') ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
        const { result } = await fieldUpsert(context.workspace, name, type, options)
        emit(context, result, () => context.out(`Field ${result.name} (${result.type})`))
        return
      }
      if (first === 'rm') {
        const { result } = await fieldDelete(context.workspace, [second, ...rest].join(' '))
        emit(context, result, () => context.out(`Removed the field ${result.name}.`))
        return
      }

      const usage = 'field <ref> <field> <value>'
      const { result } = await itemField(
        context.workspace,
        required(context, 0, usage),
        required(context, 1, usage),
        rest.join(' ') || null,
      )
      emit(context, result, () =>
        context.out(`${result.item.ref}: ${result.field.name} = ${String(result.value ?? '—')}`),
      )
    },
  },

  fields: {
    group: 'vocabulary',
    usage: 'fields',
    summary: "the project's custom fields",
    async run(context) {
      const list = context.workspace.project.fields.toSorted(byOrder)
      emit(context, list, () => {
        for (const field of list) {
          const options = field.options.length > 0 ? `  ${field.options.join(', ')}` : ''
          context.out(`  ${pad(field.name, 20)} ${pad(field.type, 14)}${options}`)
        }
        if (list.length === 0) context.out('  —')
      })
    },
  },

  // -------------------------------------------------------------- content

  comment: {
    group: 'content',
    usage: 'comment <ref> [text|-]   ·   comment rm <id>',
    summary: 'say something on a card',
    async run(context) {
      if (context.args[0] === 'rm') {
        const { result } = await commentDelete(
          context.workspace,
          required(context, 1, 'comment rm <id>'),
        )
        emit(context, result, () => context.out('Comment removed.'))
        return
      }

      const ref = required(context, 0, 'comment <ref> [text|-]')
      const rest = context.args.slice(1).join(' ')
      const body = rest === '-' || rest === '' ? await readStdin() : rest

      const { result } = await itemComment(context.workspace, ref, body)
      emit(context, result, () => context.out(`Commented on ${result.item.ref}.`))
    },
  },

  history: {
    group: 'content',
    usage: 'history <ref>',
    summary: 'what happened to an item, read from the log',
    async run(context) {
      const lines = history(context.workspace, required(context, 0, 'history <ref>'))
      emit(context, lines, () => {
        for (const line of lines) context.out(`  ${describeChange(line)}`)
        if (lines.length === 0) context.out('  —')
      })
    },
  },

  // --------------------------------------------------------------- people

  people: {
    group: 'people',
    usage: 'people',
    summary: 'who is carrying what, read off the board',
    async run(context) {
      const rows = people(context.workspace, context.now)
      emit(context, rows, () => {
        for (const row of rows) {
          const oldest = row.oldest ? `  oldest ${row.oldest.days}d` : ''
          context.out(
            `  ${pad(row.name, 20)} open ${pad(String(row.open.length), 4)} pts ${pad(String(row.points), 5)} blocked ${row.blocked.length}${oldest}`,
          )
        }
        if (rows.length === 0) context.out('  —')
      })
    },
  },

  person: {
    group: 'people',
    usage: 'person add|set <name> [--name x] [--handle @x]   ·   person rm <name>',
    summary: 'add someone, give them a forge handle, or remove them',
    async run(context) {
      const [action, ...rest] = context.args
      const name = rest.join(' ')

      if (action === 'rm') {
        const { result } = await personDelete(context.workspace, name)
        emit(context, result, () => context.out(`Removed ${result.name}.`))
        return
      }
      if (action !== 'add' && action !== 'set') throw new KanboError(`Usage: kanbo ${this.usage}`)

      const patch: { name?: string; handle?: string | null } = {}
      if (context.flags.has('name')) patch.name = text(context.flags, 'name')
      if (context.flags.has('handle')) patch.handle = clearable(context.flags, 'handle')

      const { result } = await personUpsert(context.workspace, name, patch)
      emit(context, result, () =>
        context.out(`${result.name}${result.handle ? ` (@${result.handle})` : ''}`),
      )
    },
  },

  me: {
    group: 'people',
    usage: 'me [name|--none]',
    summary: 'who you are here, for assignee:@me',
    async run(context) {
      const wanted = context.args.join(' ').trim()

      if (wanted === '') {
        const me = whoAmI(context.workspace)
        emit(context, me, () =>
          context.out(
            me
              ? `You are ${me.name}${me.handle ? ` (${me.handle})` : ''}.`
              : 'Nobody claimed on this machine.',
          ),
        )
        return
      }

      if (wanted === '--none' || context.flags.has('none')) {
        await claimMe(context.workspace, null)
        emit(context, null, () => context.out('Nobody claimed on this machine.'))
        return
      }

      const { result } = await claimMe(context.workspace, wanted)
      emit(context, result, () => context.out(`You are ${result!.name}.`))
    },
  },

  // -------------------------------------------------------------- sprints

  sprints: {
    group: 'sprints',
    usage: 'sprints',
    summary: 'every sprint, with its dates',
    async run(context) {
      const list = context.workspace.project.iterations.toSorted(byOrder)
      emit(context, list, () => {
        for (const sprint of list) {
          const capacity = sprint.capacity === null ? '' : `  capacity ${sprint.capacity}`
          context.out(`  ${pad(sprint.name, 20)} ${sprint.startsAt} → ${sprint.endsAt}${capacity}`)
        }
        if (list.length === 0) context.out('  —')
      })
    },
  },

  sprint: {
    group: 'sprints',
    usage:
      'sprint new|set <name> [--start --end --goal --capacity]   ·   sprint show|close|rm <name>',
    summary: 'plan a sprint, look at one, or close it',
    async run(context) {
      const [action, ...rest] = context.args
      const name = rest.join(' ')
      const { flags } = context

      switch (action) {
        case 'new':
        case 'set': {
          const patch: Parameters<typeof sprintUpsert>[2] = {}
          if (flags.has('name')) patch.name = text(flags, 'name')
          if (flags.has('goal')) patch.goal = text(flags, 'goal')
          if (flags.has('start')) patch.startsAt = text(flags, 'start')
          if (flags.has('end')) patch.endsAt = text(flags, 'end')
          if (flags.has('capacity')) patch.capacity = flags.number('capacity') ?? null

          const { result } = await sprintUpsert(context.workspace, name, patch, context.now)
          emit(context, result, () =>
            context.out(`${result.name}  ${result.startsAt} → ${result.endsAt}`),
          )
          return
        }

        case 'show': {
          const report = sprintReport(context.workspace, name || 'current', context.now)
          emit(context, report, () => {
            context.out(
              `${report.sprint.name}  ${report.sprint.startsAt} → ${report.sprint.endsAt}`,
            )
            if (report.sprint.goal) context.out(`  goal      ${report.sprint.goal}`)
            context.out(`  points    ${report.done} done of ${report.committed} committed`)
            context.out(`  items     ${report.items.length}`)
            if (report.unestimated > 0) {
              context.out(
                `  unestimated ${report.unestimated} — they count as zero, not as a guess`,
              )
            }
            context.out('')
            context.out('  day         remaining  ideal  scope')
            for (const point of report.burndown) {
              // The domain marks days it will not draw with NaN, because a
              // burndown that projects the remaining line forward is asserting
              // something nobody can know. A dash says that; "NaN" says the
              // arithmetic went wrong.
              const remaining = Number.isNaN(point.remaining) ? '—' : String(point.remaining)
              context.out(
                `  ${point.day}  ${pad(remaining, 9)}  ${pad(point.ideal.toFixed(1), 5)}  ${point.scopeChange}`,
              )
            }
          })
          return
        }

        case 'close': {
          const into = flags.has('backlog') ? null : (flags.get('into') ?? null)
          const { result } = await sprintClose(context.workspace, name, into, context.now)
          emit(context, result, () =>
            context.out(
              `Closed ${result.sprint.name}. ${result.carried.length} unfinished item(s) went to ${result.into?.name ?? 'the backlog'}.`,
            ),
          )
          return
        }

        case 'rm': {
          const { result } = await sprintDelete(context.workspace, name, context.now)
          emit(context, result, () =>
            context.out(`Removed ${result.sprint.name}; ${result.released} item(s) released.`),
          )
          return
        }

        default:
          throw new KanboError(`Usage: kanbo ${this.usage}`)
      }
    },
  },

  velocity: {
    group: 'sprints',
    usage: 'velocity',
    summary: 'points completed per sprint, and the recent average',
    async run(context) {
      const data = velocities(context.workspace, context.now)
      emit(context, data, () => {
        for (const entry of data.sprints) {
          context.out(`  ${pad(entry.name, 20)} ${entry.completed} of ${entry.committed}`)
        }
        if (data.sprints.length === 0) context.out('  —')
        context.out(`  average over the last three: ${data.average ?? '—'}`)
      })
    },
  },

  // ------------------------------------------------------------- releases

  milestones: {
    group: 'releases',
    usage: 'milestones',
    summary: 'releases, and how far along each is',
    async run(context) {
      const rows = releases(context.workspace)
      emit(context, rows, () => {
        for (const row of rows) {
          context.out(
            `  ${pad(row.milestone.name, 20)} ${row.done}/${row.total} items  ${row.donePoints}/${row.points} pts  due ${row.milestone.dueOn ?? '—'}`,
          )
        }
        if (rows.length === 0) context.out('  —')
      })
    },
  },

  milestone: {
    group: 'releases',
    usage:
      'milestone new|set <name> [--due 2026-09-01] [--description x]   ·   milestone rm <name>',
    summary: 'plan a release',
    async run(context) {
      const [action, ...rest] = context.args
      const name = rest.join(' ')

      if (action === 'rm') {
        const { result } = await milestoneDelete(context.workspace, name)
        emit(context, result, () =>
          context.out(`Removed ${result.milestone.name}; ${result.released} item(s) released.`),
        )
        return
      }
      if (action !== 'new' && action !== 'set') throw new KanboError(`Usage: kanbo ${this.usage}`)

      const patch: { name?: string; description?: string; dueOn?: string | null } = {}
      if (context.flags.has('name')) patch.name = text(context.flags, 'name')
      if (context.flags.has('description')) patch.description = text(context.flags, 'description')
      if (context.flags.has('due')) patch.dueOn = clearable(context.flags, 'due')

      const { result } = await milestoneUpsert(context.workspace, name, patch)
      emit(context, result, () => context.out(`${result.name}  due ${result.dueOn ?? '—'}`))
    },
  },

  release: {
    group: 'releases',
    usage: 'release notes [--release x | --sprint x | --days 14]',
    summary: 'release notes generated from what actually shipped',
    async run(context) {
      if (context.args[0] !== 'notes') throw new KanboError(`Usage: kanbo ${this.usage}`)

      const options: { release?: string; sprint?: string; days?: number } = {}
      if (context.flags.has('release')) options.release = text(context.flags, 'release')
      if (context.flags.has('sprint')) options.sprint = text(context.flags, 'sprint')
      if (context.flags.has('days')) options.days = context.flags.number('days') ?? 14

      const markdown = releaseNotes(context.workspace, options, context.now)
      emit(context, { markdown }, () =>
        context.out(
          markdown === ''
            ? 'Nothing shipped in that window. A release note claiming a release that did not happen is worse than no note.'
            : markdown,
        ),
      )
    },
  },

  roadmap: {
    group: 'releases',
    usage: 'roadmap',
    summary: 'what is dated, in order, with what blocks it',
    async run(context) {
      const bars = roadmap(context.workspace, context.now)
      emit(context, bars, () => {
        for (const bar of bars) {
          const blocked = bar.blockedBy.length > 0 ? `  blocked by ${bar.blockedBy.join(', ')}` : ''
          const overdue = bar.overdue ? '  overdue' : ''
          context.out(
            `  ${bar.startsOn ?? '          '} → ${bar.endsOn}  ${pad(bar.item.ref, 10)} ${bar.item.title}${blocked}${overdue}`,
          )
        }
        if (bars.length === 0) {
          context.out('  — nothing has dates. An item with no dates gets no bar.')
        }
      })
    },
  },

  // -------------------------------------------------------------- metrics

  metrics: {
    group: 'metrics',
    usage: 'metrics [--days 30]',
    summary: 'cycle time, aging work, throughput, cumulative flow',
    async run(context) {
      const data = metrics(context.workspace, context.now, context.flags.number('days') ?? 30)
      emit(context, data, () => {
        const day = (value: number | null) =>
          value === null ? '—' : `${Math.round((value / 86_400_000) * 10) / 10}d`

        context.out('cycle time')
        context.out(
          `  p50 ${day(data.cycle.p50)}   p85 ${day(data.cycle.p85)}   p95 ${day(data.cycle.p95)}`,
        )
        context.out(`  from ${data.cycle.count} finished item(s)`)

        context.out('')
        context.out('aging work in progress')
        for (const row of data.aging.slice(0, 10)) {
          context.out(`  ${pad(row.item.ref, 10)} ${pad(String(row.days), 6)} ${row.item.title}`)
        }
        if (data.aging.length === 0) context.out('  —')

        context.out('')
        context.out('cumulative flow')
        context.out('  day         todo  doing  done')
        for (const entry of data.flow) {
          context.out(
            `  ${entry.day}  ${pad(String(entry.todo), 4)}  ${pad(String(entry.inProgress), 5)}  ${entry.done}`,
          )
        }
      })
    },
  },

  search: {
    group: 'metrics',
    usage: 'search <query>',
    summary: 'the same query language the palette and the filter run',
    async run(context) {
      const found = find(context.workspace, context.args.join(' '), context.now)
      emit(context, found, () => {
        if (found.length === 0) context.out('Nothing matched.')
        for (const { item, status } of found) {
          context.out(`${pad(item.ref, 10)} ${pad(status?.name ?? '', 12)} ${item.title}`)
        }
      })
    },
  },

  // ---------------------------------------------------------- portability

  export: {
    group: 'portability',
    usage: 'export [--csv]',
    summary: 'the operation log, or a flat CSV',
    async run(context) {
      context.out(
        context.flags.has('csv') || context.args[0] === '--csv'
          ? exportCsv(context.workspace.project)
          : exportJson(context.workspace.log, context.now),
      )
    },
  },

  import: {
    group: 'portability',
    usage: 'import',
    summary: 'merge an export from stdin',
    async run(context) {
      const { result } = await importOperations(context.workspace, await readStdin())
      emit(context, result, () => context.out(`Merged ${result.added} new operations.`))
    },
  },
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * One history entry as a sentence.
 *
 * The browser builds its own from the same values, with icons and relative
 * times it can afford and a terminal cannot. What is shared is the structure,
 * not the prose — which is why `@kanbo/workspace` hands over resolved names and
 * leaves the wording to whoever is doing the printing.
 */
function describeChange(line: ReturnType<typeof history>[number]): string {
  const { change } = line.entry
  const who = line.author ? ` (${line.author})` : ''

  switch (change.kind) {
    case 'created':
      return `created${who}`
    case 'deleted':
      return `deleted${who}`
    case 'reordered':
      return `reordered${who}`
    case 'commented':
      return `commented${who}`
    case 'moved':
      return line.from ? `moved ${line.from} → ${line.to}${who}` : `moved to ${line.to}${who}`
    case 'field': {
      if (change.field === 'description') return `description edited${who}`
      // An id resolved to a name where the workspace could resolve one.
      const from = line.fromNames ? names(line.fromNames) : short(change.from)
      const to = line.toNames ? names(line.toNames) : short(change.to)
      return `${change.field}: ${from} → ${to}${who}`
    }
    case 'linked':
      return `linked ${change.linkType} ${line.target ?? ''}${who}`.replace('  ', ' ')
    case 'unlinked':
      return `unlinked ${change.linkType} ${line.target ?? ''}${who}`.replace('  ', ' ')
    case 'project':
      return `project ${change.field} changed${who}`
    case 'other':
      return `${change.operation}${who}`
  }
}

function short(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'nothing'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'nothing'
    return value.length === 1 ? '1 entry' : `${value.length} entries`
  }
  const text = String(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

function names(resolved: readonly string[]): string {
  return resolved.length === 0 ? 'nothing' : resolved.join(', ')
}

const GROUP_TITLES: Record<Group, string> = {
  project: 'Project',
  columns: 'Board',
  items: 'Items',
  relations: 'Relations',
  content: 'Content',
  vocabulary: 'Labels and fields',
  people: 'People',
  sprints: 'Sprints',
  releases: 'Releases and roadmap',
  metrics: 'Metrics',
  portability: 'Portability',
}

/** The help, generated from the table above so it cannot describe a command that is gone. */
export function helpText(root: string): string {
  const lines = ['kanbo — project management from the terminal', '']

  for (const [group, title] of Object.entries(GROUP_TITLES) as [Group, string][]) {
    const entries = Object.values(COMMANDS).filter((command) => command.group === group)
    if (entries.length === 0) continue

    lines.push(`${title}`)
    for (const command of entries) {
      lines.push(`  ${command.usage}`)
      lines.push(`      ${command.summary}`)
    }
    lines.push('')
  }

  lines.push(`Add --json to anything that reads, for machine-readable output.`)
  lines.push(`This project lives in ${root}. Set KANBO_HOME to work on another.`)
  return lines.join('\n')
}

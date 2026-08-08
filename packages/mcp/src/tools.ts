import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import {
  KanboError,
  type Workspace,
  board,
  columnAdd,
  columnDelete,
  columnSet,
  columns,
  find,
  history,
  importOperations,
  init,
  itemComment,
  itemCreate,
  itemDelete,
  itemDetail,
  itemLink,
  itemMove,
  itemUpdate,
  metrics,
  milestoneDelete,
  milestoneUpsert,
  people,
  personDelete,
  personUpsert,
  releaseNotes,
  releases,
  roadmap,
  sprintClose,
  sprintDelete,
  sprintReport,
  sprintUpsert,
  summary,
  syncNow,
  velocities,
} from '@kanbo/workspace'
import { exportJson } from '@kanbo/core'

/**
 * Kanbo as tools an agent can call.
 *
 * Every one of these is a call into `@kanbo/workspace` — the same functions
 * `kanbo` runs from a terminal, which are the same `@kanbo/core` the board runs
 * in a browser. Nothing about a project is decided here. If it were, there
 * would now be three implementations of "what closing a sprint means" and no
 * way to know which of them a team was actually using.
 *
 * What *is* decided here is the shape of the conversation: which arguments a
 * model may pass, what comes back, and which calls a client should stop and ask
 * about first.
 */
export type ToolContext = {
  /** Re-read from disk on every call: a terminal may have written in between. */
  open(): Promise<Workspace>
  now(): number
}

/**
 * Structured JSON, always.
 *
 * A model is better served by values than by the aligned columns a person
 * reads, and asking one to parse a table back into fields is asking it to
 * guess. The CLI renders; this does not.
 */
function reply(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

/**
 * A refusal a model can act on.
 *
 * `isError` rather than a thrown exception, because "no column called Shipped,
 * here are the five that exist" is information — the next call can be right.
 * A stack trace is not.
 */
function refuse(error: unknown) {
  if (error instanceof KanboError) {
    const candidates = error.candidates.length > 0 ? `\n${error.candidates.join('\n')}` : ''
    return { isError: true, content: [{ type: 'text' as const, text: error.message + candidates }] }
  }
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
    ],
  }
}

/** Reads nothing but the store, and changes nothing in it. */
const READS: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
/** Writes to the store. A client should confirm. */
const WRITES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
}
/** Removes something. A client should confirm harder. */
const REMOVES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
}

const ref = z.string().describe('An item reference like APL-12, or its id.')

/** The fields of a card, in the one spelling both front-ends use. */
const patchShape = {
  title: z.string().optional(),
  description: z.string().optional().describe('Markdown.'),
  type: z.enum(['epic', 'story', 'task', 'bug', 'spike', 'chore']).optional(),
  priority: z.enum(['p0', 'p1', 'p2', 'p3', 'p4']).optional(),
  points: z.union([z.number(), z.literal('none')]).optional(),
  due: z.string().optional().describe('An ISO date like 2026-09-01, or "none".'),
  sprint: z.string().optional().describe('A sprint name, "current", or "none".'),
  release: z.string().optional().describe('A release name, or "none".'),
  parent: z.string().optional().describe('A reference to nest under, or "none".'),
  labels: z.array(z.string()).optional().describe('Replaces the labels. Unknown ones are created.'),
  assignees: z
    .array(z.string())
    .optional()
    .describe('Replaces the assignees, by name. Unknown people are created.'),
  archived: z.boolean().optional(),
}

export function registerTools(server: McpServer, context: ToolContext): readonly string[] {
  const names: string[] = []

  const tool = (
    name: string,
    config: {
      title: string
      description: string
      inputSchema?: z.ZodRawShape
      annotations: ToolAnnotations
    },
    run: (args: never, workspace: Workspace) => Promise<unknown> | unknown,
  ) => {
    names.push(name)
    server.registerTool(
      name,
      config as never,
      (async (args: never) => {
        try {
          return reply(await run(args, await context.open()))
        } catch (error) {
          return refuse(error)
        }
      }) as never,
    )
  }

  // ------------------------------------------------------------- reading

  tool(
    'kanbo_status',
    {
      title: 'Project status',
      description:
        'The project name, how many items and operations it holds, and where the store is on disk. Call this first when you do not know whether a project exists here.',
      annotations: READS,
    },
    (_args, workspace) => summary(workspace),
  )

  tool(
    'kanbo_board',
    {
      title: 'The board',
      description: 'Every column, in order, with the items in it.',
      annotations: READS,
    },
    (_args, workspace) => ({
      columns: columns(workspace.project),
      board: board(workspace.project),
    }),
  )

  tool(
    'kanbo_search',
    {
      title: 'Search',
      description:
        'The project query language, the same one the board filter and the command palette run. Qualifiers: status, type, priority, assignee (or @me), label, sprint (a name, current, or none), milestone, parent, is (blocked|open|closed|done|started|overdue|archived), has (estimate|assignee|due|parent), points (3, >3, <=8), due (today, a date, <2026-09-01), ref. A leading - negates. An empty query returns everything.',
      inputSchema: { query: z.string() },
      annotations: READS,
    },
    (args: { query: string }, workspace) =>
      find(workspace, args.query, context.now()).map(({ item, status }) => ({
        ref: item.ref,
        title: item.title,
        status: status?.name ?? null,
        type: item.type,
        priority: item.priority,
        points: item.estimate,
      })),
  )

  tool(
    'kanbo_item',
    {
      title: 'One card in full',
      description:
        'Everything on a card: fields, labels, people, links, children, comments, and its history. Read this before changing a card, so you can tell the user what it currently says.',
      inputSchema: { ref },
      annotations: READS,
    },
    (args: { ref: string }, workspace) => ({
      ...itemDetail(workspace, args.ref, context.now()),
      history: history(workspace, args.ref),
    }),
  )

  tool(
    'kanbo_people',
    {
      title: 'Who is carrying what',
      description:
        'Open work, points, what is blocked and the oldest thing in flight, per person. Read off the board rather than recorded anywhere.',
      annotations: READS,
    },
    (_args, workspace) => people(workspace, context.now()),
  )

  tool(
    'kanbo_sprints',
    {
      title: 'Sprints',
      description:
        'Every sprint with its dates, plus a report on one of them — points done against committed, and the burndown. Days after today come back as NaN on purpose: the future is not drawn.',
      inputSchema: {
        sprint: z.string().optional().describe('A name or "current". Omit to list them all.'),
      },
      annotations: READS,
    },
    (args: { sprint?: string }, workspace) => {
      if (args.sprint === undefined) {
        return {
          sprints: workspace.project.iterations,
          velocity: velocities(workspace, context.now()),
        }
      }
      return sprintReport(workspace, args.sprint, context.now())
    },
  )

  tool(
    'kanbo_releases',
    {
      title: 'Releases',
      description:
        'Milestones and how far along each is, and release notes generated from what actually shipped.',
      inputSchema: {
        notes: z.boolean().optional().describe('Also generate release notes.'),
        release: z.string().optional(),
        sprint: z.string().optional(),
        days: z
          .number()
          .optional()
          .describe('A window in days, when no release or sprint is named.'),
      },
      annotations: READS,
    },
    (args: { notes?: boolean; release?: string; sprint?: string; days?: number }, workspace) => ({
      releases: releases(workspace),
      notes: args.notes
        ? releaseNotes(
            workspace,
            {
              ...(args.release === undefined ? {} : { release: args.release }),
              ...(args.sprint === undefined ? {} : { sprint: args.sprint }),
              ...(args.days === undefined ? {} : { days: args.days }),
            },
            context.now(),
          )
        : undefined,
    }),
  )

  tool(
    'kanbo_roadmap',
    {
      title: 'Roadmap',
      description:
        'Dated work in order, with what blocks it. An item with no dates has no bar and does not appear — a roadmap that invents a schedule is the most confident kind of wrong.',
      annotations: READS,
    },
    (_args, workspace) => roadmap(workspace, context.now()),
  )

  tool(
    'kanbo_metrics',
    {
      title: 'Flow metrics',
      description:
        'Cycle time as percentiles rather than an average, aging work in progress, throughput, and cumulative flow. All derived from the log the board is built from.',
      inputSchema: { days: z.number().optional().describe('Window, default 30.') },
      annotations: READS,
    },
    (args: { days?: number }, workspace) => metrics(workspace, context.now(), args.days ?? 30),
  )

  tool(
    'kanbo_export',
    {
      title: 'Export',
      description:
        'The whole operation log as JSON. This is the project: replaying it elsewhere rebuilds it exactly.',
      annotations: READS,
    },
    (_args, workspace) => JSON.parse(exportJson(workspace.log, context.now())),
  )

  // ------------------------------------------------------------- writing

  tool(
    'kanbo_init',
    {
      title: 'Create a project',
      description:
        'Start a project in this store. Refuses if one is already here — check kanbo_status first.',
      inputSchema: {
        name: z.string(),
        key: z
          .string()
          .optional()
          .describe('The reference prefix, like APL. Defaults from the name.'),
      },
      annotations: WRITES,
    },
    async (args: { name: string; key?: string }, workspace) =>
      (await init(workspace, args.name, args.key ?? null)).result,
  )

  tool(
    'kanbo_item_create',
    {
      title: 'Add an item',
      description:
        'Create a card. It lands at the top of the first column unless you say otherwise.',
      // `title` is required here and optional everywhere else, so it replaces
      // the one in the shared shape rather than sitting beside it.
      inputSchema: {
        ...patchShape,
        title: z.string(),
        status: z.string().optional().describe('The column to land in. Defaults to the first.'),
      },
      annotations: WRITES,
    },
    async (args: { title: string; status?: string } & Record<string, unknown>, workspace) => {
      const created = await itemCreate(workspace, { title: args.title })
      let latest = created.workspace

      const { title: _title, status, ...rest } = args
      if (Object.keys(rest).length > 0) {
        latest = (await itemUpdate(latest, created.result.ref, rest, context.now())).workspace
      }
      if (status !== undefined) await itemMove(latest, created.result.ref, status)

      return created.result
    },
  )

  tool(
    'kanbo_item_update',
    {
      title: 'Change an item',
      description:
        'Set any field on a card. Only the fields you pass change; "none" clears an optional one.',
      inputSchema: { ref, ...patchShape },
      annotations: WRITES,
    },
    async (args: { ref: string } & Record<string, unknown>, workspace) => {
      const { ref: which, ...rest } = args
      return (await itemUpdate(workspace, which, rest, context.now())).result
    },
  )

  tool(
    'kanbo_item_move',
    {
      title: 'Move an item',
      description:
        'Move a card to a column. In Kanbo "closed" is a column with the done category, so this is also how work is finished.',
      inputSchema: {
        ref,
        column: z.string(),
        index: z.number().optional().describe('Position in the column, from 0.'),
      },
      annotations: WRITES,
    },
    async (args: { ref: string; column: string; index?: number }, workspace) =>
      (await itemMove(workspace, args.ref, args.column, args.index ?? 0)).result,
  )

  tool(
    'kanbo_item_link',
    {
      title: 'Link two items',
      description:
        'Link two cards. The other end is written too, so the pair reads the same both ways. A blocking link that would close a loop is refused.',
      inputSchema: {
        ref,
        type: z.enum(['blocks', 'blocked-by', 'relates-to', 'duplicates']),
        target: z.string(),
      },
      annotations: WRITES,
    },
    async (args: { ref: string; type: string; target: string }, workspace) =>
      (await itemLink(workspace, args.ref, args.type, args.target)).result,
  )

  tool(
    'kanbo_item_comment',
    {
      title: 'Comment on an item',
      description: 'Add a comment. It is attributed to whoever this machine has claimed as "me".',
      inputSchema: { ref, body: z.string() },
      annotations: WRITES,
    },
    async (args: { ref: string; body: string }, workspace) =>
      (await itemComment(workspace, args.ref, args.body)).result,
  )

  tool(
    'kanbo_column_upsert',
    {
      title: 'Add or change a column',
      description:
        'Create a column, or change one. The category is what the metrics read, not the name — so a column called "Shipped" with category done closes work.',
      inputSchema: {
        name: z.string(),
        category: z.enum(['todo', 'in-progress', 'done']).optional(),
        rename: z.string().optional(),
        wipLimit: z.number().nullable().optional(),
        color: z.string().nullable().optional(),
      },
      annotations: WRITES,
    },
    async (
      args: {
        name: string
        category?: 'todo' | 'in-progress' | 'done'
        rename?: string
        wipLimit?: number | null
        color?: string | null
      },
      workspace,
    ) => {
      const exists = workspace.project.statuses.some(
        (status) => status.name.toLowerCase() === args.name.toLowerCase(),
      )
      if (!exists) {
        return (await columnAdd(workspace, args.name, args.category ?? 'in-progress')).result
      }
      return (
        await columnSet(workspace, args.name, {
          ...(args.rename === undefined ? {} : { name: args.rename }),
          ...(args.category === undefined ? {} : { category: args.category }),
          ...(args.wipLimit === undefined ? {} : { wipLimit: args.wipLimit }),
          ...(args.color === undefined ? {} : { color: args.color }),
        })
      ).result
    },
  )

  tool(
    'kanbo_sprint_upsert',
    {
      title: 'Plan a sprint',
      description: 'Create or change a sprint. A new one needs a start and an end.',
      inputSchema: {
        name: z.string(),
        start: z.string().optional().describe('ISO date.'),
        end: z.string().optional().describe('ISO date.'),
        goal: z.string().optional(),
        capacity: z.number().nullable().optional(),
        rename: z.string().optional(),
      },
      annotations: WRITES,
    },
    async (
      args: {
        name: string
        start?: string
        end?: string
        goal?: string
        capacity?: number | null
        rename?: string
      },
      workspace,
    ) =>
      (
        await sprintUpsert(
          workspace,
          args.name,
          {
            ...(args.rename === undefined ? {} : { name: args.rename }),
            ...(args.start === undefined ? {} : { startsAt: args.start }),
            ...(args.end === undefined ? {} : { endsAt: args.end }),
            ...(args.goal === undefined ? {} : { goal: args.goal }),
            ...(args.capacity === undefined ? {} : { capacity: args.capacity }),
          },
          context.now(),
        )
      ).result,
  )

  tool(
    'kanbo_sprint_close',
    {
      title: 'Close a sprint',
      description:
        'Close a sprint and say where unfinished work goes. Leaving it attached to a sprint that is over is how a burndown starts lying.',
      inputSchema: {
        name: z.string(),
        carryTo: z
          .string()
          .nullable()
          .describe('A sprint name to carry unfinished work into, or null for the backlog.'),
      },
      annotations: WRITES,
    },
    async (args: { name: string; carryTo: string | null }, workspace) => {
      const { result } = await sprintClose(workspace, args.name, args.carryTo, context.now())
      return {
        sprint: result.sprint.name,
        carried: result.carried.map((item) => item.ref),
        into: result.into?.name ?? null,
      }
    },
  )

  tool(
    'kanbo_milestone_upsert',
    {
      title: 'Plan a release',
      description: 'Create or change a milestone.',
      inputSchema: {
        name: z.string(),
        due: z.string().nullable().optional().describe('ISO date, or null.'),
        description: z.string().optional(),
        rename: z.string().optional(),
      },
      annotations: WRITES,
    },
    async (
      args: { name: string; due?: string | null; description?: string; rename?: string },
      workspace,
    ) =>
      (
        await milestoneUpsert(workspace, args.name, {
          ...(args.rename === undefined ? {} : { name: args.rename }),
          ...(args.due === undefined ? {} : { dueOn: args.due }),
          ...(args.description === undefined ? {} : { description: args.description }),
        })
      ).result,
  )

  tool(
    'kanbo_person_upsert',
    {
      title: 'Add or change a person',
      description:
        'Add someone, or set their forge handle — the name their forge spells them with, which is what makes an imported issue land on the right plate.',
      inputSchema: {
        name: z.string(),
        handle: z.string().nullable().optional(),
        rename: z.string().optional(),
      },
      annotations: WRITES,
    },
    async (args: { name: string; handle?: string | null; rename?: string }, workspace) =>
      (
        await personUpsert(workspace, args.name, {
          ...(args.rename === undefined ? {} : { name: args.rename }),
          ...(args.handle === undefined ? {} : { handle: args.handle }),
        })
      ).result,
  )

  tool(
    'kanbo_import',
    {
      title: 'Import',
      description:
        'Merge an exported log into this store. The merge is a union, so importing the same export twice changes nothing.',
      inputSchema: { json: z.string().describe('The contents of a Kanbo export.') },
      annotations: { ...WRITES, idempotentHint: true },
    },
    async (args: { json: string }, workspace) =>
      (await importOperations(workspace, args.json)).result,
  )

  tool(
    'kanbo_sync',
    {
      title: 'Sync with the repository',
      description:
        'Pull, merge and push through the configured forge. This is the only tool here that touches the network, and it reaches exactly one host: the one configured in this store.',
      annotations: { ...WRITES, openWorldHint: true },
    },
    async (_args, workspace) => (await syncNow(workspace)).result,
  )

  // ---------------------------------------------------------- destroying

  tool(
    'kanbo_item_delete',
    {
      title: 'Delete an item',
      description:
        'Delete a card. Its children are released rather than deleted, and the deletion itself stays in the history.',
      inputSchema: { ref },
      annotations: REMOVES,
    },
    async (args: { ref: string }, workspace) => {
      const { result } = await itemDelete(workspace, args.ref)
      return { ref: result.item.ref, title: result.item.title, childrenReleased: result.children }
    },
  )

  tool(
    'kanbo_column_delete',
    {
      title: 'Delete a column',
      description:
        'Remove a column, saying which column inherits its cards. Items are never orphaned, and choosing silently where a team’s work goes is not a decision a tool should make.',
      inputSchema: { name: z.string(), into: z.string() },
      annotations: REMOVES,
    },
    async (args: { name: string; into: string }, workspace) => {
      const { result } = await columnDelete(workspace, args.name, args.into)
      return { removed: result.status.name, into: result.into.name, moved: result.moved }
    },
  )

  tool(
    'kanbo_sprint_delete',
    {
      title: 'Delete a sprint',
      description: 'Remove a sprint. Its items stay, with no sprint.',
      inputSchema: { name: z.string() },
      annotations: REMOVES,
    },
    async (args: { name: string }, workspace) => {
      const { result } = await sprintDelete(workspace, args.name, context.now())
      return { removed: result.sprint.name, released: result.released }
    },
  )

  tool(
    'kanbo_milestone_delete',
    {
      title: 'Delete a release',
      description: 'Remove a milestone. Its items stay, with no release.',
      inputSchema: { name: z.string() },
      annotations: REMOVES,
    },
    async (args: { name: string }, workspace) => {
      const { result } = await milestoneDelete(workspace, args.name)
      return { removed: result.milestone.name, released: result.released }
    },
  )

  tool(
    'kanbo_person_delete',
    {
      title: 'Remove a person',
      description: 'Take someone off the project. Their work stays, unassigned.',
      inputSchema: { name: z.string() },
      annotations: REMOVES,
    },
    async (args: { name: string }, workspace) => (await personDelete(workspace, args.name)).result,
  )

  return names
}

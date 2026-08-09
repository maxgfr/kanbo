/**
 * "The terminal can do what the site can do", checked rather than claimed.
 *
 * The README says the CLI is evidence rather than convenience. That was true of
 * what it did and quiet about what it did not: for a long time it could emit
 * six of the domain's twenty-two operations, and sprints, releases, links,
 * comments, labels, fields and deletion were reachable only from a browser.
 * Nothing failed, because nothing was checking.
 *
 * So the claim gets a gate. The table below maps every `OperationKind` to the
 * `@kanbo/workspace` action that emits it, and it is typed as a
 * `Record<OperationKind, …>` — which means **adding a kind to the domain stops
 * the build** until somebody says how a terminal reaches it. That is the part
 * that cannot rot: a comment can be forgotten, an exhaustive record cannot.
 *
 * The rest is runtime: every action named here must exist, every command the
 * help offers must be routed, and every routed command must be in the help.
 *
 * Run with `node scripts/check-parity.ts`.
 */
// Imported by path, not by name: a script at the repo root is not inside any
// package, so pnpm's strict layout gives it no `@kanbo/*` to resolve. The
// network guard does the same for the same reason.
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { OperationKind } from '../packages/core/src/index.ts'
import * as workspace from '../packages/workspace/src/index.ts'

import { COMMANDS, helpText } from '../packages/cli/src/commands.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Which action reaches each operation, and which command reaches that action.
 *
 * An entry with an empty `commands` array would be an operation the domain can
 * express and no human can ask for, which is the exact hole this file exists to
 * find — so the check refuses it.
 */
const REACHES: Record<
  OperationKind,
  { readonly actions: readonly string[]; readonly commands: readonly string[] }
> = {
  'project.set': { actions: ['init', 'projectSet'], commands: ['init', 'project'] },

  'item.create': { actions: ['itemCreate'], commands: ['add'] },
  'item.set': {
    actions: ['itemSet', 'itemUpdate', 'itemAssign', 'itemUnassign', 'itemLabel', 'sprintClose'],
    commands: ['set', 'describe', 'assign', 'label', 'parent', 'sprint'],
  },
  'item.move': { actions: ['itemMove'], commands: ['move'] },
  'item.setField': { actions: ['itemField'], commands: ['field'] },
  'item.link': { actions: ['itemLink'], commands: ['link'] },
  'item.unlink': { actions: ['itemUnlink'], commands: ['unlink'] },
  'item.delete': { actions: ['itemDelete'], commands: ['rm'] },

  'status.upsert': { actions: ['columnAdd', 'columnSet', 'columnReorder'], commands: ['column'] },
  'status.delete': { actions: ['columnDelete'], commands: ['column'] },

  'field.upsert': { actions: ['fieldUpsert'], commands: ['field'] },
  'field.delete': { actions: ['fieldDelete'], commands: ['field'] },

  'iteration.upsert': { actions: ['sprintUpsert'], commands: ['sprint'] },
  'iteration.delete': { actions: ['sprintDelete'], commands: ['sprint'] },

  'milestone.upsert': { actions: ['milestoneUpsert'], commands: ['milestone'] },
  'milestone.delete': { actions: ['milestoneDelete'], commands: ['milestone'] },

  'label.upsert': { actions: ['labelUpsert', 'parsePatch'], commands: ['label'] },
  'label.delete': { actions: ['labelDelete'], commands: ['label'] },

  'member.upsert': { actions: ['personUpsert', 'itemAssign'], commands: ['person', 'assign'] },
  'member.delete': { actions: ['personDelete'], commands: ['person'] },

  'comment.upsert': { actions: ['itemComment'], commands: ['comment'] },
  'comment.delete': { actions: ['commentDelete'], commands: ['comment'] },
}

/**
 * Readings the browser offers that a terminal must also be able to print.
 *
 * Not operations — nothing is written — but the other half of parity: a board
 * you can change and cannot look at is not the same tool.
 */
const READINGS: Record<string, { readonly action: string; readonly command: string }> = {
  'the board': { action: 'board', command: 'board' },
  'the columns': { action: 'columns', command: 'columns' },
  'one card in full': { action: 'itemDetail', command: 'show' },
  'the query language': { action: 'find', command: 'search' },
  'an item history': { action: 'history', command: 'history' },
  'who is carrying what': { action: 'people', command: 'people' },
  'a sprint, with its burndown': { action: 'sprintReport', command: 'sprint' },
  velocity: { action: 'velocities', command: 'velocity' },
  'releases and their progress': { action: 'releases', command: 'milestones' },
  'release notes': { action: 'releaseNotes', command: 'release' },
  'the roadmap': { action: 'roadmap', command: 'roadmap' },
  'flow metrics': { action: 'metrics', command: 'metrics' },

  // The two the browser could do and a terminal could not at all, which is
  // where "iso" was furthest from true.
  'an encrypted share': { action: 'shareCreate', command: 'share' },
  'reading a share back': { action: 'shareOpen', command: 'open-share' },
  'repository settings': { action: 'remoteSet', command: 'remote' },
  'the forge token': { action: 'tokenSet', command: 'token' },
  'syncing through a repository': { action: 'syncNow', command: 'sync' },
  'reconciling issues': { action: 'issuesReconcile', command: 'issues' },
  'pull requests on the ticket': { action: 'pullRequests', command: 'prs' },
}

const failures: string[] = []
const checks: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) checks.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const exported = new Set(Object.keys(workspace))
const routed = new Set(Object.keys(COMMANDS))

// ---- every operation the domain can express is reachable from a terminal

const unreachable: string[] = []
const missingAction: string[] = []
const missingCommand: string[] = []

for (const [kind, entry] of Object.entries(REACHES)) {
  if (entry.actions.length === 0 || entry.commands.length === 0) unreachable.push(kind)
  for (const action of entry.actions) {
    if (!exported.has(action)) missingAction.push(`${kind} → ${action}`)
  }
  for (const command of entry.commands) {
    if (!routed.has(command)) missingCommand.push(`${kind} → kanbo ${command}`)
  }
}

check(
  'every operation the domain defines is reachable from a terminal',
  unreachable.length === 0,
  unreachable.join(', '),
)
check(
  'every action the table names is exported by @kanbo/workspace',
  missingAction.length === 0,
  missingAction.join(', '),
)
check(
  'every command the table names is routed by the CLI',
  missingCommand.length === 0,
  missingCommand.join(', '),
)

// ---- and every reading the browser offers

const missingReading = Object.entries(READINGS).filter(
  ([, entry]) => !exported.has(entry.action) || !routed.has(entry.command),
)
check(
  'every reading the browser offers can also be printed',
  missingReading.length === 0,
  missingReading.map(([name]) => name).join(', '),
)

// ---- the help cannot describe a command that is not there, or omit one

const help = helpText('/tmp/kanbo')
const undocumented = [...routed].filter(
  (name) => !help.includes(`  ${COMMANDS[name]!.usage.split(' ')[0]!}`),
)
check(
  'every routed command appears in the help',
  undocumented.length === 0,
  undocumented.join(', '),
)

const usageNames = [...routed].filter((name) => !COMMANDS[name]!.usage.startsWith(name))
check(
  'every command is spelled in its own usage line',
  usageNames.length === 0,
  usageNames.join(', '),
)

// ---- the README's account of the gate matches the gate

/**
 * The list of checks in the README, against the ones `verify` actually runs.
 *
 * This drifted the moment it could: the README said "seven checks" over a list
 * of eight, because the number and the list are two claims about a third thing
 * and nothing compared any of them. A reader counting the bullets was right and
 * the sentence was wrong, which is the worst way round.
 */
const NUMBERS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]

const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const readme = await readFile(join(ROOT, 'README.md'), 'utf8')

const gate = [...(manifest.scripts['verify'] ?? '').matchAll(/pnpm (check:[a-z]+|smoke)\b/g)].map(
  (match) => match[1]!,
)
const described = [...readme.matchAll(/^- \*\*`(check:[a-z]+|smoke)`\*\*/gm)].map(
  (match) => match[1]!,
)

check(
  'the README describes exactly the checks the gate runs',
  gate.join(' ') === described.join(' '),
  `verify: ${gate.join(', ')} | README: ${described.join(', ')}`,
)

check(
  'and counts them correctly in the sentence above the list',
  readme.includes(`then the ${NUMBERS[described.length] ?? '?'} checks below`),
  `the list has ${described.length}`,
)

// ---- the count, printed rather than asserted, so a regression is legible

const kinds = Object.keys(REACHES).length

for (const passed of checks) console.log(`  ✓ ${passed}`)

if (failures.length > 0) {
  console.error(`\n✗ Parity: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  • ${failure}`)
  process.exit(1)
}

console.log(
  `\n✓ Parity: ${kinds} operation kinds and ${Object.keys(READINGS).length} readings, all reachable from ${routed.size} commands.`,
)

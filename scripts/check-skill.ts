/**
 * The skill, checked against the program it describes.
 *
 * Documentation that has drifted is a nuisance to a person and a trap for a
 * model: a human reading "run `kanbo close APL-1`" tries it, sees it fail and
 * looks for the real spelling. A model reads it as fact, calls it, gets an
 * error it did not expect, and starts inventing. So the skill is not allowed to
 * mention a command that does not exist, and it is not allowed to list a set of
 * query qualifiers that is not the set the query language actually accepts.
 *
 * Run with `node scripts/check-skill.ts`.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { QUALIFIERS } from '../packages/core/src/views/search.ts'
import { COMMANDS } from '../packages/cli/src/commands.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = join(ROOT, 'skills/kanbo/SKILL.md')

const failures: string[] = []
const checks: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) checks.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const source = await readFile(SKILL, 'utf8')

// ---- frontmatter, which is the whole of how a skill gets found

const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/)
check('it opens with YAML frontmatter', frontmatter !== null)

const front = frontmatter?.[1] ?? ''
const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim()
const raw = front.match(/^description:\s*([\s\S]*?)(?=\n[a-z-]+:|$)/m)?.[1]?.trim() ?? ''

/**
 * The installer parses this as YAML, and YAML is stricter than it looks.
 *
 * An unquoted scalar containing `: ` is a nested mapping, not a sentence — so a
 * description saying "the tooling itself: the command" is rejected outright and
 * the skill silently does not exist. That is exactly what happened here, and a
 * regex that merely *extracted* the description was happy with it, which is why
 * this check now looks at the quoting rather than at the text.
 */
const quoted = raw.startsWith("'") || raw.startsWith('"')
check(
  'the description is quoted, or contains nothing that needs quoting',
  quoted || !/:\s/.test(raw),
  'an unquoted `: ` makes the frontmatter a nested mapping, and `skills add` skips the file',
)

if (quoted && raw.startsWith("'")) {
  // Inside single quotes the only escape is a doubled apostrophe.
  const inner = raw.slice(1, -1)
  check(
    'apostrophes inside a single-quoted description are doubled',
    !/(^|[^'])'([^']|$)/.test(inner),
    'a lone apostrophe ends the scalar early',
  )
}

const description = quoted ? raw.slice(1, -1).replaceAll("''", "'") : raw

check('it is named for the directory it lives in', name === 'kanbo', String(name))
check(
  'its description says when to reach for it',
  (description ?? '').length > 200,
  `${(description ?? '').length} characters`,
)
// A description that only names the tool never triggers on the task.
check(
  'and describes tasks rather than only the tool',
  /want|ask|"/.test(description ?? ''),
  description?.slice(0, 80),
)

// ---- every command it mentions is a command

const body = source.slice(frontmatter?.[0].length ?? 0)
const routed = new Set(Object.keys(COMMANDS))

/**
 * `kanbo <word>` anywhere in the document, in prose or in a fenced block.
 *
 * `npx kanbo …` counts too, because that is how most readers will run it.
 */
const mentioned = new Set(
  [...body.matchAll(/(?:npx\s+)?kanbo\s+([a-z][a-z-]*)/g)].map((match) => match[1]!),
)

// Words that follow `kanbo` without being commands.
const NOT_COMMANDS = new Set(['help', 'the', 'and', 'is', 'a', 'command'])

const invented = [...mentioned].filter((word) => !routed.has(word) && !NOT_COMMANDS.has(word))
check(
  'every command it mentions exists',
  invented.length === 0,
  invented.map((word) => `kanbo ${word}`).join(', '),
)

// ---- and the qualifier table is the real one

const table = [...body.matchAll(/^\|\s*`([a-z]+)`\s*\|/gm)].map((match) => match[1]!)
const declared = QUALIFIERS.map((entry) => entry.key)

const missing = declared.filter((key) => !table.includes(key))
const extra = table.filter((key) => !declared.includes(key))

check(
  'the query qualifiers it documents are the ones the language accepts',
  missing.length === 0 && extra.length === 0,
  [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    extra.length > 0 ? `invented ${extra.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; '),
)

// ---- the two claims most likely to rot

check(
  'it tells the reader where the store is',
  body.includes('KANBO_HOME'),
  'a skill that does not say which project it is touching is a skill that touches the wrong one',
)
check(
  'it names the commands that should be confirmed first',
  ['rm', 'share', 'sync', 'import'].every((word) => body.includes(word)),
)

for (const passed of checks) console.log(`  ✓ ${passed}`)

if (failures.length > 0) {
  console.error(`\n✗ Skill: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  • ${failure}`)
  process.exit(1)
}

console.log(
  `\n✓ Skill: ${checks.length} checks passed; ${mentioned.size} commands mentioned, all of them real.`,
)

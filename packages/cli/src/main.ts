#!/usr/bin/env node
/**
 * Kanbo from a terminal.
 *
 * The point of this command is not convenience — it is evidence. Every
 * behaviour it offers is `@kanbo/core` driven through `@kanbo/workspace`: the
 * same reducer the board uses, the same merge the sync engine uses, the same
 * query language the command palette uses. Nothing about a project is
 * re-implemented for the terminal, and nothing could be, because the domain has
 * no branch for where it is running.
 *
 * What is left in this file is the only part that is genuinely about a
 * terminal: reading argv, choosing a command, and deciding what to do with an
 * error. The commands themselves are in `commands.ts`, and the MCP server is
 * the same program with a different last step.
 *
 * Run with `node packages/cli/src/main.ts <command>`.
 */
import { KanboError, openWorkspace } from '@kanbo/workspace'
import { ImportError, ProviderError, ShareError } from '@kanbo/core'

import { COMMANDS, helpText } from './commands.ts'
import { parseFlags } from './flags.ts'

/**
 * Errors that are sentences, and errors that are bugs.
 *
 * The domain raises these deliberately, with a message written for whoever is
 * reading — "that passphrase does not open this share" is an answer, not a
 * failure. Anything else is something we did not anticipate, and it keeps its
 * stack trace, because swallowing it would turn a bug into a shrug.
 */
const EXPECTED = [KanboError, ShareError, ImportError, ProviderError]

const [, , name = 'help', ...rest] = process.argv

const workspace = await openWorkspace()
const flags = parseFlags(rest)

function fail(message: string, candidates: readonly string[] = []): never {
  console.error(message)
  for (const candidate of candidates) console.error(`  ${candidate}`)
  process.exit(1)
}

if (name === 'help' || name === '--help' || name === '-h') {
  console.log(helpText(workspace.root))
  process.exit(0)
}

const command = COMMANDS[name]

if (!command) {
  // A typo used to print the help and exit 0, so a broken line in a script
  // passed in silence. Asking for something that does not exist is an error.
  console.error(`There is no "${name}" command.`)
  console.error('')
  console.error(helpText(workspace.root))
  process.exit(1)
}

try {
  await command.run({
    workspace,
    flags,
    args: flags.rest,
    now: Date.now(),
    json: flags.has('json'),
    out: (line) => console.log(line),
  })
} catch (error) {
  if (error instanceof KanboError) fail(error.message, error.candidates)
  if (EXPECTED.some((kind) => error instanceof kind)) fail((error as Error).message)
  throw error
}

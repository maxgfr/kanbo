#!/usr/bin/env node
/**
 * Kanbo, for an agent.
 *
 * The same argument the CLI makes, made once more: this server decides nothing
 * about a project. It opens a store with `@kanbo/workspace` and calls the same
 * actions `kanbo` calls, which call the same `@kanbo/core` the board calls. A
 * third implementation of "what closing a sprint means" would be a third answer
 * a team could get, and no way to know which one they were living in.
 *
 * Two things are specific to this front-end and worth stating.
 *
 * **Nothing but JSON-RPC may reach stdout.** A stray `console.log` corrupts the
 * stream and surfaces as an unexplained disconnect, which is a miserable thing
 * to debug from the other end. Every diagnostic here goes to stderr, and
 * `scripts/check-mcp.ts` asserts that every line the server writes parses as a
 * message.
 *
 * **The store is re-read on every call.** A person at a terminal and an agent
 * through this server are two writers on one directory; holding a project in
 * memory across calls would mean answering from a board that had already moved.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { defaultRoot, openWorkspace } from '@kanbo/workspace'

import { registerTools } from './tools.ts'

/** `--home <dir>`, then `KANBO_HOME`, then `~/.kanbo`. */
function rootFromArgv(argv: readonly string[]): string {
  const at = argv.indexOf('--home')
  const given = at === -1 ? undefined : argv[at + 1]
  return given ?? defaultRoot()
}

const root = rootFromArgv(process.argv.slice(2))

const server = new McpServer(
  { name: 'kanbo', version: '0.2.0' },
  {
    instructions: [
      'Kanbo is a local-first project board. Its whole state is an append-only log of',
      'operations in a directory on this machine; nothing is uploaded, and the same log',
      'drives a browser UI, the `kanbo` command and these tools.',
      '',
      `This server is working on ${root}.`,
      '',
      'Read before you write. kanbo_status says whether a project exists here at all,',
      'kanbo_board and kanbo_search find work, and kanbo_item shows one card in full.',
      'Name the card back to the user before changing it.',
      '',
      'A card is named by its reference — APL-12 — not by an approximate title. When a',
      'name is ambiguous these tools refuse and list the candidates rather than guessing.',
      '',
      'There is no separate "close" flag: finishing work means moving a card to a column',
      'whose category is done. Deleting is rarely what someone means; archiving is',
      'usually closer, and the delete tools say so.',
    ].join('\n'),
  },
)

registerTools(server, {
  open: () => openWorkspace(root),
  now: () => Date.now(),
})

await server.connect(new StdioServerTransport())

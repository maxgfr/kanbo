# kanbo-mcp

The [Kanbo](https://github.com/maxgfr/kanbo) MCP server: a local-first project
board — kanban, sprints, roadmap, flow metrics — as tools an agent can call.

```json
{
  "mcpServers": {
    "kanbo": {
      "command": "npx",
      "args": ["-y", "kanbo-mcp@0.2"],
      "env": { "KANBO_HOME": "/path/to/your/project/.kanbo" }
    }
  }
}
```

Set `KANBO_HOME` (or pass `--home <dir>`). Without it every project shares
`~/.kanbo`, which is rarely what anyone means.

This is the same program as the `kanbo-mcp` bin inside the
[`kanbo`](https://www.npmjs.com/package/kanbo) package — byte for byte, checked
in CI. It exists under its own name because `npx <name>` resolves a _package_
called `<name>`, never a bin inside another one.

## What it exposes

Reads: the board, search in the project's query language, one card in full with
its history, people and their load, sprints and burndown, releases and generated
notes, the roadmap, flow metrics, and the whole log.

Writes: create and change cards, move them between columns, link them, comment,
plan sprints and releases, add people, import a log, and sync with a forge.
Every write is annotated so your client can ask first; the four tools that
remove something are marked destructive, and exactly one — `kanbo_sync` — admits
to touching the network.

Nothing about a project is decided in this server. Every tool calls the same
code the `kanbo` command and the browser UI call.

MIT.

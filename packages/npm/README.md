# kanbo

Local-first project management from your terminal. Kanban, sprints, roadmap and
flow metrics, with a git repository as the only backend — or no backend at all.

```sh
npx kanbo init "Apollo" APL
npx kanbo add "Ship the departure board" --type story --points 5
npx kanbo board
```

There is no server, no account and no database. A project is an append-only log
of operations in a directory on your machine (`~/.kanbo`, or wherever
`KANBO_HOME` points). The same log drives a browser UI at
[maxgfr.github.io/kanbo](https://maxgfr.github.io/kanbo/), the `kanbo` command,
and an MCP server for coding agents.

`kanbo help` lists everything. Anything that reads takes `--json`.

## An agent can drive it

This package also installs `kanbo-mcp`, a Model Context Protocol server over
stdio. For `npx` to resolve it by name, install
[`kanbo-mcp`](https://www.npmjs.com/package/kanbo-mcp) — it is the same program:

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

Pin the version. An agent running a version you cannot name is a bad debugging
position.

## What it is not

Repository mode talks to exactly one host — the forge you configure — and
refuses every other origin. Local mode talks to nobody. Neither is a promise
about our servers, because there are none.

MIT. Source at [github.com/maxgfr/kanbo](https://github.com/maxgfr/kanbo).

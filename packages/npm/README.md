# kanbo-board

Local-first project management from your terminal. Kanban, sprints, roadmap and
flow metrics, with a git repository as the only backend — or no backend at all.

```sh
npx kanbo-board init "Apollo" APL
npx kanbo-board add "Ship the departure board" --type story --points 5
npx kanbo-board board
```

Installed globally (`npm i -g kanbo-board`) the command is just `kanbo`.

There is no server, no account and no database. A project is an append-only log
of operations in a directory on your machine (`~/.kanbo`, or wherever
`KANBO_HOME` points). The same log drives a browser UI at
[maxgfr.github.io/kanbo](https://maxgfr.github.io/kanbo/), the `kanbo` command,
and an MCP server for coding agents.

`kanbo-board help` lists everything. Anything that reads takes `--json`.

## An agent can drive it

The same package installs `kanbo-mcp`, a Model Context Protocol server over
stdio. It lives in this package rather than its own, so `npx` has to be told
which package the command comes from:

```json
{
  "mcpServers": {
    "kanbo": {
      "command": "npx",
      "args": ["-y", "--package=kanbo-board@0.3", "kanbo-mcp"],
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

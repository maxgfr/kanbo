---
name: kanbo
description: 'Use when the user wants to read or change a Kanbo project board from the conversation — "what''s on the board", "what am I working on", "add a ticket for X", "move X to in progress", "assign X to Y", "what''s blocked", "plan a sprint", "how did this sprint go", "what shipped", "release notes", "what''s overdue", "who has too much on". Also covers the terminal tooling itself: `kanbo` the command, `kanbo-mcp` the MCP server, KANBO_HOME, importing and exporting a board, encrypted share links, and syncing a board with a GitHub or GitLab repository. Not for editing Kanbo''s own source code.'
---

# Kanbo from the terminal

Kanbo is a local-first project board — kanban, sprints, roadmap, flow metrics.
A project is an **append-only log of operations** in a directory on this
machine. Nothing is uploaded. The same log drives a browser UI, the `kanbo`
command and an MCP server, and none of the three re-implements the other.

```sh
npx kanbo-board status        # is there a project here at all?
npx kanbo-board board
npx kanbo-board help          # every command; it is generated from the router, so it cannot lie
```

Inside a checkout of the repository, `node packages/cli/src/main.ts …` is the
same program.

## Where the project is

`$KANBO_HOME`, or `~/.kanbo`. One directory per project, so a repository with
its own board usually wants `KANBO_HOME=./.kanbo`.

`kanbo status` prints the resolved path. Run it before anything else when you do
not know what you are pointed at — creating a second project in the wrong
directory is the mistake this prevents.

## How to work

**Read before you write, and say what you found.** `board`, `search`, `show`.
Name the card back to the user — "APL-12, Ship the departure board, currently in
Backlog" — before you change it. Add `--json` to anything that reads.

**A card is a reference, not a title.** `APL-12`. If you only have a phrase,
`search` for it and use the reference you get. Every command that resolves a
name refuses ambiguity and lists the candidates rather than picking; that is
information, so pass it to the user instead of guessing again.

**Nothing overwrites.** Every change appends to the log, so `history <ref>`
always shows what happened, a deleted card's deletion is still recorded, and
`export` replayed into another store rebuilds the project exactly.

**Batch as separate calls.** Three `add` commands read better in a transcript
than one shell loop, and each failure is legible on its own.

## The query language

The same one the browser's filter and command palette run.

```sh
kanbo search "assignee:@me is:blocked"
kanbo search "type:bug priority:p0 -is:closed"
kanbo search "sprint:current points:>3"
kanbo search "due:<2026-09-01 has:assignee"
```

| Qualifier   | Takes                                                         |
| ----------- | ------------------------------------------------------------- |
| `status`    | a column name, or `todo` / `in-progress` / `done`             |
| `type`      | `epic`, `story`, `task`, `bug`, `spike`, `chore`              |
| `priority`  | `p0` to `p4`                                                  |
| `assignee`  | a name, or `@me`                                              |
| `label`     | a label name                                                  |
| `sprint`    | a sprint name, `current`, or `none`                           |
| `milestone` | a milestone name, or `none`                                   |
| `parent`    | a reference like `KAN-4`, or `none`                           |
| `is`        | `blocked`, `open`, `closed`, `started`, `overdue`, `archived` |
| `has`       | `estimate`, `assignee`, `due`, `parent`                       |
| `points`    | a number, or `>3` / `<=8`                                     |
| `due`       | `today`, a date, or `<2026-09-01`                             |

Tokens are ANDed; a leading `-` negates. `@me` only means something once
somebody has run `kanbo me "Their Name"` on this machine — that answer is true
of a machine, not of a board, and is never written into the project.

## Changing things

```sh
kanbo add "Ship the departure board" --type story --points 5 --assignee "Ada Lovelace"
kanbo set APL-12 --priority p1 --sprint current --due 2026-09-01
kanbo describe APL-12 -            # Markdown on stdin
kanbo move APL-12 "In Progress"
kanbo link APL-12 blocked-by APL-9
kanbo comment APL-12 "Waiting on the login fix."
```

`--sprint none` clears a field; leaving the flag out leaves it alone. Assigning
to somebody the project has never seen invents them, exactly as the board does.

**There is no "close" flag.** Finishing work means moving a card to a column
whose category is `done` — `kanbo columns` shows which those are. A team can
call it anything, and the metrics read the category rather than the name.

## Sprints, releases, metrics

```sh
kanbo sprint new "Sprint 12" --start 2026-08-03 --end 2026-08-16 --capacity 20
kanbo sprint show current          # points done against committed, and the burndown
kanbo sprint close "Sprint 12" --into "Sprint 13"
kanbo velocity
kanbo milestone new "v1.0" --due 2026-09-01
kanbo release notes --release v1.0
kanbo roadmap
kanbo people                       # who is carrying what, read off the board
kanbo metrics                      # cycle time percentiles, aging WIP, throughput, flow
```

A burndown's days after today come back as `—` (or `NaN` in `--json`) on
purpose: the future is not drawn, because nobody can know it. Do not fill it in.

## Say before you do

Tell the user what you are about to do, and wait, for anything in this list:

- `rm`, `column rm`, `sprint rm`, `milestone rm`, `person rm` — deletion.
- `share` — it produces a link that decrypts the **whole board**, cannot be
  revoked, and does not expire. It is a copy.
- `sync`, `issues --apply` — these reach the network and write to a repository.
- `import` — merging is safe and idempotent, but say whose export it is.

`issues` without `--apply` prints the plan and writes nothing. Prefer it first.

## Repository mode

A git repository can be the backend, which is what gives several people one
board with no server.

```sh
kanbo remote set --forge github --repo owner/name --branch main
kanbo token set          # reads the token from the terminal; never pass it as an argument
kanbo sync
kanbo issues             # a plan; add --apply to carry it out
kanbo prs                # pull requests matched to cards, and what CI says
```

The command talks to exactly one host — the one configured — and refuses every
other origin. Passphrases and tokens are never flags with values, because
`--token ghp_…` lands in the shell history and in `ps` output for everyone on
the machine.

## As an MCP server

If tools named `kanbo_*` are available, use them instead of the shell: they
return structured JSON and their writes are annotated, so the client can ask
before anything is deleted. They are the same program.

```json
{
  "mcpServers": {
    "kanbo": {
      "command": "npx",
      "args": ["-y", "--package=kanbo-board@0.3$3", "kanbo-mcp"],
      "env": { "KANBO_HOME": "/path/to/project/.kanbo" }
    }
  }
}
```

Set `KANBO_HOME`, or every project shares `~/.kanbo`. Pin the version — an agent
running a version nobody can name is a bad debugging position.

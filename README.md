# Kanbo

Local-first project management. Kanban, sprints and roadmap in your browser, with a git repo as the only backend.

There is no server, no account and no database of ours. Kanbo runs in two modes, and the difference between them is enforced by the browser rather than promised by us.

## Two modes

**Local** — the default. Everything lives encrypted in your browser. The page is served with `connect-src 'none'`, so it _cannot_ make a network request: not to us, not to anyone. Nothing to trust, because nothing is possible.

**Repository** — a git repo becomes the source of truth, which gives you multiple devices and multiple people without a backend. The page may then reach exactly one host: the forge you named. Nothing else.

Switching modes is a setting, and it reloads the page — because the guarantee is a property of the document, not of our code. The URL tells you which mode you are in.

## How the network guarantee works

A Content-Security-Policy delivered in a `<meta>` element applies at parse time and can never be loosened afterwards. So the build emits two documents from one bundle, identical in every directive except `connect-src`:

| Document       | `connect-src` | Mode       |
| -------------- | ------------- | ---------- |
| `index.html`   | `'none'`      | Local      |
| `connect.html` | `https:`      | Repository |

`connect.html` names no host, because a list fixed at build time could never cover a self-hosted Gitea on a domain we have never heard of. Instead, the first module the browser runs inserts a _second_ policy naming the one origin you configured. Policies accumulate and a request must satisfy all of them, so the intersection of `https:` and `https://api.github.com` is that host alone — and it cannot be widened afterwards, not even by a dependency compromised later in the page's life.

Three things keep that honest, and CI fails if any of them slips:

- One module in the entire codebase may touch the network; it rejects any origin but the configured one. Every other file using `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon` fails the build.
- Both documents are checked, after the build, against the same source of truth the build composed them from.
- The two documents must not differ in anything but `connect-src`.

**The honest limit.** In repository mode the promise is no longer "this page cannot talk to anyone" but "this page can only talk to the host you chose". If that is not a trade you want to make, local mode keeps the stronger guarantee, fully intact.

## Features

**Board** with real drag and drop, operable entirely from the keyboard, WIP limits, and a status chip that flips like a departure board when someone else moves a card.

**Sprints** with a goal, capacity, burndown and velocity. The burndown carries scope changes as their own series, because drawing only the remaining line makes a sprint that grew look like a team that stalled — and it stops at today rather than projecting a future nobody can know.

**Flow metrics** — cycle time as percentiles rather than an average, cumulative flow, throughput, aging work in progress. Every figure is derived from the board's own history; nothing is recorded twice, so nothing can drift.

**Roadmap** with dependency arrows drawn in the grammar of a technical drawing, milestones, and blocking links that refuse to form a cycle. An item with no dates gets no bar: a roadmap that invents a schedule is the most confident kind of wrong.

**Backlog, table and releases** — ordered planning, bulk editing, and release notes generated from what actually shipped.

**⌘K** for search and commands, in a query language you already know: `is:blocked`, `assignee:@me`, `type:bug points:>3`, `sprint:current`. The same language the CLI runs.

**Markdown** descriptions, so issue bodies round-trip exactly. Rendered as elements from a tree of values — there is no `dangerouslySetInnerHTML` anywhere in Kanbo, and no sanitiser to get wrong.

## From the terminal

```sh
node packages/cli/src/main.ts init "Apollo" APL
node packages/cli/src/main.ts add "Ship the departure board"
node packages/cli/src/main.ts search is:blocked
node packages/cli/src/main.ts export > backup.json
```

The CLI is not a convenience wrapper — it is the evidence. It calls `@kanbo/core` directly: the same reducer the board uses, the same merge the sync engine uses, the same query language the palette uses. Nothing about a project is re-implemented for the terminal, and nothing could be, because the domain has no branch for where it is running. `pnpm check:cli` keeps that true.

## Development

```sh
pnpm install
pnpm dev        # http://localhost:5173 — /connect.html serves the connected document
pnpm verify     # everything below, in order
```

`pnpm verify` is what CI runs: typecheck, lint, format, unit tests, build, then three checks that need the built artifact.

- **`check:network`** — no network API outside the one declared transport module, and both documents carrying exactly the policies `policy.ts` describes.
- **`check:cli`** — the domain driven with no browser at all, including an export replayed into a different store.
- **`smoke`** — a real browser: the strict document genuinely refusing a request, a card moved between columns with the keyboard alone, and two devices converging through a repository.

## Architecture

```
packages/core           pure TypeScript — no browser, no Node, no I/O
packages/adapters-web   IndexedDB, WebCrypto
packages/adapters-node  filesystem, node:crypto
packages/web            React UI
packages/cli            the `kanbo` command
```

The domain does no I/O of its own; it receives storage, crypto and a clock as injected ports. That is what will let a CLI drive the same logic with the filesystem instead of IndexedDB, without duplicating a line of it — and it is why the domain tests need neither a browser nor a mock.

`packages/core/src/policy.ts` is the single source of truth for the CSP directives. The Vite plugin composes the documents from it, the boot module tightens from it, and the CI guard checks against it. A directive living in only one of those three places is a directive that will drift.

## Self-hosting

```sh
docker compose up
```

The policy travels inside the documents rather than in response headers, so a self-hosted Kanbo gives exactly the same guarantees as the hosted build. The nginx config deliberately sets no CSP header — one header would apply a single policy to both documents and collapse the distinction.

## License

MIT

# Kanbo

Local-first project management. Kanban, sprints and roadmap in your browser, with a git repo as the only backend.

There is no server, no account and no database of ours. Kanbo runs in two modes, and the difference between them is enforced by the browser rather than promised by us.

## Two modes

**Local** — the default. Everything lives encrypted in your browser. The page is served with `connect-src 'none'`, so it _cannot_ make a network request: not to us, not to anyone. Nothing to trust, because nothing is possible.

**Repository** — a git repo becomes the source of truth, which gives you multiple devices and multiple people without a backend. The page may then reach exactly one host: the forge you named. Nothing else. **GitHub and GitLab** are both implemented, including self-hosted instances; they sit behind one interface, so switching changes the connector and nothing else.

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

**Board** with real drag and drop, operable entirely from the keyboard, WIP limits, and a status chip that flips like a departure board when someone else moves a card. Filter it to a sprint without leaving the board, with that sprint's points done against committed in the toolbar.

**History on everything.** Kanbo stores changes rather than state, so an activity feed needs no recording of its own — it is a reading of the same log the board is built from, and cannot drift from it or be quietly edited. A deleted card is gone from the board but its deletion is still in the history.

**Sprints** with a goal, capacity, burndown and velocity. The burndown carries scope changes as their own series, because drawing only the remaining line makes a sprint that grew look like a team that stalled — and it stops at today rather than projecting a future nobody can know.

**Flow metrics** — cycle time as percentiles rather than an average, cumulative flow, throughput, aging work in progress. Every figure is derived from the board's own history; nothing is recorded twice, so nothing can drift.

**Roadmap** with dependency arrows drawn in the grammar of a technical drawing, milestones, and blocking links that refuse to form a cycle. An item with no dates gets no bar: a roadmap that invents a schedule is the most confident kind of wrong.

**One place the work is, and controls for how to look at it.** Columns or a list; grouped by status, sprint, person or priority; narrowed by a filter written in the same query language as everything else. Board, table and backlog were three destinations over the same items, each freezing one combination of those; they are one now. Grouping by sprint gives lanes — including a lane for the work in no sprint at all, which is the question a filter cannot ask.

**People** — who is carrying what, read off the board rather than recorded anywhere: open work, points, what is blocked, and the oldest thing still in flight. It is also where you say which of them is you, which is what makes `assignee:@me` mean something — and what the **Mine** filter stands on. That answer is remembered by the browser and never written to the project: it is true of a machine, not of a board.

A person's **forge handle** is their name as the forge spells it, and it is the only bridge between the two: an issue arrives assigned to `@ada`, this board knows "Ada Lovelace", and there is no directory to ask. It is read when issues are imported, so work that arrives already assigned lands on the right plate. It is not pushed the other way, and the interface does not pretend it is.

**Releases** — release notes generated from what actually shipped.

**⌘K** for search and commands, in a query language you already know: `is:blocked`, `assignee:@me`, `type:bug points:>3`, `sprint:current`. The same language the filter runs, and the same language the CLI runs — including `@me`, which needs a terminal to know who you are and now has `kanbo me` to tell it.

**The keyboard means it.** `/` filters, `n` opens an item, `g` then a letter goes somewhere, `?` lists all of it — and everything `?` lists is bound, which is the point of having the list.

**Pull requests on the ticket.** A pull request is matched to a card by the item's reference in a branch, title or description, by a closing keyword (`closes #12`), or by a bare issue mention — strongest signal wins, and a pull request that mentions nothing recognisable is left unlinked rather than guessed at. The card shows whether work is merged, open, draft, and what CI says; unknown check status is drawn as unknown, never as passing.

**Encrypted sharing** — hand someone a read-only copy of the board as a link. It is encrypted in the page with AES-GCM-256 and nothing is uploaded: the key travels in the URL fragment, which browsers never send to the host, so whoever serves Kanbo cannot read what the link unlocks. Optionally protect it with a passphrase, derived with Argon2id, and send that by another route. A share cannot be revoked and does not expire — it is a copy, there is nobody to enforce an expiry, and the app says so rather than implying otherwise.

**Markdown** descriptions, so issue bodies round-trip exactly. Rendered as elements from a tree of values — there is no `dangerouslySetInnerHTML` anywhere in Kanbo, and no sanitiser to get wrong.

## From the terminal

```sh
node packages/cli/src/main.ts init "Apollo" APL
node packages/cli/src/main.ts add "Ship the departure board"
node packages/cli/src/main.ts assign APL-1 "Ada Lovelace"
node packages/cli/src/main.ts me "Ada Lovelace"
node packages/cli/src/main.ts search assignee:@me
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

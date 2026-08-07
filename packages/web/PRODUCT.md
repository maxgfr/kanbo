# Kanbo — product truth

## What it is

Local-first project management for software teams. Kanban board, sprints, roadmap, dependencies, and delivery metrics — running entirely in the browser, with a git repository as the only backend it will ever have.

## The unique mechanism

There is no server, no account, and no database belonging to us. The app runs in one of two modes and the difference is **enforced by the browser, not promised by us**:

- **Local mode** (default) — served with `connect-src 'none'`. The page physically cannot make a network request.
- **Repository mode** — a git repo is the source of truth. The page may reach exactly one host: the forge the user named.

Each device appends only to its own operation log, so multi-person collaboration produces no git conflicts by construction rather than resolving them afterwards.

## Audience and scene

Software developers and tech leads, aged roughly 25–45, who already live in GitHub. They are at a desk, on a large screen, often with the browser beside an editor and a terminal. They open Kanbo several times a day for short bursts: check what is in flight, drag a card, open a ticket, close a ticket. Standups and sprint plannings are the moments it is projected on a wall.

They are people who chose a tool because it does not phone home. They are suspicious of SaaS, comfortable with keyboard-driven software, and will read a README before signing up for anything — because they will not sign up for anything.

## Jobs to be done

1. See what the team has in flight, in under two seconds, without clicking.
2. Move a card between columns without thinking about it — with a mouse or with the keyboard.
3. Plan a sprint: pull from backlog, watch committed points against capacity.
4. Answer "when will this ship" from the roadmap and the dependency chain.
5. Answer "where does work get stuck" from cycle time and cumulative flow.

## Constraints that bind the design

- **No network in local mode.** No web fonts, no CDN, no remote images, no analytics. Ever. The CI guard fails the build otherwise. Type must come from system stacks or self-hosted files.
- **Density is the job.** A board showing eight cards per column is a board that answers question 1. Comfortable padding that shows three is a failure, however handsome.
- **Keyboard parity is not optional.** Every drag gesture has a keyboard equivalent. A board reachable only by mouse is unusable for part of the team and fails the promise of a developer tool.
- **Projected on a wall at standup.** Legible from three metres, in a room with the lights on.
- **Both themes are first-class.** This audience sets dark mode and never changes it back; it is also used in bright meeting rooms.
- **State must be unmistakable.** Blocked, over WIP limit, overdue, unestimated, syncing, offline, conflicted. A tool people trust with delivery dates cannot be ambiguous about any of them.

## Brand commitments

- Name: **Kanbo**. Sibling to the author's `nook`. Lowercase in prose, capitalized as a proper noun.
- Interface language: **English**.
- MIT licensed, self-hostable, published to GitHub Pages and GHCR.

## What must never happen

- A claim the software cannot keep. The README states the honest limit of repository mode; the UI must too.
- Fabricated activity, fake avatars, invented team names, or seeded "sample data" presented as real.
- Any element that implies data leaves the machine when it cannot, or that it cannot when it does.

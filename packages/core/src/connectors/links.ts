/**
 * Working out which pull request belongs to which ticket.
 *
 * There is no field on a forge that says so, and asking people to fill one in
 * is asking them to do the computer's job. So the link is inferred from what
 * developers already write down without being asked:
 *
 * 1. **The item's own reference** — `KAN-42` in a branch name, a title or a
 *    description. This is the strongest signal, because nothing else in a
 *    repository looks like it.
 * 2. **A closing keyword** — `closes #12`, `fixes #12`. The forge already
 *    treats these as authoritative, so a board that ignored them would
 *    disagree with the thing it is mirroring.
 * 3. **A bare issue reference** — `#12` anywhere. Weaker, because a number
 *    with a hash in front of it is a common way to mention something in
 *    passing, so it links but does not imply the pull request will close it.
 *
 * A pull request can legitimately touch several tickets, so this returns every
 * match rather than picking one. What it will not do is guess: a pull request
 * that mentions nothing recognisable is left unlinked, because a wrong link on
 * a board is worse than a missing one — someone reads it as "this is being
 * worked on" and stops looking.
 */
import type { Item, Project } from '../model/types.ts'
import { ISSUE_FIELD, type RemotePullRequest } from './issues.ts'

export type LinkStrength = 'reference' | 'closes' | 'mentions'

export type PullRequestLink = {
  readonly itemId: string
  readonly pull: RemotePullRequest
  readonly strength: LinkStrength
  /** True when the pull request says it will close the ticket. */
  readonly closes: boolean
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi
const MENTION = /#(\d+)/g

function issueNumbersIn(text: string, pattern: RegExp): readonly number[] {
  const found: number[] = []
  // A fresh lastIndex each time: a shared global regex silently skips matches
  // on its second use, which would drop links at random.
  const scan = new RegExp(pattern.source, pattern.flags)
  let match: RegExpExecArray | null
  while ((match = scan.exec(text)) !== null) {
    const number = Number(match[1])
    if (Number.isFinite(number)) found.push(number)
  }
  return found
}

/**
 * A reference is matched case-insensitively and on a word boundary, so
 * `KAN-4` never matches `KAN-42` and a lowercase branch still counts.
 */
function mentionsRef(text: string, ref: string): boolean {
  if (ref === '') return false
  const escaped = ref.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(text)
}

export function linkPullRequests(
  project: Project,
  pulls: readonly RemotePullRequest[],
): readonly PullRequestLink[] {
  const byIssue = new Map<number, Item>()
  for (const item of project.items) {
    const number = item.fields[ISSUE_FIELD]
    if (typeof number === 'number') byIssue.set(number, item)
  }

  const links: PullRequestLink[] = []

  for (const pull of pulls) {
    const haystack = `${pull.title}\n${pull.body}\n${pull.branch}`
    const closes = new Set(issueNumbersIn(haystack, CLOSING))
    const mentions = new Set(issueNumbersIn(haystack, MENTION))
    const claimed = new Set<string>()

    // Strongest first, so a pull request naming both a reference and an issue
    // number is recorded once, at the stronger of the two.
    for (const item of project.items) {
      if (item.archived || !mentionsRef(haystack, item.ref)) continue
      claimed.add(item.id)
      links.push({
        itemId: item.id,
        pull,
        strength: 'reference',
        closes: closesItem(item, closes),
      })
    }

    for (const number of closes) {
      const item = byIssue.get(number)
      if (!item || claimed.has(item.id)) continue
      claimed.add(item.id)
      links.push({ itemId: item.id, pull, strength: 'closes', closes: true })
    }

    for (const number of mentions) {
      const item = byIssue.get(number)
      if (!item || claimed.has(item.id)) continue
      claimed.add(item.id)
      links.push({ itemId: item.id, pull, strength: 'mentions', closes: false })
    }
  }

  return links
}

function closesItem(item: Item, closes: ReadonlySet<number>): boolean {
  const number = item.fields[ISSUE_FIELD]
  return typeof number === 'number' && closes.has(number)
}

/** Links grouped by item, so a card can ask about itself in one lookup. */
export function linksByItem(
  links: readonly PullRequestLink[],
): ReadonlyMap<string, readonly PullRequestLink[]> {
  const grouped = new Map<string, PullRequestLink[]>()
  for (const link of links) {
    const existing = grouped.get(link.itemId)
    if (existing) existing.push(link)
    else grouped.set(link.itemId, [link])
  }
  return grouped
}

export type ItemDelivery = {
  readonly merged: boolean
  readonly open: number
  /** Worst status across the item's pull requests; null when nothing reported. */
  readonly checks: 'passing' | 'failing' | 'pending' | null
  readonly draftOnly: boolean
}

/**
 * What the pull requests say about an item, as one answer a card can show.
 *
 * Checks take the *worst* status rather than the newest: an item with one
 * passing and one failing pull request is not passing, and showing it green
 * would be the board telling a comfortable lie.
 */
export function deliveryOf(links: readonly PullRequestLink[]): ItemDelivery | null {
  if (links.length === 0) return null

  const pulls = links.map((link) => link.pull)
  const open = pulls.filter((pull) => pull.state === 'open')

  return {
    merged: pulls.some((pull) => pull.state === 'merged'),
    open: open.length,
    checks: pulls.some((pull) => pull.checks === 'failing')
      ? 'failing'
      : pulls.some((pull) => pull.checks === 'pending')
        ? 'pending'
        : pulls.some((pull) => pull.checks === 'passing')
          ? 'passing'
          : null,
    draftOnly: open.length > 0 && open.every((pull) => pull.draft),
  }
}

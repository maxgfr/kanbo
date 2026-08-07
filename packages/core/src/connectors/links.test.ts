import { describe, expect, it } from 'vitest'

import { reduceOperations } from '../ops/reduce.ts'
import { anItem, op, statusOperations } from '../ops/testing.ts'
import { ISSUE_FIELD, type RemotePullRequest } from './issues.ts'
import { deliveryOf, linkPullRequests, linksByItem } from './links.ts'

const project = reduceOperations([
  ...statusOperations(),
  op('a', 10, {
    kind: 'item.create',
    item: anItem('1', { ref: 'KAN-4', title: 'Small', fields: { [ISSUE_FIELD]: 12 } }),
  }),
  op('a', 11, {
    kind: 'item.create',
    item: anItem('2', { ref: 'KAN-42', title: 'Large', fields: { [ISSUE_FIELD]: 99 } }),
  }),
  op('a', 12, {
    kind: 'item.create',
    item: anItem('3', { ref: 'KAN-7', title: 'Archived', archived: true }),
  }),
])

function aPull(overrides: Partial<RemotePullRequest> = {}): RemotePullRequest {
  return {
    number: 1,
    title: 'Some change',
    body: '',
    state: 'open',
    draft: false,
    url: 'https://example.com/pull/1',
    branch: 'feature/whatever',
    checks: null,
    ...overrides,
  }
}

const link = (pull: RemotePullRequest) => linkPullRequests(project, [pull])

describe('linking by item reference', () => {
  it('matches a reference in the branch name', () => {
    expect(link(aPull({ branch: 'feat/KAN-42-large-thing' }))).toMatchObject([
      { itemId: '2', strength: 'reference' },
    ])
  })

  it('matches a reference in the title, whatever the case', () => {
    expect(link(aPull({ title: 'kan-42: at last' }))).toMatchObject([{ itemId: '2' }])
  })

  it('does not let KAN-4 match KAN-42', () => {
    // The bug that would quietly attach every pull request to the wrong card.
    const links = link(aPull({ branch: 'feat/KAN-42-large' }))
    expect(links.map((entry) => entry.itemId)).toEqual(['2'])
  })

  it('ignores archived items', () => {
    expect(link(aPull({ title: 'KAN-7 revisited' }))).toEqual([])
  })
})

describe('linking by issue number', () => {
  it('treats a closing keyword as authoritative', () => {
    const links = link(aPull({ body: 'This closes #12 at last.' }))
    expect(links).toMatchObject([{ itemId: '1', strength: 'closes', closes: true }])
  })

  it('recognises the usual verbs and punctuation', () => {
    for (const phrase of ['closes #12', 'Closed: #12', 'fixes #12', 'fix #12', 'resolves #12']) {
      expect(link(aPull({ body: phrase })), phrase).toMatchObject([{ closes: true }])
    }
  })

  it('links a bare mention without claiming it will close anything', () => {
    expect(link(aPull({ body: 'related to #12, see there' }))).toMatchObject([
      { itemId: '1', strength: 'mentions', closes: false },
    ])
  })

  it('ignores a number belonging to no item', () => {
    expect(link(aPull({ body: 'closes #4321' }))).toEqual([])
  })
})

describe('when several signals agree', () => {
  it('records an item once, at the strongest signal', () => {
    const links = link(aPull({ branch: 'KAN-4-fix', body: 'closes #12' }))
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ itemId: '1', strength: 'reference', closes: true })
  })

  it('links every ticket a pull request genuinely touches', () => {
    const links = link(aPull({ title: 'KAN-42 groundwork', body: 'also closes #12' }))
    expect(links.map((entry) => entry.itemId).toSorted()).toEqual(['1', '2'])
  })
})

describe('refusing to guess', () => {
  it('links nothing when there is nothing recognisable', () => {
    // A wrong link is worse than a missing one: someone reads it as "this is
    // being worked on" and stops looking.
    expect(link(aPull({ title: 'Tidy up', body: 'no refs here', branch: 'chore/tidy' }))).toEqual(
      [],
    )
  })

  it('finds every mention rather than stopping at the first', () => {
    const links = link(aPull({ body: '#12 and #99 both' }))
    expect(links).toHaveLength(2)
  })
})

describe('linksByItem', () => {
  it('groups so a card asks about itself once', () => {
    const links = linkPullRequests(project, [
      aPull({ number: 1, branch: 'KAN-4-a' }),
      aPull({ number: 2, branch: 'KAN-4-b' }),
      aPull({ number: 3, branch: 'KAN-42-c' }),
    ])
    const grouped = linksByItem(links)
    expect(grouped.get('1')).toHaveLength(2)
    expect(grouped.get('2')).toHaveLength(1)
  })
})

const linksFor = (...pulls: RemotePullRequest[]) =>
  pulls.map((pull) => ({ itemId: '1', pull, strength: 'reference' as const, closes: false }))

describe('deliveryOf', () => {
  it('is nothing when no pull request touches the item', () => {
    expect(deliveryOf([])).toBeNull()
  })

  it('reports the worst check status, not the newest', () => {
    // One passing and one failing is not passing, and green here would be the
    // board telling a comfortable lie.
    const delivery = deliveryOf(
      linksFor(aPull({ checks: 'passing' }), aPull({ number: 2, checks: 'failing' })),
    )
    expect(delivery?.checks).toBe('failing')
  })

  it('does not report unknown checks as passing', () => {
    expect(deliveryOf(linksFor(aPull({ checks: null })))?.checks).toBeNull()
  })

  it('notices a merge', () => {
    expect(deliveryOf(linksFor(aPull({ state: 'merged' })))?.merged).toBe(true)
  })

  it('counts only open pull requests as open', () => {
    const delivery = deliveryOf(
      linksFor(aPull({ state: 'open' }), aPull({ number: 2, state: 'closed' })),
    )
    expect(delivery?.open).toBe(1)
  })

  it('marks work as draft-only when nothing is ready for review', () => {
    expect(deliveryOf(linksFor(aPull({ draft: true })))?.draftOnly).toBe(true)
    expect(
      deliveryOf(linksFor(aPull({ draft: true }), aPull({ number: 2, draft: false })))?.draftOnly,
    ).toBe(false)
  })
})

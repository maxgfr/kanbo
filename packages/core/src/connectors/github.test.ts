import { describe, expect, it } from 'vitest'

import type { Http, HttpRequest } from '../ports/index.ts'
import { encodeBase64 } from './base64.ts'
import { gitHubProvider, parseRepository, withChecks } from './github.ts'
import { ConflictError, ProviderError } from './provider.ts'

type Call = { url: string; init: HttpRequest }

/** Records what was asked, and answers with what the caller queued. */
function fakeHttp(answers: readonly { status: number; body: string }[]) {
  const calls: Call[] = []
  let at = 0
  const http: Http = {
    async request(url, init) {
      calls.push({ url, init })
      return answers[at++] ?? { status: 200, body: '[]' }
    },
  }
  return { http, calls }
}

const config = {
  apiBaseUrl: 'https://api.github.com',
  owner: 'acme',
  repo: 'board',
  branch: 'main',
  token: 'ghp-secret',
}

describe('addressing and auth', () => {
  it('builds a Contents URL from the configured repository and branch', async () => {
    const { http, calls } = fakeHttp([{ status: 404, body: '{}' }])
    await gitHubProvider(http, config).readFile('.kanbo/manifest.json')
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/acme/board/contents/.kanbo/manifest.json?ref=main',
    )
  })

  it('tolerates a trailing slash on the API base, as a pasted URL has', async () => {
    const { http, calls } = fakeHttp([{ status: 404, body: '{}' }])
    await gitHubProvider(http, { ...config, apiBaseUrl: 'https://ghe.acme.com/api/v3/' }).readFile(
      'a.txt',
    )
    expect(calls[0]?.url).toContain('https://ghe.acme.com/api/v3/repos/acme/board/contents/a.txt')
  })

  it('authenticates as a bearer token and pins the API version', async () => {
    const { http, calls } = fakeHttp([{ status: 404, body: '{}' }])
    await gitHubProvider(http, config).readFile('a.txt')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer ghp-secret')
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28')
  })
})

describe('reading', () => {
  it('decodes the base64 payload and carries the blob sha as the version', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify({ content: encodeBase64('{"format":1}'), sha: 'blob-sha' }),
      },
    ])
    expect(await gitHubProvider(http, config).readFile('.kanbo/manifest.json')).toEqual({
      path: '.kanbo/manifest.json',
      content: '{"format":1}',
      sha: 'blob-sha',
    })
  })

  it('reads a payload GitHub wrapped in line breaks', async () => {
    // The Contents API returns base64 with newlines in it, which is legal and
    // which naive decoders trip over. A first sync would fail on nothing worse
    // than a file that grew past 60 characters.
    const wrapped = encodeBase64('{"format":1}').replace(/(.{4})/g, '$1\n')
    const { http } = fakeHttp([
      { status: 200, body: JSON.stringify({ content: wrapped, sha: 's' }) },
    ])
    expect((await gitHubProvider(http, config).readFile('m.json'))?.content).toBe('{"format":1}')
  })

  it('reports a missing file as absent rather than as a failure', async () => {
    // The normal state of a first sync: nothing has been written yet.
    const { http } = fakeHttp([{ status: 404, body: '{"message":"Not Found"}' }])
    expect(await gitHubProvider(http, config).readFile('.kanbo/manifest.json')).toBeNull()
  })

  it('returns null for a payload missing the fields it needs', async () => {
    const { http } = fakeHttp([{ status: 200, body: JSON.stringify({ sha: 'only-a-sha' }) }])
    expect(await gitHubProvider(http, config).readFile('m.json')).toBeNull()
  })
})

describe('writing', () => {
  it('PUTs base64 content, the branch and the message', async () => {
    const { http, calls } = fakeHttp([{ status: 200, body: '{"content":{"sha":"new"}}' }])
    const result = await gitHubProvider(http, config).writeFile({
      path: '.kanbo/ops/a.ndjson',
      content: 'line\n',
      message: 'sync',
    })

    expect(calls[0]?.init.method).toBe('PUT')
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body['content']).toBe(encodeBase64('line\n'))
    expect(body['branch']).toBe('main')
    expect(body['message']).toBe('sync')
    // No sha on a first write: sending one for a file that does not exist is
    // how GitHub is told to expect a file that does not exist.
    expect('sha' in body).toBe(false)
    expect(result).toEqual({ sha: 'new' })
  })

  it('sends the expected sha when replacing a file', async () => {
    const { http, calls } = fakeHttp([{ status: 200, body: '{"content":{"sha":"next"}}' }])
    await gitHubProvider(http, config).writeFile({
      path: 'a.ndjson',
      content: 'x',
      message: 'm',
      sha: 'old',
    })
    expect(JSON.parse(String(calls[0]?.init.body))['sha']).toBe('old')
  })

  it('detects a concurrent write reported as 409', async () => {
    const { http } = fakeHttp([{ status: 409, body: '{}' }])
    await expect(
      gitHubProvider(http, config).writeFile({ path: 'a', content: 'x', message: 'm', sha: 's' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('detects the same conflict reported as 422', async () => {
    // GitHub answers a stale sha with 409 or 422 depending on the day. Treating
    // 422 as an ordinary error would turn a recoverable re-read into a sync
    // that simply stops working.
    const { http } = fakeHttp([{ status: 422, body: '{}' }])
    await expect(
      gitHubProvider(http, config).writeFile({ path: 'a', content: 'x', message: 'm', sha: 's' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('reports an ordinary failure as a provider error, not a conflict', async () => {
    const { http } = fakeHttp([{ status: 500, body: '{}' }])
    const write = gitHubProvider(http, config).writeFile({
      path: 'a',
      content: 'x',
      message: 'm',
    })
    await expect(write).rejects.toBeInstanceOf(ProviderError)
    await expect(write).rejects.not.toBeInstanceOf(ConflictError)
  })
})

describe('errors never carry the token', () => {
  it('keeps the response body out of the message', async () => {
    // A forge echoes the request back in its error payload, and the token
    // travels in the request. Anything that reaches a log or a screen has to be
    // safe to read over someone's shoulder.
    const echoed = JSON.stringify({ message: 'Bad credentials', request: 'Bearer ghp-secret' })
    const { http } = fakeHttp([{ status: 401, body: echoed }])

    await expect(gitHubProvider(http, config).readFile('a')).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && !error.message.includes('ghp-secret'),
    )
  })

  it('says what to check when the token is refused', async () => {
    const { http } = fakeHttp([{ status: 403, body: '{}' }])
    await expect(gitHubProvider(http, config).readFile('a')).rejects.toThrow(/repo. scope/)
  })
})

describe('listing', () => {
  it('returns file paths and drops directories', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify([
          { path: '.kanbo/ops/a.ndjson', type: 'file' },
          { path: '.kanbo/ops/nested', type: 'dir' },
          { path: '.kanbo/ops/b.ndjson', type: 'file' },
        ]),
      },
    ])
    expect(await gitHubProvider(http, config).listFiles('.kanbo/ops')).toEqual([
      '.kanbo/ops/a.ndjson',
      '.kanbo/ops/b.ndjson',
    ])
  })

  it('reads an absent directory as empty, because git has no empty directories', async () => {
    const { http } = fakeHttp([{ status: 404, body: '{}' }])
    expect(await gitHubProvider(http, config).listFiles('.kanbo/ops')).toEqual([])
  })

  it('returns nothing when the payload is not a list', async () => {
    const { http } = fakeHttp([{ status: 200, body: '{"type":"file"}' }])
    expect(await gitHubProvider(http, config).listFiles('.kanbo/ops')).toEqual([])
  })
})

describe('issues', () => {
  it('excludes pull requests, which arrive from the issues endpoint', async () => {
    // Importing them as cards would double every piece of work in flight.
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify([
          { number: 1, title: 'A bug', state: 'open', updated_at: '2026-08-01T00:00:00Z' },
          { number: 2, title: 'A PR', state: 'open', pull_request: { url: 'x' } },
        ]),
      },
    ])
    const issues = await gitHubProvider(http, config).listIssues({})
    expect(issues.map((issue) => issue.number)).toEqual([1])
  })

  it('reads an empty body as a string, since GitHub reports it as null', async () => {
    const { http } = fakeHttp([
      { status: 200, body: JSON.stringify([{ number: 3, title: 'T', body: null, state: 'open' }]) },
    ])
    expect((await gitHubProvider(http, config).listIssues({}))[0]?.body).toBe('')
  })

  it('flattens label objects and assignee logins', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify([
          {
            number: 4,
            title: 'T',
            state: 'closed',
            labels: [{ name: 'bug' }, 'plain'],
            assignees: [{ login: 'ada' }, {}],
          },
        ]),
      },
    ])
    const issue = (await gitHubProvider(http, config).listIssues({}))[0]
    expect(issue?.labels).toEqual(['bug', 'plain'])
    expect(issue?.assignees).toEqual(['ada'])
    expect(issue?.state).toBe('closed')
  })

  it('passes `since` as an ISO instant', async () => {
    const { http, calls } = fakeHttp([{ status: 200, body: '[]' }])
    await gitHubProvider(http, config).listIssues({ since: Date.parse('2026-08-01T00:00:00Z') })
    expect(calls[0]?.url).toContain('since=2026-08-01T00%3A00%3A00.000Z')
  })

  it('creates and updates through the issues endpoint', async () => {
    const { http, calls } = fakeHttp([
      { status: 201, body: JSON.stringify({ number: 7, title: 'New', state: 'open' }) },
      { status: 200, body: JSON.stringify({ number: 7, title: 'New', state: 'closed' }) },
    ])
    const provider = gitHubProvider(http, config)

    expect((await provider.createIssue({ title: 'New', body: '', labels: [] })).number).toBe(7)
    expect(calls[0]?.init.method).toBe('POST')

    expect((await provider.updateIssue(7, { state: 'closed' })).state).toBe('closed')
    expect(calls[1]?.init.method).toBe('PATCH')
    expect(calls[1]?.url).toBe('https://api.github.com/repos/acme/board/issues/7')
  })
})

describe('pull requests', () => {
  it('reads merged from merged_at rather than from the state', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify([
          {
            number: 9,
            title: 'Fix APL-4',
            state: 'closed',
            merged_at: '2026-08-02T00:00:00Z',
            head: { ref: 'fix/apl-4' },
          },
          { number: 10, title: 'Draft', state: 'open', draft: true, head: { ref: 'wip' } },
        ]),
      },
    ])
    const pulls = await gitHubProvider(http, config).listPullRequests()
    expect(pulls[0]?.state).toBe('merged')
    expect(pulls[0]?.branch).toBe('fix/apl-4')
    expect(pulls[1]?.state).toBe('open')
    expect(pulls[1]?.draft).toBe(true)
  })

  it('leaves checks unknown, never passing, on the list payload', async () => {
    const { http } = fakeHttp([
      { status: 200, body: JSON.stringify([{ number: 9, state: 'open', head: { ref: 'b' } }]) },
    ])
    expect((await gitHubProvider(http, config).listPullRequests())[0]?.checks).toBeNull()
  })
})

describe('withChecks', () => {
  const pull = {
    number: 9,
    title: 'T',
    body: '',
    state: 'open' as const,
    draft: false,
    url: '',
    branch: 'topic',
    checks: null,
  }

  it('reports passing only when every run completed successfully', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify({
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'success' },
          ],
        }),
      },
    ])
    expect((await withChecks(http, config, [pull]))[0]?.checks).toBe('passing')
  })

  it('reports failing when any run failed or timed out', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify({
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'timed_out' },
          ],
        }),
      },
    ])
    expect((await withChecks(http, config, [pull]))[0]?.checks).toBe('failing')
  })

  it('reports pending while a run is still going', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify({
          check_runs: [{ status: 'in_progress' }, { status: 'completed', conclusion: 'success' }],
        }),
      },
    ])
    expect((await withChecks(http, config, [pull]))[0]?.checks).toBe('pending')
  })

  it('leaves checks unknown when the request fails, rather than claiming passing', async () => {
    // "Unknown" and "passing" must never look the same: a board that cannot
    // tell them apart will eventually be believed about the wrong one.
    const { http } = fakeHttp([{ status: 500, body: '{}' }])
    expect((await withChecks(http, config, [pull]))[0]?.checks).toBeNull()
  })

  it('leaves checks unknown when a repository runs no checks at all', async () => {
    const { http } = fakeHttp([{ status: 200, body: '{"check_runs":[]}' }])
    expect((await withChecks(http, config, [pull]))[0]?.checks).toBeNull()
  })

  it('survives a body that is not JSON', async () => {
    const { http } = fakeHttp([{ status: 200, body: '<html>a proxy said no</html>' }])
    expect((await withChecks(http, config, [pull]))[0]?.checks).toBeNull()
  })
})

describe('parseRepository', () => {
  it('accepts owner/repo', () => {
    expect(parseRepository(' acme/board ')).toEqual({ owner: 'acme', repo: 'board' })
  })

  it('accepts a URL copied out of the address bar', () => {
    expect(parseRepository('https://github.com/acme/board')).toEqual({
      owner: 'acme',
      repo: 'board',
    })
  })

  it('accepts a clone URL, and drops the .git', () => {
    expect(parseRepository('git@github.com:acme/board.git')).toEqual({
      owner: 'acme',
      repo: 'board',
    })
  })

  it('accepts a GitHub Enterprise host', () => {
    expect(parseRepository('https://github.acme.dev/acme/board')).toEqual({
      owner: 'acme',
      repo: 'board',
    })
  })

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseRepository('board')).toBeNull()
    expect(parseRepository('')).toBeNull()
    expect(parseRepository('a/b/c/d')).toBeNull()
    // A clone URL for some other forge is refused rather than read as an owner
    // called `git@somewhere.dev:acme`.
    expect(parseRepository('git@somewhere.dev:acme/board.git')).toBeNull()
  })
})

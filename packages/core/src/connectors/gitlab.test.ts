import { describe, expect, it } from 'vitest'

import type { Http, HttpRequest } from '../ports/index.ts'
import { encodeBase64 } from './base64.ts'
import { gitLabProvider, parseGitLabProject } from './gitlab.ts'
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
  apiBaseUrl: 'https://gitlab.com/api/v4',
  project: 'acme/team/board',
  branch: 'main',
  token: 'glpat-secret',
}

describe('project addressing', () => {
  it('encodes the whole path as one segment, subgroups included', async () => {
    // `acme/team/board` must arrive as acme%2Fteam%2Fboard; joining the
    // segments instead produces a 404 that reads like a missing repository.
    const { http, calls } = fakeHttp([{ status: 404, body: '{}' }])
    await gitLabProvider(http, config).readFile('.kanbo/manifest.json')
    expect(calls[0]?.url).toContain('/projects/acme%2Fteam%2Fboard/')
  })

  it('authenticates with PRIVATE-TOKEN, which is what a PAT uses', async () => {
    const { http, calls } = fakeHttp([{ status: 404, body: '{}' }])
    await gitLabProvider(http, config).readFile('x')
    expect(calls[0]?.init.headers['PRIVATE-TOKEN']).toBe('glpat-secret')
    expect(calls[0]?.init.headers['Authorization']).toBeUndefined()
  })
})

describe('reading a file', () => {
  it('decodes the content and takes last_commit_id as the version', async () => {
    // blob_id is the hash of the content; last_commit_id is what the write
    // endpoint compares against, and sending the wrong one is always refused.
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify({
          content: encodeBase64('hello'),
          blob_id: 'blob-hash',
          last_commit_id: 'commit-abc',
        }),
      },
    ])
    const file = await gitLabProvider(http, config).readFile('.kanbo/x.ndjson')
    expect(file).toEqual({ path: '.kanbo/x.ndjson', content: 'hello', sha: 'commit-abc' })
  })

  it('treats a missing file as absent, which is the normal first sync', async () => {
    const { http } = fakeHttp([{ status: 404, body: '{}' }])
    expect(await gitLabProvider(http, config).readFile('x')).toBeNull()
  })

  it('explains a refused token rather than reporting a bare number', async () => {
    const { http } = fakeHttp([{ status: 401, body: '{}' }])
    await expect(gitLabProvider(http, config).readFile('x')).rejects.toThrow(/api. scope|refused/i)
  })

  it('never puts the token in an error', async () => {
    const { http } = fakeHttp([{ status: 500, body: '{"token":"glpat-secret"}' }])
    await expect(gitLabProvider(http, config).readFile('x')).rejects.toThrow(
      expect.not.stringContaining('glpat-secret') as unknown as string,
    )
  })
})

describe('writing a file', () => {
  it('creates with POST when there is no version yet', async () => {
    const { http, calls } = fakeHttp([{ status: 201, body: '{}' }])
    await gitLabProvider(http, config).writeFile({
      path: '.kanbo/ops/a.ndjson',
      content: 'line',
      message: 'kanbo',
    })
    expect(calls[0]?.init.method).toBe('POST')
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).not.toHaveProperty('last_commit_id')
  })

  it('updates with PUT and passes the expected commit', async () => {
    // GitLab uses a different verb for create and update and refuses the wrong
    // one, which GitHub does not.
    const { http, calls } = fakeHttp([{ status: 200, body: '{}' }])
    await gitLabProvider(http, config).writeFile({
      path: '.kanbo/ops/a.ndjson',
      content: 'line',
      sha: 'commit-abc',
      message: 'kanbo',
    })
    expect(calls[0]?.init.method).toBe('PUT')
    expect(JSON.parse(calls[0]?.init.body ?? '{}').last_commit_id).toBe('commit-abc')
  })

  it('recognises a stale write reported as a 400', async () => {
    // The case that matters: GitLab does not use 409 here, so a status-only
    // check would surface a conflict as a generic failure and the sync engine
    // would never retry.
    const { http } = fakeHttp([
      {
        status: 400,
        body: '{"message":"You are attempting to update a file that has changed since you started editing it."}',
      },
    ])
    await expect(
      gitLabProvider(http, config).writeFile({ path: 'x', content: 'y', sha: 'old', message: 'm' }),
    ).rejects.toThrow(ConflictError)
  })

  it('still reports an ordinary 400 as an error, not a conflict', async () => {
    const { http } = fakeHttp([{ status: 400, body: '{"message":"branch is missing"}' }])
    await expect(
      gitLabProvider(http, config).writeFile({ path: 'x', content: 'y', message: 'm' }),
    ).rejects.toThrow(ProviderError)
  })
})

describe('listing files', () => {
  it('returns blobs and leaves directories out', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify([
          { path: '.kanbo/ops/a.ndjson', type: 'blob' },
          { path: '.kanbo/ops/nested', type: 'tree' },
        ]),
      },
    ])
    expect(await gitLabProvider(http, config).listFiles('.kanbo/ops')).toEqual([
      '.kanbo/ops/a.ndjson',
    ])
  })

  it('treats an absent directory as empty, since git has no empty directories', async () => {
    const { http } = fakeHttp([{ status: 404, body: '{}' }])
    expect(await gitLabProvider(http, config).listFiles('.kanbo/ops')).toEqual([])
  })
})

describe('issues', () => {
  it('reads iid, which is the number people quote, not the global id', async () => {
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify([
          {
            id: 90210,
            iid: 12,
            title: 'Login crash',
            description: 'body',
            state: 'opened',
            labels: ['bug'],
            assignees: [{ username: 'max' }],
            web_url: 'https://gitlab.com/acme/team/board/-/issues/12',
            updated_at: '2026-08-07T10:00:00Z',
          },
        ]),
      },
    ])
    const [issue] = await gitLabProvider(http, config).listIssues({})
    expect(issue).toMatchObject({
      number: 12,
      title: 'Login crash',
      body: 'body',
      state: 'open',
      labels: ['bug'],
      assignees: ['max'],
    })
  })

  it('maps GitLab"s "opened" onto the open state the domain uses', async () => {
    const { http } = fakeHttp([
      { status: 200, body: JSON.stringify([{ iid: 1, state: 'opened' }]) },
    ])
    expect((await gitLabProvider(http, config).listIssues({}))[0]?.state).toBe('open')
  })

  it('closes an issue with a verb, because GitLab ignores a state', async () => {
    const { http, calls } = fakeHttp([{ status: 200, body: '{"iid":12,"state":"closed"}' }])
    await gitLabProvider(http, config).updateIssue(12, { state: 'closed' })
    expect(JSON.parse(calls[0]?.init.body ?? '{}')).toEqual({ state_event: 'close' })
  })

  it('sends a description, not a body', async () => {
    const { http, calls } = fakeHttp([{ status: 201, body: '{"iid":1}' }])
    await gitLabProvider(http, config).createIssue({ title: 'T', body: 'B', labels: ['bug'] })
    const sent = JSON.parse(calls[0]?.init.body ?? '{}')
    expect(sent).toMatchObject({ title: 'T', description: 'B', labels: 'bug' })
  })
})

describe('merge requests', () => {
  it('arrives as a pull request, with its pipeline already resolved', async () => {
    // GitLab reports the pipeline inline, so unlike GitHub this costs no extra
    // request per merge request.
    const { http } = fakeHttp([
      {
        status: 200,
        body: JSON.stringify([
          {
            iid: 7,
            title: 'KAN-42 groundwork',
            description: 'closes #12',
            state: 'merged',
            draft: false,
            web_url: 'https://gitlab.com/x/-/merge_requests/7',
            source_branch: 'feat/KAN-42',
            head_pipeline: { status: 'success' },
          },
        ]),
      },
    ])
    expect((await gitLabProvider(http, config).listPullRequests())[0]).toEqual({
      number: 7,
      title: 'KAN-42 groundwork',
      body: 'closes #12',
      state: 'merged',
      draft: false,
      url: 'https://gitlab.com/x/-/merge_requests/7',
      branch: 'feat/KAN-42',
      checks: 'passing',
    })
  })

  it('reads the older work_in_progress flag as a draft', async () => {
    const { http } = fakeHttp([
      { status: 200, body: JSON.stringify([{ iid: 1, work_in_progress: true }]) },
    ])
    expect((await gitLabProvider(http, config).listPullRequests())[0]?.draft).toBe(true)
  })

  it('leaves checks unknown when no pipeline ran, never "passing"', async () => {
    const { http } = fakeHttp([{ status: 200, body: JSON.stringify([{ iid: 1 }]) }])
    expect((await gitLabProvider(http, config).listPullRequests())[0]?.checks).toBeNull()
  })
})

describe('parseGitLabProject', () => {
  it('accepts a plain path, subgroups included', () => {
    expect(parseGitLabProject('acme/board')).toBe('acme/board')
    expect(parseGitLabProject('acme/team/board')).toBe('acme/team/board')
  })

  it('accepts the URL someone copied out of the address bar', () => {
    expect(parseGitLabProject('https://gitlab.com/acme/team/board')).toBe('acme/team/board')
    expect(parseGitLabProject('https://gitlab.example.com/acme/board.git')).toBe('acme/board')
  })

  it('refuses something that is not a project path', () => {
    expect(parseGitLabProject('board')).toBeNull()
    expect(parseGitLabProject('')).toBeNull()
  })
})

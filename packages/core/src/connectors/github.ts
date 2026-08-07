/**
 * The GitHub Contents API, behind the GitProvider boundary.
 *
 * Everything GitHub-specific is here and nowhere else: the URL shapes, the
 * base64 payloads, and the fact that it reports a concurrent write as 409 or
 * 422 depending on the day. The sync engine has never heard of any of it.
 *
 * Contents rather than the Git data API, and no git client in the browser:
 * that keeps sync to plain HTTPS against one host, which is what lets the
 * page's policy be narrowed to that host and keeps the privacy promise whole.
 * A CORS proxy would quietly put a third party in the middle of everything.
 */
import type { Http } from '../ports/index.ts'
import type { IssueConnector, RemoteIssue, RemotePullRequest } from './issues.ts'
import { decodeBase64, encodeBase64 } from './base64.ts'
import { ConflictError, type GitProvider, ProviderError, type WriteRequest } from './provider.ts'

export type GitHubConfig = {
  /** e.g. `https://api.github.com`, or a GitHub Enterprise host. */
  readonly apiBaseUrl: string
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly token: string
}

export function gitHubProvider(http: Http, config: GitHubConfig): GitProvider & IssueConnector {
  const repo = `${config.apiBaseUrl.replace(/\/+$/, '')}/repos/${config.owner}/${config.repo}`
  const base = `${repo}/contents`

  const headers = () => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${config.token}`,
  })

  /**
   * Errors never carry the response body verbatim.
   *
   * A forge happily echoes a request back in its error payload, and the token
   * travels in the request. Anything that reaches a log or a screen has to be
   * safe to read over someone's shoulder.
   */
  const fail = (status: number, action: string): never => {
    if (status === 401 || status === 403) {
      throw new ProviderError(
        `GitHub refused the request (${status}). The token may be missing the \`repo\` scope, or the repository may be private to it.`,
        status,
      )
    }
    if (status === 404) {
      throw new ProviderError(
        `GitHub could not find ${config.owner}/${config.repo} on branch ${config.branch}.`,
        status,
      )
    }
    throw new ProviderError(`GitHub returned ${status} while trying to ${action}.`, status)
  }

  return {
    id: 'github',
    apiBaseUrl: config.apiBaseUrl,

    async readFile(path) {
      const url = `${base}/${encodeURI(path)}?ref=${encodeURIComponent(config.branch)}`
      const response = await http.request(url, { method: 'GET', headers: headers() })

      // A file that does not exist yet is the normal state of a first sync, not
      // a failure worth reporting upward.
      if (response.status === 404) return null
      if (response.status >= 400) fail(response.status, `read ${path}`)

      const payload: unknown = JSON.parse(response.body)
      if (typeof payload !== 'object' || payload === null) return null
      const record = payload as Record<string, unknown>
      if (typeof record['content'] !== 'string' || typeof record['sha'] !== 'string') return null

      return { path, content: decodeBase64(record['content']), sha: record['sha'] }
    },

    async writeFile(request: WriteRequest) {
      const url = `${base}/${encodeURI(request.path)}`
      const response = await http.request(url, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: request.message,
          content: encodeBase64(request.content),
          branch: config.branch,
          ...(request.sha ? { sha: request.sha } : {}),
        }),
      })

      // 409 is the documented concurrent-write answer; 422 arrives when the sha
      // is stale, which is the same situation wearing a different number.
      if (response.status === 409 || response.status === 422) {
        throw new ConflictError(request.path)
      }
      if (response.status >= 400) fail(response.status, `write ${request.path}`)

      const payload: unknown = JSON.parse(response.body)
      const content = (payload as { content?: { sha?: unknown } })?.content
      const sha = typeof content?.sha === 'string' ? content.sha : ''
      return { sha }
    },

    async listFiles(prefix) {
      const url = `${base}/${encodeURI(prefix)}?ref=${encodeURIComponent(config.branch)}`
      const response = await http.request(url, { method: 'GET', headers: headers() })

      // An empty directory does not exist in git, so 404 means "nothing yet".
      if (response.status === 404) return []
      if (response.status >= 400) fail(response.status, `list ${prefix}`)

      const payload: unknown = JSON.parse(response.body)
      if (!Array.isArray(payload)) return []

      return payload
        .filter(
          (entry): entry is { path: string; type: string } =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as Record<string, unknown>)['path'] === 'string',
        )
        .filter((entry) => entry.type === 'file')
        .map((entry) => entry.path)
    },

    // ---------------------------------------------------------- issues

    async listIssues({ since } = {}) {
      const query = new URLSearchParams({ state: 'all', per_page: '100' })
      if (since !== undefined) query.set('since', new Date(since).toISOString())

      const response = await http.request(`${repo}/issues?${query.toString()}`, {
        method: 'GET',
        headers: headers(),
      })
      if (response.status >= 400) fail(response.status, 'list issues')

      const payload: unknown = JSON.parse(response.body)
      if (!Array.isArray(payload)) return []

      // GitHub returns pull requests from the issues endpoint. They are a
      // different thing on the board and importing them as cards would double
      // every piece of work in flight.
      return payload
        .filter(
          (entry) => typeof entry === 'object' && entry !== null && !('pull_request' in entry),
        )
        .map(toIssue)
    },

    async createIssue(input) {
      const response = await http.request(`${repo}/issues`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
      })
      if (response.status >= 400) fail(response.status, 'create an issue')
      return toIssue(JSON.parse(response.body))
    },

    async updateIssue(number, patch) {
      const response = await http.request(`${repo}/issues/${number}`, {
        method: 'PATCH',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (response.status >= 400) fail(response.status, `update issue ${number}`)
      return toIssue(JSON.parse(response.body))
    },

    async listPullRequests() {
      const response = await http.request(`${repo}/pulls?state=all&per_page=100`, {
        method: 'GET',
        headers: headers(),
      })
      if (response.status >= 400) fail(response.status, 'list pull requests')

      const payload: unknown = JSON.parse(response.body)
      if (!Array.isArray(payload)) return []
      return payload.map(toPullRequest)
    },
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toIssue(raw: unknown): RemoteIssue {
  const entry = (raw ?? {}) as Record<string, unknown>
  const labels = Array.isArray(entry['labels'])
    ? entry['labels'].map((label) =>
        typeof label === 'string' ? label : asString((label as Record<string, unknown>)?.['name']),
      )
    : []
  const assignees = Array.isArray(entry['assignees'])
    ? entry['assignees'].map((user) => asString((user as Record<string, unknown>)?.['login']))
    : []

  return {
    number: typeof entry['number'] === 'number' ? entry['number'] : 0,
    title: asString(entry['title']),
    // A GitHub issue with an empty body reports null, not an empty string.
    body: asString(entry['body']),
    state: entry['state'] === 'closed' ? 'closed' : 'open',
    labels: labels.filter(Boolean),
    assignees: assignees.filter(Boolean),
    url: asString(entry['html_url']),
    updatedAt: Date.parse(asString(entry['updated_at'])) || 0,
  }
}

function toPullRequest(raw: unknown): RemotePullRequest {
  const entry = (raw ?? {}) as Record<string, unknown>
  const merged = asString(entry['merged_at']) !== ''
  return {
    number: typeof entry['number'] === 'number' ? entry['number'] : 0,
    title: asString(entry['title']),
    body: asString(entry['body']),
    state: merged ? 'merged' : entry['state'] === 'closed' ? 'closed' : 'open',
    draft: entry['draft'] === true,
    url: asString(entry['html_url']),
    branch: asString((entry['head'] as Record<string, unknown>)?.['ref']),
    // GitHub does not report check status on the pull-request payload, so it
    // is filled in by a second call only for the ones actually shown on a
    // board — see `withChecks` below. Null means unknown, never "passing".
    checks: null,
  }
}

/** Split `owner/repo`, or a full GitHub URL, into its parts. */
export function parseRepository(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\.git$/, '')

  // `git@github.com:acme/board` is the other shape a clone URL comes in, and
  // its colon is not a path separator. Left alone, the fallback split on `/`
  // reads `git@github.com:acme` as the owner and the request 404s in a way that
  // reads like a missing repository rather than a mistyped one.
  const normalised = trimmed.replace(/^[^@\s]+@([^:\s]+):/, '$1/')

  const fromUrl = /github\.[^/]+\/([^/\s]+)\/([^/\s]+)/.exec(normalised)
  if (fromUrl?.[1] && fromUrl[2]) return { owner: fromUrl[1], repo: fromUrl[2] }

  // Normalised here too: a clone URL for some other host now splits into three
  // parts and is refused, which is the right answer. Returning an owner of
  // `git@somewhere.dev:acme` would be a guess dressed up as a reading.
  const parts = normalised.split('/').filter(Boolean)
  if (parts.length === 2 && parts[0] && parts[1]) return { owner: parts[0], repo: parts[1] }
  return null
}

/**
 * Fill in check status for the pull requests a board actually shows.
 *
 * GitHub needs a request per commit for this, so it is deliberately not part
 * of `listPullRequests`: a repository with two hundred open pull requests
 * would spend two hundred requests answering a question about the four on
 * screen. A failure leaves `checks` null, because "unknown" and "passing" must
 * never look the same.
 */
export async function withChecks(
  http: Http,
  config: GitHubConfig,
  pulls: readonly RemotePullRequest[],
): Promise<readonly RemotePullRequest[]> {
  const repo = `${config.apiBaseUrl.replace(/\/+$/, '')}/repos/${config.owner}/${config.repo}`

  return Promise.all(
    pulls.map(async (pull) => {
      try {
        const response = await http.request(`${repo}/commits/${pull.branch}/check-runs`, {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${config.token}`,
          },
        })
        if (response.status >= 400) return pull

        const runs = (JSON.parse(response.body) as { check_runs?: unknown }).check_runs
        if (!Array.isArray(runs) || runs.length === 0) return pull

        const states = runs.map((run) => {
          const entry = run as Record<string, unknown>
          return entry['status'] === 'completed' ? asString(entry['conclusion']) : 'pending'
        })

        const checks = states.some((state) => state === 'failure' || state === 'timed_out')
          ? 'failing'
          : states.some((state) => state === 'pending')
            ? 'pending'
            : 'passing'

        return { ...pull, checks }
      } catch {
        return pull
      }
    }),
  )
}

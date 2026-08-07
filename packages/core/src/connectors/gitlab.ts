/**
 * GitLab, behind the same boundary GitHub sits behind.
 *
 * This file is the proof that the boundary was worth drawing: the sync engine,
 * the merge, the issue reconciliation and the pull-request matching are all
 * unchanged, and none of them has heard of GitLab. What differs is entirely
 * local to this module, and it differs more than the shape of a URL:
 *
 * - **Concurrency is a commit id, not a blob hash.** GitHub takes the `sha` of
 *   the file you read; GitLab takes `last_commit_id` — the commit the file was
 *   last changed in. Both mean "refuse this write if the file moved on", so
 *   `RemoteFile.sha` carries whichever the provider needs and the engine never
 *   has to know which it got.
 * - **A project is one path segment**, so `owner/repo` is URL-encoded whole.
 * - **Issues are numbered per project (`iid`)**, not per repository, and the
 *   two are different fields on the same response.
 * - **A merge request is not a pull request**, but it answers the same
 *   question, so it arrives as one.
 */
import type { Http } from '../ports/index.ts'
import { decodeBase64, encodeBase64 } from './base64.ts'
import type { IssueConnector, RemoteIssue, RemotePullRequest } from './issues.ts'
import { ConflictError, type GitProvider, ProviderError, type WriteRequest } from './provider.ts'

export type GitLabConfig = {
  /** e.g. `https://gitlab.com/api/v4`, or a self-hosted instance. */
  readonly apiBaseUrl: string
  /** `group/project`, including any subgroups. */
  readonly project: string
  readonly branch: string
  readonly token: string
}

export function gitLabProvider(http: Http, config: GitLabConfig): GitProvider & IssueConnector {
  // The whole path is one segment, subgroups and all, so it is encoded whole
  // rather than joined — `group/sub/project` must arrive as `group%2Fsub%2Fproject`.
  const base = `${config.apiBaseUrl.replace(/\/+$/, '')}/projects/${encodeURIComponent(config.project)}`

  // PRIVATE-TOKEN is what a personal access token uses; Bearer is for OAuth,
  // and sending the wrong one produces a 401 that reads like a bad token.
  const headers = () => ({ 'PRIVATE-TOKEN': config.token })

  const fail = (status: number, action: string): never => {
    if (status === 401 || status === 403) {
      throw new ProviderError(
        `GitLab refused the request (${status}). The token may be missing the \`api\` scope, or lack write access to ${config.project}.`,
        status,
      )
    }
    if (status === 404) {
      throw new ProviderError(
        `GitLab could not find ${config.project} on branch ${config.branch}.`,
        status,
      )
    }
    throw new ProviderError(`GitLab returned ${status} while trying to ${action}.`, status)
  }

  const filePath = (path: string) => `${base}/repository/files/${encodeURIComponent(path)}`

  return {
    id: 'gitlab',
    apiBaseUrl: config.apiBaseUrl,

    async readFile(path) {
      const response = await http.request(
        `${filePath(path)}?ref=${encodeURIComponent(config.branch)}`,
        { method: 'GET', headers: headers() },
      )

      // Absent is the normal state of a first sync, not a failure.
      if (response.status === 404) return null
      if (response.status >= 400) fail(response.status, `read ${path}`)

      const payload = JSON.parse(response.body) as Record<string, unknown>
      if (typeof payload['content'] !== 'string') return null

      // last_commit_id, not blob_id: it is what the write endpoint compares
      // against, and passing the blob hash instead is refused every time.
      const sha = typeof payload['last_commit_id'] === 'string' ? payload['last_commit_id'] : ''
      return { path, content: decodeBase64(payload['content']), sha }
    },

    async writeFile(request: WriteRequest) {
      const body = JSON.stringify({
        branch: config.branch,
        content: encodeBase64(request.content),
        encoding: 'base64',
        commit_message: request.message,
        ...(request.sha ? { last_commit_id: request.sha } : {}),
      })

      // A file that exists must be updated and one that does not must be
      // created; GitLab uses a different verb for each and refuses the wrong one.
      const response = await http.request(filePath(request.path), {
        method: request.sha ? 'PUT' : 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body,
      })

      // 400 carries the stale-commit case in its message, which is why the body
      // is inspected here rather than the status alone.
      if (response.status === 409 || (response.status === 400 && isStale(response.body))) {
        throw new ConflictError(request.path)
      }
      if (response.status >= 400) fail(response.status, `write ${request.path}`)

      // The write response does not carry the new commit id, so the caller
      // re-reads on its next pull. Returning a wrong id would be worse than
      // returning none.
      return { sha: '' }
    },

    async listFiles(prefix) {
      const query = new URLSearchParams({
        path: prefix,
        ref: config.branch,
        per_page: '100',
      })
      const response = await http.request(`${base}/repository/tree?${query.toString()}`, {
        method: 'GET',
        headers: headers(),
      })

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
        .filter((entry) => entry.type === 'blob')
        .map((entry) => entry.path)
    },

    // ------------------------------------------------------------- issues

    async listIssues({ since } = {}) {
      const query = new URLSearchParams({ scope: 'all', per_page: '100' })
      if (since !== undefined) query.set('updated_after', new Date(since).toISOString())

      const response = await http.request(`${base}/issues?${query.toString()}`, {
        method: 'GET',
        headers: headers(),
      })
      if (response.status >= 400) fail(response.status, 'list issues')

      const payload: unknown = JSON.parse(response.body)
      return Array.isArray(payload) ? payload.map(toIssue) : []
    },

    async createIssue(input) {
      const response = await http.request(`${base}/issues`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: input.title,
          description: input.body,
          labels: input.labels.join(','),
        }),
      })
      if (response.status >= 400) fail(response.status, 'create an issue')
      return toIssue(JSON.parse(response.body))
    },

    async updateIssue(number, patch) {
      const response = await http.request(`${base}/issues/${number}`, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.body === undefined ? {} : { description: patch.body }),
          // GitLab takes a verb, not a state, and ignores a state it does not
          // recognise rather than reporting one.
          ...(patch.state === undefined
            ? {}
            : { state_event: patch.state === 'closed' ? 'close' : 'reopen' }),
        }),
      })
      if (response.status >= 400) fail(response.status, `update issue ${number}`)
      return toIssue(JSON.parse(response.body))
    },

    async listPullRequests() {
      const response = await http.request(`${base}/merge_requests?scope=all&per_page=100`, {
        method: 'GET',
        headers: headers(),
      })
      if (response.status >= 400) fail(response.status, 'list merge requests')

      const payload: unknown = JSON.parse(response.body)
      return Array.isArray(payload) ? payload.map(toMergeRequest) : []
    },
  }
}

/** GitLab reports a stale write as a 400 whose message names the conflict. */
function isStale(body: string): boolean {
  return /last_commit_id|changed since|conflict/i.test(body)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function toIssue(raw: unknown): RemoteIssue {
  const entry = (raw ?? {}) as Record<string, unknown>
  return {
    // `iid` is the number people see and quote; `id` is global and means
    // nothing to anyone reading the board.
    number: typeof entry['iid'] === 'number' ? entry['iid'] : 0,
    title: asString(entry['title']),
    body: asString(entry['description']),
    state: entry['state'] === 'closed' ? 'closed' : 'open',
    labels: Array.isArray(entry['labels'])
      ? entry['labels'].filter((label): label is string => typeof label === 'string')
      : [],
    assignees: Array.isArray(entry['assignees'])
      ? entry['assignees']
          .map((user) => asString((user as Record<string, unknown>)?.['username']))
          .filter(Boolean)
      : [],
    url: asString(entry['web_url']),
    updatedAt: Date.parse(asString(entry['updated_at'])) || 0,
  }
}

function toMergeRequest(raw: unknown): RemotePullRequest {
  const entry = (raw ?? {}) as Record<string, unknown>
  const state = asString(entry['state'])

  // GitLab reports the pipeline inline, which GitHub does not — so this is one
  // request rather than one per merge request.
  const pipeline = (entry['pipeline'] ?? entry['head_pipeline']) as
    Record<string, unknown> | undefined
  const status = asString(pipeline?.['status'])

  return {
    number: typeof entry['iid'] === 'number' ? entry['iid'] : 0,
    title: asString(entry['title']),
    body: asString(entry['description']),
    state: state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : 'open',
    draft: entry['draft'] === true || entry['work_in_progress'] === true,
    url: asString(entry['web_url']),
    branch: asString(entry['source_branch']),
    checks:
      status === 'success'
        ? 'passing'
        : status === 'failed'
          ? 'failing'
          : status === 'running' || status === 'pending'
            ? 'pending'
            : null,
  }
}

/** Accept `group/project`, or the URL someone copied out of the address bar. */
export function parseGitLabProject(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  const fromUrl = /^https?:\/\/[^/]+\/(.+)$/.exec(trimmed)
  const path = fromUrl?.[1] ?? trimmed
  // Subgroups are legal and common, so anything with at least one slash counts.
  return /^[^/\s]+(\/[^/\s]+)+$/.test(path) ? path : null
}

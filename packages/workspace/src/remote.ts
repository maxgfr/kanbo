import {
  type GitHubConfig,
  type GitProvider,
  type Http,
  type IssueSyncPlan,
  type ItemDelivery,
  type RemoteIssue,
  type RemotePullRequest,
  deliveryOf,
  hasIssues,
  linkPullRequests,
  linksByItem,
  membersForHandles,
  newItem,
  operationsForSync,
  parseGitLabProject,
  parseRepository,
  planIssueSync,
  gitHubProvider,
  gitLabProvider,
  synchronise,
  typeFromLabels,
  withChecks,
} from '@kanbo/core'
import { nodeHttp, readToken, storeToken } from '@kanbo/adapters-node'

import { KanboError } from './resolve.ts'
import { type Workspace, replaceLog } from './session.ts'
import type { Outcome } from './write.ts'

/**
 * Repository mode, at a terminal.
 *
 * Every line of the sync itself is `@kanbo/core`: `synchronise` speaks only to
 * the `GitProvider` interface and touches no global, and the GitHub and GitLab
 * providers take their `Http` by injection. So there was never anything to
 * write here except the wiring the browser has in `state/sync.ts` — a place to
 * keep the settings, a vault for the token, and a transport.
 *
 * The transport is `nodeHttp`, which refuses any origin but the configured one.
 * That is not decoration: a CLI that could be pointed anywhere would be a very
 * convenient way to send a repository token somewhere else. The browser has a
 * Content-Security-Policy behind it as well; here the check is all there is,
 * which is why it is in the one module the build allows to touch the network.
 */
const REMOTE_KEY = 'remote'

export type Remote = {
  readonly forge: 'github' | 'gitlab'
  /** Base URL of the forge API — `https://api.github.com`, or a self-hosted one. */
  readonly apiBaseUrl: string
  /** `owner/name`, as the forge spells it. */
  readonly repository: string
  readonly branch: string
}

export const FORGE_DEFAULTS: Record<Remote['forge'], { api: string; example: string }> = {
  github: { api: 'https://api.github.com', example: 'owner/name' },
  gitlab: { api: 'https://gitlab.com/api/v4', example: 'group/name' },
}

export async function remoteGet(workspace: Workspace): Promise<Remote | null> {
  const stored = await workspace.ports.storage.get(REMOTE_KEY)
  if (!stored) return null
  try {
    return JSON.parse(new TextDecoder().decode(stored)) as Remote
  } catch {
    return null
  }
}

export async function remoteSet(
  workspace: Workspace,
  patch: Partial<Remote>,
): Promise<Outcome<Remote>> {
  const current = await remoteGet(workspace)
  const forge = patch.forge ?? current?.forge ?? 'github'

  const remote: Remote = {
    forge,
    apiBaseUrl: patch.apiBaseUrl ?? current?.apiBaseUrl ?? FORGE_DEFAULTS[forge].api,
    repository: patch.repository ?? current?.repository ?? '',
    branch: patch.branch ?? current?.branch ?? 'main',
  }

  // Refused here rather than at the first request, so a typo is a sentence
  // instead of a network error twenty seconds later.
  if (!remote.apiBaseUrl.startsWith('https://')) {
    throw new KanboError('The forge API must be an https address.')
  }
  const named =
    remote.forge === 'gitlab'
      ? parseGitLabProject(remote.repository)
      : parseRepository(remote.repository)
  if (remote.repository !== '' && !named) {
    throw new KanboError(`The repository should look like ${FORGE_DEFAULTS[remote.forge].example}.`)
  }

  await workspace.ports.storage.set(REMOTE_KEY, new TextEncoder().encode(JSON.stringify(remote)))
  return { workspace, result: remote }
}

export async function tokenSet(workspace: Workspace, token: string): Promise<void> {
  await storeToken(workspace.ports.storage, workspace.root, token)
}

export async function hasStoredToken(workspace: Workspace): Promise<boolean> {
  return (await readToken(workspace.ports.storage, workspace.root)) !== null
}

/**
 * The provider, or the reason there is not one.
 *
 * Mirrors `buildProvider` in the browser, including the order it checks things:
 * settings, then repository, then token — so somebody setting this up is told
 * about one missing piece at a time, in the order they would supply them.
 */
type Connection = {
  readonly provider: GitProvider
  readonly http: Http
  /** Present only for GitHub, which is the forge that can report check runs. */
  readonly github: GitHubConfig | null
}

async function connect(workspace: Workspace): Promise<Connection> {
  const remote = await remoteGet(workspace)
  if (!remote) throw new KanboError('No repository configured. Run `kanbo remote set` first.')
  if (remote.repository === '') throw new KanboError('No repository named. Use --repo owner/name.')

  const token = await readToken(workspace.ports.storage, workspace.root)
  if (!token) throw new KanboError('No access token saved here. Run `kanbo token set`.')

  const http = nodeHttp(remote.apiBaseUrl)

  if (remote.forge === 'gitlab') {
    const project = parseGitLabProject(remote.repository)
    if (!project) throw new KanboError('The project should look like group/name.')
    return {
      provider: gitLabProvider(http, {
        apiBaseUrl: remote.apiBaseUrl,
        project,
        branch: remote.branch,
        token,
      }),
      http,
      github: null,
    }
  }

  const repository = parseRepository(remote.repository)
  if (!repository) throw new KanboError('The repository should look like owner/name.')

  const github: GitHubConfig = {
    apiBaseUrl: remote.apiBaseUrl,
    owner: repository.owner,
    repo: repository.repo,
    branch: remote.branch,
    token,
  }
  return { provider: gitHubProvider(http, github), http, github }
}

export async function syncNow(
  workspace: Workspace,
): Promise<Outcome<{ added: number; total: number }>> {
  const { provider } = await connect(workspace)
  const result = await synchronise(provider, workspace.device, workspace.log)
  const after = await replaceLog(workspace, result.log)

  return {
    workspace: after,
    result: { added: result.log.length - workspace.log.length, total: result.log.length },
  }
}

export type IssueReport = {
  readonly imported: number
  readonly updated: number
  readonly pushed: number
  readonly plan: IssueSyncPlan
}

/** Reconcile the board with the repository's issues, by the same policy the web runs. */
export async function issuesReconcile(
  workspace: Workspace,
  apply: boolean,
): Promise<Outcome<IssueReport>> {
  const { provider } = await connect(workspace)
  if (!hasIssues(provider)) throw new KanboError('This forge does not expose issues.')

  const { project } = workspace
  const doneStatuses = new Set(
    project.statuses.filter((status) => status.category === 'done').map((status) => status.id),
  )

  const issues: readonly RemoteIssue[] = await provider.listIssues({})
  const plan = planIssueSync(project, issues, doneStatuses)

  if (!apply) {
    return {
      workspace,
      result: { imported: 0, updated: 0, pushed: 0, plan },
    }
  }

  const bodies = operationsForSync(project, plan, (issue, statusId) =>
    newItem(project, workspace.ports, {
      title: issue.title,
      description: issue.body,
      type: typeFromLabels(issue.labels),
      assignees: membersForHandles(project, issue.assignees),
      ...(statusId ? { statusId } : {}),
    }),
  )

  const after = bodies.length > 0 ? await workspace.commit(...bodies) : workspace

  // Pushing happens after the local side settles, so a failure upward leaves
  // the board consistent rather than half-reconciled.
  let pushed = 0
  for (const change of plan.toPush) {
    try {
      await provider.updateIssue(change.number, { state: change.state })
      pushed++
    } catch {
      // Counted rather than fatal: one issue we cannot write should not stop
      // the rest from reconciling.
    }
  }

  return {
    workspace: after,
    result: {
      imported: plan.toCreate.length,
      updated: plan.toUpdate.length,
      pushed,
      plan,
    },
  }
}

export type DeliveryRow = {
  readonly ref: string
  readonly title: string
  readonly delivery: ItemDelivery
}

/**
 * What is actually shipping: pull requests matched to cards, and what CI says.
 *
 * `deliveryOf` is the same reading the card badge uses, so a terminal and a
 * board never disagree about whether something has merged. Unknown check status
 * stays unknown here too — a terminal that printed "passing" because it could
 * not tell would be worse than one that said nothing.
 */
export async function pullRequests(workspace: Workspace): Promise<readonly DeliveryRow[]> {
  const { provider, http, github } = await connect(workspace)
  if (!hasIssues(provider)) throw new KanboError('This forge does not expose pull requests.')

  const open: readonly RemotePullRequest[] = await provider.listPullRequests()
  const withStatus = github === null ? open : await withChecks(http, github, open)

  const byItem = linksByItem(linkPullRequests(workspace.project, withStatus))

  return workspace.project.items.flatMap((item) => {
    const delivery = deliveryOf(byItem.get(item.id) ?? [])
    return delivery === null ? [] : [{ ref: item.ref, title: item.title, delivery }]
  })
}

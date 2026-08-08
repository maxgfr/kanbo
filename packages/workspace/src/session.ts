import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  type Operation,
  type OperationBody,
  type Ports,
  type Project,
  mergeLogs,
  operationBuilder,
  reduceOperations,
} from '@kanbo/core'
import { nodeDeviceId, nodePorts } from '@kanbo/adapters-node'

/**
 * A project on a disk, opened once.
 *
 * This is the part of the old CLI that was never about a terminal: find the
 * store, read the log, fold it into a project, remember who is at this machine.
 * A serving of it as text was the only thing that ever made it a CLI, and an
 * MCP server needs every line of it and none of that.
 *
 * Nothing here decides anything about a project. It opens one, and hands the
 * domain the three things the domain says it needs.
 */
const LOG_KEY = 'log'

/**
 * Who is at this terminal.
 *
 * Beside the log rather than in it, for the same reason the browser keeps it in
 * localStorage: "I am Ada" is true of a machine, not of a project. Syncing it
 * would tell every other device that they are Ada too.
 */
const ME_KEY = 'me'

/** Where a project lives when nobody says otherwise. */
export function defaultRoot(): string {
  return process.env['KANBO_HOME'] ?? join(homedir(), '.kanbo')
}

export type Workspace = {
  readonly root: string
  readonly ports: Ports
  readonly device: string
  readonly log: readonly Operation[]
  readonly project: Project
  /** The member id claimed on this machine, for `assignee:@me`. */
  readonly meId: string | null
  /**
   * Append changes, in the same total order every device computes.
   *
   * Returns a workspace reading the result, rather than mutating this one: an
   * action that has committed should not be able to keep answering questions
   * from before it did.
   */
  commit(...bodies: readonly OperationBody[]): Promise<Workspace>
  /** Re-read the store — after an import, a sync, or anything else's write. */
  reload(): Promise<Workspace>
  claim(memberId: string | null): Promise<Workspace>
}

async function loadLog(ports: Ports): Promise<readonly Operation[]> {
  const stored = await ports.storage.get(LOG_KEY)
  if (!stored) return []
  const parsed: unknown = JSON.parse(new TextDecoder().decode(stored))
  return Array.isArray(parsed) ? (parsed as readonly Operation[]) : []
}

async function saveLog(ports: Ports, log: readonly Operation[]): Promise<void> {
  await ports.storage.set(LOG_KEY, new TextEncoder().encode(JSON.stringify(log)))
}

async function readMe(ports: Ports): Promise<string | null> {
  const stored = await ports.storage.get(ME_KEY)
  return stored ? new TextDecoder().decode(stored) : null
}

function build(
  root: string,
  ports: Ports,
  device: string,
  log: readonly Operation[],
  meId: string | null,
): Workspace {
  return {
    root,
    ports,
    device,
    log,
    project: reduceOperations(log),
    meId,

    async commit(...bodies) {
      if (bodies.length === 0) return this
      /**
       * The author is whoever claimed this machine.
       *
       * It used to be hardcoded null while `me` sat two lines below, so every
       * change made from a terminal was signed by nobody and the history could
       * never name a CLI user — while knowing exactly who they were.
       */
      const emit = operationBuilder(ports, { deviceId: device, authorId: meId }, log)
      const merged = mergeLogs(log, bodies.map(emit))
      await saveLog(ports, merged)
      return build(root, ports, device, merged, meId)
    },

    async reload() {
      return build(root, ports, device, await loadLog(ports), await readMe(ports))
    },

    async claim(memberId) {
      if (memberId === null) await ports.storage.delete(ME_KEY)
      else await ports.storage.set(ME_KEY, new TextEncoder().encode(memberId))
      return build(root, ports, device, log, memberId)
    },
  }
}

/** Open the project at `root`, creating the directory but never the project. */
export async function openWorkspace(root: string = defaultRoot()): Promise<Workspace> {
  await mkdir(root, { recursive: true })
  const ports = nodePorts(root)
  const device = await nodeDeviceId(ports.storage)
  return build(root, ports, device, await loadLog(ports), await readMe(ports))
}

/** Replace the whole log — the one write that is not an append. Used by import and sync. */
export async function replaceLog(
  workspace: Workspace,
  log: readonly Operation[],
): Promise<Workspace> {
  await saveLog(workspace.ports, log)
  return build(workspace.root, workspace.ports, workspace.device, log, workspace.meId)
}

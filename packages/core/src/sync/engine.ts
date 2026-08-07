/**
 * Keeping a repository and a browser in step.
 *
 * The design rests on one rule: **a device writes only its own file.** Its
 * operations live in `.kanbo/ops/<deviceId>.ndjson` and nowhere else, so two
 * people working at once touch two different paths and the class of git
 * conflict disappears by construction rather than being resolved after the
 * fact. Pulling is then just reading everyone's file and merging the union,
 * which is idempotent, commutative and associative — so every device that has
 * seen the same operations computes the same board.
 *
 * A conflict on a device's own file is still possible: the same person in two
 * tabs, or a push that half-landed. That case is handled the only honest way —
 * re-read, merge what is there with what we have, write again. Nothing is
 * discarded, because the merge is a union.
 *
 * Compaction keeps history from growing without bound. It is deliberately not
 * automatic on every push: rewriting the snapshot on each keystroke would make
 * the repository's history unreadable, which is half the point of using one.
 */
import type { Project } from '../model/types.ts'
import { mergeLogs, operationsOf, sortOperations } from '../ops/log.ts'
import { reduceOperations } from '../ops/reduce.ts'
import type { Operation } from '../ops/types.ts'
import {
  ConflictError,
  type GitProvider,
  MANIFEST_PATH,
  OPS_DIR,
  SNAPSHOT_PATH,
  opsPathFor,
} from '../connectors/provider.ts'

export const SYNC_FORMAT = 1

export type Manifest = {
  readonly format: number
  readonly projectId: string
  readonly devices: readonly string[]
  /** Operations at or below this Lamport counter are folded into the snapshot. */
  readonly watermark: number
}

export type Snapshot = {
  readonly format: number
  readonly watermark: number
  readonly project: Project
}

export type PullResult = {
  readonly operations: readonly Operation[]
  readonly snapshot: Snapshot | null
  readonly manifest: Manifest | null
}

/** One NDJSON line per operation, so a device appends without rewriting. */
export function serialiseLog(operations: readonly Operation[]): string {
  return sortOperations(operations)
    .map((operation) => JSON.stringify(operation))
    .join('\n')
}

/**
 * Parse a log file, skipping lines we cannot read.
 *
 * A single corrupt line — a half-written push, a bad merge someone resolved by
 * hand — must not cost the whole file. Losing one operation is recoverable;
 * refusing to load the project is not.
 */
export function parseLog(content: string): readonly Operation[] {
  const operations: Operation[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isOperation(parsed)) operations.push(parsed)
    } catch {
      // Skipped deliberately; see above.
    }
  }
  return operations
}

function isOperation(value: unknown): value is Operation {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['deviceId'] === 'string' &&
    typeof candidate['lamport'] === 'number' &&
    typeof candidate['kind'] === 'string'
  )
}

export function parseManifest(content: string): Manifest | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate['format'] !== 'number') return null
    return {
      format: candidate['format'],
      projectId: typeof candidate['projectId'] === 'string' ? candidate['projectId'] : '',
      devices: Array.isArray(candidate['devices'])
        ? candidate['devices'].filter((entry): entry is string => typeof entry === 'string')
        : [],
      watermark: typeof candidate['watermark'] === 'number' ? candidate['watermark'] : 0,
    }
  } catch {
    return null
  }
}

/**
 * Read everything the repository has.
 *
 * The snapshot stands in for operations already folded into it, so a long-lived
 * project does not replay its whole history to render a board.
 */
export async function pull(provider: GitProvider): Promise<PullResult> {
  const manifestFile = await provider.readFile(MANIFEST_PATH)
  const manifest = manifestFile ? parseManifest(manifestFile.content) : null

  // Devices come from the directory listing rather than the manifest: a device
  // that pushed before it could update the manifest must still be read, or its
  // work is invisible to everyone else.
  const paths = await provider.listFiles(OPS_DIR)
  const files = await Promise.all(
    paths.filter((path) => path.endsWith('.ndjson')).map((path) => provider.readFile(path)),
  )

  const operations = mergeLogs(
    ...files
      .filter((file): file is NonNullable<typeof file> => file !== null)
      .map((file) => parseLog(file.content)),
  )

  const snapshotFile = await provider.readFile(SNAPSHOT_PATH)
  let snapshot: Snapshot | null = null
  if (snapshotFile) {
    try {
      const parsed: unknown = JSON.parse(snapshotFile.content)
      if (typeof parsed === 'object' && parsed !== null && 'project' in parsed) {
        snapshot = parsed as Snapshot
      }
    } catch {
      // A snapshot is an optimisation, never the only copy: the operations
      // above can always rebuild the project without it.
    }
  }

  return { operations, snapshot, manifest }
}

/**
 * Rebuild the project from whatever the pull returned.
 *
 * Operations at or below the snapshot's watermark are dropped: they are
 * already folded in, and replaying a create over a snapshot that has since
 * seen the item deleted would resurrect it.
 */
export function projectFrom(result: PullResult): Project {
  if (!result.snapshot) return reduceOperations(result.operations)
  const after = result.operations.filter(
    (operation) => operation.lamport > result.snapshot!.watermark,
  )
  return reduceOperations(after, result.snapshot.project)
}

export type PushResult = {
  readonly pushed: number
  /** Everything now in this device's file, including what was already there. */
  readonly log: readonly Operation[]
}

/**
 * Write this device's operations to its own file.
 *
 * The read-merge-write is not belt and braces: the same person in two tabs is
 * one device, and each tab holds part of the history. Merging before writing is
 * what stops the second tab from truncating the first tab's work.
 */
export async function push(
  provider: GitProvider,
  deviceId: string,
  log: readonly Operation[],
  attempt = 0,
): Promise<PushResult> {
  const mine = operationsOf(log, deviceId)
  const path = opsPathFor(deviceId)

  const existing = await provider.readFile(path)
  const merged = existing ? mergeLogs(parseLog(existing.content), mine) : mine

  // Nothing new: writing anyway would add an empty commit to the history for
  // every poll, which makes the repository useless to read.
  if (existing && merged.length === parseLog(existing.content).length) {
    return { pushed: 0, log: merged }
  }

  try {
    await provider.writeFile({
      path,
      content: serialiseLog(merged),
      ...(existing ? { sha: existing.sha } : {}),
      message: `kanbo: ${merged.length} operations from ${deviceId.slice(0, 8)}`,
    })
  } catch (error) {
    // Someone wrote between our read and our write. Re-reading and merging is
    // the whole recovery: the merge is a union, so nothing is lost either way.
    if (error instanceof ConflictError && attempt < 3) {
      return push(provider, deviceId, log, attempt + 1)
    }
    throw error
  }

  return { pushed: merged.length - (existing ? parseLog(existing.content).length : 0), log: merged }
}

/** Record which devices exist, so a fresh clone knows where to look. */
export async function writeManifest(
  provider: GitProvider,
  projectId: string,
  devices: readonly string[],
  watermark: number,
): Promise<void> {
  const existing = await provider.readFile(MANIFEST_PATH)
  const previous = existing ? parseManifest(existing.content) : null

  const manifest: Manifest = {
    format: SYNC_FORMAT,
    projectId,
    devices: [...new Set([...(previous?.devices ?? []), ...devices])].toSorted(),
    watermark: Math.max(previous?.watermark ?? 0, watermark),
  }

  if (previous && JSON.stringify(previous) === JSON.stringify(manifest)) return

  await provider.writeFile({
    path: MANIFEST_PATH,
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    ...(existing ? { sha: existing.sha } : {}),
    message: 'kanbo: update manifest',
  })
}

/**
 * A full cycle: read what everyone has, hand it back merged with ours, write
 * ours. Pull before push, so a push never overwrites work it has not seen.
 */
export async function synchronise(
  provider: GitProvider,
  deviceId: string,
  localLog: readonly Operation[],
): Promise<{ readonly log: readonly Operation[]; readonly project: Project }> {
  const remote = await pull(provider)
  const merged = mergeLogs(remote.operations, localLog)

  await push(provider, deviceId, merged)

  return {
    log: merged,
    project: projectFrom({ ...remote, operations: merged }),
  }
}

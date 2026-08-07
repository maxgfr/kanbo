/**
 * Getting data out, and getting it back in.
 *
 * A local-first tool that cannot export is a trap, so the export is the whole
 * operation log rather than a rendering of the current board: replaying it
 * reconstructs the project exactly, history and metrics included. A snapshot
 * of the current state would be a photograph of a thing whose value is that it
 * is a recording.
 */
import type { Item, Project } from './model/types.ts'
import { mergeLogs } from './ops/log.ts'
import type { Operation } from './ops/types.ts'
import { SCHEMA_VERSION } from './model/types.ts'

export const EXPORT_FORMAT = 1

export type Export = {
  readonly kanbo: number
  readonly schema: number
  readonly exportedAt: number
  readonly operations: readonly Operation[]
}

export function exportJson(operations: readonly Operation[], now: number): string {
  const payload: Export = {
    kanbo: EXPORT_FORMAT,
    schema: SCHEMA_VERSION,
    exportedAt: now,
    operations,
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

/**
 * Read an export, refusing anything we cannot honestly replay.
 *
 * A file from a newer format is rejected rather than partially read: importing
 * three quarters of someone's project and calling it done is the worst
 * available outcome.
 */
export function importJson(text: string): readonly Operation[] {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new ImportError('That file is not JSON.')
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new ImportError('That file does not look like a Kanbo export.')
  }

  const record = payload as Record<string, unknown>
  if (typeof record['kanbo'] !== 'number') {
    throw new ImportError('That file does not look like a Kanbo export.')
  }
  if (record['kanbo'] > EXPORT_FORMAT) {
    throw new ImportError(
      `That export was written by a newer version of Kanbo (format ${record['kanbo']}). Update before importing it.`,
    )
  }
  if (!Array.isArray(record['operations'])) {
    throw new ImportError('That export carries no operations.')
  }

  return record['operations'] as readonly Operation[]
}

/** Merge an import into an existing log: nothing is replaced, only added. */
export function mergeImport(
  existing: readonly Operation[],
  incoming: readonly Operation[],
): readonly Operation[] {
  return mergeLogs(existing, incoming)
}

const CSV_COLUMNS = [
  'ref',
  'title',
  'type',
  'status',
  'priority',
  'points',
  'assignees',
  'labels',
  'sprint',
  'milestone',
  'due',
  'created',
  'started',
  'completed',
] as const

function csvCell(value: string): string {
  // A title containing a comma, a quote or a newline is ordinary; a CSV that
  // breaks on one is not usable for the spreadsheet people actually open it in.
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function isoOrBlank(at: number | null): string {
  return at === null ? '' : new Date(at).toISOString()
}

function nameOf(list: readonly { id: string; name: string }[], id: string | null): string {
  // Names, not ids: a spreadsheet cannot look an id up.
  return id === null ? '' : (list.find((entry) => entry.id === id)?.name ?? id)
}

/** A flat rendering for a spreadsheet. Lossy by nature, and labelled as such. */
export function exportCsv(project: Project): string {
  const rows = project.items.map((item: Item) =>
    [
      item.ref,
      item.title,
      item.type,
      nameOf(project.statuses, item.statusId),
      item.priority,
      item.estimate === null ? '' : String(item.estimate),
      item.assignees.map((id) => nameOf(project.members, id)).join(' '),
      item.labels.map((id) => nameOf(project.labels, id)).join(' '),
      nameOf(project.iterations, item.iterationId),
      nameOf(project.milestones, item.milestoneId),
      item.dueOn ?? '',
      isoOrBlank(item.createdAt),
      isoOrBlank(item.startedAt),
      isoOrBlank(item.completedAt),
    ]
      .map(csvCell)
      .join(','),
  )

  return [CSV_COLUMNS.join(','), ...rows].join('\n')
}

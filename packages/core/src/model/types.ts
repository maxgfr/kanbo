/**
 * What a project is made of.
 *
 * Everything here is data: no methods, no identity beyond ids, no references
 * that a JSON round-trip would lose. That is a requirement rather than a taste
 * — a project has to survive being written to a git repo as text, read back on
 * another machine, and compared field by field during a merge.
 */

export type ItemType = 'epic' | 'story' | 'task' | 'bug' | 'spike' | 'chore'

/** P0 is "drop everything"; P4 is "someday". */
export type Priority = 'p0' | 'p1' | 'p2' | 'p3' | 'p4'

/**
 * Statuses are user-defined, but every one of them belongs to a category, and
 * the metrics read the category rather than the name.
 *
 * Without this, renaming "In Progress" to "Doing" would silently break cycle
 * time, and a team with four in-progress columns could not measure anything at
 * all. The name is for people; the category is for arithmetic.
 */
export type StatusCategory = 'todo' | 'in-progress' | 'done'

export type Status = {
  readonly id: string
  readonly name: string
  readonly category: StatusCategory
  readonly order: string
  /** Null means no limit. Zero is a real limit and means "accept nothing new". */
  readonly wipLimit: number | null
  readonly color: string | null
}

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi-select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'person'
  | 'iteration'

export type Field = {
  readonly id: string
  readonly name: string
  readonly type: FieldType
  /** Choices for select and multi-select; empty for every other type. */
  readonly options: readonly string[]
  readonly order: string
}

/** A date is an ISO-8601 day (`2026-08-07`); an instant is epoch milliseconds. */
export type IsoDate = string
export type Instant = number

export type FieldValue = string | number | boolean | readonly string[] | null

export type LinkType = 'blocks' | 'blocked-by' | 'relates-to' | 'duplicates'

export type Link = {
  readonly type: LinkType
  readonly itemId: string
}

export type Item = {
  readonly id: string
  /** Human-facing reference, e.g. `KAN-42`. Stable for the item's whole life. */
  readonly ref: string
  readonly title: string
  /** Markdown, so an issue body round-trips without loss. */
  readonly description: string
  readonly type: ItemType
  readonly statusId: string
  readonly priority: Priority
  /** Story points, or null when the item has not been estimated. */
  readonly estimate: number | null
  readonly assignees: readonly string[]
  readonly labels: readonly string[]
  readonly milestoneId: string | null
  readonly iterationId: string | null
  /** The epic or story this belongs to. */
  readonly parentId: string | null
  readonly links: readonly Link[]
  readonly order: string
  readonly fields: Readonly<Record<string, FieldValue>>
  readonly dueOn: IsoDate | null
  readonly createdAt: Instant
  readonly updatedAt: Instant
  /**
   * Set when the item first enters an in-progress status, cleared if it goes
   * back to todo. Cycle time is measured from here, so it is derived from
   * status transitions rather than typed by anyone.
   */
  readonly startedAt: Instant | null
  readonly completedAt: Instant | null
  readonly archived: boolean
}

export type Iteration = {
  readonly id: string
  readonly name: string
  readonly goal: string
  readonly startsAt: IsoDate
  readonly endsAt: IsoDate
  /** Points the team expects to complete. Null when the team does not use capacity. */
  readonly capacity: number | null
  readonly order: string
}

export type Milestone = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly dueOn: IsoDate | null
  readonly order: string
}

export type Label = {
  readonly id: string
  readonly name: string
  readonly color: string
}

/**
 * A person, as this project knows them.
 *
 * There is no user directory and no authentication — a member is a name the
 * team agreed on, optionally tied to a forge handle so issue assignment can
 * round-trip.
 */
export type Member = {
  readonly id: string
  readonly name: string
  readonly handle: string | null
}

export type FilterOperator =
  'is' | 'isNot' | 'contains' | 'isEmpty' | 'isNotEmpty' | 'gt' | 'lt' | 'isAnyOf'

export type Filter = {
  /** A field id, or one of the built-in keys: `status`, `type`, `priority`, … */
  readonly key: string
  readonly operator: FilterOperator
  readonly value?: FieldValue
}

export type Sort = {
  readonly key: string
  readonly direction: 'asc' | 'desc'
}

export type ViewKind = 'board' | 'table' | 'backlog' | 'calendar' | 'roadmap'

export type View = {
  readonly id: string
  readonly name: string
  readonly kind: ViewKind
  readonly filters: readonly Filter[]
  readonly sorts: readonly Sort[]
  readonly groupBy: string | null
  /** Field ids shown on a card or as table columns, in order. */
  readonly visibleFields: readonly string[]
  readonly order: string
}

export type Comment = {
  readonly id: string
  readonly itemId: string
  readonly authorId: string | null
  readonly body: string
  readonly createdAt: Instant
  readonly editedAt: Instant | null
}

export type Project = {
  readonly id: string
  readonly name: string
  /** Reference prefix, e.g. `KAN` in `KAN-42`. */
  readonly key: string
  readonly description: string
  /** Incremented when the shape changes in a way older builds cannot read. */
  readonly schemaVersion: number
  readonly statuses: readonly Status[]
  readonly fields: readonly Field[]
  readonly items: readonly Item[]
  readonly iterations: readonly Iteration[]
  readonly milestones: readonly Milestone[]
  readonly labels: readonly Label[]
  readonly members: readonly Member[]
  readonly views: readonly View[]
  readonly comments: readonly Comment[]
  /** Next number for the `key`-prefixed reference. */
  readonly nextRef: number
}

export const SCHEMA_VERSION = 1

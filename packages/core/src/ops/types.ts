/**
 * Every change, as a value.
 *
 * Kanbo never stores "the project" as the thing devices exchange. It stores the
 * sequence of changes that produced it, and each device appends only to its own
 * file. Two people editing at once therefore write to two different files and
 * the class of git conflict disappears by construction rather than being
 * resolved afterwards.
 *
 * Two properties make the merge work, and both are worth stating plainly:
 *
 * **Ordering.** Operations carry a Lamport counter, broken by device id and
 * then operation id. That is a *total* order which every device computes
 * identically from the same set of operations, without any clock being
 * trustworthy. Wall-clock `at` is carried for humans and metrics; it is never
 * used to decide precedence, because devices disagree about the time.
 *
 * **Last write wins, per field.** An `item.set` names only the fields it
 * changes. Folding the log in total order therefore lets the last operation to
 * touch *each field* win, with no per-field metadata anywhere. Two people
 * changing the status and the assignee of one card do not overwrite each other.
 *
 * A useful side effect: the log is the history. Activity feeds, "who changed
 * what", and the timestamped status transitions that cycle time and burndown
 * are computed from all fall out of it, rather than needing to be recorded
 * separately and kept in step.
 */
import type {
  Comment,
  Field,
  FieldValue,
  Item,
  Iteration,
  Label,
  Link,
  Member,
  Milestone,
  Status,
  View,
} from '../model/types.ts'

/** Fields of an item a user can set directly. Derived timestamps are excluded. */
export type ItemPatch = Partial<
  Pick<
    Item,
    | 'title'
    | 'description'
    | 'type'
    | 'priority'
    | 'estimate'
    | 'assignees'
    | 'labels'
    | 'milestoneId'
    | 'iterationId'
    | 'parentId'
    | 'dueOn'
    | 'archived'
  >
>

export type OperationBody =
  | {
      readonly kind: 'project.set'
      readonly patch: { name?: string; description?: string; key?: string }
    }
  | { readonly kind: 'item.create'; readonly item: Item }
  | { readonly kind: 'item.set'; readonly itemId: string; readonly patch: ItemPatch }
  /** Status and position move together: dropping a card is one operation. */
  | {
      readonly kind: 'item.move'
      readonly itemId: string
      readonly statusId: string
      readonly order: string
    }
  | {
      readonly kind: 'item.setField'
      readonly itemId: string
      readonly fieldId: string
      readonly value: FieldValue
    }
  | { readonly kind: 'item.link'; readonly itemId: string; readonly link: Link }
  | {
      readonly kind: 'item.unlink'
      readonly itemId: string
      readonly targetId: string
      readonly linkType: Link['type']
    }
  | { readonly kind: 'item.delete'; readonly itemId: string }
  | { readonly kind: 'status.upsert'; readonly status: Status }
  | { readonly kind: 'status.delete'; readonly statusId: string; readonly moveToId: string }
  | { readonly kind: 'field.upsert'; readonly field: Field }
  | { readonly kind: 'field.delete'; readonly fieldId: string }
  | { readonly kind: 'iteration.upsert'; readonly iteration: Iteration }
  | { readonly kind: 'iteration.delete'; readonly iterationId: string }
  | { readonly kind: 'milestone.upsert'; readonly milestone: Milestone }
  | { readonly kind: 'milestone.delete'; readonly milestoneId: string }
  | { readonly kind: 'label.upsert'; readonly label: Label }
  | { readonly kind: 'label.delete'; readonly labelId: string }
  | { readonly kind: 'member.upsert'; readonly member: Member }
  | { readonly kind: 'member.delete'; readonly memberId: string }
  | { readonly kind: 'view.upsert'; readonly view: View }
  | { readonly kind: 'view.delete'; readonly viewId: string }
  | { readonly kind: 'comment.upsert'; readonly comment: Comment }
  | { readonly kind: 'comment.delete'; readonly commentId: string }

export type OperationKind = OperationBody['kind']

export type OperationMeta = {
  /** Unique per operation. Two devices must never generate the same one. */
  readonly id: string
  /** Which device wrote it — also the name of the file it lives in. */
  readonly deviceId: string
  /** Lamport counter. Decides precedence; never compared across projects. */
  readonly lamport: number
  /**
   * Wall-clock milliseconds, for people and for metrics. Deliberately not part
   * of the ordering: a device with a wrong clock would otherwise reorder
   * everyone else's history.
   */
  readonly at: number
  /** Who made the change, when the project has members. */
  readonly authorId: string | null
}

export type Operation = OperationMeta & OperationBody

/**
 * Where a card sits, expressed so that two people can move cards at once.
 *
 * The obvious model — an integer position per card — forces a rewrite of every
 * card after the insertion point, so two devices reordering the same column
 * concurrently produce overlapping writes that no merge can reconcile.
 *
 * Fractional indexing stores an *order key* instead: a string chosen to sort
 * lexicographically between its two neighbours. Inserting touches one card and
 * one field. Two devices inserting in the same gap generate different keys, and
 * both survive the merge — the result is deterministic and neither edit is lost.
 *
 * The midpoint algorithm itself is the sort of code whose bugs are silent and
 * corrupt ordering permanently, so it comes from a dependency-free public
 * domain implementation rather than being rewritten here. What this module owns
 * is the contract Kanbo depends on, and the tests that hold it.
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/** The order key of the first card in an empty column. */
export const FIRST_KEY = 'a0'

export class OrderKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderKeyError'
  }
}

/**
 * A key that sorts strictly between `before` and `after`.
 *
 * Pass null for either end to mean "no neighbour on that side": `keyBetween
 * (null, first)` prepends, `keyBetween(last, null)` appends, and both null is
 * the first card in an empty column.
 */
export function keyBetween(before: string | null, after: string | null): string {
  assertOrdered(before, after)

  let key: string
  try {
    key = generateKeyBetween(before, after)
  } catch (error) {
    throw new OrderKeyError(
      `No order key fits between ${before ?? 'start'} and ${after ?? 'end'}: ` +
        (error instanceof Error ? error.message : String(error)),
    )
  }

  assertInside(key, before, after)
  return key
}

/**
 * Reject a reversed pair before it reaches the generator.
 *
 * Not defensive programming for its own sake: given `before > after` the
 * generator returns a key that is *not* between them rather than failing, so a
 * caller that swapped its arguments would silently corrupt the ordering of a
 * column and only find out much later. Failing here turns a data bug into a
 * stack trace pointing at the caller.
 */
function assertOrdered(before: string | null, after: string | null): void {
  if (before === null || after === null) return
  if (before < after) return
  throw new OrderKeyError(
    before === after
      ? `Cannot insert between ${before} and itself: there is no gap.`
      : `Order keys are reversed: ${before} is not before ${after}.`,
  )
}

/**
 * Check the answer, cheaply, every time.
 *
 * A key outside its bounds is unrecoverable once written and shared, and a
 * string comparison costs nothing next to that. This also means a regression in
 * the dependency surfaces here instead of in someone's board.
 */
function assertInside(key: string, before: string | null, after: string | null): void {
  const tooLow = before !== null && key <= before
  const tooHigh = after !== null && key >= after
  if (tooLow || tooHigh) {
    throw new OrderKeyError(
      `Generated order key ${key} does not fall between ${before ?? 'start'} and ${after ?? 'end'}.`,
    )
  }
}

/**
 * `count` keys, evenly spread between the two neighbours and in ascending
 * order. Used when several cards move at once — dragging a multi-selection, or
 * pulling a batch of issues into a column — where calling `keyBetween` in a
 * loop would build a needlessly long key for every card after the first.
 */
export function keysBetween(
  before: string | null,
  after: string | null,
  count: number,
): readonly string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new OrderKeyError(`Cannot generate ${count} order keys.`)
  }
  if (count === 0) return []
  assertOrdered(before, after)

  let keys: string[]
  try {
    keys = generateNKeysBetween(before, after, count)
  } catch (error) {
    throw new OrderKeyError(
      `No ${count} order keys fit between ${before ?? 'start'} and ${after ?? 'end'}: ` +
        (error instanceof Error ? error.message : String(error)),
    )
  }

  // Same reasoning as the single-key case, plus the keys must ascend among
  // themselves or a batch insert would scramble its own order.
  let previous = before
  for (const key of keys) {
    assertInside(key, previous, after)
    previous = key
  }
  return keys
}

/**
 * Order keys compare as plain strings — that is the entire point, and it means
 * sorting never has to parse them.
 */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Sort by order key, breaking ties by id.
 *
 * Ties are not supposed to happen, but two devices can generate the same key
 * from the same neighbours before either has seen the other's write. Falling
 * back to the id keeps the order *deterministic* across devices rather than
 * dependent on which operation happened to be replayed first.
 */
export function byOrder<T extends { readonly id: string; readonly order: string }>(
  a: T,
  b: T,
): number {
  return compareKeys(a.order, b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

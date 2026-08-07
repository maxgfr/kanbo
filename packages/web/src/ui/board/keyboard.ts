import type { KeyboardCoordinateGetter } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

/**
 * Arrow keys that can reach an empty column.
 *
 * dnd-kit's stock coordinate getter navigates between *sortable items*, which
 * is fine until a column has none — and an empty column is precisely where a
 * card most often needs to go. With the default getter, pressing right on a
 * board whose next column is empty does nothing at all, so a keyboard user
 * could move a card only into columns that already had work in them.
 *
 * Horizontal keys are therefore resolved here against the column droppables
 * themselves. Vertical movement is left to the stock getter, which already does
 * the right thing within a column.
 */
const COLUMN_PREFIX = 'column:'

export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') {
    return sortableKeyboardCoordinates(event, args)
  }

  // Otherwise the arrow scrolls the board out from under the drag.
  event.preventDefault()

  const { collisionRect, droppableRects, droppableContainers } = args.context
  const current = args.currentCoordinates
  if (!collisionRect || !current) return undefined

  const goingRight = event.code === 'ArrowRight'
  const centre = collisionRect.left + collisionRect.width / 2
  let best: { centre: number; top: number } | null = null

  for (const container of droppableContainers.getEnabled()) {
    if (!String(container.id).startsWith(COLUMN_PREFIX)) continue
    const rect = droppableRects.get(container.id)
    if (!rect) continue

    const rectCentre = rect.left + rect.width / 2
    // A one-pixel margin stops a column being chosen when the dragged card is
    // already sitting in it.
    const ahead = goingRight ? rectCentre > centre + 1 : rectCentre < centre - 1
    if (!ahead) continue

    // The nearest column in the direction travelled, so repeated presses walk
    // the board one column at a time instead of jumping to the far end.
    if (!best || (goingRight ? rectCentre < best.centre : rectCentre > best.centre)) {
      best = { centre: rectCentre, top: rect.top }
    }
  }

  if (!best) return undefined

  // Centres are matched rather than left edges. A dragged card is rendered in
  // an overlay outside the column, so it is wider than the column it came
  // from; aligning the edges leaves it straddling two columns and collision
  // detection picks the one it started in.
  //
  // The result is also a *translation* of where the drag currently sits, not an
  // absolute position — dnd-kit takes the delta against `currentCoordinates`.
  return {
    x: current.x + (best.centre - centre),
    y: current.y + (best.top - collisionRect.top),
  }
}

import { type CollisionDetection, closestCenter, closestCorners } from '@dnd-kit/core'

/**
 * Where a dragged card lands, decided the way a person reads a board.
 *
 * The stock detectors compare a card against every droppable at once, which on
 * a board gives the wrong answer in a very specific and very common case: a
 * card is itself a droppable, so a card being dragged competes with the column
 * it is heading for and frequently wins. Moving right then does nothing, and
 * the more subtle version is a card that snaps back to where it started.
 *
 * A board is two questions, not one. *Which column* is answered by the dragged
 * card's horizontal centre — a card is in the column it sits over, and no
 * amount of overlap with a neighbour changes that. *Which position* is then a
 * matter of vertical proximity among that column's own cards, where the active
 * card is naturally absent when the column is not the one it came from.
 *
 * Splitting them removes the ambiguity rather than tuning around it, and it is
 * what makes keyboard movement land in an empty column.
 */
const COLUMN_PREFIX = 'column:'

export const boardCollisionDetection: CollisionDetection = (args) => {
  const { droppableContainers, droppableRects, collisionRect } = args
  if (!collisionRect) return closestCorners(args)

  const centreX = collisionRect.left + collisionRect.width / 2

  const columns = droppableContainers.filter((container) =>
    String(container.id).startsWith(COLUMN_PREFIX),
  )

  let column = columns.find((container) => {
    const rect = droppableRects.get(container.id)
    return rect && centreX >= rect.left && centreX <= rect.left + rect.width
  })

  // Dragged past the ends of the board: fall to the nearest column rather than
  // refusing the drop.
  if (!column && columns.length > 0) {
    let nearest = Infinity
    for (const container of columns) {
      const rect = droppableRects.get(container.id)
      if (!rect) continue
      const distance = Math.abs(rect.left + rect.width / 2 - centreX)
      if (distance < nearest) {
        nearest = distance
        column = container
      }
    }
  }

  if (!column) return closestCorners(args)

  const columnRect = droppableRects.get(column.id)
  if (!columnRect) return [{ id: column.id }]

  // Cards belonging to that column, judged by horizontal containment: a card
  // knows its column by where it is drawn, and this needs no extra bookkeeping
  // to stay in step with the layout.
  const cards = droppableContainers.filter((container) => {
    if (String(container.id).startsWith(COLUMN_PREFIX)) return false
    const rect = droppableRects.get(container.id)
    if (!rect) return false
    const cardCentre = rect.left + rect.width / 2
    return cardCentre >= columnRect.left && cardCentre <= columnRect.left + columnRect.width
  })

  // An empty column is still a place to drop; returning the column itself is
  // what lets the board accept the first card of a new status.
  if (cards.length === 0) return [{ id: column.id }]

  return closestCenter({ ...args, droppableContainers: cards })
}

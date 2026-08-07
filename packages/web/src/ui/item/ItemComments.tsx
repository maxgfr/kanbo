/**
 * The conversation on an item.
 *
 * `Comment`, `comment.upsert` and `comment.delete` were already in the domain,
 * the reducer already cascaded a thread with its item, and the history feed
 * already had a branch for `commented` that nothing could ever reach. This is
 * the missing end of a wire that was otherwise complete.
 *
 * Bodies render through the same Markdown parser as descriptions, which emits
 * elements rather than HTML — so a comment cannot smuggle markup in, and there
 * is no sanitiser here to get wrong.
 */
import { type Comment, type Project } from '@kanbo/core'
import { useState } from 'react'

import { createPorts } from '../../state/store.ts'
import { useDispatch } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Markdown } from '../design/Markdown.tsx'

export function ItemComments({
  project,
  itemId,
}: {
  readonly project: Project
  readonly itemId: string
}) {
  const dispatch = useDispatch()
  const [draft, setDraft] = useState('')

  const thread = project.comments
    .filter((comment) => comment.itemId === itemId)
    .toSorted((a, b) => a.createdAt - b.createdAt)

  async function post() {
    const body = draft.trim()
    if (body === '') return
    const ports = createPorts()
    const comment: Comment = {
      id: ports.random.id(),
      itemId,
      authorId: null,
      body,
      createdAt: ports.clock.now(),
      editedAt: null,
    }
    setDraft('')
    await dispatch({ kind: 'comment.upsert', comment })
  }

  return (
    <div className="kb-field">
      <span className="kb-field__label">Comments</span>

      {thread.map((comment) => (
        <article key={comment.id} className="kb-comment">
          <div className="kb-row">
            <span className="kb-muted data" style={{ fontSize: 'var(--step--1)' }}>
              {new Date(comment.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
            </span>
            <span className="kb-spacer" />
            <Button
              variant="quiet"
              icon="trash"
              aria-label="Delete this comment"
              onClick={() => void dispatch({ kind: 'comment.delete', commentId: comment.id })}
            />
          </div>
          <Markdown source={comment.body} />
        </article>
      ))}

      <textarea
        className="kb-textarea"
        style={{ minHeight: '4.5rem' }}
        value={draft}
        placeholder="Write a comment. Markdown works. ⌘↵ to post."
        aria-label="New comment"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void post()
          }
        }}
      />

      {draft.trim() !== '' && (
        <div>
          <Button variant="primary" onClick={() => void post()}>
            Comment
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The project's own name, key and description.
 *
 * All three were asked for once, at first run, and then frozen: a project
 * misnamed in the thirty seconds before anyone had seen the board stayed
 * misnamed. `project.set` has always existed and nothing emitted it after the
 * seed.
 *
 * The key is editable and deliberately does not renumber anything. Existing
 * references are part of an item's identity — they appear in branch names,
 * commit messages and pull request titles that Kanbo does not own — so changing
 * the key changes what the *next* item is called and nothing else. That is said
 * on screen rather than left to be discovered.
 */
import { useDispatch, useProject } from '../../state/useStore.ts'

export function ProjectSection() {
  const project = useProject()
  const dispatch = useDispatch()

  const set = (patch: { name?: string; key?: string; description?: string }) =>
    void dispatch({ kind: 'project.set', patch })

  return (
    <section className="kb-field">
      <h2 className="kb-field__label">Project</h2>

      <div className="kb-row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
        <div className="kb-field" style={{ flex: 1 }}>
          <label className="kb-field__label" htmlFor="kb-project-rename">
            Name
          </label>
          <input
            id="kb-project-rename"
            className="kb-input"
            value={project.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>

        <div className="kb-field" style={{ width: '7rem' }}>
          <label className="kb-field__label" htmlFor="kb-project-rekey">
            Key
          </label>
          <input
            id="kb-project-rekey"
            className="kb-input data"
            value={project.key}
            maxLength={8}
            onChange={(event) => set({ key: event.target.value.toUpperCase() })}
          />
        </div>
      </div>

      <p className="kb-muted" style={{ margin: 0, lineHeight: 1.6 }}>
        The next item will be{' '}
        <span className="data">
          {project.key || 'KEY'}-{project.nextRef}
        </span>
        . Items that already have a reference keep it: those strings live in branch names and pull
        request titles that this board does not own, and quietly rewriting them here would break the
        links back.
      </p>

      <div className="kb-field">
        <label className="kb-field__label" htmlFor="kb-project-description">
          Description
        </label>
        <textarea
          id="kb-project-description"
          className="kb-textarea"
          style={{ minHeight: '4rem' }}
          value={project.description}
          placeholder="What this board is for."
          onChange={(event) => set({ description: event.target.value })}
        />
      </div>
    </section>
  )
}

/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown } from './Markdown.tsx'

/**
 * The README's claim is that there is no `dangerouslySetInnerHTML` anywhere in
 * Kanbo and no sanitiser to get wrong. The parser is tested in the domain; what
 * is tested here is the half that could still betray it — that this component
 * turns a tree of values into elements, and never turns text into markup.
 *
 * A description is text someone else wrote: pulled from a forge issue, typed by
 * a teammate, imported from a file, or carried in a share link from a stranger.
 */
describe('Markdown', () => {
  it('renders emphasis as elements rather than as characters', () => {
    render(<Markdown source="A **bold** and an _emphasis_." />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('emphasis').tagName).toBe('EM')
  })

  it('leaves raw HTML as literal text', () => {
    const { container } = render(
      <Markdown source="<b>not bold</b> and <script>alert(1)</script>" />,
    )
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<b>not bold</b>')
  })

  it('does not execute an img error handler, because it never builds one', () => {
    const { container } = render(<Markdown source={`<img src=x onerror="alert(1)">`} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('onerror')
  })

  it('refuses a javascript: link rather than rendering it', () => {
    const { container } = render(<Markdown source="[click](javascript:alert(1))" />)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('opens links away from the board, so unsaved edits behind survive', () => {
    render(<Markdown source="[the issue](https://example.com/1)" />)
    const link = screen.getByRole('link', { name: 'the issue' })
    expect(link).toHaveProperty('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('keeps code fences verbatim, markdown inside them included', () => {
    const { container } = render(<Markdown source={'```\n**not bold**\n```'} />)
    expect(container.querySelector('pre code')?.textContent).toContain('**not bold**')
    expect(container.querySelector('strong')).toBeNull()
  })

  it('renders a task list the source cannot be edited from', () => {
    // The checkbox reflects the Markdown; clicking it would have to rewrite
    // someone else's text, so it is out of the tab order and read-only.
    const { container } = render(<Markdown source={'- [x] done\n- [ ] not done'} />)
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect([...boxes].map((box) => box.checked)).toEqual([true, false])
    expect([...boxes].every((box) => box.readOnly && box.tabIndex === -1)).toBe(true)
  })

  it('renders nothing at all for an empty description', () => {
    const { container } = render(<Markdown source="" />)
    expect(container.firstChild).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import { firstLine, parseInline, parseMarkdown, safeHref } from './parse'

describe('safeHref', () => {
  it('allows the schemes a description legitimately uses', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeHref('/local/path')).toBe('/local/path')
    expect(safeHref('#anchor')).toBe('#anchor')
  })

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x'])(
    'refuses %s',
    (href) => {
      expect(safeHref(href)).toBeNull()
    },
  )
})

describe('parseInline', () => {
  it('reads emphasis, strong, strike and code', () => {
    expect(parseInline('**bold**')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', value: 'bold' }] },
    ])
    expect(parseInline('*em*')).toEqual([
      { kind: 'emphasis', children: [{ kind: 'text', value: 'em' }] },
    ])
    expect(parseInline('~~gone~~')).toEqual([
      { kind: 'strike', children: [{ kind: 'text', value: 'gone' }] },
    ])
    expect(parseInline('`x`')).toEqual([{ kind: 'code', value: 'x' }])
  })

  it('keeps surrounding text', () => {
    expect(parseInline('a **b** c')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', value: 'b' }] },
      { kind: 'text', value: ' c' },
    ])
  })

  it.each([
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
  ])('never produces a link node for %s', (source) => {
    const nodes = parseInline(source)
    expect(nodes.some((node) => node.kind === 'link')).toBe(false)
    // The label survives as text: silently deleting content the author wrote
    // would be worse than showing an unclickable label.
    expect(nodes.map((node) => ('value' in node ? node.value : '')).join('')).toContain('click')
  })

  it('never emits markup, so raw HTML stays literal text', () => {
    // The whole reason this parser exists: an issue body is text someone else
    // wrote, and it must never reach the document as markup.
    const nodes = parseInline('<img src=x onerror=alert(1)>')
    expect(nodes).toEqual([{ kind: 'text', value: '<img src=x onerror=alert(1)>' }])
  })
})

describe('parseMarkdown', () => {
  it('reads headings', () => {
    const [block] = parseMarkdown('## Title')
    expect(block).toEqual({
      kind: 'heading',
      level: 2,
      children: [{ kind: 'text', value: 'Title' }],
    })
  })

  it('reads a fenced code block with its language, verbatim', () => {
    const [block] = parseMarkdown('```ts\nconst a = 1\n\nconst b = 2\n```')
    expect(block).toEqual({ kind: 'code', language: 'ts', value: 'const a = 1\n\nconst b = 2' })
  })

  it('does not interpret Markdown inside a code fence', () => {
    const [block] = parseMarkdown('```\n# not a heading\n**not bold**\n```')
    expect(block).toEqual({ kind: 'code', language: null, value: '# not a heading\n**not bold**' })
  })

  it('closes an unterminated fence at the end of input', () => {
    const [block] = parseMarkdown('```\nunclosed')
    expect(block).toEqual({ kind: 'code', language: null, value: 'unclosed' })
  })

  it('reads task lists with their checked state', () => {
    const [block] = parseMarkdown('- [ ] todo\n- [x] done\n- plain')
    expect(block).toMatchObject({
      kind: 'list',
      ordered: false,
      items: [{ checked: false }, { checked: true }, { checked: null }],
    })
  })

  it('reads ordered lists', () => {
    expect(parseMarkdown('1. one\n2. two')).toMatchObject([{ kind: 'list', ordered: true }])
  })

  it('reads nested blocks inside a quote', () => {
    const [block] = parseMarkdown('> ## Quoted\n> body')
    expect(block).toMatchObject({
      kind: 'quote',
      children: [{ kind: 'heading', level: 2 }, { kind: 'paragraph' }],
    })
  })

  it('separates paragraphs on a blank line', () => {
    expect(parseMarkdown('one\n\ntwo')).toHaveLength(2)
  })

  it('ends a paragraph where another block begins', () => {
    expect(parseMarkdown('text\n- item')).toMatchObject([{ kind: 'paragraph' }, { kind: 'list' }])
  })

  it('returns nothing for empty input', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n  \n')).toEqual([])
  })
})

describe('firstLine', () => {
  it('skips headings and strips formatting for a card preview', () => {
    expect(firstLine('# Title\n\nSome **bold** text')).toBe('Some bold text')
  })

  it('truncates rather than overflowing a card', () => {
    expect(firstLine('x'.repeat(200), 20)).toBe(`${'x'.repeat(20)}…`)
  })

  it('is empty when there is nothing to show', () => {
    expect(firstLine('')).toBe('')
    expect(firstLine('# Only a heading')).toBe('')
  })
})

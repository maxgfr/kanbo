/**
 * Markdown, parsed to a tree of values rather than to HTML.
 *
 * Descriptions round-trip with forge issue bodies, so they have to be Markdown.
 * But a description is text someone else wrote, and turning it into an HTML
 * string means the renderer has to inject that string into the document —
 * which is the one thing an app built around "the page cannot reach the
 * network" should never do. So no HTML is produced anywhere in this file, and
 * the React side maps these nodes onto real elements. There is no
 * `dangerouslySetInnerHTML` in Kanbo, and no sanitiser to get wrong, because
 * raw HTML in the source is carried through as literal text.
 *
 * The dialect is deliberately the common subset: headings, emphasis, code,
 * links, lists, task lists, quotes, rules, tables are out. Anything unmatched
 * survives as text rather than disappearing.
 */

export type Inline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'emphasis'; readonly children: readonly Inline[] }
  | { readonly kind: 'strike'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly value: string }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] }

export type Block =
  | {
      readonly kind: 'heading'
      readonly level: 1 | 2 | 3 | 4
      readonly children: readonly Inline[]
    }
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly language: string | null; readonly value: string }
  | { readonly kind: 'quote'; readonly children: readonly Block[] }
  | { readonly kind: 'rule' }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      readonly items: readonly ListItem[]
    }

export type ListItem = {
  /** Null when the item is not a task; otherwise its checked state. */
  readonly checked: boolean | null
  readonly children: readonly Inline[]
}

/**
 * Only http(s) and mailto survive.
 *
 * `javascript:` and `data:` in a link are the one place a Markdown description
 * could become an execution vector, so anything else is dropped and the link
 * renders as plain text.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  // Relative links are fine: they cannot leave the origin.
  if (/^[#/]/.test(trimmed)) return trimmed
  return null
}

const INLINE_PATTERN =
  /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([\s\S]+?)\*|_([\s\S]+?)_|\[([^\]]*)\]\(([^)\s]+)\)/

export function parseInline(source: string): readonly Inline[] {
  const nodes: Inline[] = []
  let rest = source

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest)
    if (!match || match.index === undefined) break

    if (match.index > 0) nodes.push({ kind: 'text', value: rest.slice(0, match.index) })

    const [whole, , codeValue, strongStar, strongScore, strike, emStar, emScore, label, href] =
      match

    if (codeValue !== undefined) {
      nodes.push({ kind: 'code', value: codeValue.trim() })
    } else if (strongStar ?? strongScore) {
      nodes.push({ kind: 'strong', children: parseInline((strongStar ?? strongScore)!) })
    } else if (strike) {
      nodes.push({ kind: 'strike', children: parseInline(strike) })
    } else if (emStar ?? emScore) {
      nodes.push({ kind: 'emphasis', children: parseInline((emStar ?? emScore)!) })
    } else if (href !== undefined) {
      const safe = safeHref(href)
      const children = parseInline(label ?? '')
      // A refused scheme keeps its text; silently dropping the label would lose
      // content the author wrote.
      nodes.push(safe ? { kind: 'link', href: safe, children } : { kind: 'text', value: whole! })
    }

    rest = rest.slice(match.index + whole!.length)
  }

  if (rest.length > 0) nodes.push({ kind: 'text', value: rest })
  return nodes
}

const HEADING = /^(#{1,4})\s+(.*)$/
const RULE = /^(?:---|\*\*\*|___)\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/
const FENCE = /^```\s*(\S*)\s*$/

export function parseMarkdown(source: string): readonly Block[] {
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const blocks: Block[] = []
  let at = 0

  while (at < lines.length) {
    const line = lines[at] ?? ''

    if (line.trim() === '') {
      at++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      at++
      while (at < lines.length && !(lines[at] ?? '').startsWith('```')) {
        body.push(lines[at] ?? '')
        at++
      }
      at++ // closing fence, or the end of input
      blocks.push({ kind: 'code', language: fence[1] || null, value: body.join('\n') })
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      at++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3 | 4,
        children: parseInline(heading[2] ?? ''),
      })
      at++
      continue
    }

    if (line.startsWith('>')) {
      const quoted: string[] = []
      while (at < lines.length && (lines[at] ?? '').startsWith('>')) {
        quoted.push((lines[at] ?? '').replace(/^>\s?/, ''))
        at++
      }
      blocks.push({ kind: 'quote', children: parseMarkdown(quoted.join('\n')) })
      continue
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line)
      const items: ListItem[] = []
      while (at < lines.length) {
        const current = lines[at] ?? ''
        const match = ordered ? NUMBERED.exec(current) : BULLET.exec(current)
        if (!match) break
        const content = match[1] ?? ''
        const task = TASK.exec(content)
        items.push(
          task
            ? { checked: task[1]!.toLowerCase() === 'x', children: parseInline(task[2] ?? '') }
            : { checked: null, children: parseInline(content) },
        )
        at++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // A paragraph runs until a blank line or the start of another block.
    const paragraph: string[] = []
    while (at < lines.length) {
      const current = lines[at] ?? ''
      if (
        current.trim() === '' ||
        HEADING.test(current) ||
        RULE.test(current) ||
        FENCE.test(current) ||
        current.startsWith('>') ||
        BULLET.test(current) ||
        NUMBERED.test(current)
      ) {
        break
      }
      paragraph.push(current)
      at++
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) })
  }

  return blocks
}

/** First non-empty line, unformatted — for card previews and search results. */
export function firstLine(source: string, limit = 140): string {
  const line = source
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry !== '' && !entry.startsWith('#') && !entry.startsWith('```'))
  if (!line) return ''
  const plain = line
    .replaceAll(/`([^`]*)`/g, '$1')
    .replaceAll(/\*\*([^*]*)\*\*/g, '$1')
    .replaceAll(/\*([^*]*)\*/g, '$1')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain
}

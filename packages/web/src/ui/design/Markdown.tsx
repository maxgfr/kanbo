import { type Block, type Inline, parseMarkdown } from '@kanbo/core'
import { Fragment, type ReactNode, useMemo } from 'react'

/**
 * Markdown rendered as React elements.
 *
 * There is no `dangerouslySetInnerHTML` here and none anywhere else in Kanbo.
 * A description is text someone else wrote — pulled from a forge issue, typed
 * by a teammate, imported from a file — and the parser hands over a tree of
 * values rather than a string of markup, so raw HTML in the source arrives as
 * literal text and there is no sanitiser that could be got wrong.
 */

function renderInline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={index}>{node.value}</Fragment>
      case 'strong':
        return <strong key={index}>{renderInline(node.children)}</strong>
      case 'emphasis':
        return <em key={index}>{renderInline(node.children)}</em>
      case 'strike':
        return <s key={index}>{renderInline(node.children)}</s>
      case 'code':
        return <code key={index}>{node.value}</code>
      case 'link':
        return (
          // Descriptions carry links to issues and pull requests; opening them
          // in place would lose unsaved edits in the panel behind.
          <a key={index} href={node.href} target="_blank" rel="noreferrer noopener">
            {renderInline(node.children)}
          </a>
        )
    }
  })
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4'
      return <Tag key={index}>{renderInline(block.children)}</Tag>
    }
    case 'paragraph':
      return <p key={index}>{renderInline(block.children)}</p>
    case 'code':
      return (
        <pre key={index}>
          <code>{block.value}</code>
        </pre>
      )
    case 'quote':
      return <blockquote key={index}>{block.children.map(renderBlock)}</blockquote>
    case 'rule':
      return <hr key={index} />
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag key={index}>
          {block.items.map((item, at) => (
            <li key={at} className={item.checked === null ? undefined : 'kb-md__task'}>
              {item.checked !== null && (
                // Read-only: the checkbox reflects the Markdown source, and
                // editing happens in the description field rather than here,
                // where a click would have to rewrite someone's text.
                <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} />
              )}
              {renderInline(item.children)}
            </li>
          ))}
        </Tag>
      )
    }
  }
}

export function Markdown({ source }: { readonly source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  if (blocks.length === 0) return null
  return <div className="kb-md">{blocks.map(renderBlock)}</div>
}

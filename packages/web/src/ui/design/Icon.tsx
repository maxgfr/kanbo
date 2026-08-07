/**
 * One icon set, drawn on one grid.
 *
 * Every glyph is a 16-unit box with a 1.5 stroke, round caps and round joins,
 * so a row of them shares a weight and an optical size. Unicode characters and
 * emoji are not an option here: they arrive with the platform's own metrics and
 * colour, and a board that mixes them with drawn marks looks assembled.
 */

export type IconName =
  | 'board'
  | 'table'
  | 'backlog'
  | 'calendar'
  | 'roadmap'
  | 'metrics'
  | 'settings'
  | 'plus'
  | 'search'
  | 'chevronDown'
  | 'chevronRight'
  | 'close'
  | 'check'
  | 'blocked'
  | 'warning'
  | 'grip'
  | 'link'
  | 'clock'
  | 'person'
  | 'tag'
  | 'filter'
  | 'archive'
  | 'trash'
  | 'sync'
  | 'offline'
  | 'lock'
  | 'repo'
  | 'epic'
  | 'bug'
  | 'story'
  | 'task'

const PATHS: Record<IconName, string> = {
  board: 'M2.5 3h3v10h-3zM6.5 3h3v6.5h-3zM10.5 3h3v8.5h-3z',
  table: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M6.5 6.5v6M10 6.5v6',
  backlog: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  calendar: 'M2.5 4.5h11v9h-11zM2.5 7.5h11M5.5 2.5v3M10.5 2.5v3',
  roadmap: 'M2 4.5h5M6 8h6M9 11.5h5M7 4.5v0M7 4.5a1 1 0 0 0 0 3M11 8a1 1 0 0 1 0 3',
  metrics: 'M2.5 13.5V2.5M2.5 13.5h11M5 11V8M8 11V4.5M11 11V6.5',
  settings:
    'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13 8a5 5 0 0 0-.1-1l1.2-.9-1.3-2.2-1.4.5A5 5 0 0 0 10 3.6L9.8 2H7.2L7 3.6a5 5 0 0 0-1.4.8l-1.4-.5-1.3 2.2 1.2.9a5 5 0 0 0 0 2l-1.2.9 1.3 2.2 1.4-.5a5 5 0 0 0 1.4.8l.2 1.6h2.6l.2-1.6a5 5 0 0 0 1.4-.8l1.4.5 1.3-2.2-1.2-.9c.06-.33.1-.66.1-1z',
  plus: 'M8 3.5v9M3.5 8h9',
  search: 'M7.25 12a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5zM10.75 10.75L13.5 13.5',
  chevronDown: 'M4 6.5L8 10.5l4-4',
  chevronRight: 'M6.5 4L10.5 8l-4 4',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-7',
  blocked: 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM4.5 4.5l7 7',
  warning: 'M8 2.5L14.5 13.5h-13zM8 6.5v3.25M8 11.75h.01',
  grip: 'M6 4h.01M6 8h.01M6 12h.01M10 4h.01M10 8h.01M10 12h.01',
  link: 'M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.75.75M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.75-.75',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4.75V8l2.25 1.5',
  person: 'M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8zM2.75 14a5.25 5.25 0 0 1 10.5 0',
  tag: 'M2.5 7V2.5H7L13.5 9 9 13.5zM5 5h.01',
  filter: 'M2.5 3.5h11l-4.25 5v5l-2.5-1.5v-3.5z',
  archive: 'M2.5 5.5h11v8h-11zM2 2.5h12v3H2zM6.5 8.5h3',
  trash: 'M2.5 4h11M5.5 4V2.5h5V4M4 4l.75 9.5h6.5L12 4M6.5 6.5v5M9.5 6.5v5',
  sync: 'M13.5 8a5.5 5.5 0 0 1-9.4 3.9M2.5 8a5.5 5.5 0 0 1 9.4-3.9M11.5 4.5h2.5V2M4.5 11.5H2V14',
  offline:
    'M2 2l12 12M5 9.5a4 4 0 0 1 3-1.4M2.5 6.75a7.5 7.5 0 0 1 3-2M13.5 6.75a7.5 7.5 0 0 0-6-2.2M8 12.5h.01',
  lock: 'M3.5 7h9v6.5h-9zM5.5 7V4.75a2.5 2.5 0 0 1 5 0V7',
  repo: 'M3 2.5h9a1 1 0 0 1 1 1v10H4a1 1 0 0 1-1-1zM3 11.5h10M5.5 5h4',
  epic: 'M8 1.5l2 4.5 4.5.5-3.4 3 1 4.5L8 11.5 3.9 14l1-4.5-3.4-3L6 6z',
  bug: 'M8 13.5a3.5 3.5 0 0 0 3.5-3.5V7a3.5 3.5 0 1 0-7 0v3a3.5 3.5 0 0 0 3.5 3.5zM6 4.5L4.5 3M10 4.5L11.5 3M4.5 8H2M11.5 8H14M4.75 11.5L3 13M11.25 11.5L13 13',
  story: 'M3 2.5h8.5a1.5 1.5 0 0 1 1.5 1.5v9.5l-3-2-3 2-3-2z',
  task: 'M3 3.5h10v9H3zM5.5 8l1.75 1.75L10.5 6.5',
}

export type IconProps = {
  readonly name: IconName
  readonly size?: number | undefined
  readonly className?: string | undefined
  /** Set when the icon is the only content of a control. */
  readonly title?: string | undefined
}

export function Icon({ name, size = 16, className, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  )
}

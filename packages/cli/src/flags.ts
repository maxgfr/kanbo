/**
 * Argument parsing, kept small on purpose.
 *
 * There is no dependency here and there does not need to be: the whole grammar
 * is `--name value`, `--name=value`, a bare `--name` meaning true, and
 * everything else in order. Repeating a flag collects it, which is how
 * `--label ui --label api` says two labels without inventing a separator that
 * a label could itself contain.
 *
 * `--` stops parsing, so a title that begins with a dash is still a title.
 */
export type Flags = {
  /** Positional arguments, in the order they were given. */
  readonly rest: readonly string[]
  /** The last value given for a flag, which is what a repeated scalar means. */
  get(name: string): string | undefined
  /** Every value given for a flag. */
  all(name: string): readonly string[]
  /** Present at all, with or without a value. */
  has(name: string): boolean
  /** Present as `--name` or `--name true`; absent means undefined, not false. */
  bool(name: string): boolean | undefined
  number(name: string): number | undefined
}

export function parseFlags(argv: readonly string[]): Flags {
  const rest: string[] = []
  const values = new Map<string, string[]>()

  const put = (name: string, value: string) => {
    const existing = values.get(name)
    if (existing) existing.push(value)
    else values.set(name, [value])
  }

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!

    if (argument === '--') {
      rest.push(...argv.slice(index + 1))
      break
    }

    if (!argument.startsWith('--')) {
      rest.push(argument)
      continue
    }

    const body = argument.slice(2)
    const equals = body.indexOf('=')
    if (equals !== -1) {
      put(body.slice(0, equals), body.slice(equals + 1))
      continue
    }

    const next = argv[index + 1]
    // A following dash is another flag, not this one's value — otherwise
    // `--archived --json` would quietly set archived to "--json".
    if (next === undefined || next.startsWith('--')) {
      put(body, '')
      continue
    }
    put(body, next)
    index++
  }

  return {
    rest,
    get: (name) => values.get(name)?.at(-1),
    all: (name) => values.get(name) ?? [],
    has: (name) => values.has(name),
    bool(name) {
      const value = values.get(name)?.at(-1)
      if (value === undefined) return undefined
      if (value === '') return true
      return !['false', 'no', '0', 'off'].includes(value.toLowerCase())
    },
    number(name) {
      const value = values.get(name)?.at(-1)
      if (value === undefined || value === '') return undefined
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) throw new Error(`--${name} needs a number, not "${value}".`)
      return parsed
    },
  }
}

/**
 * A value that may be cleared.
 *
 * `--sprint none` and `--sprint` both mean "take it off"; absent means "leave
 * it alone". Three states, because two would make it impossible to unset
 * anything without a second flag for every field.
 */
export function optional(flags: Flags, name: string): string | null | undefined {
  if (!flags.has(name)) return undefined
  const value = flags.get(name)
  if (value === undefined || value === '' || value.toLowerCase() === 'none') return null
  return value
}

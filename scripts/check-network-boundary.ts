/**
 * The guard that keeps "the page talks to one host, and only when asked"
 * checkable rather than merely intended.
 *
 * Nook could assert something simpler — that no network API reaches the bundle
 * at all. Kanbo uses the network, so the assertion changes shape: network code
 * is allowed to exist, but only in the declared transport module for each
 * runtime, and the two documents must carry exactly the policies `policy.ts`
 * describes.
 *
 * Run with `node scripts/check-network-boundary.ts` (Node strips the types).
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONNECTED_CONNECT,
  CONNECTED_DOCUMENT,
  SHARED_DIRECTIVES,
  STRICT_CONNECT,
  STRICT_DOCUMENT,
  policyFor,
} from '../packages/core/src/policy.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'packages/web/dist')

/**
 * The only modules permitted to touch the network: one per runtime, each
 * enforcing the configured origin itself. Adding an entry here is a deliberate
 * widening of the trusted surface and should be argued for in the pull request
 * that does it — which is why the list is short enough to read.
 */
const TRANSPORT_MODULES = [
  'packages/web/src/net/transport.ts',
  'packages/adapters-node/src/http.ts',
]

const NETWORK_APIS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /\bimportScripts\b/,
  /\bnavigator\.connection\b/,
]

/**
 * Markup written from a string, which Kanbo never does.
 *
 * The README's claim is that there is no `dangerouslySetInnerHTML` anywhere and
 * no sanitiser to get wrong — the Markdown parser hands over a tree of values
 * and the renderer turns it into elements, so raw HTML in a description arrives
 * as literal text. That held because nobody had reached for the shortcut yet,
 * not because anything stopped them; a description is text a stranger wrote and
 * can arrive from a forge issue, an import or a share link.
 *
 * Checked here for the same reason the network APIs are: a promise the build
 * does not enforce is a promise that lasts until the next hurried afternoon.
 */
const MARKUP_APIS = [
  /\bdangerouslySetInnerHTML\b/,
  /\.innerHTML\s*=/,
  /\.outerHTML\s*=/,
  /\binsertAdjacentHTML\s*\(/,
  /\bdocument\.write\b/,
]

const failures: string[] = []

function fail(message: string): void {
  failures.push(message)
}

async function walk(dir: string, match: (path: string) => boolean): Promise<string[]> {
  const found: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      found.push(...(await walk(full, match)))
    } else if (match(full)) {
      found.push(full)
    }
  }
  return found
}

/** Comments discuss network APIs by name; only real code should be flagged. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

async function checkSourceBoundary(): Promise<void> {
  const sources = await walk(
    join(ROOT, 'packages'),
    (path) => /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path),
  )

  for (const path of sources) {
    const rel = relative(ROOT, path)
    if (TRANSPORT_MODULES.includes(rel)) continue

    const code = stripComments(await readFile(path, 'utf8'))
    for (const pattern of NETWORK_APIS) {
      if (pattern.test(code)) {
        fail(
          `${rel} uses a network API (${pattern.source}) outside the transport module. ` +
            `Route it through one of ${TRANSPORT_MODULES.join(' or ')}, which enforce the configured origin.`,
        )
      }
    }
    for (const pattern of MARKUP_APIS) {
      if (pattern.test(code)) {
        fail(
          `${rel} builds markup from a string (${pattern.source}). Kanbo renders elements from ` +
            `parsed values instead, so there is no sanitiser to get wrong — see ui/design/Markdown.tsx.`,
        )
      }
    }
  }
}

function policyOf(html: string, document: string): string | null {
  // The attribute value is full of single quotes ('self', 'none'), so the
  // closing delimiter has to be the same character that opened it.
  const match = html.match(
    /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*?content=(?:"([^"]*)"|'([^']*)')/i,
  )
  const policy = match?.[1] ?? match?.[2]
  if (!policy) {
    fail(`${document} carries no Content-Security-Policy meta element.`)
    return null
  }
  return policy
}

function checkDocument(html: string, document: string, expected: string): string | null {
  const policy = policyOf(html, document)
  if (policy === null) return null

  if (policy !== expected) {
    fail(
      `${document} policy does not match policy.ts.\n  expected: ${expected}\n  found:    ${policy}`,
    )
  }

  for (const directive of SHARED_DIRECTIVES) {
    if (!policy.includes(directive))
      fail(`${document} is missing the shared directive ${directive}`)
  }

  // An inline script would be blocked by our own script-src anyway; finding one
  // means a plugin is emitting code that will silently never run.
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) {
    fail(`${document} contains an inline script, which script-src 'self' will block.`)
  }

  return policy
}

function directivesOnlyIn(policy: string, other: string): string[] {
  const theirs = other.split('; ')
  return policy.split('; ').filter((d) => !theirs.includes(d) && !d.startsWith('connect-src'))
}

async function checkDocuments(): Promise<void> {
  let strictHtml: string
  let connectedHtml: string
  try {
    strictHtml = await readFile(join(DIST, STRICT_DOCUMENT), 'utf8')
    connectedHtml = await readFile(join(DIST, CONNECTED_DOCUMENT), 'utf8')
  } catch {
    fail(`Both documents must exist in ${relative(ROOT, DIST)}. Run the build first.`)
    return
  }

  const strict = checkDocument(strictHtml, STRICT_DOCUMENT, policyFor('local'))
  const connected = checkDocument(connectedHtml, CONNECTED_DOCUMENT, policyFor('connected'))
  if (!strict || !connected) return

  if (!strict.includes(STRICT_CONNECT)) {
    fail(`${STRICT_DOCUMENT} must close the network with ${STRICT_CONNECT}.`)
  }

  // The connected document must name no host: a fixed list could never cover a
  // self-hosted forge, and the boot-time tightening is what actually narrows it.
  const connectSrc = connected.split('; ').find((d) => d.startsWith('connect-src'))
  if (connectSrc !== CONNECTED_CONNECT) {
    fail(
      `${CONNECTED_DOCUMENT} must carry exactly "${CONNECTED_CONNECT}", found "${connectSrc}". ` +
        'A host baked into the build would be both too narrow and a promise we do not keep.',
    )
  }

  // Everything except connect-src has to be identical, or the two documents are
  // no longer the same application under two network policies.
  const drift = [...directivesOnlyIn(strict, connected), ...directivesOnlyIn(connected, strict)]
  if (drift.length > 0) {
    fail(`The two documents differ beyond connect-src: ${drift.join(', ')}`)
  }
}

/**
 * XML namespace URIs are identifiers, not addresses — `createElementNS` never
 * dereferences them, and React ships several. Excusing them by exact prefix
 * keeps the plain-HTTP check meaningful instead of permanently noisy.
 */
const NAMESPACE_URIS = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
]

function isNamespaceUri(url: string): boolean {
  return NAMESPACE_URIS.some((namespace) => url.startsWith(namespace))
}

async function checkBundle(dir: string, label: string): Promise<void> {
  const assets = await walk(dir, (path) => /\.(js|css)$/.test(path))
  if (assets.length === 0) {
    fail(`No built assets found in ${label}. Run the build first.`)
    return
  }

  for (const path of assets) {
    const code = await readFile(path, 'utf8')
    // Plain HTTP can only be a downgrade or a mistake; the policy blocks it, so
    // its presence means dead code shipped to users.
    const insecure = code
      .match(/http:\/\/[a-z0-9.-]+[^"'`\s)]*/gi)
      ?.filter((url) => !url.includes('localhost') && !isNamespaceUri(url))
    if (insecure?.length) {
      fail(`${relative(ROOT, path)} embeds plain-HTTP URLs: ${[...new Set(insecure)].join(', ')}`)
    }
  }
}

/**
 * The npm bins, which is what most people will actually run.
 *
 * The walk above skips `dist` and reads only TypeScript, so the published
 * bundles were invisible to this guard: no false positives, and no coverage
 * either. That is the worse failure — a guard that has nothing to say about the
 * artifact is a guard people believe anyway.
 *
 * Two assertions, on a bundle deliberately left unminified so that counting is
 * meaningful.
 */
const DIST_BINS = ['packages/npm/dist/kanbo.js', 'packages/npm/dist/kanbo-mcp.js']

/**
 * Exactly one `fetch(` per bin: the one inside `nodeHttp`.
 *
 * Written as a budget rather than a ban for the same reason `TRANSPORT_MODULES`
 * is a list rather than a rule — if a future version of the MCP SDK drags a
 * second call site in, the build fails and somebody either shakes it out or
 * raises this number *and argues for it in the pull request*.
 */
const DIST_NETWORK_BUDGET: Record<string, number> = {
  'fetch(': 1,
  XMLHttpRequest: 0,
  WebSocket: 0,
  EventSource: 0,
  sendBeacon: 0,
}

/** The refusal inside `nodeHttp`, which must survive being bundled. */
const ORIGIN_REFUSAL = 'Refused a request to'

/**
 * The other half, and only in the command that can set an address.
 *
 * `kanbo remote set` refuses anything but https before it is stored. The MCP
 * server deliberately exposes no tool for configuring a forge — an agent may
 * sync, it may not decide where to — so this string is correctly shaken out of
 * that bin, and requiring it there would be requiring a capability we withheld
 * on purpose.
 */
const HTTPS_ONLY = {
  text: 'The forge API must be an https address.',
  bin: 'packages/npm/dist/kanbo.js',
}

/**
 * Why the plain-HTTP scan above is *not* run over these bins.
 *
 * That check exists because a `http://` URL in the web bundle is dead code the
 * page's own policy would block — it can only be a mistake. A Node bin is a
 * different argument: the MCP SDK vendors a JSON Schema validator whose dialect
 * identifiers (`http://json-schema.org/draft-07/schema#`) and doc-comment links
 * are strings that are never dereferenced, and failing on them would teach
 * whoever hits it to delete the check rather than to think about it.
 *
 * What these bins promise is enforced at runtime and asserted below instead:
 * one call site, pinned to one origin, and an address that must be https before
 * it is ever stored.
 */

async function checkDistributedBins(): Promise<void> {
  for (const rel of DIST_BINS) {
    let code: string
    try {
      code = await readFile(join(ROOT, rel), 'utf8')
    } catch {
      fail(`${rel} is missing. Run \`pnpm build:dist\` first.`)
      continue
    }

    if (rel === HTTPS_ONLY.bin && !code.includes(HTTPS_ONLY.text)) {
      fail(
        `${rel} no longer refuses a plain-HTTP forge address. That check runs before ` +
          `anything is stored, so losing it moves the failure to the first request.`,
      )
    }

    if (!code.includes(ORIGIN_REFUSAL)) {
      fail(
        `${rel} no longer contains nodeHttp's origin refusal. A published command that ` +
          `could be pointed at any host would be a convenient way to send a token elsewhere.`,
      )
    }

    for (const [api, allowed] of Object.entries(DIST_NETWORK_BUDGET)) {
      const found = code.split(api).length - 1
      if (found !== allowed) {
        fail(
          `${rel} contains ${found} occurrence(s) of \`${api}\`, and ${allowed} is the budget. ` +
            `Widening it is a deliberate enlargement of what this command can reach.`,
        )
      }
    }
  }
}

await checkSourceBoundary()
await checkDocuments()
await checkBundle(DIST, relative(ROOT, DIST))
await checkDistributedBins()

if (failures.length > 0) {
  console.error(`\n✗ Network boundary: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  • ${failure}\n`)
  process.exit(1)
}

console.log(
  `✓ Network boundary intact: ${TRANSPORT_MODULES.length} transport modules, no markup built from strings, ` +
    `two documents, policies as declared, and ${DIST_BINS.length} published bins that reach one host.`,
)

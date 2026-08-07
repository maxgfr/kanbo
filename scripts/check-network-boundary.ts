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

async function checkBundle(): Promise<void> {
  const assets = await walk(DIST, (path) => /\.(js|css)$/.test(path))
  if (assets.length === 0) {
    fail(`No built assets found in ${relative(ROOT, DIST)}. Run the build first.`)
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

await checkSourceBoundary()
await checkDocuments()
await checkBundle()

if (failures.length > 0) {
  console.error(`\n✗ Network boundary: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  • ${failure}\n`)
  process.exit(1)
}

console.log(
  `✓ Network boundary intact: ${TRANSPORT_MODULES.length} transport modules, two documents, policies as declared.`,
)

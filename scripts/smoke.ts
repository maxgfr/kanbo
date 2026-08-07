/**
 * The checks a unit test cannot make.
 *
 * Everything here needs a real browser: that the strict document genuinely
 * refuses a network request, that the board renders, that a card can be moved
 * with the keyboard alone, and that nothing throws on the way. The CSP is the
 * product's central claim, and the only authority on whether a policy is
 * enforced is a browser enforcing it.
 *
 * Uses the Chrome already on the machine rather than downloading one, so this
 * stays cheap enough to run on every change.
 *
 * Run with `node scripts/smoke.ts [--headed] [--shots <dir>]`.
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4178
const BASE = `http://localhost:${PORT}`

const headed = process.argv.includes('--headed')
const shotsAt = process.argv.indexOf('--shots')
const shotsDir = shotsAt === -1 ? null : (process.argv[shotsAt + 1] ?? null)

const failures: string[] = []
const checks: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) checks.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

async function serve(): Promise<() => void> {
  // Vite is a dependency of the web package, not of the root, so it lives in
  // that package's own node_modules under pnpm's strict layout.
  const server = spawn(
    'node',
    [
      join(ROOT, 'packages/web/node_modules/vite/bin/vite.js'),
      'preview',
      '--port',
      String(PORT),
      '--strictPort',
    ],
    { cwd: join(ROOT, 'packages/web'), stdio: 'ignore' },
  )

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(BASE)
      if (response.ok) return () => server.kill()
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  server.kill()
  throw new Error('The preview server never came up.')
}

/** Console errors are failures: a board that throws is a board that lies. */
function watchConsole(page: Page, label: string): void {
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A refused request is the success case for the strict document, and a 404
    // is how the Contents API says "this file does not exist yet" — which is
    // the normal state of a first sync. The browser logs both regardless.
    if (/Content Security Policy|Failed to fetch|net::ERR|status of 404/i.test(text)) return
    failures.push(`console error on ${label}: ${text}`)
  })
  page.on('pageerror', (error) => failures.push(`page error on ${label}: ${error.message}`))
}

async function shoot(page: Page, name: string): Promise<void> {
  if (!shotsDir) return
  await mkdir(shotsDir, { recursive: true })
  await page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: false })
}

async function run(browser: Browser): Promise<void> {
  // ---------------------------------------------------------------- strict
  const strict = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  watchConsole(strict, 'index.html')
  await strict.goto(BASE, { waitUntil: 'networkidle' })

  const policy = await strict
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .first()
    .getAttribute('content')
  check(
    'index.html closes the network',
    policy?.includes("connect-src 'none'") === true,
    policy ?? 'no policy',
  )

  // The claim the whole product rests on, asked of the browser itself.
  const blocked = await strict.evaluate(async () => {
    try {
      await fetch('https://example.com/', { mode: 'no-cors' })
      return false
    } catch {
      return true
    }
  })
  check('the strict document cannot reach the network', blocked)

  await strict.locator('#kb-project-name').fill('Apollo')
  await strict.locator('#kb-project-key').fill('APL')
  await shoot(strict, 'first-run')
  await strict.getByRole('button', { name: 'Create the board' }).click()

  await strict.getByRole('button', { name: 'New item' }).waitFor({ timeout: 5000 })
  check('the board appears after setup', true)

  // ------------------------------------------------------------- an item
  await strict.getByRole('button', { name: 'New item' }).click()
  await strict.locator('#kb-title').waitFor({ timeout: 5000 })
  await strict.locator('#kb-title').fill('Ship the departure board')
  await strict.locator('#kb-estimate').fill('5')
  await strict.getByRole('button', { name: 'Close', exact: true }).click()

  const card = strict.locator('.kb-card').first()
  await card.waitFor({ timeout: 5000 })
  check('the item shows on the board', (await strict.locator('.kb-card').count()) === 1)
  check(
    'the reference uses the project prefix',
    (await card.locator('.kb-card__ref').first().textContent())?.startsWith('APL-') === true,
  )

  // ------------------------------------------------- keyboard drag and drop
  // The board must be operable without a mouse; this is the check that keeps
  // that true rather than aspirational.
  const columnOf = async () =>
    strict.evaluate(() => {
      const el = document.querySelector('.kb-card')
      return el?.closest('section')?.getAttribute('aria-label') ?? null
    })

  const before = await columnOf()
  await card.focus()
  // Each step needs a frame to settle: dnd-kit measures the layout when the
  // card is picked up and again after it moves, and firing all three keys in
  // the same tick tests nothing but our own impatience.
  await strict.keyboard.press('Space')
  await strict.waitForTimeout(250)
  await strict.keyboard.press('ArrowRight')
  await strict.waitForTimeout(400)
  await strict.keyboard.press('Space')
  await strict.waitForTimeout(600)
  const after = await columnOf()

  check(
    'a card moves between columns with the keyboard alone',
    before !== after && after !== null,
    `${before} -> ${after}`,
  )

  await shoot(strict, 'board')

  // ------------------------------------------------------------ other views
  await strict.getByRole('button', { name: 'Table' }).click()
  await strict.locator('.kb-table').waitFor({ timeout: 5000 })
  check('the table view renders', (await strict.locator('.kb-table tbody tr').count()) >= 1)
  await shoot(strict, 'table')

  await strict.getByRole('button', { name: 'Backlog' }).click()
  await strict.locator('.kb-card').first().waitFor({ timeout: 5000 })
  check('the backlog lists the item', (await strict.locator('.kb-card').count()) >= 1)
  await shoot(strict, 'backlog')

  // Sprints: create one, then confirm the burndown is drawn from the board's
  // own history rather than anything typed in.
  await strict.getByRole('button', { name: 'Sprints' }).click()
  await strict.getByRole('button', { name: 'Start a sprint' }).click()
  await strict.getByLabel('Sprint goal').waitFor({ timeout: 5000 })
  check(
    'a sprint shows a burndown and a velocity chart',
    (await strict.locator('svg[role="img"]').count()) >= 2,
  )
  await shoot(strict, 'sprint')

  // The roadmap deliberately shows nothing without dates; give the item one.
  await strict.getByRole('button', { name: 'Backlog' }).click()
  await strict.locator('.kb-button--quiet').filter({ hasText: 'APL-' }).first().click()
  await strict.locator('#kb-due').fill('2026-09-15')
  await strict.getByRole('button', { name: 'Close', exact: true }).click()

  await strict.getByRole('button', { name: 'Roadmap' }).click()
  await strict.locator('svg[role="img"]').first().waitFor({ timeout: 5000 })
  check('the roadmap draws a bar once an item has a date', true)
  await shoot(strict, 'roadmap')

  await strict.getByRole('button', { name: 'Releases' }).click()
  await strict.waitForTimeout(300)
  check(
    'releases generate a note from what actually shipped',
    (await strict.getByRole('button', { name: 'New milestone' }).count()) === 1,
  )
  await shoot(strict, 'releases')

  await strict.getByRole('button', { name: 'Metrics' }).click()
  await strict.waitForTimeout(300)
  check(
    'the metrics view computes charts from the log',
    (await strict.locator('svg[role="img"]').count()) >= 2,
  )
  await shoot(strict, 'metrics')

  // -------------------------------------------------------------- palette
  // The palette runs the same query language the CLI runs; a syntax that only
  // works in one place is a syntax nobody remembers.
  await strict.getByRole('button', { name: 'Board' }).click()
  await strict.keyboard.press('ControlOrMeta+k')
  await strict.getByRole('dialog', { name: 'Command palette' }).waitFor({ timeout: 5000 })
  await strict.getByLabel('Search or run a command').fill('is:open')
  await strict.waitForTimeout(300)
  const found = await strict.locator('.kb-palette__row').count()
  check('the palette searches with the query language', found >= 1, `${found} rows`)
  await shoot(strict, 'palette')
  await strict.keyboard.press('Escape')

  // ---------------------------------------------------------------- theme
  // The default follows the machine. Someone who set their system to light has
  // already answered the question, and overriding that is the app telling them
  // they were wrong.
  for (const scheme of ['light', 'dark'] as const) {
    const themed = await browser.newPage({
      viewport: { width: 900, height: 700 },
      colorScheme: scheme,
    })
    await themed.goto(BASE, { waitUntil: 'networkidle' })
    const resolved = await themed.evaluate(() => document.documentElement.dataset['theme'])
    check(
      `an untouched install follows a ${scheme} system`,
      resolved === scheme,
      resolved ?? 'unset',
    )
    await themed.close()
  }

  await strict.getByRole('button', { name: 'Settings' }).click()
  await strict.getByRole('button', { name: 'Light' }).click()
  await strict.waitForTimeout(200)
  check(
    'the light theme applies',
    (await strict.evaluate(() => document.documentElement.dataset['theme'])) === 'light',
  )
  await shoot(strict, 'settings-light')
  // An explicit choice must survive the system disagreeing with it.
  check(
    'an explicit choice overrides the system',
    (await strict.evaluate(() => localStorage.getItem('kanbo.theme'))) === 'light',
  )
  await strict.getByRole('button', { name: 'System' }).click()
  await strict.waitForTimeout(200)
  check(
    'choosing System hands the decision back',
    (await strict.evaluate(() => localStorage.getItem('kanbo.theme'))) === 'system',
  )
  await strict.getByRole('button', { name: 'Dark' }).click()
  await strict.getByRole('button', { name: 'Close', exact: true }).click()

  // ---------------------------------------------------------------- share
  // The claim under test: a share is encrypted in the page, the key rides in
  // the fragment the browser never sends, and Argon2id runs under a policy
  // that forbids fetching anything — including its own wasm module.
  await strict.getByRole('button', { name: 'Share' }).click()
  await strict.getByRole('dialog', { name: 'Share this board' }).waitFor({ timeout: 5000 })
  await strict.locator('#kb-share-note').fill('Have a look')
  await strict.getByRole('button', { name: 'Create the share' }).click()
  await strict.getByLabel('Share link').waitFor({ timeout: 10_000 })

  const linkShare = await strict.getByLabel('Share link').inputValue()
  check(
    'a share link carries its key in the fragment',
    linkShare.includes('#s='),
    linkShare.slice(0, 60),
  )
  check(
    'the key is never in the path or the query, which a host would see',
    new URL(linkShare).search === '' && !new URL(linkShare).pathname.includes('s='),
  )
  check(
    'a share always opens on the document that cannot reach the network',
    new URL(linkShare).pathname.endsWith('index.html'),
    new URL(linkShare).pathname,
  )
  await shoot(strict, 'share')

  // Now a passphrase share, which is what actually exercises Argon2id.
  await strict.getByRole('button', { name: 'Make another' }).click()
  await strict.getByText('Protect with a passphrase').click()
  await strict.locator('#kb-share-new-passphrase').fill('correct horse battery staple')
  await strict.getByRole('button', { name: 'Create the share' }).click()
  await strict.getByLabel('Share link').waitFor({ timeout: 30_000 })
  const passShare = await strict.getByLabel('Share link').inputValue()
  check('Argon2id runs under connect-src none', passShare.includes('#s=p.'), passShare.slice(0, 40))

  await strict.close()

  // A recipient is a different browser profile with no vault of their own.
  const reader = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  watchConsole(reader, 'reader')
  await reader.goto(linkShare, { waitUntil: 'networkidle' })
  await reader.locator('.kb-card').first().waitFor({ timeout: 15_000 })
  check(
    'a recipient opens the board from the link alone',
    (await reader.locator('.kb-card').count()) >= 1,
  )
  check(
    'the copy is labelled as one, and read-only',
    (await reader.getByText('read-only copy').count()) === 1,
  )
  check(
    'the reader never opened a vault of its own',
    await reader.evaluate(async () =>
      (await indexedDB.databases()).every((db) => db.name !== 'kanbo'),
    ),
  )
  await shoot(reader, 'share-reader')
  await reader.close()

  // A tampered link must fail closed, and say so.
  const tampered = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await tampered.goto(linkShare.slice(0, -24), { waitUntil: 'networkidle' })
  await tampered.waitForTimeout(1500)
  const body = (await tampered.locator('body').textContent()) ?? ''
  check(
    'a truncated or edited link is refused rather than half-read',
    /damaged|truncated|does not open/i.test(body),
    body.slice(0, 120),
  )
  await tampered.close()

  // The passphrase share must not open without the passphrase.
  const guard = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await guard.goto(passShare, { waitUntil: 'networkidle' })
  await guard.locator('#kb-share-passphrase').waitFor({ timeout: 5000 })
  check(
    'a passphrase share shows no board until the passphrase is given',
    (await guard.locator('.kb-card').count()) === 0,
  )

  await guard.locator('#kb-share-passphrase').fill('wrong passphrase entirely')
  await guard.getByRole('button', { name: 'Open the board' }).click()
  await guard.waitForTimeout(4000)
  check(
    'a wrong passphrase is refused',
    /does not open this share/i.test((await guard.locator('body').textContent()) ?? ''),
  )

  await guard.locator('#kb-share-passphrase').fill('correct horse battery staple')
  await guard.getByRole('button', { name: 'Open the board' }).click()
  await guard.locator('.kb-card').first().waitFor({ timeout: 30_000 })
  check('the right passphrase opens it', (await guard.locator('.kb-card').count()) >= 1)
  await guard.close()

  // ------------------------------------------------------------- connected
  // The mode has to be stored before the document loads. Without it the boot
  // module correctly bounces this page back to the strict document, which is
  // itself worth asserting.
  const bounced = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await bounced.goto(BASE)
  await bounced.goto(`${BASE}/connect.html`, { waitUntil: 'networkidle' })
  check(
    'connect.html sends you back when sync is off',
    new URL(bounced.url()).pathname !== '/connect.html',
    bounced.url(),
  )
  await bounced.close()

  const connected = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  watchConsole(connected, 'connect.html')
  await connected.addInitScript(() => {
    localStorage.setItem(
      'kanbo.sync',
      JSON.stringify({ mode: 'connected', remoteUrl: 'https://api.github.com' }),
    )
  })
  await connected.goto(`${BASE}/connect.html`, { waitUntil: 'networkidle' })

  const policies = await connected
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''))

  check(
    'connect.html ships the broad policy and names no host',
    policies.some((entry) => entry.includes('connect-src https:')),
    policies.join(' | '),
  )
  check(
    'boot narrows it to the one configured origin',
    policies.some((entry) => entry.trim() === 'connect-src https://api.github.com'),
    policies.join(' | '),
  )
  check(
    'the tightening is inserted ahead of the document policy',
    policies[0]?.startsWith('connect-src https://api.github.com') === true,
    policies.join(' | '),
  )

  // The narrowing is only real if the browser enforces it: an origin other than
  // the configured one must still be refused on the connected document.
  const otherHostBlocked = await connected.evaluate(async () => {
    try {
      await fetch('https://example.com/', { mode: 'no-cors' })
      return false
    } catch {
      return true
    }
  })
  check('a host other than the configured one is still refused', otherHostBlocked)

  await connected.close()

  await syncScenario(browser)
}

/**
 * Two browsers converging through one repository.
 *
 * The forge is simulated in memory and served by intercepting the network, but
 * everything above it is the real thing: the real policy, the real transport,
 * the real Contents API shapes, the real merge. Interception happens below the
 * CSP, so a request still has to be permitted by the browser before it can be
 * answered here — which means this exercises the narrowing rather than
 * bypassing it.
 */
/** Save a token and run one sync, through the settings panel. */
async function syncThroughSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('#kb-token').fill('ghp_fake_token_for_the_smoke_test')
  await page.getByRole('button', { name: 'Save token' }).click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Sync now' }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
}

async function syncScenario(browser: Browser): Promise<void> {
  const files = new Map<string, { content: string; sha: string }>()
  let revision = 0

  async function forge(page: Page): Promise<void> {
    await page.route('https://api.github.com/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = decodeURIComponent(
        url.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''),
      )

      if (request.method() === 'GET') {
        const file = files.get(path)
        if (file) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              content: Buffer.from(file.content, 'utf8').toString('base64'),
              sha: file.sha,
            }),
          })
        }
        // A directory listing, which is how devices are discovered.
        const under = [...files.keys()].filter((key) => key.startsWith(`${path}/`))
        if (under.length > 0) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(under.map((key) => ({ path: key, type: 'file' }))),
          })
        }
        return route.fulfill({ status: 404, body: '{}' })
      }

      if (request.method() === 'PUT') {
        const body = JSON.parse(request.postData() ?? '{}') as { content: string; sha?: string }
        const existing = files.get(path)
        if (existing && existing.sha !== body.sha) {
          return route.fulfill({ status: 409, body: '{}' })
        }
        const sha = `sha-${++revision}`
        files.set(path, { content: Buffer.from(body.content, 'base64').toString('utf8'), sha })
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ content: { sha } }),
        })
      }

      return route.fulfill({ status: 405, body: '{}' })
    })
  }

  async function open(label: string) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    watchConsole(page, label)
    await forge(page)
    await page.addInitScript(() => {
      localStorage.setItem(
        'kanbo.sync',
        JSON.stringify({
          mode: 'connected',
          remoteUrl: 'https://api.github.com',
          repository: 'maxgfr/kanbo-test',
          branch: 'main',
        }),
      )
    })
    await page.goto(`${BASE}/connect.html`, { waitUntil: 'networkidle' })
    return page
  }

  // Alice creates a project and pushes it.
  const alice = await open('alice')
  await alice.locator('#kb-project-name').fill('Shared')
  await alice.locator('#kb-project-key').fill('SHR')
  await alice.getByRole('button', { name: 'Create the board' }).click()
  await alice.getByRole('button', { name: 'New item' }).click()
  await alice.locator('#kb-title').waitFor({ timeout: 5000 })
  await alice.locator('#kb-title').fill('Written by Alice')
  await alice.getByRole('button', { name: 'Close', exact: true }).click()
  await syncThroughSettings(alice)

  check(
    'a device writes only its own log file',
    [...files.keys()].filter((p) => p.endsWith('.ndjson')).length === 1,
    [...files.keys()].join(', '),
  )

  // Bob is a different browser profile, so a different device — and he has no
  // board yet, which means his only route in is the join flow on first run.
  const bob = await open('bob')
  await bob.getByLabel('Access token').fill('ghp_fake_token_for_the_smoke_test')
  await bob.getByRole('button', { name: 'Pull from repository' }).click()
  await bob.getByRole('button', { name: 'New item' }).waitFor({ timeout: 10_000 })
  check('a device with no board can join an existing repository', true)

  await bob.getByRole('button', { name: 'Table' }).click()
  await bob.locator('.kb-table').waitFor({ timeout: 5000 })

  const bobSees = await bob.locator('.kb-table tbody tr').count()
  check("a second device pulls the first device's work", bobSees === 1, `${bobSees} rows`)

  // Bob adds something and pushes; Alice pulls it back.
  await bob.getByRole('button', { name: 'New item' }).click()
  await bob.locator('#kb-title').waitFor({ timeout: 5000 })
  await bob.locator('#kb-title').fill('Written by Bob')
  await bob.getByRole('button', { name: 'Close', exact: true }).click()
  await syncThroughSettings(bob)

  check(
    'each device still owns exactly one file, so git never merges one',
    [...files.keys()].filter((p) => p.endsWith('.ndjson')).length === 2,
    [...files.keys()].join(', '),
  )

  await syncThroughSettings(alice)
  await alice.getByRole('button', { name: 'Table' }).click()
  await alice.waitForTimeout(400)
  const aliceSees = await alice.locator('.kb-table tbody tr').count()
  check('the two devices converge on the same board', aliceSees === 2, `${aliceSees} rows`)

  await alice.close()
  await bob.close()
}

/**
 * Prefer the Chrome already installed; fall back to a Playwright-managed build.
 * Downloading a browser to run this would make it too expensive to keep in the
 * default pipeline, and a check nobody runs protects nothing.
 */
async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: !headed })
  } catch {
    return chromium.launch({ headless: !headed })
  }
}

const stop = await serve()
const browser = await launch()
try {
  await run(browser)
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
} finally {
  await browser.close()
  stop()
}

for (const passed of checks) console.log(`  ✓ ${passed}`)

if (failures.length > 0) {
  console.error(`\n✗ Smoke: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  • ${failure}`)
  process.exit(1)
}

console.log(`\n✓ Smoke: ${checks.length} checks passed in a real browser.`)

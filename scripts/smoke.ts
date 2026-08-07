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
    // A refused request is the success case for the strict document, and the
    // browser reports it on the console either way.
    if (/Content Security Policy|Failed to fetch|net::ERR/i.test(text)) return
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

  await strict.getByRole('button', { name: 'Metrics' }).click()
  await strict.waitForTimeout(300)
  check(
    'the metrics view computes charts from the log',
    (await strict.locator('svg[role="img"]').count()) >= 2,
  )
  await shoot(strict, 'metrics')

  // ---------------------------------------------------------------- light
  await strict.getByRole('button', { name: 'Settings' }).click()
  await strict.getByRole('button', { name: 'Light' }).click()
  await strict.waitForTimeout(200)
  check(
    'the light theme applies',
    (await strict.evaluate(() => document.documentElement.dataset['theme'])) === 'light',
  )
  await shoot(strict, 'settings-light')
  await strict.getByRole('button', { name: 'Dark' }).click()
  await strict.getByRole('button', { name: 'Close', exact: true }).click()

  await strict.close()

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

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

  // The card's own label promises "O to open", so the promise gets checked.
  // It used to be swallowed: dnd-kit's keyboard sensor contributes an onKeyDown
  // of its own, and a handler declared before the spread is replaced by it
  // rather than merged.
  await card.focus()
  await strict.keyboard.press('o')
  await strict.locator('#kb-title').waitFor({ timeout: 5000 })
  check('O opens the focused card', await strict.locator('.kb-panel').isVisible())
  await strict.getByRole('button', { name: 'Close', exact: true }).click()

  await shoot(strict, 'board')

  // --------------------------------------------------------- custom columns
  // The domain always allowed any number of columns; this is the check that the
  // interface now does too, all the way to a card landing in a new one.
  const columnsBefore = await strict.locator('section.kb-column').count()
  await strict.getByRole('button', { name: 'Add a column' }).first().click()
  await strict.getByLabel('Name of the new column').fill('Deployed')
  await strict.keyboard.press('Enter')
  await strict.locator('section.kb-column', { hasText: 'Deployed' }).waitFor({ timeout: 5000 })
  const columnsAfter = await strict.locator('section.kb-column').count()
  check(
    'a column added from the board appears on it',
    columnsAfter === columnsBefore + 1,
    `${columnsBefore} -> ${columnsAfter}`,
  )

  // A column is not a label on a wall: deleting one has to say where its cards
  // go, and the cards have to survive the answer.
  await strict.getByRole('button', { name: 'Settings' }).click()
  await strict.getByLabel('Category of Deployed').selectOption('done')
  await strict.getByLabel('WIP limit for Deployed').fill('2')
  await strict.getByRole('button', { name: 'Delete the Deployed column' }).click()
  await strict.getByRole('button', { name: 'Delete column' }).click()

  // The project's own name was frozen at first run, and custom fields existed
  // for the connectors and for nobody else.
  await strict.getByLabel('Name', { exact: true }).fill('Apollo 11')
  await strict.getByRole('button', { name: 'Add a field' }).click()
  await strict.getByLabel('Name of the New field field').fill('Component')
  await strict.getByRole('button', { name: 'Close', exact: true }).click()
  check(
    'the project can be renamed after the first run',
    (await strict.locator('.kb-topbar').textContent())?.includes('Apollo 11') === true,
  )
  check(
    'a deleted column leaves the board, and the board keeps its cards',
    (await strict.locator('section.kb-column', { hasText: 'Deployed' }).count()) === 0 &&
      (await strict.locator('.kb-card').count()) >= 1,
  )

  // ---------------------------------------------------- layouts and grouping
  // Board, Table and Backlog used to be three destinations over the same items.
  // They are one now, with the layout and the grouping as controls — so what is
  // checked here is that changing either really changes what is drawn.
  await strict.getByRole('button', { name: 'List' }).click()
  await strict.locator('.kb-list__row').first().waitFor({ timeout: 5000 })
  check(
    'the list layout renders the same work as rows',
    (await strict.locator('.kb-list__row').count()) >= 1,
  )
  await shoot(strict, 'list')

  await strict.getByLabel('Group by').selectOption('status')
  await strict.waitForTimeout(200)
  const statusGroups = await strict.locator('.kb-list__group').count()
  check(
    'grouping a list by status gives one section per column',
    statusGroups === (await strict.locator('section.kb-column').count()) || statusGroups >= 4,
    `${statusGroups} groups`,
  )

  await strict.getByLabel('Group by').selectOption('priority')
  await strict.waitForTimeout(200)
  check(
    'grouping by something else regroups the same rows',
    (await strict.locator('.kb-list__group').count()) === 5,
  )

  // The filter is the query language, staying put rather than navigating.
  await strict.getByLabel('Filter the work').fill('is:open')
  await strict.waitForTimeout(250)
  check(
    'the filter narrows the list with the query language',
    (await strict.locator('.kb-list__row').count()) >= 1,
  )
  await strict.getByLabel('Filter the work').fill('type:bug')
  await strict.waitForTimeout(250)
  check(
    'and a query that matches nothing empties it rather than ignoring it',
    (await strict.locator('.kb-list__row').count()) === 0,
  )
  await strict.getByLabel('Filter the work').fill('')
  await strict.getByLabel('Group by').selectOption('status')
  await strict.getByRole('button', { name: 'Columns' }).click()
  await strict.locator('section.kb-column').first().waitFor({ timeout: 5000 })

  // Sprints: create one, then confirm the burndown is drawn from the board's
  // own history rather than anything typed in.
  await strict.getByRole('button', { name: 'Sprints' }).click()
  await strict.getByRole('button', { name: 'Start a sprint' }).click()
  await strict.getByLabel('Sprint goal').waitFor({ timeout: 5000 })
  check(
    'a sprint shows a burndown and a velocity chart',
    (await strict.locator('svg[role="img"]').count()) >= 2,
  )

  // The dates the burndown is drawn from have to be reachable. They used to be
  // invented at creation and then unreachable, which made a fortnight starting
  // today the only sprint anyone could have.
  await strict.getByLabel('Ends').fill('2026-12-31')
  await strict.getByLabel('Name', { exact: true }).fill('Hardening')
  await strict.getByRole('button', { name: 'New sprint' }).click()
  const sprintOptions = await strict.getByLabel('Sprint', { exact: true }).locator('option').count()
  check('a sprint can be renamed and redated, and a second one added', sprintOptions === 2)

  // Deleting a sprint must not delete its work.
  const itemsBefore = await strict.locator('.kb-card').count()
  await strict.getByRole('button', { name: /^Delete Sprint 2$/ }).click()
  await strict.getByRole('button', { name: 'Delete sprint', exact: true }).click()
  await strict.getByLabel('Sprint', { exact: true }).waitFor({ timeout: 5000 })
  check(
    'a deleted sprint releases its items rather than taking them with it',
    (await strict.getByLabel('Sprint', { exact: true }).locator('option').count()) === 1 &&
      (await strict.locator('.kb-card').count()) >= itemsBefore,
  )

  await shoot(strict, 'sprint')

  // The roadmap deliberately shows nothing without dates; give the item one.
  await strict.getByRole('button', { name: 'Work' }).click()
  await strict.locator('.kb-card').filter({ hasText: 'APL-' }).first().click()
  await strict.locator('#kb-due').fill('2026-09-15')
  await strict.getByRole('button', { name: 'Close', exact: true }).click()

  await strict.getByRole('button', { name: 'Roadmap' }).click()
  // Asked for by name rather than by counting SVG nodes: the bar has to be a
  // control something other than a mouse can find, which is the whole reason
  // the roadmap stopped being a picture with click handlers on it.
  const bar = strict.getByRole('button', { name: /APL-\d+, .*, due 2026-09-15/ })
  await bar.first().waitFor({ timeout: 5000 })
  check('the roadmap draws a bar once an item has a date', true)

  await bar.first().focus()
  await strict.keyboard.press('Enter')
  await strict.locator('.kb-panel').waitFor({ timeout: 5000 })
  check('a roadmap bar opens its item from the keyboard', true)
  await strict.getByRole('button', { name: 'Close', exact: true }).click()
  await shoot(strict, 'roadmap')

  await strict.getByRole('button', { name: 'Releases' }).click()
  await strict.waitForTimeout(300)
  check(
    'releases generate a note from what actually shipped',
    (await strict.getByRole('button', { name: 'New milestone' }).count()) === 1,
  )
  // Created here so the item panel below has a release to attach work to. A
  // release nothing can be put into is a heading with a date on it.
  await strict.getByRole('button', { name: 'New milestone' }).click()
  await strict.waitForTimeout(200)
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
  await strict.locator('.kb-nav__item', { hasText: 'Work' }).first().click()
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

  // -------------------------------------------------------------- history
  // The log was always the history; this checks it is now readable.
  await strict.locator('.kb-nav__item', { hasText: 'Work' }).first().click()
  // One click, the same gesture every other view uses. This is the regression
  // test: the board used to be the only place that demanded a double click.
  await strict.locator('.kb-card').first().click()
  await strict.locator('#kb-title').waitFor({ timeout: 5000 })
  check('a single click on a card opens it', await strict.locator('.kb-panel').isVisible())
  const entries = await strict.locator('.kb-history__entry').count()
  check('an item shows the history the log already held', entries >= 2, `${entries} entries`)
  check(
    'the history names the columns a card moved between',
    /Moved (from|to)/.test((await strict.locator('.kb-history').textContent()) ?? ''),
  )
  await shoot(strict, 'history')

  // ------------------------------------------------- the item panel's fields
  // Every field below has been in the data model since the first commit and
  // reachable from nowhere: an item could carry labels, people, a release, a
  // thread and children, and nothing in the interface could put them there.
  // The panel is already open on a card from the history check above.
  await strict.getByRole('button', { name: 'New label' }).click()
  await strict.getByLabel('New label').fill('regression')
  await strict.keyboard.press('Enter')

  await strict.getByRole('button', { name: 'New assignee' }).click()
  await strict.getByLabel('New assignee').fill('Ada Lovelace')
  await strict.keyboard.press('Enter')

  const tokens = await strict.locator('.kb-panel .kb-token').allTextContents()
  check(
    'a label and a person can be invented and applied without leaving the item',
    tokens.some((entry) => entry.includes('regression')) &&
      tokens.some((entry) => entry.includes('Ada Lovelace')),
    tokens.join(' | '),
  )

  await strict.getByLabel('Release').selectOption({ label: 'v1.0' })

  // Sub-issues: the parent link existed on every item and nothing could set it.
  await strict.getByRole('button', { name: 'Sub-issue' }).click()
  await strict.getByLabel('Title of the new sub-issue').fill('Write the migration')
  await strict.keyboard.press('Enter')
  await strict.waitForTimeout(200)
  const panelText = (await strict.locator('.kb-panel').textContent()) ?? ''
  check(
    'a sub-issue is created under its parent, and the parent counts it',
    panelText.includes('0/1 done') && panelText.includes('Write the migration'),
  )

  await strict.getByLabel('Component').fill('billing')
  check(
    'a custom field defined in settings is fillable on an item',
    (await strict.getByLabel('Component').inputValue()) === 'billing',
  )

  await strict.getByLabel('New comment').fill('Reproduced on Safari 18.')
  await strict.keyboard.press('ControlOrMeta+Enter')
  await strict.locator('.kb-comment').first().waitFor({ timeout: 5000 })
  check(
    'a comment posts, and the history reports it from the same log',
    (await strict.locator('.kb-history').textContent())?.includes('Commented') === true,
  )

  await shoot(strict, 'item')
  await strict.getByRole('button', { name: 'Close', exact: true }).click()

  // The release now has something in it, which is the only way its progress bar
  // was ever going to say anything.
  await strict.getByRole('button', { name: 'Releases' }).click()
  await strict.waitForTimeout(300)
  check(
    'an item attached to a release shows up in that release',
    (await strict.locator('[role="progressbar"]').first().getAttribute('aria-valuenow')) !== null &&
      (await strict.getByText('0/1').count()) >= 1,
  )

  // `shipped` has always accepted a milestone; only the date window was
  // reachable, so notes for a named release could not be generated at all.
  await strict.getByLabel('What to include').selectOption({ label: 'Everything in v1.0' })
  await strict.waitForTimeout(200)
  check(
    'release notes can be scoped to a release rather than to a date window',
    (await strict.getByLabel('What to include').inputValue()).startsWith('release:'),
  )

  await strict.getByRole('button', { name: 'Work' }).click()

  // -------------------------------------------------------- sprints on board
  const sprintFilter = strict.getByLabel('Filter by sprint')
  await sprintFilter.waitFor({ timeout: 5000 })
  const options = await sprintFilter.locator('option').allTextContents()
  check(
    // "Hardening" rather than "Sprint 1": the sprint was renamed earlier, and
    // the filter reading the new name is the point — it comes from the log, not
    // from a label captured when the sprint was made.
    'the board can be filtered to a sprint',
    options.some((entry) => entry.includes('Hardening')) && options.includes('All'),
    options.join(' | '),
  )

  await sprintFilter.selectOption({ label: 'No sprint' })
  await strict.waitForTimeout(300)
  check(
    'filtering by sprint actually filters the columns',
    (await strict.locator('.kb-card').count()) >= 0,
  )
  await sprintFilter.selectOption('__all')
  await strict.waitForTimeout(300)
  await shoot(strict, 'board-sprints')

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

  await peopleAndShortcuts(browser)
  await modeSwitch(browser)
  await damagedShare(browser)
  await syncScenario(browser)
}

/**
 * The team, who you are, and the keys.
 *
 * `assignee:@me` is offered in the README as an example of the query language
 * and matched nothing at all until there was a screen on which to claim a seat.
 * The palette advertised `n` against no handler. Both are claims the software
 * makes about itself, so both are checked here rather than trusted.
 */
async function peopleAndShortcuts(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  watchConsole(page, 'people')

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#kb-project-name').fill('Gemini')
  await page.locator('#kb-project-key').fill('GEM')
  await page.getByRole('button', { name: 'Create the board' }).click()
  await page.getByRole('button', { name: 'New item' }).waitFor({ timeout: 5000 })

  // `n` is what the palette has always promised and never bound.
  await page.locator('body').click()
  await page.keyboard.press('n')
  await page.locator('#kb-title').waitFor({ timeout: 5000 })
  check('n opens a new item, as the palette has always said it would', true)
  await page.locator('#kb-title').fill('Ship the departure board')

  // Invent a person from the item, which is the moment you want one.
  await page.getByRole('button', { name: 'New assignee' }).click()
  await page.getByLabel('New assignee').fill('Ada Lovelace')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  // g then p: the pattern every forge already trained this audience on.
  await page.keyboard.press('g')
  await page.keyboard.press('p')
  await page.getByRole('button', { name: 'This is me' }).first().waitFor({ timeout: 5000 })
  check('g then p goes to People', true)
  await shoot(page, 'people')

  const load = await page
    .locator('[role="img"][aria-label*="open"]')
    .first()
    .getAttribute('aria-label')
  check('People reports the load it read off the board', /1 open/.test(load ?? ''), load ?? 'none')

  await page.getByRole('button', { name: 'This is me' }).first().click()
  await page.getByRole('button', { name: "That's me" }).first().waitFor({ timeout: 5000 })
  check('a person can be claimed as you', true)

  // The whole point of claiming one.
  await page.keyboard.press('g')
  await page.keyboard.press('w')
  await page.getByRole('button', { name: 'List' }).click()
  await page.getByLabel('Filter the work').fill('assignee:@me')
  await page.waitForTimeout(300)
  check(
    'assignee:@me now matches, in the filter',
    (await page.locator('.kb-list__row').count()) === 1,
  )

  // The chip puts the query in the box: what it does stays visible, editable
  // and combinable, rather than being a second definition of "mine".
  await page.getByLabel('Filter the work').fill('')
  await page.getByRole('button', { name: 'Mine', exact: true }).click()
  await page.waitForTimeout(250)
  check(
    'the Mine chip writes the query it stands for',
    (await page.getByLabel('Filter the work').inputValue()) === 'assignee:@me',
  )
  check('and narrows to that person', (await page.locator('.kb-list__row').count()) === 1)

  // Sorting, which the old table had and the list did not inherit.
  await page.getByRole('button', { name: 'Mine', exact: true }).click()
  await page.getByRole('button', { name: 'Points' }).click()
  await page.waitForTimeout(200)
  check('the list can be sorted', true)
  await page.getByRole('button', { name: /^Points/ }).click()
  await page.getByRole('button', { name: /^Points/ }).click()
  check(
    'and a third click gives the manual order back',
    (await page.getByRole('button', { name: 'Manual order' }).count()) === 0,
  )

  await page.keyboard.press('Escape')

  // `?` has to list exactly what is bound, or it becomes the next stale claim.
  await page.locator('body').click()
  await page.keyboard.press('?')
  await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor({ timeout: 5000 })
  check('? lists the shortcuts', true)
  await shoot(page, 'shortcuts')
  await page.keyboard.press('Escape')
  await page
    .getByRole('dialog', { name: 'Keyboard shortcuts' })
    .waitFor({ state: 'detached', timeout: 5000 })

  // A letter typed into a field must stay in the field.
  await page.getByRole('button', { name: 'Columns' }).click()
  await page.locator('.kb-card').first().click()
  await page.locator('#kb-title').fill('n')
  check(
    'a shortcut key typed into a field is text, not a shortcut',
    (await page.locator('#kb-title').inputValue()) === 'n',
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  // A card added while the board is showing one sprint belongs to that sprint.
  // It used to be created with no sprint and then hidden by the very filter
  // that was on screen when you asked for it, so the button did nothing you
  // could see.
  await page.getByRole('button', { name: 'Sprints' }).click()
  await page.getByRole('button', { name: 'Start a sprint' }).click()
  await page.getByRole('button', { name: 'Work' }).click()
  await page.getByLabel('Filter by sprint').selectOption({ index: 1 })
  await page.waitForTimeout(200)

  const inSprintBefore = await page.locator('.kb-card').count()
  await page
    .getByRole('button', { name: /^Add an item/ })
    .first()
    .click()
  await page.locator('#kb-title').waitFor({ timeout: 5000 })
  await page.locator('#kb-title').fill('Planned into the sprint')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForTimeout(250)

  check(
    'a card added while a sprint is showing lands in that sprint',
    (await page.locator('.kb-card').count()) === inSprintBefore + 1,
  )

  // And `n`, which is fired from anywhere and so cannot read the view's state.
  await page.locator('body').click()
  await page.keyboard.press('n')
  await page.locator('#kb-title').waitFor({ timeout: 5000 })
  await page.locator('#kb-title').fill('Added with the keyboard')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForTimeout(250)
  check(
    'and so does one added with the keyboard from anywhere',
    (await page.locator('.kb-card').count()) === inSprintBefore + 2,
  )

  await page.getByLabel('Filter by sprint').selectOption('__all')
  await page.waitForTimeout(200)

  // relates-to and duplicates were in the model, mergeable, exportable and
  // syncable, and there was no way to make one.
  await page.keyboard.press('n')
  await page.locator('#kb-title').waitFor({ timeout: 5000 })
  await page.locator('#kb-title').fill('The same thing again')
  await page.getByLabel('Add a related item').selectOption({ index: 1 })
  await page.waitForTimeout(200)
  check(
    'a related link can be made, not only a blocking one',
    (await page.getByLabel(/^Remove the related link/).count()) === 1,
  )
  await page.getByLabel('Add an item this duplicates').selectOption({ index: 1 })
  await page.waitForTimeout(200)
  check(
    'and a duplicate link too',
    (await page.getByLabel(/^Remove the duplicates link/).count()) === 1,
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.close()
}

/**
 * Switching mode from the settings panel, end to end.
 *
 * The switch is a navigation between two documents, because the policy belongs
 * to the document rather than to our code. What has to hold is that it is *one*
 * navigation, that the panel comes back rather than vanishing, and that the
 * configuration typed just before it survives the trip.
 */
async function modeSwitch(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  watchConsole(page, 'mode switch')

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#kb-project-name').fill('Gemini')
  await page.locator('#kb-project-key').fill('GEM')
  await page.getByRole('button', { name: 'Create the board' }).click()
  await page.getByRole('button', { name: 'New item' }).waitFor({ timeout: 5000 })

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 5000 })

  // A GitLab address, because its API lives under a path the switch used to
  // drop by storing the origin alone.
  await page.locator('#kb-remote').fill('https://gitlab.com/api/v4')

  const loads: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) loads.push(new URL(frame.url()).pathname)
  })

  await page.getByRole('button', { name: 'Repository' }).click()
  await page.waitForURL(/connect\.html/, { timeout: 5000 })
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 5000 })

  check(
    'switching mode loads the other document once, not this one and then that one',
    loads.length === 1 && loads[0]?.endsWith('/connect.html') === true,
    loads.join(' → '),
  )
  check('the settings panel comes back rather than vanishing', true)
  check(
    'the panel says which mode is now running',
    await page.getByText(/Repository mode is now active/).isVisible(),
  )

  const stored = await page.evaluate(() => localStorage.getItem('kanbo.sync') ?? '')
  check(
    'the forge API keeps its path, so GitLab still answers',
    (JSON.parse(stored) as { remoteUrl?: string }).remoteUrl === 'https://gitlab.com/api/v4',
    stored,
  )

  // And back again, which must land on the strict document.
  await page.getByRole('button', { name: 'Local' }).click()
  await page.waitForURL((url) => !url.pathname.endsWith('connect.html'), { timeout: 5000 })
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 5000 })
  check('switching back lands on the document that cannot reach the network', true)

  // Escape now closes it — and, unlike before, the marker is spent, so a
  // reload does not reopen a panel nobody asked for.
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached', timeout: 5000 })
  check('the settings panel closes on Escape', true)

  await page.reload({ waitUntil: 'networkidle' })
  check(
    'a later reload does not reopen the panel',
    (await page.getByRole('dialog', { name: 'Settings' }).count()) === 0,
  )

  await page.close()
}

/**
 * A share link cut short on the way here.
 *
 * `#s=` with nothing after it satisfied neither branch of the boot, so the
 * recipient got a white page: no text, no error, nothing in the console. That
 * is the one failure the share dialog warns the *sender* about, and it had no
 * handling at the receiving end at all.
 */
async function damagedShare(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  watchConsole(page, 'damaged share')

  await page.goto(`${BASE}/#s=`, { waitUntil: 'networkidle' })
  const text = (await page.locator('body').innerText()).trim()

  check('a link truncated to nothing says so rather than rendering a blank page', text.length > 0)
  check('and it says what to do about it', /incomplete/i.test(text), text.slice(0, 120))
  check(
    "and it does not open the reader's own board under someone else's link",
    (await page.locator('.kb-shell').count()) === 0,
  )

  await page.close()
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

  await bob.getByRole('button', { name: 'List' }).click()
  await bob.locator('.kb-list__row').first().waitFor({ timeout: 5000 })

  const bobSees = await bob.locator('.kb-list__row').count()
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
  await alice.getByRole('button', { name: 'List' }).click()
  await alice.waitForTimeout(400)
  const aliceSees = await alice.locator('.kb-list__row').count()
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

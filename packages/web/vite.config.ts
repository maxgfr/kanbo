import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig } from 'vite'

import { CONNECTED_DOCUMENT, STRICT_DOCUMENT, policyFor } from '@kanbo/core/policy'

/**
 * Both documents come from one source file, so they cannot drift apart in
 * anything except the directive we deliberately vary. The placeholder is the
 * seam: it survives every other plugin, and the build fails loudly if something
 * removed it before we got to substitute.
 */
const PLACEHOLDER = '__KANBO_CSP__'

function contentSecurityPolicy(): Plugin {
  let root = process.cwd()
  let outDir = 'dist'
  let isBuild = false

  return {
    name: 'kanbo:content-security-policy',

    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
      isBuild = config.command === 'build'
    },

    /**
     * `connect.html` is emitted at the end of the build, so there is no such
     * file for the dev server to serve. Serve the same source document instead
     * and let the transform below notice which URL was asked for — otherwise
     * repository mode would be untestable without a production build.
     */
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path = ''] = (req.url ?? '').split('?')
        if (path !== `/${CONNECTED_DOCUMENT}`) return next()

        void (async () => {
          try {
            const source = await readFile(resolve(root, 'index.html'), 'utf8')
            const html = await server.transformIndexHtml(req.url ?? path, source, req.originalUrl)
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
          } catch (error) {
            next(error)
          }
        })()
      })
    },

    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const meta = `<meta http-equiv="Content-Security-Policy" content="${PLACEHOLDER}" />`
        const withMeta = html.replace(/<head>/i, `<head>\n    ${meta}`)

        // At build time the placeholder stays put: closeBundle turns the one
        // built document into two.
        if (isBuild) return withMeta

        const asked = ctx.originalUrl?.split('?')[0]
        const mode = asked === `/${CONNECTED_DOCUMENT}` ? 'connected' : 'local'
        return withMeta.replace(PLACEHOLDER, policyFor(mode))
      },
    },

    async closeBundle() {
      if (!isBuild) return

      const dir = resolve(root, outDir)
      const built = await readFile(resolve(dir, STRICT_DOCUMENT), 'utf8')

      if (!built.includes(PLACEHOLDER)) {
        throw new Error(
          `kanbo:content-security-policy — ${PLACEHOLDER} is missing from the built document. ` +
            'Another plugin stripped it, and shipping either document without a policy would ' +
            'silently drop the guarantee the whole design rests on.',
        )
      }

      await Promise.all([
        writeFile(resolve(dir, STRICT_DOCUMENT), built.replaceAll(PLACEHOLDER, policyFor('local'))),
        writeFile(
          resolve(dir, CONNECTED_DOCUMENT),
          built.replaceAll(PLACEHOLDER, policyFor('connected')),
        ),
      ])
    },
  }
}

export default defineConfig({
  // GitHub Pages serves the app from /kanbo/; Docker and dev serve it from the
  // root. The workflow sets this, so the default stays correct everywhere else.
  base: process.env.KANBO_BASE ?? '/',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: {
    target: 'es2023',
    // An inline script would be blocked by our own policy, and the CI guard
    // rejects one outright. Emitting them is never useful here.
    assetsInlineLimit: 0,
  },
})

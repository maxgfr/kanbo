import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
  let isBuild = false

  return {
    name: 'kanbo:content-security-policy',

    configResolved(config) {
      root = config.root
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

        // At build time the placeholder stays put: generateBundle turns the one
        // built document into two.
        if (isBuild) return withMeta

        const asked = ctx.originalUrl?.split('?')[0]
        const mode = asked === `/${CONNECTED_DOCUMENT}` ? 'connected' : 'local'
        return withMeta.replace(PLACEHOLDER, policyFor(mode))
      },
    },

    /**
     * The split happens on the assets themselves, before anything is written.
     *
     * An earlier version read the built file back from disk in `closeBundle`,
     * which is wrong under Vite's environment API: that hook can run before the
     * output has landed, so the plugin found no file at all. Working on the
     * bundle removes the ordering question entirely — and the failure it would
     * have shipped is a document with no policy, so this is not a hook worth
     * being casual about.
     */
    generateBundle: {
      // Vite's own HTML plugin emits the document in this same hook, so ours
      // has to run after it or there is nothing to split.
      order: 'post',
      handler(_options, bundle) {
        if (!isBuild) return

        // Located by extension rather than by key: the bundle key depends on how
        // the entry was named and on `base`, and guessing it wrong is how this
        // plugin silently stops running.
        const document = Object.values(bundle).find(
          (asset) => asset.type === 'asset' && asset.fileName.endsWith('.html'),
        )
        if (!document || document.type !== 'asset') {
          throw new Error(
            `kanbo:content-security-policy — no HTML document is among the built assets, so ` +
              `neither ${STRICT_DOCUMENT} nor ${CONNECTED_DOCUMENT} can be produced.`,
          )
        }

        const html =
          typeof document.source === 'string'
            ? document.source
            : new TextDecoder().decode(document.source)

        if (!html.includes(PLACEHOLDER)) {
          throw new Error(
            `kanbo:content-security-policy — ${PLACEHOLDER} is missing from the built document. ` +
              'Another plugin stripped it, and shipping either document without a policy would ' +
              'silently drop the guarantee the whole design rests on.',
          )
        }

        document.source = html.replaceAll(PLACEHOLDER, policyFor('local'))
        this.emitFile({
          type: 'asset',
          fileName: CONNECTED_DOCUMENT,
          source: html.replaceAll(PLACEHOLDER, policyFor('connected')),
        })
      },
    },
  }
}

export default defineConfig({
  // GitHub Pages serves the app from /kanbo/; Docker and dev serve it from the
  // root. The workflow sets this, so the default stays correct everywhere else.
  base: process.env.KANBO_BASE ?? '/',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    target: 'es2023',
    // An inline script would be blocked by our own policy, and the CI guard
    // rejects one outright. Emitting them is never useful here.
    assetsInlineLimit: 0,
  },
})

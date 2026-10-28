import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Social crawlers (LinkedIn, Slack, iMessage, WhatsApp) and most search engines
 * will not resolve a relative `og:image`. They silently fall back to the
 * site's favicon — which is exactly how a stale logo ends up in a link
 * preview weeks after the icon was replaced.
 *
 * `%SITE_URL%` in index.html is therefore replaced with the deployment's own
 * origin at build time: Vercel exposes it, and `SITE_URL` covers everywhere
 * else. With no origin known the tokens collapse to a relative URL, which is
 * still correct for local development.
 */
function absoluteSiteUrls(): Plugin {
  const raw =
    process.env.SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    ''
  const origin = raw ? (raw.startsWith('http') ? raw : `https://${raw}`) : ''

  return {
    name: 'workday:absolute-site-urls',
    transformIndexHtml(html) {
      return html.replaceAll('%SITE_URL%', origin)
    },
  }
}

// The icon set is cache-busted as one generation. Bump this whenever a file in
// public/ changes, and every browser and OS that respected the old icon will
// fetch the new one instead of reusing its cached copy.
const ASSET_GENERATION = '6'

function cacheBustIcons(): Plugin {
  return {
    name: 'workday:icon-cache-bust',
    transformIndexHtml(html) {
      // Icons only. The manifest URL stays clean so PWA update detection
      // keeps working the way browsers expect.
      return html.replace(/(href="\/[^"]*\.(?:png|svg|ico))"/g, `$1?v=${ASSET_GENERATION}"`)
    },
  }
}

export default defineConfig({
  plugins: [react(), absoluteSiteUrls(), cacheBustIcons()],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true },
})

/**
 * Post-build script:
 *  1. Moves the SPA into dist/new/ (Vite base: /new/)
 *  2. Copies index.html into each route directory for static hosting
 *  3. Puts coming-soon.html at dist/index.html (site root)
 *  4. Generates 404.html from the coming-soon page
 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')

// Vite with base: '/new/' outputs assets with /new/ prefix in HTML,
// but files land in dist/. Move everything into dist/new/.
const newDir = join(dist, 'new')
mkdirSync(newDir, { recursive: true })

// Save the SPA index before overwriting
const spaIndex = join(dist, 'index.html')
cpSync(spaIndex, join(newDir, 'index.html'))

if (existsSync(join(dist, 'assets'))) {
  cpSync(join(dist, 'assets'), join(newDir, 'assets'), { recursive: true })
  rmSync(join(dist, 'assets'), { recursive: true })
}

if (existsSync(join(dist, 'logo.svg'))) {
  cpSync(join(dist, 'logo.svg'), join(newDir, 'logo.svg'))
  rmSync(join(dist, 'logo.svg'))
}

// Generate static routes inside new/
const src = join(newDir, 'index.html')

const docsSections = [
  'lightpaper',
  'intro', 'install', 'config',
  'overview', 'discovery', 'transport', 'metering', 'payments', 'reputation',
  'skills', 'create-skill',
  'provider-api', 'router-api', 'create-plugin',
  'commands', 'flags',
]

const routes = [
  'lightpaper',
  'docs',
  ...docsSections.map((s) => `docs/${s}`),
]

for (const route of routes) {
  const dir = join(newDir, route)
  mkdirSync(dir, { recursive: true })
  cpSync(src, join(dir, 'index.html'))
}

// Coming soon page at root + 404
const comingSoon = join(dist, 'coming-soon.html')
if (existsSync(comingSoon)) {
  cpSync(comingSoon, join(dist, 'index.html'))
  cpSync(comingSoon, join(dist, '404.html'))
  rmSync(comingSoon)
}

console.log(`Generated ${routes.length} static route(s) under /new/`)
console.log(`Root: coming-soon -> index.html + 404.html`)

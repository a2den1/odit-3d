import { build, context } from 'esbuild'
import { mkdirSync } from 'node:fs'

const watch = process.argv.includes('--watch')
mkdirSync('dist/electron', { recursive: true })

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'ffmpeg-static', 'electron-updater'],
  logLevel: 'info',
}
const entries = [
  { entryPoints: ['electron/main.ts'], outfile: 'dist/electron/main.js' },
  { entryPoints: ['electron/preload.ts'], outfile: 'dist/electron/preload.js' },
]

if (watch) {
  for (const e of entries) await (await context({ ...common, ...e })).watch()
} else {
  for (const e of entries) await build({ ...common, ...e })
}

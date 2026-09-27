import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const PORT = 5188
const esb = spawn(process.execPath, ['scripts/build-main.mjs', '--watch'], { stdio: 'inherit' })
const server = await createServer({ server: { port: PORT, strictPort: true } })
await server.listen()
await new Promise((r) => setTimeout(r, 1200))

const electronBin = (await import('electron')).default
const child = spawn(electronBin, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ODIT3D_DEV_URL: `http://localhost:${PORT}` },
})
child.on('close', async () => { esb.kill(); await server.close(); process.exit(0) })

import { app, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

/**
 * Auto-update from the public GitHub releases of a2den1/odit-3d.
 *
 * Hands-off by default: check a few seconds after launch, download in the
 * background, install when the app quits. Each release must carry the
 * setup.exe together with latest.yml (and the .blockmap for small downloads).
 */

const FEED = { provider: 'github' as const, owner: 'a2den1', repo: 'odit-3d' }

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'

export interface UpdatePrefs { autoCheck: boolean; autoDownload: boolean }

export interface UpdateStatus {
  state: UpdateState
  version?: string
  notes?: string
  percent?: number
  bytesPerSecond?: number
  error?: string
  currentVersion: string
  prefs: UpdatePrefs
  /** why it is off, when it is */
  reason?: string
}

const DEFAULT_PREFS: UpdatePrefs = { autoCheck: true, autoDownload: true }
const prefsPath = () => path.join(app.getPath('userData'), 'update-prefs.json')

async function readPrefs(): Promise<UpdatePrefs> {
  try {
    const raw = JSON.parse(await fs.readFile(prefsPath(), 'utf8')) as Partial<UpdatePrefs>
    return { ...DEFAULT_PREFS, ...raw }
  } catch { return { ...DEFAULT_PREFS } }
}
async function writePrefs(p: UpdatePrefs) {
  try {
    await fs.mkdir(path.dirname(prefsPath()), { recursive: true })
    await fs.writeFile(prefsPath(), JSON.stringify(p), 'utf8')
  } catch { /* not remembered, that is all */ }
}

let status: UpdateStatus = { state: 'disabled', currentVersion: app.getVersion(), prefs: { ...DEFAULT_PREFS } }
type AutoUpdater = typeof import('electron-updater').autoUpdater
let updater: AutoUpdater | null = null
let getWindow: () => BrowserWindow | null = () => null

function set(patch: Partial<UpdateStatus>) {
  status = { ...status, ...patch }
  const w = getWindow()
  if (w && !w.isDestroyed()) w.webContents.send('update:status', status)
}

/**
 * From a bundled CommonJS main process, `import('electron-updater')` comes
 * back through Node's ESM wrapper with the export hidden behind a getter the
 * CJS lexer cannot see — and only in a packaged build. Check both shapes.
 */
async function loadUpdater(): Promise<AutoUpdater | null> {
  try {
    const mod = (await import('electron-updater')) as unknown as { autoUpdater?: AutoUpdater; default?: { autoUpdater?: AutoUpdater } }
    return mod.autoUpdater ?? mod.default?.autoUpdater ?? null
  } catch { return null }
}

export async function initUpdater(windowGetter: () => BrowserWindow | null, opts: { offline?: boolean; probe?: string } = {}) {
  getWindow = windowGetter
  const prefs = await readPrefs()
  set({ prefs })
  if (!app.isPackaged) { set({ state: 'disabled', reason: '개발 모드에서는 꺼져 있어요' }); return }
  if (opts.offline) { set({ state: 'disabled', reason: '테스트 중에는 꺼져 있어요' }); return }

  const u = await loadUpdater()
  if (!u) { set({ state: 'error', error: '업데이터를 불러오지 못했어요' }); return }
  updater = u
  u.autoDownload = prefs.autoDownload
  u.autoInstallOnAppQuit = true
  u.logger = null
  u.setFeedURL(FEED)
  set({ state: 'idle' })

  u.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
  u.on('update-available', (info) => {
    set({ state: u.autoDownload ? 'downloading' : 'available', version: info.version, percent: 0,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined })
  })
  u.on('update-not-available', () => set({ state: 'none' }))
  u.on('download-progress', (p) => set({ state: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond }))
  u.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, percent: 100 }))
  u.on('error', (err) => set({ state: 'error', error: String(err?.message ?? err) }))

  if (prefs.autoCheck && !opts.probe) setTimeout(() => { u.checkForUpdates().catch(() => {}) }, 4000)
  if (opts.probe) await probe(u, opts.probe)
}

/**
 * `--update-probe[=X.Y.Z]`: check the real feed as if this build were version
 * X.Y.Z, download what it finds, print what happened and quit — the way to
 * prove a release is picked up without installing anything.
 */
async function probe(u: AutoUpdater, pretend: string) {
  const out = (m: string) => console.log('[update-probe] ' + m)
  try {
    if (pretend !== 'current') {
      // electron-updater ships its own semver; build the fake version with that same class
      const cur = (u as any).currentVersion
      ;(u as any).currentVersion = new cur.constructor(pretend)
    }
    u.autoDownload = true
    u.autoInstallOnAppQuit = false
    const done = new Promise<void>((res) => {
      u.once('update-downloaded', (i) => { out('downloaded ' + i.version); res() })
      u.once('update-not-available', (i) => { out('up to date ' + i.version); res() })
      u.once('error', (e) => { out('error ' + String(e?.message ?? e)); res() })
    })
    const r = await u.checkForUpdates()
    out('feed says ' + (r?.updateInfo?.version ?? '?') + ' for ' + String((u as any).currentVersion))
    await done
  } catch (e) {
    out('error ' + String((e as Error)?.stack ?? e))
  }
  app.exit(0)
}

export async function updaterLoadable() { return !!(await loadUpdater()) }

export function registerUpdaterIpc() {
  ipcMain.handle('update:status', () => status)
  ipcMain.handle('update:loadable', () => updaterLoadable())
  ipcMain.handle('update:setPrefs', async (_e, patch: Partial<UpdatePrefs>) => {
    const next = { ...status.prefs, ...patch }
    await writePrefs(next)
    if (updater) updater.autoDownload = next.autoDownload
    set({ prefs: next })
    return status
  })
  ipcMain.handle('update:check', async () => {
    if (!updater) return status
    try { await updater.checkForUpdates() } catch (e) { set({ state: 'error', error: String((e as Error)?.message ?? e) }) }
    return status
  })
  ipcMain.handle('update:download', async () => {
    if (!updater) return status
    try { set({ state: 'downloading', percent: 0 }); await updater.downloadUpdate() } catch (e) { set({ state: 'error', error: String((e as Error)?.message ?? e) }) }
    return status
  })
  ipcMain.handle('update:install', () => {
    if (!updater || status.state !== 'ready') return false
    setTimeout(() => updater!.quitAndInstall(false, true), 250)
    return true
  })
}

import { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } from 'electron'
import { spawn, execFile, ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs, createReadStream } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { initUpdater, registerUpdaterIpc } from './updater'

const MIME: Record<string, string> = {
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', mtl: 'text/plain',
  fbx: 'application/octet-stream', stl: 'model/stl', bin: 'application/octet-stream',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', hdr: 'application/octet-stream',
}
const mimeOf = (p: string) => MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = (require('ffmpeg-static') as string).replace('app.asar', 'app.asar.unpacked')

const isDev = !!process.env.ODIT3D_DEV_URL
const argv = process.argv.slice(1)
const flagSelftest = argv.includes('--selftest')
const flagShots = argv.includes('--shots')
const harness = flagSelftest || flagShots
let forceClose = false

/* A harness run gets its own profile: sharing the normal one means the GPU
   cache is locked by a running copy and WebGL silently falls back to nothing. */
if (harness) app.setPath('userData', path.join(os.tmpdir(), 'odit3d-harness-' + process.pid))

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

protocol.registerSchemesAsPrivileged([
  { scheme: 'odit3d', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
])

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1640, height: 1000, minWidth: 1180, minHeight: 720,
    show: false,
    backgroundColor: '#121316',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#121316', symbolColor: '#8b8b94', height: 34 },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  Menu.setApplicationMenu(null)

  const q: string[] = []
  if (flagSelftest) q.push('selftest=1')
  if (flagShots) q.push('shots=1')
  const qs = q.length ? '?' + q.join('&') : ''
  if (isDev) win.loadURL(process.env.ODIT3D_DEV_URL + '/' + qs)
  else win.loadURL(pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).toString() + qs)

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => { win = null })
  win.on('close', (e) => {
    if (forceClose || harness) return
    e.preventDefault()
    win?.webContents.send('app:close-request')
  })
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (harness) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log('[renderer]', message)
    })
  }
}

app.whenReady().then(() => {
  /* odit3d://local/<base64url path> — base64 keeps spaces, Korean and drive
     colons away from the URL parser. Ranges are answered by hand so <audio>
     can seek, and every answer carries CORS so loaders can fetch it. */
  protocol.handle('odit3d', async (request) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.replace(/^\/+/, '').split('/')
      let fsPath = Buffer.from(parts[0], 'base64url').toString('utf8')
      // relative references inside a model (textures, .bin, .mtl) resolve next to it
      if (parts.length > 1) fsPath = path.join(path.dirname(fsPath), ...parts.slice(1).map(decodeURIComponent))
      const stat = await fs.stat(fsPath)
      const headers: Record<string, string> = {
        'Content-Type': mimeOf(fsPath), 'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*',
      }
      const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('Range') ?? '')
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0
        const end = Math.min(m[2] ? parseInt(m[2], 10) : stat.size - 1, stat.size - 1)
        return new Response(Readable.toWeb(createReadStream(fsPath, { start, end })) as ReadableStream, {
          status: 206,
          headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${stat.size}` },
        })
      }
      return new Response(Readable.toWeb(createReadStream(fsPath)) as ReadableStream, {
        status: 200, headers: { ...headers, 'Content-Length': String(stat.size) },
      })
    } catch (e) {
      return new Response('odit3d: ' + String(e), { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } })
    }
  })
  createWindow()
  registerUpdaterIpc()
  const probeArg = argv.find((a) => a.startsWith('--update-probe'))
  initUpdater(() => win, { offline: harness, probe: probeArg ? (probeArg.split('=')[1] ?? 'current') : undefined })
    .catch((e) => console.error('[updater]', e))
})

app.on('window-all-closed', () => app.quit())

/* ------------------------------------------------------------------ helpers */

const projectsDir = () => path.join(app.getPath('documents'), 'ODIT 3D')
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const ensureDir = (p: string) => fs.mkdir(p, { recursive: true }).catch(() => {})

/* ------------------------------------------------------------------ app */

ipcMain.handle('app:info', async () => {
  await ensureDir(projectsDir())
  return { version: app.getVersion(), projects: projectsDir(), temp: os.tmpdir(), isDev }
})
ipcMain.handle('app:close', () => { forceClose = true; win?.close() })
ipcMain.handle('app:showItem', (_e, p: string) => shell.showItemInFolder(p))
ipcMain.handle('app:trash', async (_e, p: string) => {
  try { await shell.trashItem(p); return true } catch { return false }
})

/* ------------------------------------------------------------------ dialogs */

const MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx', 'stl']
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp']

ipcMain.handle('dialog:open', async (_e, kind: 'model' | 'audio' | 'image' | 'project' | 'blend' | 'exe') => {
  if (!win) return []
  const filters = {
    model: [{ name: '3D 모델', extensions: MODEL_EXT }],
    audio: [{ name: '오디오', extensions: AUDIO_EXT }],
    image: [{ name: '이미지', extensions: IMAGE_EXT }],
    project: [{ name: 'ODIT 3D 프로젝트', extensions: ['odit3d'] }],
    blend: [{ name: '블렌더 파일', extensions: ['blend'] }],
    exe: [{ name: 'blender.exe', extensions: ['exe'] }],
  }[kind]
  const r = await dialog.showOpenDialog(win, {
    properties: kind === 'model' || kind === 'audio' || kind === 'image' ? ['openFile', 'multiSelections'] : ['openFile'],
    defaultPath: kind === 'project' ? projectsDir() : undefined,
    filters,
  })
  return r.canceled ? [] : r.filePaths
})

ipcMain.handle('dialog:save', async (_e, name: string, ext: string) => {
  if (!win) return null
  const label: Record<string, string> = { odit3d: 'ODIT 3D 프로젝트', mp4: 'MP4 영상', png: 'PNG 이미지', gif: 'GIF', webm: 'WebM 영상' }
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(ext === 'odit3d' ? projectsDir() : app.getPath('videos'), `${name}.${ext}`),
    filters: [{ name: label[ext] ?? ext, extensions: [ext] }],
  })
  return r.canceled ? null : r.filePath
})

/* ------------------------------------------------------------------ files */

ipcMain.handle('fs:readText', (_e, p: string) => fs.readFile(p, 'utf8'))
ipcMain.handle('fs:writeText', async (_e, p: string, d: string) => {
  await ensureDir(path.dirname(p))
  // write-then-rename, so a crash mid-save never leaves half a project behind
  const tmp = p + '.tmp'
  await fs.writeFile(tmp, d, 'utf8')
  await fs.rename(tmp, p)
  return true
})
ipcMain.handle('fs:writeBinary', async (_e, p: string, d: ArrayBuffer) => {
  await ensureDir(path.dirname(p))
  await fs.writeFile(p, Buffer.from(d))
  return true
})
ipcMain.handle('fs:exists', async (_e, p: string) => fs.access(p).then(() => true, () => false))

/** Every project in the projects folder, newest first, with just enough to draw a card. */
ipcMain.handle('projects:list', async () => {
  const dir = projectsDir()
  await ensureDir(dir)
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.odit3d'))
  const out: { path: string; name: string; mtime: number; thumb: string | null; duration: number }[] = []
  for (const n of names) {
    const p = path.join(dir, n)
    try {
      const [st, txt] = await Promise.all([fs.stat(p), fs.readFile(p, 'utf8')])
      const j = JSON.parse(txt)
      out.push({ path: p, name: j.name ?? n.replace(/\.odit3d$/, ''), mtime: st.mtimeMs, thumb: j.thumb ?? null, duration: j.settings?.duration ?? 0 })
    } catch { /* a broken file just does not show up */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
})

/* ------------------------------------------------------------------ settings */

ipcMain.handle('store:get', async (_e, k: string) => {
  try { return JSON.parse(await fs.readFile(settingsFile(), 'utf8'))[k] ?? null } catch { return null }
})
ipcMain.handle('store:set', async (_e, k: string, v: unknown) => {
  let all: Record<string, unknown> = {}
  try { all = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) } catch {}
  all[k] = v
  await ensureDir(path.dirname(settingsFile()))
  await fs.writeFile(settingsFile(), JSON.stringify(all), 'utf8')
  return true
})

/* ------------------------------------------------------------------ export */

interface Session { proc: ChildProcessWithoutNullStreams; log: string[]; done: Promise<void>; out: string; tmp: string[] }
const sessions = new Map<string, Session>()

ipcMain.handle('export:begin', async (_e, id: string, o: {
  out: string; width: number; height: number; fps: number; format: 'mp4' | 'webm' | 'gif'
  wav: ArrayBuffer | null; crf: number
}) => {
  const tmp: string[] = []
  let audio: string | null = null
  if (o.wav && o.format !== 'gif') {
    audio = path.join(os.tmpdir(), `odit3d_${id}.wav`)
    await fs.writeFile(audio, Buffer.from(o.wav))
    tmp.push(audio)
  }
  const args = ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0']
  if (audio) args.push('-i', audio)
  if (o.format === 'gif') {
    args.push('-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0')
  } else if (o.format === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-crf', String(o.crf + 8), '-b:v', '0', '-pix_fmt', 'yuv420p', '-row-mt', '1')
    if (audio) args.push('-c:a', 'libopus', '-b:a', '192k')
  } else {
    args.push('-c:v', 'libx264', '-crf', String(o.crf), '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart')
    if (audio) args.push('-c:a', 'aac', '-b:a', '192k')
  }
  if (audio) args.push('-shortest')
  args.push(o.out)

  await ensureDir(path.dirname(o.out))
  const proc = spawn(ffmpegPath, args, { windowsHide: true })
  const log: string[] = []
  proc.stderr.on('data', (d: Buffer) => { log.push(d.toString()); if (log.length > 60) log.shift() })
  proc.stdin.on('error', () => {})
  const done = new Promise<void>((res, rej) => {
    proc.on('error', rej)
    proc.on('close', (code) => code === 0 ? res() : rej(new Error(`ffmpeg ${code}\n${log.slice(-8).join('')}`)))
  })
  done.catch(() => {})
  sessions.set(id, { proc, log, done, out: o.out, tmp })
  return true
})

ipcMain.handle('export:frame', async (_e, id: string, data: ArrayBuffer) => {
  const s = sessions.get(id)
  if (!s || !s.proc.stdin.writable) return false
  if (!s.proc.stdin.write(Buffer.from(data))) await new Promise<void>((r) => s.proc.stdin.once('drain', () => r()))
  return true
})

ipcMain.handle('export:end', async (_e, id: string) => {
  const s = sessions.get(id)
  if (!s) return { ok: false, error: '세션 없음' }
  sessions.delete(id)
  try {
    s.proc.stdin.end()
    await s.done
    const st = await fs.stat(s.out)
    return { ok: true, size: st.size, path: s.out }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  } finally {
    for (const t of s.tmp) await fs.unlink(t).catch(() => {})
  }
})

ipcMain.handle('export:cancel', async (_e, id: string) => {
  const s = sessions.get(id)
  if (!s) return false
  sessions.delete(id)
  try { s.proc.stdin.destroy(); s.proc.kill('SIGKILL') } catch {}
  await s.done.catch(() => {})
  for (const t of s.tmp) await fs.unlink(t).catch(() => {})
  await fs.unlink(s.out).catch(() => {})
  return true
})

/* ------------------------------------------------------------------ blender */

const exists = (p: string) => fs.access(p).then(() => true, () => false)

async function newestIn(dir: string, rel: string): Promise<string | null> {
  try {
    const names = (await fs.readdir(dir)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const n of names) { const p = path.join(dir, n, rel); if (await exists(p)) return p }
  } catch {}
  return null
}

function sh(bin: string, args: string[]): Promise<string> {
  return new Promise((res) => execFile(bin, args, { windowsHide: true }, (_e, out) => res(String(out ?? ''))))
}

/** Every place Blender tends to live on Windows: installer, Steam, the .blend file association, PATH. */
async function findBlender(hint?: string): Promise<string | null> {
  if (hint && await exists(hint)) return hint
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean) as string[]
  for (const root of pf) {
    const p = await newestIn(path.join(root, 'Blender Foundation'), 'blender.exe')
    if (p) return p
  }
  const steamRoots = new Set<string>([path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam')])
  try {
    const vdf = await fs.readFile(path.join([...steamRoots][0], 'steamapps', 'libraryfolders.vdf'), 'utf8')
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) steamRoots.add(m[1].replace(/\\\\/g, '\\'))
  } catch {}
  for (const d of ['C', 'D', 'E', 'F']) steamRoots.add(`${d}:\\SteamLibrary`)
  for (const root of steamRoots) {
    const p = path.join(root, 'steamapps', 'common', 'Blender', 'blender.exe')
    if (await exists(p)) return p
  }
  const reg = await sh('reg', ['query', 'HKCR\\blendfile\\shell\\open\\command', '/ve'])
  const m = /"([^"]*blender[^"]*\.exe)"/i.exec(reg)
  if (m) {
    const p = m[1].replace(/blender-launcher\.exe$/i, 'blender.exe')
    if (await exists(p)) return p
  }
  const where = (await sh('where', ['blender'])).split(/\r?\n/).find((l) => l.trim().endsWith('.exe'))
  if (where && await exists(where.trim())) return where.trim()
  return null
}

ipcMain.handle('blender:find', (_e, hint?: string) => findBlender(hint))

/** Have Blender itself write the scene out as glTF plus a little JSON of render settings. */
ipcMain.handle('blender:convert', async (_e, blend: string, hint?: string) => {
  const exe = await findBlender(hint)
  if (!exe) return { ok: false, error: 'no-blender' }
  const stem = path.basename(blend).replace(/\.blend$/i, '').replace(/[\\/:*?"<>|]/g, '_')
  const dir = path.join(projectsDir(), 'assets', `${stem}-${Date.now().toString(36)}`)
  await ensureDir(dir)
  const glb = path.join(dir, 'scene.glb')
  const json = path.join(dir, 'scene.json')
  const script = path.join(os.tmpdir(), `odit3d-blend-${process.pid}.py`)
  await fs.writeFile(script, BLEND_SCRIPT, 'utf8')
  const log: string[] = []
  const code = await new Promise<number>((res) => {
    const p = spawn(exe, ['--factory-startup', '-b', blend, '--python-exit-code', '3', '--python', script, '--', glb, json], { windowsHide: true })
    p.stdout.on('data', (d) => { log.push(String(d)); if (log.length > 80) log.shift() })
    p.stderr.on('data', (d) => { log.push(String(d)); if (log.length > 80) log.shift() })
    p.on('error', () => res(-1))
    p.on('close', (c) => res(c ?? -1))
  })
  await fs.unlink(script).catch(() => {})
  if (code !== 0 || !(await exists(glb))) return { ok: false, error: log.slice(-12).join('').trim() || `blender ${code}` }
  const info = JSON.parse(await fs.readFile(json, 'utf8'))
  return { ok: true, glb, info, blender: exe }
})

const BLEND_SCRIPT = String.raw`
import bpy, json, sys, traceback
argv = sys.argv[sys.argv.index("--") + 1:]
glb, out_json = argv[0], argv[1]
sc = bpy.context.scene
r = sc.render
info = {
    "fps": r.fps / (r.fps_base or 1),
    "start": sc.frame_start, "end": sc.frame_end,
    "w": int(r.resolution_x * r.resolution_percentage / 100),
    "h": int(r.resolution_y * r.resolution_percentage / 100),
    "camera": sc.camera.name if sc.camera else None,
    "world": None,
    "version": bpy.app.version_string,
    "objects": [{"name": o.name, "type": o.type} for o in sc.objects],
}
try:
    w = sc.world
    col = None
    if w and w.use_nodes:
        for n in w.node_tree.nodes:
            if n.type == "BACKGROUND":
                c = n.inputs[0].default_value
                col = [c[0], c[1], c[2]]
                break
    if col is None and w:
        col = list(w.color)
    info["world"] = col
except Exception:
    pass
kw = dict(filepath=glb, export_format="GLB", export_cameras=True, export_lights=True, export_apply=True,
          export_animations=True, export_yup=True, export_force_sampling=False,
          export_import_convert_lighting_mode="COMPAT")
done = False
for drop in ([], ["export_import_convert_lighting_mode"], ["export_import_convert_lighting_mode", "export_force_sampling"],
             ["export_import_convert_lighting_mode", "export_force_sampling", "export_lights"]):
    try:
        bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k not in drop})
        done = True
        break
    except TypeError:
        continue
if not done:
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB")
with open(out_json, "w", encoding="utf-8") as f:
    json.dump(info, f)
`

/* ------------------------------------------------------------------ harness */

ipcMain.handle('harness:shot', async (_e, name: string) => {
  if (!win) return null
  const dir = path.join(process.cwd(), 'shots')
  await ensureDir(dir)
  const img = await win.webContents.capturePage()
  const p = path.join(dir, name + '.png')
  await fs.writeFile(p, img.toPNG())
  return p
})
ipcMain.handle('harness:result', (_e, ok: boolean, lines: string[]) => {
  for (const l of lines) console.log(l)
  console.log(ok ? '[harness] PASS' : '[harness] FAIL')
  setTimeout(() => app.exit(ok ? 0 : 1), 50)
})

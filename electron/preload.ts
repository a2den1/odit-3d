import { contextBridge, ipcRenderer, webUtils } from 'electron'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** UTF-8 -> base64url without Buffer, which a sandboxed preload does not have. */
function b64url(str: string): string {
  const b = new TextEncoder().encode(str)
  let out = ''
  for (let i = 0; i < b.length; i += 3) {
    const b0 = b[i], b1 = b[i + 1], b2 = b[i + 2]
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    if (b1 === undefined) break
    out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    if (b2 === undefined) break
    out += B64[b2 & 63]
  }
  return out
}

export interface ProjectCard { path: string; name: string; mtime: number; thumb: string | null; duration: number }

const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info') as Promise<{ version: string; projects: string; temp: string; isDev: boolean }>,
    close: () => ipcRenderer.invoke('app:close'),
    showItem: (p: string) => ipcRenderer.invoke('app:showItem', p),
    trash: (p: string) => ipcRenderer.invoke('app:trash', p) as Promise<boolean>,
    onCloseRequest: (fn: () => void) => {
      const h = () => fn()
      ipcRenderer.on('app:close-request', h)
      return () => { ipcRenderer.off('app:close-request', h) }
    },
  },
  dialog: {
    open: (kind: 'model' | 'audio' | 'image' | 'project') => ipcRenderer.invoke('dialog:open', kind) as Promise<string[]>,
    save: (name: string, ext: string) => ipcRenderer.invoke('dialog:save', name, ext) as Promise<string | null>,
  },
  fs: {
    readText: (p: string) => ipcRenderer.invoke('fs:readText', p) as Promise<string>,
    writeText: (p: string, d: string) => ipcRenderer.invoke('fs:writeText', p, d) as Promise<boolean>,
    writeBinary: (p: string, d: ArrayBuffer) => ipcRenderer.invoke('fs:writeBinary', p, d) as Promise<boolean>,
    exists: (p: string) => ipcRenderer.invoke('fs:exists', p) as Promise<boolean>,
    /** a URL the renderer can fetch/load for a local file */
    url: (p: string) => `odit3d://local/${b64url(p)}`,
    pathOf: (f: File) => webUtils.getPathForFile(f),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list') as Promise<ProjectCard[]>,
  },
  store: {
    get: <T>(k: string) => ipcRenderer.invoke('store:get', k) as Promise<T | null>,
    set: (k: string, v: unknown) => ipcRenderer.invoke('store:set', k, v) as Promise<boolean>,
  },
  exporter: {
    begin: (id: string, o: unknown) => ipcRenderer.invoke('export:begin', id, o) as Promise<boolean>,
    frame: (id: string, d: ArrayBuffer) => ipcRenderer.invoke('export:frame', id, d) as Promise<boolean>,
    end: (id: string) => ipcRenderer.invoke('export:end', id) as Promise<{ ok: boolean; size?: number; path?: string; error?: string }>,
    cancel: (id: string) => ipcRenderer.invoke('export:cancel', id) as Promise<boolean>,
  },
  harness: {
    shot: (name: string) => ipcRenderer.invoke('harness:shot', name) as Promise<string | null>,
    result: (ok: boolean, lines: string[]) => ipcRenderer.invoke('harness:result', ok, lines),
  },
}

contextBridge.exposeInMainWorld('odit', api)
export type OditApi = typeof api

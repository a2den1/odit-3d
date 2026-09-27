let seq = 0
export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36).slice(-5) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6)
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const snapFrame = (t: number, fps: number) => Math.round(t * fps) / fps
export const deepClone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export function timecode(sec: number, fps: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  const f = Math.floor((s - Math.floor(s)) * fps + 1e-6)
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}

export function shortTime(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
export const stripExt = (p: string) => basename(p).replace(/\.[^.]+$/, '')
export const extname = (p: string) => (/\.([^.\\/]+)$/.exec(p)?.[1] ?? '').toLowerCase()

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function ago(ms: number): string {
  const d = (Date.now() - ms) / 1000
  if (d < 60) return '방금'
  if (d < 3600) return `${Math.floor(d / 60)}분 전`
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}일 전`
  const dt = new Date(ms)
  return `${dt.getFullYear()}.${dt.getMonth() + 1}.${dt.getDate()}`
}

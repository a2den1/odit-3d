import type { Clip, FxClip, Project, ShotClip, TitleClip } from '../core/types'
import { easeAt } from '../core/easing'
import { clamp } from '../core/util'

/* ------------------------------------------------------------------ shots */

export interface ShotState {
  cur: ShotClip | null
  /** the shot being left during a transition */
  prev: ShotClip | null
  /** 0..1 through the transition, 1 = fully on `cur` */
  u: number
}

export const shotsOf = (p: Project) =>
  (p.clips.filter((c) => c.kind === 'shot') as ShotClip[]).sort((a, b) => a.start - b.start)

export function shotAt(p: Project, t: number): ShotState {
  const shots = shotsOf(p)
  let idx = -1
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    if (t >= s.start - 1e-6 && t < s.start + s.dur) idx = i
  }
  // past the last shot, hold on it rather than dropping to nothing
  if (idx < 0 && shots.length) {
    const before = shots.filter((s) => s.start <= t)
    idx = before.length ? shots.indexOf(before[before.length - 1]) : 0
  }
  if (idx < 0) return { cur: null, prev: null, u: 1 }
  const cur = shots[idx]
  const prev = idx > 0 ? shots[idx - 1] : null
  if (!prev || cur.trans === 'cut' || cur.transDur <= 0) return { cur, prev: null, u: 1 }
  const u = (t - cur.start) / cur.transDur
  return u >= 1 ? { cur, prev: null, u: 1 } : { cur, prev, u: clamp(u, 0, 1) }
}

/* ------------------------------------------------------------------ effects */

export interface FxState {
  bloom: number
  vignette: number
  grain: number
  mono: number
  temp: number
  fade: number
  flash: number
  chroma: number
  shake: number
  pixel: number
  invert: number
}

const EDGE = 0.18
const envelope = (c: Clip, t: number) => {
  const a = (t - c.start) / EDGE
  const b = (c.start + c.dur - t) / EDGE
  return clamp(Math.min(a, b, 1), 0, 1)
}
export const clipActive = (c: Clip, t: number) => t >= c.start && t < c.start + c.dur

export function fxAt(p: Project, t: number): FxState {
  const s: FxState = {
    bloom: p.settings.bloom, vignette: 0, grain: 0, mono: 0, temp: 0, fade: 0,
    flash: 0, chroma: 0, shake: 0, pixel: 0, invert: 0,
  }
  for (const c of p.clips) {
    if (c.kind !== 'fx' || !clipActive(c, t)) continue
    const fx = c as FxClip
    const e = envelope(fx, t) * fx.amount
    const local = (t - fx.start) / Math.max(fx.dur, 1e-3)
    switch (fx.fx) {
      case 'bloom': s.bloom += e * 1.4; break
      case 'vignette': s.vignette = Math.max(s.vignette, e); break
      case 'grain': s.grain = Math.max(s.grain, e); break
      case 'mono': s.mono = Math.max(s.mono, e); break
      case 'warm': s.temp += e; break
      case 'cool': s.temp -= e; break
      // a fade builds across the whole clip, the way a fade-out should
      case 'fade': s.fade = Math.max(s.fade, easeAt('smooth', local) * fx.amount); break
      case 'flash': s.flash = Math.max(s.flash, Math.pow(1 - local, 2.2) * fx.amount); break
      case 'chroma': s.chroma = Math.max(s.chroma, e); break
      case 'shake': s.shake = Math.max(s.shake, e); break
      case 'pixel': s.pixel = Math.max(s.pixel, e); break
      case 'invert': s.invert = Math.max(s.invert, e); break
    }
  }
  return s
}

/* ------------------------------------------------------------------ titles */

/**
 * Draw every title visible at t onto a 2D context the size of the output.
 * Sizes are authored against a 1080-line frame and scale with the output.
 */
export function drawTitles(ctx: CanvasRenderingContext2D, p: Project, t: number, w: number, h: number) {
  const k = h / 1080
  for (const c of p.clips) {
    if (c.kind !== 'title' || !clipActive(c, t)) continue
    drawTitle(ctx, c, t, w, h, k)
  }
}

function drawTitle(ctx: CanvasRenderingContext2D, c: TitleClip, t: number, w: number, h: number, k: number) {
  const IN = Math.min(0.5, c.dur / 3)
  const local = t - c.start
  const uIn = clamp(local / IN, 0, 1)
  const uOut = clamp((c.start + c.dur - t) / IN, 0, 1)
  const u = Math.min(uIn, uOut)
  const leaving = uOut < uIn

  let alpha = 1, dy = 0, dx = 0, scale = 1, blur = 0
  let text = c.text
  switch (c.anim) {
    case 'fade': alpha = easeAt('smooth', u); break
    case 'rise': alpha = easeAt('smooth', u); dy = (1 - easeAt('cubicOut', u)) * 40 * (leaving ? -1 : 1); break
    case 'pop': scale = leaving ? easeAt('smooth', u) : easeAt('backOut', u); alpha = clamp(u * 3, 0, 1); break
    case 'blur': blur = (1 - easeAt('cubicOut', u)) * 24; alpha = easeAt('smooth', u); break
    case 'slide': dx = (1 - easeAt('expoOut', u)) * -120 * (leaving ? -1 : 1); alpha = clamp(u * 2, 0, 1); break
    case 'type': {
      const chars = [...c.text]
      const n = Math.ceil(chars.length * clamp(local / Math.max(0.3, Math.min(chars.length * 0.06, c.dur * 0.6)), 0, 1))
      text = chars.slice(0, n).join('')
      alpha = uOut
      break
    }
  }
  if (alpha <= 0.001 || scale <= 0.001) return

  const size = c.size * k
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(c.x * w + dx * k, c.y * h + dy * k)
  ctx.scale(scale, scale)
  if (blur > 0.1) ctx.filter = `blur(${blur * k}px)`
  ctx.font = `${c.weight} ${size}px 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = text.split('\n')
  const lh = size * 1.22
  const top = -((lines.length - 1) * lh) / 2
  if (c.box) {
    const full = c.text.split('\n')
    const bw = Math.max(...full.map((l) => ctx.measureText(l).width)) + size * 0.9
    const bh = full.length * lh + size * 0.35
    ctx.fillStyle = c.boxColor
    ctx.beginPath()
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, Math.min(bh / 2, size * 0.45))
    ctx.fill()
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = size * 0.25
    ctx.shadowOffsetY = size * 0.04
  }
  ctx.fillStyle = c.color
  lines.forEach((l, i) => ctx.fillText(l, 0, top + i * lh))
  ctx.restore()
}

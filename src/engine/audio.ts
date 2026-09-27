import type { AudioClip, Project } from '../core/types'

const buffers = new Map<string, Promise<AudioBuffer>>()
let ctx: AudioContext | null = null
const ac = () => (ctx ??= new AudioContext())

export function decodeFile(path: string, into: BaseAudioContext = ac()): Promise<AudioBuffer> {
  let pr = buffers.get(path)
  if (!pr) {
    pr = fetch(window.odit.fs.url(path)).then((r) => r.arrayBuffer()).then((b) => into.decodeAudioData(b))
    buffers.set(path, pr)
    pr.catch(() => buffers.delete(path))
  }
  return pr
}

/** peaks for drawing a clip's waveform, one value per bucket */
const peakCache = new Map<string, Float32Array>()
export async function peaks(path: string, buckets = 2000): Promise<Float32Array> {
  const hit = peakCache.get(path)
  if (hit) return hit
  const buf = await decodeFile(path)
  const ch = buf.getChannelData(0)
  const out = new Float32Array(buckets)
  const step = Math.max(1, Math.floor(ch.length / buckets))
  for (let i = 0; i < buckets; i++) {
    let m = 0
    for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 4) m = Math.max(m, Math.abs(ch[j]))
    out[i] = m
  }
  peakCache.set(path, out)
  return out
}

function schedule(c: BaseAudioContext, clip: AudioClip, buf: AudioBuffer, from: number, when: number, dest: AudioNode) {
  const end = clip.start + clip.dur
  if (from >= end) return null
  const into = Math.max(0, from - clip.start)
  const at = when + Math.max(0, clip.start - from)
  const len = clip.dur - into
  const src = c.createBufferSource()
  src.buffer = buf
  const g = c.createGain()
  const v = clip.volume
  // fades are written as a gain envelope relative to the clip, from wherever playback starts
  const env = (x: number) => {
    let k = 1
    if (clip.fadeIn > 0) k = Math.min(k, x / clip.fadeIn)
    if (clip.fadeOut > 0) k = Math.min(k, (clip.dur - x) / clip.fadeOut)
    return Math.max(0, Math.min(1, k)) * v
  }
  g.gain.setValueAtTime(env(into), at)
  const steps = 24
  if (clip.fadeIn > 0 || clip.fadeOut > 0) {
    for (let i = 1; i <= steps; i++) {
      const x = into + (len * i) / steps
      g.gain.linearRampToValueAtTime(env(x), at + (x - into))
    }
  }
  src.connect(g).connect(dest)
  src.start(at, clip.offset + into, len)
  return src
}

/** Plays the timeline's audio clips in step with the transport. */
export class AudioPlayer {
  private live: AudioBufferSourceNode[] = []
  private gen = 0

  async start(p: Project, from: number) {
    this.stop()
    const my = ++this.gen
    const c = ac()
    if (c.state === 'suspended') await c.resume()
    const clips = p.clips.filter((x): x is AudioClip => x.kind === 'audio' && x.start + x.dur > from)
    const bufs = await Promise.all(clips.map((x) => decodeFile(x.path).catch(() => null)))
    if (my !== this.gen) return
    const when = c.currentTime + 0.03
    clips.forEach((clip, i) => {
      const b = bufs[i]
      if (!b) return
      const s = schedule(c, clip, b, from, when, c.destination)
      if (s) this.live.push(s)
    })
  }

  stop() {
    this.gen++
    for (const s of this.live) { try { s.stop() } catch {} }
    this.live = []
  }
}

/** The whole timeline's audio as one buffer, for export. */
export async function mixdown(p: Project, rate = 48000): Promise<AudioBuffer | null> {
  const clips = p.clips.filter((x): x is AudioClip => x.kind === 'audio')
  if (!clips.length) return null
  const dur = p.settings.duration
  const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(dur * rate)), rate)
  for (const clip of clips) {
    try {
      const b = await decodeFile(clip.path)
      schedule(off, clip, b, 0, 0, off.destination)
    } catch { /* a missing file is simply silent */ }
  }
  return off.startRendering()
}

export function toWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate
  const out = new ArrayBuffer(44 + len * ch * 2)
  const v = new DataView(out)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, len * ch * 2, true)
  const data = Array.from({ length: ch }, (_, i) => buf.getChannelData(i))
  let o = 44
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i]))
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    o += 2
  }
  return out
}

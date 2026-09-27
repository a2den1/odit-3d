import type { Project } from '../core/types'
import { SceneEngine } from './engine'
import { drawTitles } from './timeline'
import { mixdown, toWav } from './audio'
import { uid } from '../core/util'

export interface ExportOpts {
  out: string
  format: 'mp4' | 'webm' | 'gif' | 'png'
  width: number
  height: number
  fps: number
  from: number
  to: number
  crf: number
  audio: boolean
}

export interface Progress { frame: number; total: number; message: string }

/**
 * One frame of the finished picture: the scene through the shot camera with
 * its effects, then the titles on top — the same thing the camera view shows.
 */
export class FrameRenderer {
  readonly engine: SceneEngine
  readonly canvas = document.createElement('canvas')
  readonly out = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D

  constructor(readonly w: number, readonly h: number) {
    this.engine = new SceneEngine(this.canvas, { pixelRatio: 1 })
    this.engine.setSize(w, h)
    this.out.width = w
    this.out.height = h
    this.ctx = this.out.getContext('2d', { willReadFrequently: true })!
  }

  async prepare(p: Project) {
    this.engine.sync(p, 0)
    await this.engine.whenReady()
    await document.fonts.ready
  }

  draw(p: Project, t: number): HTMLCanvasElement {
    this.engine.renderOutput(p, t)
    this.ctx.drawImage(this.canvas, 0, 0, this.w, this.h)
    drawTitles(this.ctx, p, t, this.w, this.h)
    return this.out
  }

  pixels(): ArrayBuffer {
    return this.ctx.getImageData(0, 0, this.w, this.h).data.buffer as ArrayBuffer
  }

  dispose() { this.engine.dispose() }
}

export class Exporter {
  private cancelled = false
  cancel() { this.cancelled = true }

  async run(p: Project, o: ExportOpts, onProgress: (x: Progress) => void): Promise<{ ok: boolean; path?: string; size?: number; error?: string }> {
    const fr = new FrameRenderer(o.width, o.height)
    const id = uid('x')
    try {
      onProgress({ frame: 0, total: 1, message: '장면 준비 중' })
      await fr.prepare(p)

      if (o.format === 'png') {
        fr.draw(p, o.from)
        const blob = await new Promise<Blob | null>((r) => fr.out.toBlob(r, 'image/png'))
        if (!blob) throw new Error('이미지를 만들지 못했어요')
        await window.odit.fs.writeBinary(o.out, await blob.arrayBuffer())
        return { ok: true, path: o.out, size: blob.size }
      }

      let wav: ArrayBuffer | null = null
      if (o.audio && o.format !== 'gif') {
        onProgress({ frame: 0, total: 1, message: '오디오 합치는 중' })
        const sub = { ...p, clips: p.clips.map((c) => c.kind === 'audio' ? { ...c, start: c.start - o.from } : c) }
        const mix = await mixdown({ ...sub, settings: { ...p.settings, duration: o.to - o.from } })
        if (mix) wav = toWav(mix)
      }

      await window.odit.exporter.begin(id, { out: o.out, width: o.width, height: o.height, fps: o.fps, format: o.format, wav, crf: o.crf })
      const total = Math.max(1, Math.round((o.to - o.from) * o.fps))
      const t0 = performance.now()
      for (let i = 0; i < total; i++) {
        if (this.cancelled) {
          await window.odit.exporter.cancel(id)
          return { ok: false, error: '취소했어요' }
        }
        fr.draw(p, o.from + i / o.fps)
        await window.odit.exporter.frame(id, fr.pixels())
        if (i % 2 === 0 || i === total - 1) {
          const rate = (i + 1) / ((performance.now() - t0) / 1000)
          const eta = Math.max(0, (total - i - 1) / Math.max(rate, 0.01))
          onProgress({ frame: i + 1, total, message: `${i + 1} / ${total} 프레임 · ${Math.ceil(eta)}초 남음` })
          await new Promise((r) => setTimeout(r, 0))
        }
      }
      onProgress({ frame: total, total, message: '파일 마무리 중' })
      return await window.odit.exporter.end(id)
    } catch (e: any) {
      await window.odit.exporter.cancel(id).catch(() => {})
      return { ok: false, error: String(e?.message ?? e) }
    } finally {
      fr.dispose()
    }
  }
}

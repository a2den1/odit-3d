import React, { useEffect, useRef } from 'react'
import { store, useStore, useTime, usePlaying } from '../core/store'
import { usePrefs, setPrefs } from '../core/settings'
import { SceneEngine } from '../engine/engine'
import { drawTitles, fxAt } from '../engine/timeline'
import { timecode } from '../core/util'

/**
 * The finished picture, next to the 3D view: through the shot camera with
 * effects and titles, while the 3D view stays free for editing.
 */
export default function PreviewPanel() {
  useStore()
  const time = useTime()
  const playing = usePlaying()
  const prefs = usePrefs()
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const titles = useRef<HTMLCanvasElement>(null)
  const s = store.project.settings

  useEffect(() => {
    const cv = canvas.current!
    const engine = new SceneEngine(cv, { pixelRatio: Math.min(devicePixelRatio, 2) })
    let needs = true
    const poke = () => { needs = true }
    const offA = store.subscribe(poke)
    const offB = store.subscribeTime(poke)
    engine.onAsync = poke

    let lastKey = ''
    const fit = () => {
      const r = stage.current!.getBoundingClientRect()
      const a = store.project.settings.width / store.project.settings.height
      const pad = 12
      const aw = Math.max(2, r.width - pad * 2), ah = Math.max(2, r.height - pad * 2)
      let w = aw, h = aw / a
      if (h > ah) { h = ah; w = ah * a }
      w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h))
      cv.style.width = w + 'px'; cv.style.height = h + 'px'
      engine.setSize(w, h)
      const tc = titles.current!
      tc.style.width = w + 'px'; tc.style.height = h + 'px'
      tc.width = Math.round(w * devicePixelRatio); tc.height = Math.round(h * devicePixelRatio)
      needs = true
    }
    const ro = new ResizeObserver(fit)
    ro.observe(stage.current!)

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const p = store.project
      const key = p.settings.width + 'x' + p.settings.height
      if (key !== lastKey) { lastKey = key; fit() }
      if (!needs && !store.playing) return
      needs = false
      const t = store.time
      engine.sync(p, t)
      engine.render(p, t, { output: true, shading: 'render', overlays: false, fx: fxAt(p, t) })
      const tc = titles.current!
      const ctx = tc.getContext('2d')!
      ctx.clearRect(0, 0, tc.width, tc.height)
      drawTitles(ctx, p, t, tc.width, tc.height)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      offA(); offB()
      engine.dispose()
    }
  }, [])

  return (
    <div className="panel preview-panel" style={prefs.previewDock === 'right' ? { width: store.previewSize.w } : { height: store.previewSize.h }}>
      <div className="panel-head">
        <span className="panel-title">프리뷰</span>
        <div className="spacer" />
        <button className="btn ghost icon sm" title={prefs.previewDock === 'right' ? '아래로 옮기기' : '오른쪽으로 옮기기'}
          onClick={() => setPrefs({ previewDock: prefs.previewDock === 'right' ? 'bottom' : 'right' })}>
          <i className={'fa-solid ' + (prefs.previewDock === 'right' ? 'fa-table-rows' : 'fa-table-columns')} />
        </button>
        <button className="btn ghost icon sm" title="닫기" onClick={() => store.setUi({ preview: false })}>
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div className="pv-stage" ref={stage}>
        <canvas ref={canvas} />
        <canvas ref={titles} className="pv-titles" />
      </div>
      <div className="pv-foot">
        <button className="play-btn" title="재생 (Space)" onClick={() => store.setPlaying(!playing)}>
          <i className={'fa-solid ' + (playing ? 'fa-pause' : 'fa-play')} />
        </button>
        <div className="tc"><span className="cur">{timecode(time, s.fps)}</span></div>
        <div className="spacer" />
        <span className="pv-size">{s.width}×{s.height}</span>
      </div>
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { store, useStore, useTime, type KeySel } from '../core/store'
import { PROPS, KEY_EPS } from '../core/anim'
import { EASINGS } from '../core/easing'
import { FX_MAP } from '../core/defaults'
import type { AudioClip, Clip, ClipKind, SceneObject } from '../core/types'
import { clamp, snapFrame } from '../core/util'
import { openMenu } from './widgets'
import { addShot } from './actions'
import { peaks } from '../engine/audio'
import { iconOf } from './Outliner'

const HEAD = 150
const ROW = 34
const KROW = 22
/** room before 0s so the first keys and clip edges are not under the track names */
const PAD = 12

const KIND_ROWS: { kind: ClipKind; label: string; icon: string }[] = [
  { kind: 'shot', label: '카메라 샷', icon: 'fa-film' },
  { kind: 'title', label: '자막', icon: 'fa-font' },
  { kind: 'fx', label: '효과', icon: 'fa-wand-magic-sparkles' },
  { kind: 'audio', label: '오디오', icon: 'fa-music' },
]

/** clips of one kind spread over as many lanes as they need to not overlap */
function lanes(clips: Clip[]): Clip[][] {
  const out: Clip[][] = []
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    const lane = out.find((l) => l.every((x) => x.start + x.dur <= c.start + 1e-4 || c.start + c.dur <= x.start + 1e-4))
    if (lane) lane.push(c); else out.push([c])
  }
  return out.length ? out : [[]]
}

function Wave({ clip, pps }: { clip: AudioClip; pps: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [pk, setPk] = useState<Float32Array | null>(null)
  useEffect(() => { peaks(clip.path).then(setPk).catch(() => {}) }, [clip.path])
  useEffect(() => {
    const cv = ref.current
    if (!cv || !pk) return
    const w = Math.max(1, Math.round(clip.dur * pps)), h = 22
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    for (let x = 0; x < w; x++) {
      const tt = clip.offset + (x / pps)
      const i = Math.floor((tt / clip.srcDur) * pk.length)
      const v = (pk[i] ?? 0) * clip.volume
      const bh = Math.max(1, v * h)
      ctx.fillRect(x, (h - bh) / 2, 1, bh)
    }
  }, [pk, clip.dur, clip.offset, clip.volume, pps])
  return <canvas ref={ref} className="clip-wave" />
}

export default function Timeline({ height }: { height: number }) {
  useStore()
  const time = useTime()
  const scroller = useRef<HTMLDivElement>(null)
  const p = store.project
  const { ui } = store
  const pps = ui.pxPerSec
  const fps = p.settings.fps
  const dur = p.settings.duration
  const width = Math.max(dur * pps + 200, 400)
  const X = (t: number) => PAD + t * pps

  /* ---------------------------------------------------- time from mouse */
  const tAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect()
    return (clientX - r.left - HEAD - PAD + scroller.current!.scrollLeft) / pps
  }
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault()
    store.setPlaying(false)
    store.setTime(tAt(e.clientX))
    const move = (ev: PointerEvent) => store.setTime(tAt(ev.clientX))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* keep the playhead in view while playing */
  useEffect(() => {
    const el = scroller.current
    if (!el || !store.playing) return
    const x = X(time) + HEAD
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - HEAD - 40
  }, [time])

  /* ctrl + wheel zooms around the mouse */
  useEffect(() => {
    const el = scroller.current!
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const t = tAt(e.clientX)
      const next = clamp(store.ui.pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 12, 800)
      store.setUi({ pxPerSec: next })
      requestAnimationFrame(() => { el.scrollLeft = PAD + t * next - (e.clientX - el.getBoundingClientRect().left - HEAD) })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  /* ---------------------------------------------------- snapping */
  const snapPoints = (skip: string) => {
    const pts = [0, store.time, dur]
    for (const c of p.clips) if (c.id !== skip) pts.push(c.start, c.start + c.dur)
    return pts
  }
  const snap = (t: number, skip: string) => {
    const tol = 8 / pps
    let best = snapFrame(t, fps), bd = tol
    for (const s of snapPoints(skip)) if (Math.abs(s - t) < bd) { bd = Math.abs(s - t); best = s }
    return Math.max(0, best)
  }

  /* ---------------------------------------------------- clip drag */
  const clipDown = (e: React.PointerEvent, c: Clip) => {
    if (e.button !== 0) return
    e.stopPropagation()
    store.selectClip(c.id)
    if (c.kind === 'shot' && store.ui.selection[0] !== c.cameraId) store.select([c.cameraId])
    store.selectClip(c.id)
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const edge = e.clientX - r.left < 7 ? 'l' : r.right - e.clientX < 7 ? 'r' : 'm'
    const x0 = e.clientX
    const s0 = c.start, d0 = c.dur
    const o0 = c.kind === 'audio' ? c.offset : 0
    let started = false
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps
      if (!started) { if (Math.abs(ev.clientX - x0) < 3) return; started = true; store.beginGesture() }
      store.patchClip(c.id, (x) => {
        if (edge === 'm') {
          const ns = snap(s0 + dt, c.id)
          const ne = snap(s0 + dt + d0, c.id)
          x.start = Math.abs(ne - (s0 + dt + d0)) < Math.abs(ns - (s0 + dt)) ? ne - d0 : ns
          x.start = Math.max(0, x.start)
        } else if (edge === 'l') {
          let ns = clamp(snap(s0 + dt, c.id), 0, s0 + d0 - 1 / fps)
          if (x.kind === 'audio') ns = Math.max(ns, s0 - o0)
          x.start = ns
          x.dur = s0 + d0 - ns
          if (x.kind === 'audio') x.offset = o0 + (ns - s0)
        } else {
          let ne = Math.max(s0 + 1 / fps, snap(s0 + d0 + dt, c.id))
          if (x.kind === 'audio') ne = Math.min(ne, s0 + (x.srcDur - x.offset))
          x.dur = ne - s0
        }
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (started) {
        store.endGesture()
        const end = Math.max(...store.project.clips.map((x) => x.start + x.dur))
        if (end > store.project.settings.duration) store.mutate((pp) => { pp.settings.duration = +end.toFixed(3) })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const clipMenu = (e: React.MouseEvent, c: Clip) => {
    e.preventDefault()
    store.selectClip(c.id)
    openMenu(e.clientX, e.clientY, [
      { label: '재생 헤드에서 자르기', icon: 'fa-scissors', key: 'Ctrl B', run: () => store.split() },
      { label: '복제', icon: 'fa-clone', run: () => {
        const n = { ...JSON.parse(JSON.stringify(c)), id: 'c' + Math.random().toString(36).slice(2, 9), start: c.start + c.dur }
        store.addClip(n)
      } },
      { sep: true },
      { label: '삭제', icon: 'fa-trash', key: 'Del', danger: true, run: () => store.deleteClip(c.id) },
    ])
  }

  const clipLabel = (c: Clip) => {
    if (c.kind === 'shot') return store.obj(c.cameraId)?.name ?? '카메라 없음'
    if (c.kind === 'title') return c.text.split('\n')[0] || ' '
    if (c.kind === 'fx') return FX_MAP[c.fx].name
    return c.name
  }

  /* ---------------------------------------------------- keyframes */
  const animated = p.objects.filter((o) => Object.keys(o.anim).length > 0 || ui.selection.includes(o.id))
  const isSel = (s: KeySel) => ui.selKeys.some((k) => k.obj === s.obj && k.key === s.key && Math.abs(k.t - s.t) <= KEY_EPS)

  const keyDown = (e: React.PointerEvent, group: KeySel[]) => {
    if (e.button !== 0) return
    e.stopPropagation()
    let sel = ui.selKeys
    const already = group.every(isSel)
    if (e.shiftKey) sel = already ? sel.filter((k) => !group.some((g) => g.obj === k.obj && g.key === k.key && Math.abs(g.t - k.t) <= KEY_EPS)) : [...sel, ...group]
    else if (!already) sel = group
    store.setUi({ selKeys: sel, selClip: null })
    const x0 = e.clientX
    let started = false
    let lastDt = 0
    const moving = sel
    const move = (ev: PointerEvent) => {
      const dt = snapFrame((ev.clientX - x0) / pps, fps)
      if (!started) { if (Math.abs(ev.clientX - x0) < 3) return; started = true; store.beginGesture() }
      if (dt === lastDt) return
      // move by the difference since the last step, keeping the selection following the keys
      const cur = moving.map((k) => ({ ...k, t: k.t + lastDt }))
      store.moveKeys(cur, dt - lastDt)
      lastDt = dt
      store.setUi({ selKeys: moving.map((k) => ({ ...k, t: Math.max(0, snapFrame(k.t + dt, fps)) })) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (started) store.endGesture()
      else if (!e.shiftKey) store.setTime(group[0].t)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const keyMenu = (e: React.MouseEvent, group: KeySel[]) => {
    e.preventDefault()
    const sel = group.every(isSel) ? ui.selKeys : group
    store.setUi({ selKeys: sel })
    openMenu(e.clientX, e.clientY, [
      ...['linear', 'smooth', 'easeIn', 'easeOut', 'backOut', 'bounceOut', 'elasticOut', 'hold'].map((id) => {
        const d = EASINGS.find((x) => x.id === id)!
        return { label: d.name, icon: 'fa-bezier-curve', run: () => store.setKeysEase(sel, d.id) }
      }),
      { sep: true },
      { label: '키프레임 삭제', icon: 'fa-trash', key: 'Del', danger: true, run: () => store.deleteKeys(sel) },
    ])
  }

  const summary = (o: SceneObject): { t: number; group: KeySel[] }[] => {
    const m = new Map<number, KeySel[]>()
    for (const [key, list] of Object.entries(o.anim)) for (const k of list) {
      const r = Math.round(k.t * 1000)
      if (!m.has(r)) m.set(r, [])
      m.get(r)!.push({ obj: o.id, key, t: k.t })
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => ({ t: g[0].t, group: g }))
  }

  const diamond = (t: number, group: KeySel[], key: string) => (
    <div key={key} className={'kf' + (group.every(isSel) ? ' sel' : '')} style={{ left: X(t) }}
      onPointerDown={(e) => keyDown(e, group)} onContextMenu={(e) => keyMenu(e, group)} />
  )

  /* ---------------------------------------------------- layout */
  const clipRows = KIND_ROWS.flatMap((k) => lanes(p.clips.filter((c) => c.kind === k.kind)).map((lane, i) => ({ ...k, lane, i })))

  const ticks: React.ReactNode[] = []
  const stepSec = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find((s) => s * pps >= 70) ?? 60
  for (let t = 0; t <= dur + stepSec; t += stepSec) {
    ticks.push(<div key={t} className="tick" style={{ left: X(t) }}><span>{t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${+t.toFixed(2)}s`}</span></div>)
  }

  return (
    <div className="timeline" style={{ height }}>
      <div className="tl-bar">
        <button className="btn ghost sm" title="자르기 (Ctrl B)" onClick={() => store.split()}><i className="fa-solid fa-scissors" />자르기</button>
        <button className="btn ghost sm" title="삭제 (Delete)" onClick={() => store.deleteSelection()}><i className="fa-solid fa-trash" /></button>
        <div className="tl-sep" />
        <button className="btn ghost sm" title="선택한 카메라로 샷 넣기" onClick={() => addShot()}><i className="fa-solid fa-film" />샷 넣기</button>
        <button className="btn ghost sm" title="변형 키프레임 넣기 (I)" disabled={!ui.selection.length} onClick={() => store.keySelection()}>
          <i className="fa-solid fa-diamond" />키 넣기
        </button>
        <button className={'btn sm rec' + (ui.autoKey ? ' on' : ' ghost')} title="자동 키 — 움직이면 바로 키프레임이 돼요"
          onClick={() => store.setUi({ autoKey: !ui.autoKey })}>
          <i className="fa-solid fa-circle" />자동 키
        </button>
        <div className="spacer" />
        <button className="btn ghost icon sm" title="축소" onClick={() => store.setUi({ pxPerSec: clamp(pps / 1.3, 12, 800) })}><i className="fa-solid fa-minus" /></button>
        <button className="btn ghost sm" title="전체 보기" onClick={() => {
          const w = (scroller.current?.clientWidth ?? 800) - HEAD - 40
          store.setUi({ pxPerSec: clamp(w / dur, 12, 800) })
          if (scroller.current) scroller.current.scrollLeft = 0
        }}>맞춤</button>
        <button className="btn ghost icon sm" title="확대" onClick={() => store.setUi({ pxPerSec: clamp(pps * 1.3, 12, 800) })}><i className="fa-solid fa-plus" /></button>
      </div>

      <div className="tl-scroll" ref={scroller}
        onPointerDown={(e) => { if (e.button === 0 && e.target === e.currentTarget) store.setUi({ selKeys: [], selClip: null }) }}>
        <div className="tl-inner" style={{ width: width + HEAD }}>
          <div className="tl-ruler">
            <div className="tl-corner" />
            <div className="tl-ticks" onPointerDown={scrub}>{ticks}<div className="tl-end" style={{ left: X(dur) }} /></div>
          </div>

          {clipRows.map((r) => (
            <div key={r.kind + r.i} className={'tl-row kind-' + r.kind} style={{ height: ROW }}>
              <div className="tl-head">
                {r.i === 0 && <><i className={'fa-solid ' + r.icon} /><span>{r.label}</span></>}
              </div>
              <div className="tl-lane" onPointerDown={(e) => { if (e.button === 0) { store.setUi({ selClip: null, selKeys: [] }); scrub(e) } }}>
                {r.lane.map((c) => (
                  <div key={c.id} className={'clip k-' + c.kind + (ui.selClip === c.id ? ' sel' : '')}
                    style={{ left: X(c.start), width: Math.max(4, c.dur * pps) }}
                    onPointerDown={(e) => clipDown(e, c)} onContextMenu={(e) => clipMenu(e, c)}>
                    {c.kind === 'shot' && c.trans !== 'cut' && <div className="clip-trans" style={{ width: Math.min(c.transDur, c.dur) * pps }} />}
                    {c.kind === 'audio' && <Wave clip={c} pps={pps} />}
                    <span className="clip-name">
                      {c.kind === 'shot' && <i className="fa-solid fa-video" />}
                      {clipLabel(c)}
                    </span>
                    <i className="clip-grip l" /><i className="clip-grip r" />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="tl-divider"><div className="tl-head"><span>키프레임</span></div><div /></div>

          {animated.length === 0 && (
            <div className="tl-row" style={{ height: KROW + 6 }}>
              <div className="tl-head dim">움직임 없음</div><div className="tl-lane" onPointerDown={scrub} />
            </div>
          )}
          {animated.map((o) => {
            const open = ui.expanded['tl:' + o.id]
            const props = PROPS.filter((d) => o.anim[d.key]?.length)
            return (
              <React.Fragment key={o.id}>
                <div className={'tl-row krow' + (ui.selection.includes(o.id) ? ' sel' : '')} style={{ height: KROW + 4 }}>
                  <div className="tl-head obj" onClick={() => store.select([o.id])}>
                    <button className="ol-twist" disabled={!props.length}
                      onClick={(e) => { e.stopPropagation(); store.setUi({ expanded: { ...ui.expanded, ['tl:' + o.id]: !open } }) }}>
                      <i className={'fa-solid ' + (open ? 'fa-caret-down' : 'fa-caret-right')} />
                    </button>
                    <i className={'fa-solid ' + iconOf(o)} /><span>{o.name}</span>
                  </div>
                  <div className="tl-lane" onPointerDown={(e) => { if (e.button === 0) { store.setUi({ selKeys: [] }); scrub(e) } }}>
                    {summary(o).map((s) => diamond(s.t, s.group, 's' + s.t))}
                  </div>
                </div>
                {open && props.map((d) => (
                  <div key={d.key} className="tl-row krow sub" style={{ height: KROW }}>
                    <div className="tl-head sub"><span>{d.label}</span></div>
                    <div className="tl-lane" onPointerDown={(e) => { if (e.button === 0) { store.setUi({ selKeys: [] }); scrub(e) } }}>
                      {o.anim[d.key].map((k) => diamond(k.t, [{ obj: o.id, key: d.key, t: k.t }], d.key + k.t))}
                    </div>
                  </div>
                ))}
              </React.Fragment>
            )
          })}

          <div className="tl-playhead" style={{ left: HEAD + X(time) }}><i /></div>
        </div>
      </div>
    </div>
  )
}

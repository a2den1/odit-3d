import React, { useRef, useState } from 'react'
import { store } from '../core/store'
import { Exporter, type ExportOpts, type Progress } from '../engine/exporter'
import { bytes } from '../core/util'
import { Seg, Select } from './widgets'

type Fmt = ExportOpts['format']

const SCALES = [
  { v: 1, label: '원본' }, { v: 0.5, label: '절반' }, { v: 2, label: '2배' },
]

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const s = store.project.settings
  const [fmt, setFmt] = useState<Fmt>('mp4')
  const [scale, setScale] = useState(1)
  const [quality, setQuality] = useState<'high' | 'normal' | 'small'>('high')
  const [prog, setProg] = useState<Progress | null>(null)
  const [done, setDone] = useState<{ path: string; size: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ex = useRef<Exporter | null>(null)
  const hasAudio = store.project.clips.some((c) => c.kind === 'audio')

  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  const w = even(s.width * (fmt === 'gif' ? Math.min(scale, 0.5) : scale))
  const h = even(s.height * (fmt === 'gif' ? Math.min(scale, 0.5) : scale))

  const go = async () => {
    const out = await window.odit.dialog.save(store.project.name, fmt)
    if (!out) return
    setErr(null); setDone(null)
    setProg({ frame: 0, total: 1, message: '준비 중' })
    store.setPlaying(false)
    const e = new Exporter()
    ex.current = e
    const r = await e.run(store.project, {
      out, format: fmt, width: w, height: h,
      fps: fmt === 'gif' ? Math.min(s.fps, 24) : s.fps,
      from: fmt === 'png' ? store.time : 0, to: s.duration,
      crf: quality === 'high' ? 17 : quality === 'normal' ? 21 : 26,
      audio: hasAudio,
    }, setProg)
    ex.current = null
    setProg(null)
    if (r.ok) setDone({ path: r.path!, size: r.size ?? 0 })
    else if (r.error !== '취소했어요') setErr(r.error ?? '실패했어요')
  }

  const busy = !!prog
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      onKeyDown={(e) => e.stopPropagation()}>
      <div className="modal export">
        <div className="modal-head"><h2>내보내기</h2></div>
        <div className="modal-body">
          <div className="field">
            <label>형식</label>
            <Seg value={fmt} onChange={setFmt} options={[
              { v: 'mp4', label: 'MP4' }, { v: 'webm', label: 'WebM' }, { v: 'gif', label: 'GIF' }, { v: 'png', label: '현재 프레임 PNG' },
            ]} />
          </div>
          <div className="grid2">
            <div className="field">
              <label>크기</label>
              <Select value={scale} onChange={setScale} options={SCALES.map((x) => ({ v: x.v, label: `${x.label} · ${even(s.width * x.v)}×${even(s.height * x.v)}` }))} />
            </div>
            {fmt !== 'png' && fmt !== 'gif' && (
              <div className="field">
                <label>화질</label>
                <Seg value={quality} onChange={setQuality} options={[{ v: 'high', label: '높음' }, { v: 'normal', label: '보통' }, { v: 'small', label: '작게' }]} />
              </div>
            )}
          </div>
          <div className="export-sum">
            <span>{w}×{h}</span>
            {fmt !== 'png' && <><span>{fmt === 'gif' ? Math.min(s.fps, 24) : s.fps}fps</span><span>{s.duration.toFixed(1)}초</span></>}
            {fmt !== 'png' && fmt !== 'gif' && hasAudio && <span>오디오 포함</span>}
          </div>

          {prog && (
            <div className="export-prog">
              <div className="progress"><div style={{ width: `${(prog.frame / prog.total) * 100}%` }} /></div>
              <span>{prog.message}</span>
            </div>
          )}
          {done && (
            <div className="export-done">
              <i className="fa-solid fa-circle-check" />
              <span>저장했어요 · {bytes(done.size)}</span>
              <div className="spacer" />
              <button className="btn sm" onClick={() => window.odit.app.showItem(done.path)}>폴더 열기</button>
            </div>
          )}
          {err && <div className="err-body">{err}</div>}
        </div>
        <div className="modal-foot">
          {busy
            ? <button className="btn" onClick={() => ex.current?.cancel()}>취소</button>
            : <button className="btn" onClick={onClose}>닫기</button>}
          <button className="btn primary" disabled={busy} onClick={go}>
            <i className="fa-solid fa-arrow-up-from-bracket" />내보내기
          </button>
        </div>
      </div>
    </div>
  )
}

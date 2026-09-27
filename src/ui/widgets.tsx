import React, { useCallback, useEffect, useRef, useState } from 'react'
import { clamp } from '../core/util'
import { store } from '../core/store'

/* ---------------------------------------------------------------- slider */

export function Slider({ value, min, max, step = 0.01, onChange }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const span = max - min || 1
  const pct = clamp((value - min) / span, 0, 1)
  const apply = useCallback((x: number) => {
    const r = ref.current!.getBoundingClientRect()
    const raw = min + clamp((x - r.left) / Math.max(r.width, 1), 0, 1) * span
    onChange(clamp(parseFloat((Math.round(raw / step) * step).toFixed(6)), min, max))
  }, [min, max, span, step, onChange])
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    store.beginGesture()
    apply(e.clientX)
    const move = (ev: PointerEvent) => apply(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      store.endGesture()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="slider" ref={ref} onPointerDown={down}>
      <div className="slider-track" />
      <div className="slider-fill" style={{ width: `${pct * 100}%` }} />
      <div className="slider-thumb" style={{ left: `${pct * 100}%` }} />
    </div>
  )
}

/* --------------------------------------------------------------- numbers */

const fmt = (v: number, step: number) => {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  return v.toFixed(d)
}

/**
 * A number you can drag sideways to scrub or click to type into. The whole
 * drag is one undo step.
 */
export function NumField({ label, value, onChange, step = 0.01, min = -Infinity, max = Infinity, suffix, color, speed }: {
  label?: string; value: number; onChange: (v: number) => void
  step?: number; min?: number; max?: number; suffix?: string; color?: string; speed?: number
}) {
  const [edit, setEdit] = useState<string | null>(null)
  const moved = useRef(false)
  const down = (e: React.PointerEvent) => {
    if (edit !== null || e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.requestPointerLock?.()
    moved.current = false
    const start = value
    let acc = 0
    store.beginGesture()
    const move = (ev: PointerEvent) => {
      acc += ev.movementX
      if (Math.abs(acc) > 2) moved.current = true
      if (!moved.current) return
      const fine = ev.shiftKey ? 0.1 : ev.ctrlKey ? 10 : 1
      const per = (speed ?? step) * fine
      onChange(clamp(parseFloat((start + Math.round(acc) * per).toFixed(6)), min, max))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.exitPointerLock?.()
      store.endGesture()
      if (!moved.current) setEdit(fmt(value, step))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const commit = (s: string) => {
    setEdit(null)
    const v = Number(s.replace(/[^\d.+\-*/() e]/g, ''))
    if (Number.isFinite(v)) onChange(clamp(v, min, max))
  }
  return (
    <div className={'num' + (edit !== null ? ' editing' : '')} onPointerDown={down} title={label}>
      {color && <i className="num-axis" style={{ background: color }} />}
      {label && <span className="num-label">{label}</span>}
      {edit !== null ? (
        <input className="num-input" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setEdit(null)
          }} />
      ) : (
        <span className="num-value">{fmt(value, step)}{suffix}</span>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- bits */

export function ColorSwatch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="swatch" style={{ background: value }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        onPointerDown={() => store.beginGesture()} onBlur={() => store.endGesture()} />
    </label>
  )
}

export function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: { v: T; label?: string; icon?: string; title?: string }[]; onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)} title={o.title ?? o.label}>
          {o.icon && <i className={'fa-solid ' + o.icon} />}{o.label}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string | number>({ value, options, onChange }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <div className="select-wrap">
      <select className="input" value={String(value)} onChange={(e) => {
        const o = options.find((x) => String(x.v) === e.target.value)
        if (o) onChange(o.v)
      }}>
        {options.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.label}</option>)}
      </select>
      <i className="fa-solid fa-chevron-down" />
    </div>
  )
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={'sw' + (on ? ' on' : '')} onClick={() => onChange(!on)}><i /></button>
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prow">
      <span className="prow-label">{label}</span>
      <div className="prow-body">{children}</div>
    </div>
  )
}

export function Section({ title, children, right, open: initial = true }: {
  title: string; children: React.ReactNode; right?: React.ReactNode; open?: boolean
}) {
  const [open, setOpen] = useState(initial)
  return (
    <div className="insp-section">
      <div className="insp-head" onClick={() => setOpen(!open)}>
        <i className={'fa-solid fa-chevron-right chev' + (open ? ' open' : '')} />
        <h4>{title}</h4>
        {right && <div className="insp-head-actions" onClick={(e) => e.stopPropagation()}>{right}</div>}
      </div>
      {open && <div className="insp-body">{children}</div>}
    </div>
  )
}

/* --------------------------------------------------------------- confirm */

interface Ask { title: string; body?: string; ok: string; cancel: string; extra?: string; danger?: boolean; resolve: (v: 'ok' | 'cancel' | 'extra') => void }
let pushAsk: ((a: Ask) => void) | null = null

export function ask(title: string, o: { body?: string; ok?: string; cancel?: string; extra?: string; danger?: boolean } = {}) {
  return new Promise<'ok' | 'cancel' | 'extra'>((resolve) => {
    const a: Ask = { title, body: o.body, ok: o.ok ?? '확인', cancel: o.cancel ?? '취소', extra: o.extra, danger: o.danger, resolve }
    if (pushAsk) pushAsk(a); else resolve('cancel')
  })
}

export function AskHost() {
  const [q, setQ] = useState<Ask | null>(null)
  useEffect(() => { pushAsk = setQ; return () => { pushAsk = null } }, [])
  if (!q) return null
  const done = (v: 'ok' | 'cancel' | 'extra') => { setQ(null); q.resolve(v) }
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) done('cancel') }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') done('cancel'); if (e.key === 'Enter') done('ok') }}>
      <div className="modal small">
        <div className="modal-head"><h2>{q.title}</h2></div>
        {q.body && <div className="modal-body"><p className="ask-body">{q.body}</p></div>}
        <div className="modal-foot">
          {q.extra && <button className="btn ghost" onClick={() => done('extra')}>{q.extra}</button>}
          <div className="spacer" />
          <button className="btn" onClick={() => done('cancel')}>{q.cancel}</button>
          <button className={'btn ' + (q.danger ? 'danger-fill' : 'primary')} autoFocus onClick={() => done('ok')}>{q.ok}</button>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- menus */

export interface MenuItem { label?: string; icon?: string; key?: string; danger?: boolean; sep?: boolean; run?: () => void; disabled?: boolean }

let pushMenu: ((m: { x: number; y: number; items: MenuItem[] } | null) => void) | null = null
export function openMenu(x: number, y: number, items: MenuItem[]) { pushMenu?.({ x, y, items }) }

export function MenuHost() {
  const [m, setM] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useEffect(() => { pushMenu = setM; return () => { pushMenu = null } }, [])
  useEffect(() => {
    if (!m) return
    const el = ref.current
    const w = el?.offsetWidth ?? 200, h = el?.offsetHeight ?? 200
    setPos({ x: Math.min(m.x, innerWidth - w - 6), y: Math.min(m.y, innerHeight - h - 6) })
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setM(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setM(null) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true) }
  }, [m])
  if (!m) return null
  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {m.items.map((it, i) => it.sep ? <div key={i} className="ctx-sep" /> : (
        <button key={i} className={'ctx-item' + (it.danger ? ' danger' : '')} disabled={it.disabled}
          onClick={() => { setM(null); it.run?.() }}>
          <i className={'fa-solid ' + (it.icon ?? '')} />{it.label}{it.key && <span className="key">{it.key}</span>}
        </button>
      ))}
    </div>
  )
}

import React, { useState } from 'react'
import { store, useStore } from '../core/store'
import type { SceneObject } from '../core/types'
import { openMenu } from './widgets'
import { viewportApi } from './vpApi'

export function iconOf(o: SceneObject): string {
  if (o.kind === 'camera') return 'fa-video'
  if (o.kind === 'light') return o.light?.kind === 'sun' ? 'fa-sun' : o.light?.kind === 'spot' ? 'fa-bullseye' : 'fa-lightbulb'
  if (o.kind === 'model') return 'fa-cubes'
  if (o.kind === 'empty') return 'fa-crosshairs'
  if (o.prim?.kind === 'text') return 'fa-font'
  if (o.prim?.kind === 'sphere' || o.prim?.kind === 'icosphere') return 'fa-circle'
  if (o.prim?.kind === 'plane') return 'fa-square'
  return 'fa-cube'
}

/** Blender-style scene tree: drag onto a row to parent, onto the gap above to reorder. */
export default function Outliner() {
  useStore()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string | null; mode: 'in' | 'before' } | null>(null)
  const objs = store.project.objects
  const sel = new Set(store.ui.selection)
  const collapsed = store.ui.expanded

  const rows: { o: SceneObject; depth: number }[] = []
  const walk = (pid: string | null, depth: number) => {
    for (const o of objs) {
      if (o.parentId !== pid) continue
      rows.push({ o, depth })
      if (!collapsed[o.id]) walk(o.id, depth + 1)
    }
  }
  walk(null, 0)
  // anything whose parent went missing still shows up
  for (const o of objs) if (o.parentId && !objs.some((x) => x.id === o.parentId) && !rows.some((r) => r.o.id === o.id)) rows.push({ o, depth: 0 })

  const hasKids = (id: string) => objs.some((o) => o.parentId === id)

  const drop = () => {
    if (drag && over) {
      if (over.mode === 'in') store.setParent(drag, over.id)
      else {
        const target = over.id ? store.obj(over.id) : null
        store.mutate((p) => {
          const o = p.objects.find((x) => x.id === drag)
          if (o && o.parentId !== (target?.parentId ?? null)) o.parentId = target?.parentId ?? null
        })
        store.reorder(drag, over.id)
      }
    }
    setDrag(null); setOver(null)
  }

  const menu = (e: React.MouseEvent, o: SceneObject) => {
    e.preventDefault()
    if (!sel.has(o.id)) store.select([o.id])
    openMenu(e.clientX, e.clientY, [
      { label: '이름 바꾸기', icon: 'fa-pen', key: 'F2', run: () => setRenaming(o.id) },
      { label: '복제', icon: 'fa-clone', key: 'Shift D', run: () => store.duplicateSelection() },
      { label: '화면에 맞추기', icon: 'fa-expand', key: 'F', run: () => viewportApi.frameSelected?.() },
      { label: o.parentId ? '부모에서 빼기' : '부모 없음', icon: 'fa-link-slash', disabled: !o.parentId, run: () => store.setParent(o.id, null) },
      { label: '애니메이션 지우기', icon: 'fa-eraser', disabled: !Object.keys(o.anim).length, run: () => store.clearAnim(o.id) },
      { sep: true },
      { label: '삭제', icon: 'fa-trash', key: 'Del', danger: true, run: () => store.deleteSelection() },
    ])
  }

  return (
    <div className="outliner" onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); drop() }}>
      {rows.map(({ o, depth }) => (
        <div key={o.id}
          className={'ol-row' + (sel.has(o.id) ? ' sel' : '') + (!o.visible ? ' hidden' : '')
            + (over?.id === o.id ? (over.mode === 'in' ? ' drop-in' : ' drop-before') : '')}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={renaming !== o.id}
          onDragStart={(e) => { setDrag(o.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { setDrag(null); setOver(null) }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!drag || drag === o.id) return
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setOver({ id: o.id, mode: e.clientY - r.top < r.height * 0.3 ? 'before' : 'in' })
          }}
          onClick={(e) => store.select([o.id], e.shiftKey || e.ctrlKey)}
          onDoubleClick={() => setRenaming(o.id)}
          onContextMenu={(e) => menu(e, o)}>
          <button className={'ol-twist' + (hasKids(o.id) ? '' : ' none')}
            onClick={(e) => { e.stopPropagation(); store.setUi({ expanded: { ...collapsed, [o.id]: !collapsed[o.id] } }) }}>
            <i className={'fa-solid ' + (collapsed[o.id] ? 'fa-caret-right' : 'fa-caret-down')} />
          </button>
          <i className={'ol-icon fa-solid ' + iconOf(o)} />
          {renaming === o.id ? (
            <input className="ol-rename" autoFocus defaultValue={o.name}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== o.name) store.rename(o.id, v); setRenaming(null) }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenaming(null)
              }} />
          ) : <span className="ol-name">{o.name}</span>}
          {Object.keys(o.anim).length > 0 && <i className="ol-anim fa-solid fa-diamond" title="애니메이션 있음" />}
          <button className={'ol-act' + (o.locked ? ' on' : '')} title="잠금"
            onClick={(e) => { e.stopPropagation(); store.patch(o.id, (x) => { x.locked = !x.locked }) }}>
            <i className={'fa-solid ' + (o.locked ? 'fa-lock' : 'fa-lock-open')} />
          </button>
          <button className={'ol-act' + (!o.visible ? ' on' : '')} title="보이기 (H)"
            onClick={(e) => { e.stopPropagation(); store.patch(o.id, (x) => { x.visible = !x.visible }) }}>
            <i className={'fa-solid ' + (o.visible ? 'fa-eye' : 'fa-eye-slash')} />
          </button>
        </div>
      ))}
      <div className={'ol-tail' + (over?.id === null ? ' drop-before' : '')}
        onDragOver={(e) => { e.preventDefault(); if (drag) setOver({ id: null, mode: 'before' }) }}
        onClick={() => store.select([])} />
    </div>
  )
}

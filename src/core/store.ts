import { useSyncExternalStore } from 'react'
import type { Clip, EditMesh, Keyframe, Project, SceneObject, Vec3 } from './types'
import { PROP_MAP, setKey, evalKeys, KEY_EPS, valueAt } from './anim'
import { makeShot, newProject } from './defaults'
import { clamp, deepClone, snapFrame, uid } from './util'
import type { EasingKind } from './easing'

export type Screen = 'home' | 'editor'
export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type Shading = 'wire' | 'solid' | 'render'
export type LeftTab = 'add' | 'material' | 'motion' | 'text' | 'fx' | 'audio'
export type RightTab = 'object' | 'scene'

export interface KeySel { obj: string; key: string; t: number }
export type EditSelMode = 'vert' | 'face'
/** mesh edit mode: which object, how clicks select, and the selected vertex indices */
export interface EditState { id: string; mode: EditSelMode; sel: number[] }

interface Ui {
  screen: Screen
  selection: string[]
  selClip: string | null
  selKeys: KeySel[]
  gizmo: GizmoMode
  shading: Shading
  /** look through the active shot camera, with titles and effects on top */
  camView: boolean
  autoKey: boolean
  leftTab: LeftTab
  rightTab: RightTab
  /** timeline zoom, px per second */
  pxPerSec: number
  expanded: Record<string, boolean>
  toast: { id: number; text: string } | null
  edit: EditState | null
}

const MAX_UNDO = 150

class Store {
  project: Project = newProject()
  path: string | null = null
  dirty = false
  ui: Ui = {
    screen: 'home', selection: [], selClip: null, selKeys: [], gizmo: 'translate', shading: 'render',
    camView: false, autoKey: false, leftTab: 'add', rightTab: 'object', pxPerSec: 90, expanded: {}, toast: null, edit: null,
  }

  /* ------------------------------------------------------------ time */
  time = 0
  playing = false
  private timeSubs = new Set<() => void>()
  private subs = new Set<() => void>()
  version = 0

  private undo: string[] = []
  private redo: string[] = []
  private gesture = 0
  private coalesceKey: string | null = null
  private coalesceAt = 0

  /** set by the viewport so saving can store a picture of the scene */
  thumbnailer: (() => string | null) | null = null

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn) } }
  subscribeTime = (fn: () => void) => { this.timeSubs.add(fn); return () => { this.timeSubs.delete(fn) } }
  emit() { this.version++; for (const f of this.subs) f() }
  private emitTime() { for (const f of this.timeSubs) f() }

  setUi(p: Partial<Ui>) { this.ui = { ...this.ui, ...p }; this.emit() }

  toast(text: string) {
    const id = Date.now()
    this.setUi({ toast: { id, text } })
    setTimeout(() => { if (this.ui.toast?.id === id) this.setUi({ toast: null }) }, 2200)
  }

  /* ------------------------------------------------------------ undo */

  private snapshot() { return JSON.stringify(this.project) }

  /** Every edit goes through here: one snapshot per call, or per gesture. */
  mutate(fn: (p: Project) => void, coalesce?: string) {
    const now = performance.now()
    const merge = this.gesture > 0 || (coalesce && coalesce === this.coalesceKey && now - this.coalesceAt < 700)
    if (!merge) {
      this.undo.push(this.snapshot())
      if (this.undo.length > MAX_UNDO) this.undo.shift()
      this.redo = []
    }
    this.coalesceKey = coalesce ?? null
    this.coalesceAt = now
    fn(this.project)
    this.dirty = true
    this.emit()
  }

  beginGesture() {
    if (this.gesture === 0) {
      this.undo.push(this.snapshot())
      if (this.undo.length > MAX_UNDO) this.undo.shift()
      this.redo = []
    }
    this.gesture++
  }
  endGesture() { this.gesture = Math.max(0, this.gesture - 1) }
  /** abandon the gesture and put things back how they were */
  cancelGesture() {
    if (this.gesture === 0) return
    this.gesture = 0
    const s = this.undo.pop()
    if (s) this.project = JSON.parse(s)
    this.emit()
  }

  doUndo() {
    const s = this.undo.pop()
    if (!s) return
    this.redo.push(this.snapshot())
    this.project = JSON.parse(s)
    this.fixSelection()
    this.dirty = true
    this.emit()
  }
  doRedo() {
    const s = this.redo.pop()
    if (!s) return
    this.undo.push(this.snapshot())
    this.project = JSON.parse(s)
    this.fixSelection()
    this.dirty = true
    this.emit()
  }
  get canUndo() { return this.undo.length > 0 }
  get canRedo() { return this.redo.length > 0 }

  private fixSelection() {
    const ids = new Set(this.project.objects.map((o) => o.id))
    const clips = new Set(this.project.clips.map((c) => c.id))
    this.ui = {
      ...this.ui,
      selection: this.ui.selection.filter((id) => ids.has(id)),
      selClip: this.ui.selClip && clips.has(this.ui.selClip) ? this.ui.selClip : null,
      selKeys: [],
    }
    const e = this.ui.edit
    if (e) {
      const m = this.obj(e.id)?.edit
      this.ui.edit = m ? { ...e, sel: e.sel.filter((i) => i < m.pos.length / 3) } : null
    }
  }

  /* ------------------------------------------------------------ project */

  load(p: Project, path: string | null) {
    this.project = p
    this.path = path
    this.dirty = false
    this.undo = []
    this.redo = []
    this.time = 0
    this.playing = false
    this.ui = { ...this.ui, screen: 'editor', selection: [], selClip: null, selKeys: [], camView: false, edit: null }
    this.emit()
    this.emitTime()
  }

  obj(id: string | null | undefined): SceneObject | undefined {
    return id ? this.project.objects.find((o) => o.id === id) : undefined
  }
  clip(id: string | null | undefined): Clip | undefined {
    return id ? this.project.clips.find((c) => c.id === id) : undefined
  }
  get selected(): SceneObject | undefined { return this.obj(this.ui.selection[this.ui.selection.length - 1]) }

  select(ids: string[], additive = false) {
    // picking another object leaves mesh edit mode, as in Blender
    if (this.ui.edit && !(ids.length === 1 && ids[0] === this.ui.edit.id)) this.ui = { ...this.ui, edit: null }
    let sel = ids
    if (additive) {
      const cur = new Set(this.ui.selection)
      for (const id of ids) { if (cur.has(id)) cur.delete(id); else cur.add(id) }
      sel = [...cur]
    }
    this.setUi({ selection: sel, selClip: null, rightTab: sel.length ? 'object' : this.ui.rightTab })
  }
  selectClip(id: string | null) { this.setUi({ selClip: id, selKeys: [] }) }

  /* ------------------------------------------------------------ time */

  setTime(t: number, snap = true) {
    const { fps, duration } = this.project.settings
    const v = clamp(snap ? snapFrame(t, fps) : t, 0, duration)
    if (v === this.time) return
    this.time = v
    this.emitTime()
  }
  setPlaying(on: boolean) {
    if (on && this.time >= this.project.settings.duration - 1e-3) this.setTime(0)
    this.playing = on
    this.emitTime()
    this.emit()
  }

  /* ------------------------------------------------------------ objects */

  add(o: SceneObject, select = true) {
    // new things land where the camera-free viewport expects them: named uniquely
    const names = new Set(this.project.objects.map((x) => x.name))
    if (names.has(o.name)) {
      let i = 2
      while (names.has(`${o.name} ${i}`)) i++
      o.name = `${o.name} ${i}`
    }
    this.mutate((p) => { p.objects.push(o) })
    if (o.kind === 'camera' && !this.project.clips.some((c) => c.kind === 'shot')) {
      this.mutate((p) => { p.clips.push(makeShot(o.id, 0, p.settings.duration)) })
    }
    if (select) this.select([o.id])
  }

  descendants(id: string): string[] {
    const out: string[] = []
    const walk = (pid: string) => {
      for (const o of this.project.objects) if (o.parentId === pid) { out.push(o.id); walk(o.id) }
    }
    walk(id)
    return out
  }

  deleteSelection() {
    if (this.ui.selKeys.length) { this.deleteKeys(this.ui.selKeys); return }
    if (this.ui.selClip) { this.deleteClip(this.ui.selClip); return }
    const ids = new Set(this.ui.selection)
    if (!ids.size) return
    for (const id of [...ids]) for (const d of this.descendants(id)) ids.add(d)
    this.mutate((p) => {
      p.objects = p.objects.filter((o) => !ids.has(o.id))
      p.clips = p.clips.filter((c) => !(c.kind === 'shot' && ids.has(c.cameraId)))
      for (const o of p.objects) if (o.camera?.target && ids.has(o.camera.target)) o.camera.target = null
    })
    this.setUi({ selection: [] })
  }

  duplicateSelection() {
    const sel = this.ui.selection.map((id) => this.obj(id)).filter(Boolean) as SceneObject[]
    if (!sel.length) return
    const map = new Map<string, string>()
    const copies: SceneObject[] = []
    const copyTree = (o: SceneObject, parent: string | null) => {
      const c = deepClone(o)
      c.id = uid('o')
      map.set(o.id, c.id)
      c.parentId = parent
      copies.push(c)
      for (const ch of this.project.objects.filter((x) => x.parentId === o.id)) copyTree(ch, c.id)
    }
    for (const o of sel) copyTree(o, o.parentId)
    const names = new Set(this.project.objects.map((x) => x.name))
    for (const c of copies) {
      let i = 2
      const stem = c.name.replace(/ \d+$/, '')
      while (names.has(`${stem} ${i}`)) i++
      c.name = `${stem} ${i}`
      names.add(c.name)
    }
    this.mutate((p) => { p.objects.push(...copies) })
    this.select(sel.map((o) => map.get(o.id)!))
  }

  rename(id: string, name: string) {
    this.mutate((p) => { const o = p.objects.find((x) => x.id === id); if (o) o.name = name })
  }

  patch(id: string, fn: (o: SceneObject) => void, coalesce?: string) {
    this.mutate((p) => { const o = p.objects.find((x) => x.id === id); if (o) fn(o) }, coalesce)
  }

  setParent(id: string, parentId: string | null) {
    if (parentId && (parentId === id || this.descendants(id).includes(parentId))) return
    this.patch(id, (o) => { o.parentId = parentId })
  }

  /** Move an object in the outliner list (for draw order and tidiness). */
  reorder(id: string, beforeId: string | null) {
    this.mutate((p) => {
      const i = p.objects.findIndex((o) => o.id === id)
      if (i < 0) return
      const [o] = p.objects.splice(i, 1)
      const j = beforeId ? p.objects.findIndex((x) => x.id === beforeId) : -1
      if (j < 0) p.objects.push(o); else p.objects.splice(j, 0, o)
    })
  }

  /* ------------------------------------------------------------ edit mode */

  setEditSel(sel: number[]) {
    if (!this.ui.edit) return
    this.setUi({ edit: { ...this.ui.edit, sel: [...new Set(sel)].sort((a, b) => a - b) } })
  }

  /** change the edited mesh; return a replacement mesh or mutate the given one in place */
  editMesh(fn: (m: EditMesh) => EditMesh | void, coalesce?: string) {
    const id = this.ui.edit?.id
    if (!id) return
    this.patch(id, (o) => {
      if (!o.edit) return
      const r = fn(o.edit)
      if (r) o.edit = r
      o.edit.v++
    }, coalesce)
  }

  /* ------------------------------------------------------------ keyframes */

  /**
   * Change an animatable value. With keys already on the property (or record
   * mode on) the change becomes a key at the playhead; otherwise it simply
   * changes the value — the way a first-time user expects a slider to behave.
   */
  setProp(id: string, key: string, v: number, coalesce?: string) {
    const def = PROP_MAP[key]
    if (!def) return
    this.patch(id, (o) => {
      if (this.ui.autoKey || (o.anim[key]?.length ?? 0) > 0) o.anim[key] = setKey(o.anim[key], this.time, v)
      else def.set(o, v)
    }, coalesce ?? `${id}:${key}`)
  }

  /** gizmo/modal edits write whole vectors; only the parts that moved become keys */
  setVec(id: string, field: 'pos' | 'rot' | 'scale', v: Vec3) {
    const o = this.obj(id)
    if (!o) return
    const t = this.time
    this.patch(id, (x) => {
      for (let i = 0; i < 3; i++) {
        const key = `${field}.${'xyz'[i]}`
        const cur = valueAt(x, key, t)
        if (Math.abs(cur - v[i]) < 1e-7) continue
        if (this.ui.autoKey || (x.anim[key]?.length ?? 0) > 0) x.anim[key] = setKey(x.anim[key], t, v[i])
        else (x[field] as Vec3)[i] = v[i]
      }
    }, `${id}:${field}`)
  }

  toggleKey(id: string, keys: string[]) {
    const o = this.obj(id)
    if (!o) return
    const t = this.time
    const has = keys.every((k) => o.anim[k]?.some((kf) => Math.abs(kf.t - t) <= KEY_EPS))
    this.patch(id, (x) => {
      for (const k of keys) {
        if (has) {
          x.anim[k] = (x.anim[k] ?? []).filter((kf) => Math.abs(kf.t - t) > KEY_EPS)
          if (!x.anim[k].length) {
            // the property keeps whatever value the last key gave it
            PROP_MAP[k]?.set(x, valueAt(o, k, t))
            delete x.anim[k]
          }
        } else {
          x.anim[k] = setKey(x.anim[k], t, valueAt(x, k, t))
        }
      }
    })
  }

  /** Insert keys on the whole transform of every selected object (the I key). */
  keySelection() {
    const t = this.time
    const ids = this.ui.selection
    if (!ids.length) return
    this.mutate((p) => {
      for (const o of p.objects) {
        if (!ids.includes(o.id)) continue
        for (const f of ['pos', 'rot', 'scale'] as const) {
          for (let i = 0; i < 3; i++) {
            const k = `${f}.${'xyz'[i]}`
            o.anim[k] = setKey(o.anim[k], t, valueAt(o, k, t))
          }
        }
      }
    })
    this.toast('키프레임을 넣었어요')
  }

  clearAnim(id: string) {
    const o = this.obj(id)
    if (!o) return
    const t = this.time
    this.patch(id, (x) => {
      for (const k of Object.keys(x.anim)) { PROP_MAP[k]?.set(x, valueAt(o, k, t)); delete x.anim[k] }
    })
  }

  moveKeys(sel: KeySel[], dt: number) {
    const fps = this.project.settings.fps
    this.mutate((p) => {
      for (const s of sel) {
        const o = p.objects.find((x) => x.id === s.obj)
        const k = o?.anim[s.key]?.find((kf) => Math.abs(kf.t - s.t) <= KEY_EPS)
        if (k) k.t = Math.max(0, snapFrame(s.t + dt, fps))
      }
      for (const o of p.objects) for (const k of Object.keys(o.anim)) {
        // two keys landing on one frame: the moved one wins
        const seen = new Map<number, Keyframe>()
        for (const kf of o.anim[k]) seen.set(Math.round(kf.t * 1000), kf)
        o.anim[k] = [...seen.values()].sort((a, b) => a.t - b.t)
      }
    })
  }

  setKeysEase(sel: KeySel[], e: EasingKind) {
    this.mutate((p) => {
      for (const s of sel) {
        const k = p.objects.find((x) => x.id === s.obj)?.anim[s.key]?.find((kf) => Math.abs(kf.t - s.t) <= KEY_EPS)
        if (k) k.e = e
      }
    })
  }

  deleteKeys(sel: KeySel[]) {
    const t = this.time
    this.mutate((p) => {
      for (const s of sel) {
        const o = p.objects.find((x) => x.id === s.obj)
        if (!o?.anim[s.key]) continue
        const before = evalKeys(o.anim[s.key], t, 0)
        o.anim[s.key] = o.anim[s.key].filter((kf) => Math.abs(kf.t - s.t) > KEY_EPS)
        if (!o.anim[s.key].length) { PROP_MAP[s.key]?.set(o, before); delete o.anim[s.key] }
      }
    })
    this.setUi({ selKeys: [] })
  }

  /* ------------------------------------------------------------ clips */

  addClip(c: Clip) {
    this.mutate((p) => { p.clips.push(c); p.settings.duration = Math.max(p.settings.duration, c.start + c.dur) })
    this.setUi({ selClip: c.id, selKeys: [] })
  }

  patchClip(id: string, fn: (c: Clip) => void, coalesce?: string) {
    this.mutate((p) => { const c = p.clips.find((x) => x.id === id); if (c) fn(c) }, coalesce)
  }

  deleteClip(id: string) {
    this.mutate((p) => { p.clips = p.clips.filter((c) => c.id !== id) })
    this.setUi({ selClip: null })
  }

  /** cut the selected clip (or every clip under the playhead) in two */
  split() {
    const t = this.time
    const targets = this.project.clips.filter((c) =>
      (this.ui.selClip ? c.id === this.ui.selClip : true) && t > c.start + 1e-3 && t < c.start + c.dur - 1e-3)
    if (!targets.length) return
    this.mutate((p) => {
      for (const c of targets) {
        const orig = p.clips.find((x) => x.id === c.id)!
        const right = deepClone(orig)
        right.id = uid('c')
        const cut = t - orig.start
        orig.dur = cut
        right.start = t
        right.dur -= cut
        if (right.kind === 'audio') right.offset += cut
        if (right.kind === 'shot') right.trans = 'cut'
        p.clips.push(right)
      }
    })
  }
}

export const store = new Store()
;(window as any).__odit3d = store

export function useStore(): number {
  return useSyncExternalStore(store.subscribe, () => store.version)
}
export function useTime(): number {
  return useSyncExternalStore(store.subscribeTime, () => store.time)
}
export function usePlaying(): boolean {
  return useSyncExternalStore(store.subscribeTime, () => store.playing)
}

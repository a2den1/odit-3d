import * as THREE from 'three'
import { store } from '../core/store'
import {
  makeAudio, makeCamera, makeEmpty, makeFx, makeLight, makeMesh, makeModel, makeShot, makeTitle,
  MATERIAL_PRESETS, newProject, TITLE_PRESETS,
} from '../core/defaults'
import type { FxKind, LightKind, PrimKind, Project, SceneObject, Vec3 } from '../core/types'
import { setKey, valueAt } from '../core/anim'
import type { EasingKind } from '../core/easing'
import { basename, stripExt } from '../core/util'
import { viewportApi } from './vpApi'
import { decodeFile } from '../engine/audio'
import { FrameRenderer } from '../engine/exporter'
import { ask } from './widgets'
import { buildGeometry } from '../engine/geometry'
import { fromGeometry, extrude, merge, remove as removeMesh, subdivide } from '../engine/editmesh'
import type { EditSelMode } from '../core/store'
import { getPrefs } from '../core/settings'
import { projectFromBlend } from '../engine/blendImport'

const R2D = 180 / Math.PI

/* ------------------------------------------------------------------ add */

export function addPrim(kind: PrimKind) { store.add(makeMesh(kind)) }
export function addLight(kind: LightKind) { store.add(makeLight(kind)) }
export function addEmpty() { store.add(makeEmpty([0, 0.5, 0])) }

/** A new camera starts where you are looking from, so framing a shot is just "look, then add". */
export function addCameraFromView() {
  const eng = viewportApi.engine
  const c = makeCamera()
  if (eng && !store.ui.camView) {
    const cam = eng.editorCam
    c.pos = cam.position.toArray().map((v) => +v.toFixed(3)) as Vec3
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'XYZ')
    c.rot = [e.x * R2D, e.y * R2D, e.z * R2D].map((v) => +v.toFixed(2)) as Vec3
  }
  const hadShots = store.project.clips.some((x) => x.kind === 'shot')
  store.add(c)
  if (hadShots) store.toast('카메라를 넣었어요 — 타임라인에 샷으로 올리면 그 구간에 쓰여요')
}

export async function importModels(paths?: string[]) {
  const list = paths ?? await window.odit.dialog.open('model')
  for (const p of list) store.add(makeModel(p, stripExt(p)))
}

export async function importAudio(paths?: string[]) {
  const list = paths ?? await window.odit.dialog.open('audio')
  for (const p of list) {
    try {
      const buf = await decodeFile(p)
      store.addClip(makeAudio(p, basename(p), store.time, +buf.duration.toFixed(3)))
    } catch {
      store.toast('이 오디오 파일은 열 수 없어요')
    }
  }
}

export function addTitle(presetId?: string) {
  store.addClip(makeTitle(store.time, TITLE_PRESETS.find((p) => p.id === presetId)))
}

export function addFx(fx: FxKind) { store.addClip(makeFx(fx, store.time)) }

export function addShot(cameraId?: string) {
  const cam = cameraId ?? store.project.objects.find((o) => o.id === store.ui.selection[0] && o.kind === 'camera')?.id
    ?? store.project.objects.find((o) => o.kind === 'camera')?.id
  if (!cam) { store.toast('먼저 카메라를 추가해 주세요'); return }
  const t = store.time
  const shots = store.project.clips.filter((c) => c.kind === 'shot')
  const covering = shots.find((c) => t > c.start + 1e-3 && t < c.start + c.dur - 1e-3)
  if (covering) {
    // dropping a shot in the middle of another one cuts to it right here
    store.selectClip(covering.id)
    store.split()
    const right = store.project.clips.find((c) => c.kind === 'shot' && Math.abs(c.start - t) < 1e-3)
    if (right && right.kind === 'shot') store.patchClip(right.id, (c) => { if (c.kind === 'shot') c.cameraId = cam })
    if (right) store.selectClip(right.id)
    return
  }
  const next = shots.filter((c) => c.start > t).sort((a, b) => a.start - b.start)[0]
  const end = next ? next.start : store.project.settings.duration
  store.addClip(makeShot(cam, t, Math.max(0.5, end - t)))
}

/* ------------------------------------------------------------------ materials */

export function applyMaterial(id: string) {
  const pre = MATERIAL_PRESETS.find((m) => m.id === id)
  const targets = store.ui.selection.map((x) => store.obj(x)).filter((o): o is SceneObject => !!o?.mat)
  if (!pre) return
  if (!targets.length) { store.toast('모양을 먼저 선택해 주세요'); return }
  store.mutate((p) => {
    for (const o of p.objects) {
      if (!targets.some((x) => x.id === o.id) || !o.mat) continue
      o.mat = { ...o.mat, emissive: '#000000', emissiveIntensity: 0, transmission: 0, wireframe: false, flat: false, metalness: 0, ...pre.m }
    }
  })
}

/* ------------------------------------------------------------------ motions */

type K = [number, number, EasingKind?]

/** Write a run of keys on one property, starting at the playhead. */
function keys(o: SceneObject, prop: string, list: K[]) {
  let arr = o.anim[prop]
  for (const [dt, v, e] of list) arr = setKey(arr, +(store.time + dt).toFixed(4), v, e ?? 'smooth')
  // the keys a preset writes should keep the preset's easing even over older keys
  for (const [dt, , e] of list) {
    const k = arr.find((x) => Math.abs(x.t - (store.time + dt)) < 1e-3)
    if (k) k.e = e ?? 'smooth'
  }
  o.anim[prop] = arr
}

export function applyMotion(id: string) {
  const ids = store.ui.selection
  if (!ids.length) { store.toast('움직일 오브젝트를 먼저 선택해 주세요'); return }
  const t = store.time
  store.mutate((p) => {
    for (const o of p.objects) {
      if (!ids.includes(o.id)) continue
      const v = (k: string) => valueAt(o, k, t)
      const [x, y, z] = [v('pos.x'), v('pos.y'), v('pos.z')]
      const [rx, ry, rz] = [v('rot.x'), v('rot.y'), v('rot.z')]
      const s = [v('scale.x'), v('scale.y'), v('scale.z')]
      const sc = (list: [number, number, EasingKind?][]) => {
        ;['x', 'y', 'z'].forEach((a, i) => keys(o, `scale.${a}`, list.map(([dt, f, e]) => [dt, s[i] * f, e])))
      }
      switch (id) {
        case 'spin': keys(o, 'rot.y', [[0, ry, 'linear'], [2, ry + 360, 'linear']]); break
        case 'bounce': keys(o, 'pos.y', [[0, y, 'quadOut'], [0.35, y + 1.2, 'quadIn'], [0.7, y, 'quadOut'], [0.95, y + 0.5, 'quadIn'], [1.2, y, 'linear']]); break
        case 'float': keys(o, 'pos.y', [[0, y, 'sineInOut'], [1, y + 0.3, 'sineInOut'], [2, y, 'sineInOut'], [3, y + 0.3, 'sineInOut'], [4, y, 'sineInOut']]); break
        case 'popIn': sc([[0, 0, 'backOut'], [0.5, 1]]); break
        case 'popOut': sc([[0, 1, 'backIn'], [0.45, 0]]); break
        case 'dropIn': keys(o, 'pos.y', [[0, y + 4, 'bounceOut'], [1, y]]); break
        case 'wobble': keys(o, 'rot.z', [[0, rz], [0.2, rz + 14], [0.4, rz - 11], [0.6, rz + 7], [0.8, rz - 3], [1, rz]]); break
        case 'pulse': sc([[0, 1], [0.3, 1.15], [0.6, 1], [0.9, 1.15], [1.2, 1]]); break
        case 'flip': keys(o, 'rot.x', [[0, rx, 'cubicInOut'], [1, rx + 360]]); break
        case 'orbit': {
          const r = Math.hypot(x, z) || 2
          const a0 = Math.atan2(z, x)
          const N = 24
          const px: K[] = [], pz: K[] = []
          for (let i = 0; i <= N; i++) {
            const a = a0 + (i / N) * Math.PI * 2
            px.push([(i / N) * 4, +(Math.cos(a) * r).toFixed(4), 'linear'])
            pz.push([(i / N) * 4, +(Math.sin(a) * r).toFixed(4), 'linear'])
          }
          keys(o, 'pos.x', px); keys(o, 'pos.z', pz)
          break
        }
        case 'fadeIn': if (o.mat) keys(o, 'mat.opacity', [[0, 0], [0.6, 1]]); break
        case 'fadeOut': if (o.mat) keys(o, 'mat.opacity', [[0, o.mat ? v('mat.opacity') : 1], [0.6, 0]]); break
      }
    }
  })
}

/* ------------------------------------------------------------------ files */

async function thumbnail(p: Project): Promise<string | null> {
  const fr = new FrameRenderer(384, Math.round(384 * p.settings.height / p.settings.width))
  try {
    await fr.prepare(p)
    fr.draw(p, Math.min(p.settings.duration * 0.35, 2))
    return fr.out.toDataURL('image/jpeg', 0.78)
  } catch { return null } finally { fr.dispose() }
}

export async function save(as = false): Promise<boolean> {
  let path = store.path
  if (!path || as) {
    if (as) {
      path = await window.odit.dialog.save(store.project.name, 'odit3d')
      if (!path) return false
    } else {
      const info = await window.odit.app.info()
      const safe = store.project.name.replace(/[\\/:*?"<>|]/g, '_').trim() || '새 프로젝트'
      let i = 1
      path = `${info.projects}\\${safe}.odit3d`
      while (await window.odit.fs.exists(path)) path = `${info.projects}\\${safe} ${++i}.odit3d`
    }
  }
  const thumb = await thumbnail(store.project)
  const data: Project = { ...store.project, thumb }
  await window.odit.fs.writeText(path, JSON.stringify(data))
  store.path = path
  store.dirty = false
  store.emit()
  return true
}

export async function openProject(path?: string) {
  const p = path ?? (await window.odit.dialog.open('project'))[0]
  if (!p) return
  if (!(await leaveCurrent())) return
  try {
    const j = JSON.parse(await window.odit.fs.readText(p)) as Project
    if (!j.objects || !j.settings) throw new Error('형식이 맞지 않아요')
    delete j.thumb
    store.load(j, p)
  } catch (e) {
    store.toast('프로젝트를 열 수 없어요')
  }
}

export async function startNew() {
  if (!(await leaveCurrent())) return
  let n = 1
  const names = new Set((await window.odit.projects.list()).map((c) => c.name))
  let name = '새 프로젝트'
  while (names.has(name)) name = `새 프로젝트 ${++n}`
  store.load(newProject(name), null)
}

/** Ask about unsaved work before it is replaced. False = stay. */
export async function leaveCurrent(): Promise<boolean> {
  if (store.ui.screen !== 'editor' || !store.dirty) return true
  const r = await ask('저장하지 않은 변경이 있어요', { ok: '저장', cancel: '취소', extra: '저장 안 함' })
  if (r === 'cancel') return false
  if (r === 'ok') return save()
  return true
}

export async function goHome() {
  if (!(await leaveCurrent())) return
  store.setPlaying(false)
  store.setUi({ screen: 'home' })
}

/* ------------------------------------------------------------------ edit mode */

/** Tab: into mesh edit mode (turning a shape into an editable mesh the first time), or back out. */
export function toggleEdit() {
  if (store.ui.edit) { store.setUi({ edit: null }); return }
  const o = store.selected
  if (!o || o.kind !== 'mesh') {
    store.toast(o ? '모양만 편집할 수 있어요' : '편집할 모양을 먼저 선택해 주세요')
    return
  }
  if (!o.edit) {
    const g = buildGeometry(o)
    const m = fromGeometry(g)
    g.dispose()
    if (!m.idx.length) { store.toast('이 모양은 아직 준비 중이에요'); return }
    store.patch(o.id, (x) => { x.edit = m; delete x.prim })
  }
  store.setPlaying(false)
  store.setUi({ edit: { id: o.id, mode: lastEditMode, sel: [] }, selection: [o.id], camView: false })
}
let lastEditMode: EditSelMode = 'vert'

export function setEditMode(mode: EditSelMode) {
  const e = store.ui.edit
  if (!e) return
  lastEditMode = mode
  store.setUi({ edit: { ...e, mode } })
}

const editObj = () => store.ui.edit ? store.obj(store.ui.edit.id) : undefined

export function editSelectAll(all = true) {
  const o = editObj()
  if (!o?.edit) return
  store.setEditSel(all ? Array.from({ length: o.edit.pos.length / 3 }, (_, i) => i) : [])
}

export function editDelete() {
  const e = store.ui.edit
  if (!e?.sel.length) return
  const sel = new Set(e.sel)
  store.editMesh((m) => removeMesh(m, sel, e.mode))
  store.setEditSel([])
}

export function editExtrude(): THREE.Vector3 | null {
  const e = store.ui.edit
  const o = editObj()
  if (!e || !o?.edit) return null
  const r = extrude(o.edit, new Set(e.sel))
  if (!r) { store.toast('돌출할 면을 선택해 주세요'); return null }
  store.editMesh(() => r.mesh)
  store.setEditSel(r.sel)
  return r.normal
}

export function editMerge() {
  const e = store.ui.edit
  const o = editObj()
  if (!e || !o?.edit) return
  const r = merge(o.edit, new Set(e.sel))
  if (!r) { store.toast('합칠 정점을 두 개 이상 선택해 주세요'); return }
  store.editMesh(() => r.mesh)
  store.setEditSel(r.sel)
}

export function editSubdivide() {
  const e = store.ui.edit
  const o = editObj()
  if (!e || !o?.edit) return
  const r = subdivide(o.edit, new Set(e.sel))
  if (!r) { store.toast('나눌 면을 선택해 주세요'); return }
  store.editMesh(() => r.mesh)
  store.setEditSel(r.sel)
}

/* ------------------------------------------------------------------ blender */

/** Start a new project from a .blend: Blender writes it out, and the scene comes in object by object. */
export async function startFromBlend(file?: string) {
  const f = file ?? (await window.odit.dialog.open('blend'))[0]
  if (!f) return
  if (!(await leaveCurrent())) return
  store.setUi({ blend: { phase: 'working', file: f } })
  const r = await window.odit.blender.convert(f, getPrefs().blenderPath || undefined)
  if (!r.ok) {
    store.setUi({ blend: r.error === 'no-blender' ? { phase: 'noblender', file: f } : { phase: 'error', file: f, error: r.error } })
    return
  }
  try {
    const p = await projectFromBlend(r.glb, r.info, stripExt(f))
    store.load(p, null)
    store.setUi({ blend: null })
    const models = p.objects.filter((o) => o.kind === 'model').length
    store.toast(`블렌더 장면을 가져왔어요 · 오브젝트 ${models}개`)
  } catch (e: any) {
    store.setUi({ blend: { phase: 'error', file: f, error: String(e?.message ?? e) } })
  }
}

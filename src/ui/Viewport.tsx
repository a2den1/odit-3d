import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { store, useStore, useTime, usePlaying, type GizmoMode } from '../core/store'
import { vecAt } from '../core/anim'
import { SceneEngine } from '../engine/engine'
import { drawTitles, fxAt } from '../engine/timeline'
import { AudioPlayer } from '../engine/audio'
import { timecode } from '../core/util'
import type { Vec3 } from '../core/types'
import { Seg } from './widgets'
import { editDelete, editExtrude, editMerge, editSubdivide, setEditMode, toggleEdit } from './actions'
import { faceGroups, nearestTri, vcount, vget } from '../engine/editmesh'
import { openAddMenu } from './addMenu'
import { viewportApi } from './vpApi'

const R2D = 180 / Math.PI
const D2R = Math.PI / 180

interface Modal {
  mode: GizmoMode
  axis: 'x' | 'y' | 'z' | 'n' | null
  /** a custom world direction for axis 'n' (extrude pulls along the face normal) */
  dir?: THREE.Vector3
  /** edit mode: the vertices being moved with their world start positions, and the mesh's inverse world matrix */
  verts?: { i: number; world: THREE.Vector3 }[]
  inv?: THREE.Matrix4
  pivot?: THREE.Vector3
  x0: number
  y0: number
  starts: { id: string; pos: Vec3; rot: Vec3; scale: Vec3; world: THREE.Vector3; parentInv: THREE.Matrix4 }[]
  center: THREE.Vector2
  x: number
  y: number
}

export default function Viewport() {
  useStore()
  const time = useTime()
  const playing = usePlaying()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const axisRef = useRef<SVGSVGElement>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const modalRef = useRef<Modal | null>(null)
  modalRef.current = modal
  viewportApi.modal = !!modal
  const { ui, project } = store
  const camView = ui.camView

  useEffect(() => {
    const cv = canvas.current!
    const engine = new SceneEngine(cv, { pixelRatio: Math.min(devicePixelRatio, 2) })
    viewportApi.engine = engine
    const controls = new OrbitControls(engine.editorCam, cv)
    controls.target.set(0, 0.5, 0)
    controls.enableDamping = false
    controls.zoomSpeed = 1.2
    controls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }
    controls.update()

    const tc = new TransformControls(engine.editorCam, cv)
    tc.setSize(0.85)
    engine.helperScene.add(tc.getHelper())
    let tcDragging = false
    /* in edit mode the gizmo drives a stand-in at the selection's centre, and
       whatever it does to the stand-in is done to the selected vertices */
    const pivot = new THREE.Object3D()
    let pivotStart = new THREE.Matrix4()
    let pivotBase: number[] = []
    tc.addEventListener('dragging-changed', (e: any) => {
      controls.enabled = !e.value
      tcDragging = e.value
      if (e.value) {
        store.beginGesture()
        pivot.updateMatrix()
        pivotStart = pivot.matrix.clone().invert()
        pivotBase = store.obj(store.ui.edit?.id)?.edit?.pos.slice() ?? []
      } else store.endGesture()
    })
    tc.addEventListener('objectChange', () => {
      const g = tc.object
      if (!g) return
      if (g === pivot) {
        const ed = store.ui.edit
        if (!ed) return
        pivot.updateMatrix()
        const M = pivot.matrix.clone().multiply(pivotStart)
        const v = new THREE.Vector3()
        store.editMesh((m) => {
          for (const i of ed.sel) {
            v.set(pivotBase[i * 3], pivotBase[i * 3 + 1], pivotBase[i * 3 + 2]).applyMatrix4(M)
            m.pos[i * 3] = +v.x.toFixed(5); m.pos[i * 3 + 1] = +v.y.toFixed(5); m.pos[i * 3 + 2] = +v.z.toFixed(5)
          }
        })
        return
      }
      const id = g.userData.objId as string
      if (tc.mode === 'translate') store.setVec(id, 'pos', g.position.toArray() as Vec3)
      else if (tc.mode === 'rotate') store.setVec(id, 'rot', [g.rotation.x * R2D, g.rotation.y * R2D, g.rotation.z * R2D])
      else store.setVec(id, 'scale', g.scale.toArray() as Vec3)
    })

    let needs = true
    const poke = () => { needs = true }
    const offA = store.subscribe(poke)
    const offB = store.subscribeTime(poke)
    controls.addEventListener('change', poke)
    engine.onAsync = poke

    /* ------------------------------------------------ sizing */
    const fit = () => {
      const r = wrap.current!.getBoundingClientRect()
      let w = r.width, h = r.height
      if (store.ui.camView) {
        const a = store.project.settings.width / store.project.settings.height
        const pad = 24
        const aw = r.width - pad * 2, ah = r.height - pad * 2
        if (aw / ah > a) { h = ah; w = ah * a } else { w = aw; h = aw / a }
      }
      w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h))
      cv.style.width = w + 'px'
      cv.style.height = h + 'px'
      engine.setSize(w, h)
      const ov = overlay.current!
      ov.style.width = w + 'px'
      ov.style.height = h + 'px'
      ov.width = Math.round(w * devicePixelRatio)
      ov.height = Math.round(h * devicePixelRatio)
      needs = true
    }
    const ro = new ResizeObserver(fit)
    ro.observe(wrap.current!)
    let lastCam = store.ui.camView
    let lastAspect = 0

    /* ------------------------------------------------ playback */
    const audio = new AudioPlayer()
    let wasPlaying = false
    let last = performance.now()

    /* ------------------------------------------------ loop */
    let raf = 0
    const q = new THREE.Quaternion()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const p = store.project
      const aspect = p.settings.width / p.settings.height
      if (store.ui.camView !== lastCam || aspect !== lastAspect) { lastCam = store.ui.camView; lastAspect = aspect; fit() }

      if (store.playing !== wasPlaying) {
        wasPlaying = store.playing
        if (wasPlaying) audio.start(p, store.time); else audio.stop()
      }
      if (store.playing) {
        let t = store.time + dt
        if (t >= p.settings.duration) {
          t = 0
          audio.start(p, 0)
        }
        store.setTime(t, false)
      }
      if (!needs && !store.playing) return
      needs = false

      const cam = store.ui.camView
      const t = store.time
      engine.sync(p, t)
      // the gizmo follows the one selected object — or, in edit mode, the selected vertices
      const ed = store.ui.edit
      const eo = ed ? store.obj(ed.id) : undefined
      const en = eo ? engine.nodes.get(eo.id) : undefined
      if (ed && eo?.edit && en && ed.sel.length && !cam && !modalRef.current) {
        if (pivot.parent !== en.group) en.group.add(pivot)
        if (!tcDragging) {
          const c = new THREE.Vector3()
          for (const i of ed.sel) c.add(vget(eo.edit, i))
          pivot.position.copy(c.multiplyScalar(1 / ed.sel.length))
          pivot.rotation.set(0, 0, 0)
          pivot.scale.set(1, 1, 1)
          pivot.updateMatrixWorld(true)
        }
        if (tc.object !== pivot) tc.attach(pivot)
        if (tc.mode !== store.ui.gizmo) tc.setMode(store.ui.gizmo)
      } else if (ed && !tcDragging) {
        if (tc.object) tc.detach()
        if (pivot.parent) pivot.removeFromParent()
      }
      if (!ed && pivot.parent) pivot.removeFromParent()
      const sel = ed ? undefined : store.selected
      const node = sel && !sel.locked && sel.visible && !cam ? engine.nodes.get(sel.id) : undefined
      if (ed) { /* the edit gizmo is handled above */ } else if (node && store.ui.selection.length === 1 && !modalRef.current) {
        if (tc.object !== node.group) tc.attach(node.group)
        if (tc.mode !== store.ui.gizmo) tc.setMode(store.ui.gizmo)
        tc.getHelper().visible = true
      } else if (tc.object && !tcDragging) {
        tc.detach()
      }
      controls.enabled = !cam && !tcDragging && !modalRef.current
      engine.render(p, t, {
        output: cam, shading: cam ? 'render' : store.ui.shading, overlays: !cam,
        selection: store.ui.selection, fx: cam ? fxAt(p, t) : null,
        edit: cam ? null : store.ui.edit,
      })
      const ov = overlay.current!
      const ctx = ov.getContext('2d')!
      ctx.clearRect(0, 0, ov.width, ov.height)
      if (cam) drawTitles(ctx, p, t, ov.width, ov.height)

      // axis widget
      const svg = axisRef.current
      if (svg) {
        q.copy(engine.editorCam.quaternion).invert()
        for (const el of Array.from(svg.querySelectorAll<SVGGElement>('[data-axis]'))) {
          const a = el.dataset.axis!
          const v = new THREE.Vector3(a[1] === 'x' ? 1 : 0, a[1] === 'y' ? 1 : 0, a[1] === 'z' ? 1 : 0)
          if (a[0] === '-') v.negate()
          v.applyQuaternion(q)
          el.setAttribute('transform', `translate(${40 + v.x * 28} ${40 - v.y * 28})`)
          el.style.opacity = String(v.z < -0.1 ? 0.55 : 1)
          ;(el as any).__z = v.z
        }
        const parent = svg.querySelector('g.axes')!
        const items = Array.from(parent.children) as any[]
        items.sort((a, b) => (a.__z ?? 0) - (b.__z ?? 0)).forEach((el) => parent.appendChild(el))
      }
    }
    raf = requestAnimationFrame(loop)

    /* ------------------------------------------------ picking */
    let downAt: { x: number; y: number; b: number } | null = null
    let boxing = false

    /** screen position (client px) of vertices, plus their world position */
    const project = (ids?: number[]) => {
      const ed = store.ui.edit!
      const o = store.obj(ed.id)!
      const n = engine.nodes.get(ed.id)!
      const r = cv.getBoundingClientRect()
      const M = n.group.matrixWorld
      const cam = engine.editorCam
      const list = ids ?? Array.from({ length: vcount(o.edit!) }, (_, i) => i)
      return list.map((i) => {
        const w = vget(o.edit!, i).applyMatrix4(M)
        const sp = w.clone().project(cam)
        return { i, w, x: r.left + (sp.x + 1) / 2 * r.width, y: r.top + (1 - sp.y) / 2 * r.height, front: sp.z < 1 }
      })
    }
    /** true when the edited surface itself hides this point from the camera */
    const occluded = (w: THREE.Vector3) => {
      const n = engine.nodes.get(store.ui.edit!.id)!
      if (!n.mesh || store.ui.shading === 'wire') return false
      const from = engine.editorCam.position
      const dir = w.clone().sub(from)
      const d = dir.length()
      const ray = new THREE.Raycaster(from.clone(), dir.normalize(), 0, d * 0.995 - 1e-3)
      return ray.intersectObject(n.mesh, false).length > 0
    }
    const editClick = (e: PointerEvent) => {
      const ed = store.ui.edit!
      const o = store.obj(ed.id)!
      const add = e.shiftKey || e.ctrlKey
      let hit: number[] = []
      if (ed.mode === 'vert') {
        const cands = project().filter((v) => v.front && Math.hypot(v.x - e.clientX, v.y - e.clientY) < 14)
          .sort((a, b) => Math.hypot(a.x - e.clientX, a.y - e.clientY) - Math.hypot(b.x - e.clientX, b.y - e.clientY))
        const v = cands.find((c) => !occluded(c.w)) ?? cands[0]
        if (v) hit = [v.i]
      } else {
        const n = engine.nodes.get(ed.id)!
        const ray = new THREE.Raycaster()
        ray.setFromCamera(ndc(e), engine.editorCam)
        const h = n.mesh ? ray.intersectObject(n.mesh, false)[0] : undefined
        if (h) {
          // the drawn geometry is re-indexed, so find the stored triangle under the hit point
          const { of, groups } = faceGroups(o.edit!)
          const tri = nearestTri(o.edit!, h.point.clone().applyMatrix4(n.group.matrixWorld.clone().invert()))
          if (tri >= 0) {
            const set = new Set<number>()
            for (const t of groups[of[tri]]) for (let k = 0; k < 3; k++) set.add(o.edit!.idx[t * 3 + k])
            hit = [...set]
          }
        }
      }
      if (!add) { store.setEditSel(hit); return }
      const cur = new Set(ed.sel)
      const all = hit.length > 0 && hit.every((i) => cur.has(i))
      for (const i of hit) { if (all) cur.delete(i); else cur.add(i) }
      store.setEditSel([...cur])
    }
    const boxSelect = (x0: number, y0: number, x1: number, y1: number, add: boolean) => {
      const ed = store.ui.edit!
      const [l, rt, tp, bt] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]
      let inside = project().filter((v) => v.front && v.x >= l && v.x <= rt && v.y >= tp && v.y <= bt)
      if (inside.length <= 600) inside = inside.filter((v) => !occluded(v.w))
      const ids = inside.map((v) => v.i)
      store.setEditSel(add ? [...ed.sel, ...ids] : ids)
    }
    const boxEl = document.createElement('div')
    boxEl.className = 'vp-box'
    wrap.current!.appendChild(boxEl)
    const ndc = (e: { clientX: number; clientY: number }) => {
      const r = cv.getBoundingClientRect()
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const onDown = (e: PointerEvent) => {
      if (e.button === 0 && e.altKey) {
        // Alt + left drag orbits, for mice without a usable middle button
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
      } else controls.mouseButtons.LEFT = null as any
      downAt = { x: e.clientX, y: e.clientY, b: e.button }
      boxing = false
      // left-drag on empty space in edit mode draws a selection box
      if (e.button === 0 && !e.altKey && store.ui.edit && !(tc as any).axis && !modalRef.current) {
        const x0 = e.clientX, y0 = e.clientY
        const wr = wrap.current!.getBoundingClientRect()
        const move = (ev: PointerEvent) => {
          if (!boxing && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
          boxing = true
          Object.assign(boxEl.style, {
            display: 'block', left: Math.min(x0, ev.clientX) - wr.left + 'px', top: Math.min(y0, ev.clientY) - wr.top + 'px',
            width: Math.abs(ev.clientX - x0) + 'px', height: Math.abs(ev.clientY - y0) + 'px',
          })
        }
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          boxEl.style.display = 'none'
          if (boxing) boxSelect(x0, y0, ev.clientX, ev.clientY, ev.shiftKey || ev.ctrlKey)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }
    }
    const onUp = (e: PointerEvent) => {
      const d = downAt
      downAt = null
      if (!d || d.b !== 0 || e.altKey || modalRef.current) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return
      if (tcDragging || (tc as any).axis) return
      if (store.ui.camView) return
      if (store.ui.edit) { if (!boxing) editClick(e); return }
      const id = engine.pick(ndc(e))
      if (id) {
        // clicking a child of a locked object still reaches the object
        store.select([id], e.shiftKey || e.ctrlKey)
      } else if (!e.shiftKey) store.select([])
    }
    const onDbl = () => { if (store.selected && !store.ui.edit) viewportApi.frameSelected?.() }
    cv.addEventListener('pointerdown', onDown, true)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('dblclick', onDbl)

    /* ------------------------------------------------ view helpers */
    viewportApi.frameSelected = () => {
      const ed = store.ui.edit
      if (ed && ed.sel.length > 0) {
        const box = new THREE.Box3()
        for (const v of project(ed.sel)) box.expandByPoint(v.w)
        box.expandByScalar(0.05)
        const c = box.getCenter(new THREE.Vector3())
        const r = Math.max(0.3, box.getSize(new THREE.Vector3()).length() / 2)
        const dir = engine.editorCam.position.clone().sub(controls.target).normalize()
        controls.target.copy(c)
        engine.editorCam.position.copy(c).addScaledVector(dir, r / Math.sin((engine.editorCam.fov * D2R) / 2) * 1.1)
        controls.update()
        needs = true
        return
      }
      const ids = store.ui.selection.length ? store.ui.selection : store.project.objects.filter((o) => o.kind !== 'light' && o.kind !== 'camera').map((o) => o.id)
      const box = new THREE.Box3()
      for (const id of ids) { const b = engine.boundsOf(id); if (b) box.union(b) }
      if (box.isEmpty()) return
      const c = box.getCenter(new THREE.Vector3())
      const r = box.getSize(new THREE.Vector3()).length() / 2
      const dir = engine.editorCam.position.clone().sub(controls.target).normalize()
      const dist = Math.max(0.8, r / Math.sin((engine.editorCam.fov * D2R) / 2)) * 1.05
      controls.target.copy(c)
      engine.editorCam.position.copy(c).addScaledVector(dir, dist)
      controls.update()
      needs = true
    }
    viewportApi.view = (dir) => {
      const d = engine.editorCam.position.distanceTo(controls.target)
      const v = {
        front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001],
      }[dir]
      engine.editorCam.position.copy(controls.target).add(new THREE.Vector3(...(v as Vec3)).multiplyScalar(d))
      controls.update()
      if (store.ui.camView) store.setUi({ camView: false })
      needs = true
    }

    /* ------------------------------------------------ modal transform */
    viewportApi.startModal = (mode, dir) => {
      if (store.ui.camView) return
      const ed = store.ui.edit
      if (ed) {
        if (!ed.sel.length) return
        const m = viewportApi.mouse ?? { x: 0, y: 0 }
        const n = engine.nodes.get(ed.id)!
        const verts = project(ed.sel).map((v) => ({ i: v.i, world: v.w }))
        const pivotW = verts.reduce((a, v) => a.add(v.world), new THREE.Vector3()).multiplyScalar(1 / verts.length)
        const r = cv.getBoundingClientRect()
        const sp = pivotW.clone().project(engine.editorCam)
        const center = new THREE.Vector2(r.left + (sp.x + 1) / 2 * r.width, r.top + (1 - sp.y) / 2 * r.height)
        store.beginGesture()
        tc.detach()
        const worldDir = dir ? dir.clone().transformDirection(n.group.matrixWorld) : undefined
        const next: Modal = {
          mode, axis: worldDir ? 'n' : null, dir: worldDir, x0: m.x, y0: m.y, x: m.x, y: m.y, starts: [], center,
          verts, inv: n.group.matrixWorld.clone().invert(), pivot: pivotW,
        }
        modalRef.current = next
        setModal(next)
        return
      }
      const ids = store.ui.selection.filter((id) => !store.obj(id)?.locked)
      if (!ids.length) return
      const m = viewportApi.mouse ?? { x: 0, y: 0 }
      const t = store.time
      const starts = ids.map((id) => {
        const o = store.obj(id)!
        const n = engine.nodes.get(id)!
        const world = n.group.getWorldPosition(new THREE.Vector3())
        const parentInv = n.group.parent ? n.group.parent.matrixWorld.clone().invert() : new THREE.Matrix4()
        return { id, pos: vecAt(o, 'pos', t), rot: vecAt(o, 'rot', t), scale: vecAt(o, 'scale', t), world, parentInv }
      })
      const avg = starts.reduce((a, s) => a.add(s.world), new THREE.Vector3()).multiplyScalar(1 / starts.length)
      const r = cv.getBoundingClientRect()
      const sp = avg.clone().project(engine.editorCam)
      const center = new THREE.Vector2(r.left + (sp.x + 1) / 2 * r.width, r.top + (1 - sp.y) / 2 * r.height)
      store.beginGesture()
      tc.detach()
      setModal({ mode, axis: null, x0: m.x, y0: m.y, x: m.x, y: m.y, starts, center })
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      offA(); offB()
      audio.stop()
      cv.removeEventListener('pointerdown', onDown, true)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('dblclick', onDbl)
      tc.dispose()
      controls.dispose()
      engine.dispose()
      viewportApi.engine = undefined
    }
  }, [])

  /* the modal transform follows the mouse until it is confirmed or cancelled */
  useEffect(() => {
    if (!modal) return
    const engine = viewportApi.engine!
    const cam = engine.editorCam
    const apply = (m: Modal) => {
      const dx = m.x - m.x0, dy = m.y - m.y0
      const axisVec = m.axis === 'n' && m.dir ? m.dir.clone()
        : m.axis ? new THREE.Vector3(m.axis === 'x' ? 1 : 0, m.axis === 'y' ? 1 : 0, m.axis === 'z' ? 1 : 0) : null
      if (m.verts && m.inv && m.pivot) {
        const r = canvas.current!.getBoundingClientRect()
        const P = m.pivot
        let f: (w: THREE.Vector3) => THREE.Vector3
        if (m.mode === 'translate') {
          const dist = cam.position.distanceTo(P)
          const k = (2 * Math.tan((cam.fov * D2R) / 2) * dist) / r.height
          let delta = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(dx * k)
            .add(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).multiplyScalar(-dy * k))
          if (axisVec) {
            const a = P.clone().project(cam), b = P.clone().add(axisVec).project(cam)
            const sd = new THREE.Vector2((b.x - a.x) * r.width / 2, -(b.y - a.y) * r.height / 2)
            const len2 = sd.lengthSq()
            delta = axisVec.clone().multiplyScalar(len2 > 1e-6 ? (dx * sd.x + dy * sd.y) / len2 : 0)
          }
          f = (w) => w.clone().add(delta)
        } else if (m.mode === 'rotate') {
          const ang = -(Math.atan2(m.y - m.center.y, m.x - m.center.x) - Math.atan2(m.y0 - m.center.y, m.x0 - m.center.x))
          const ax = axisVec ?? new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate()
          const q = new THREE.Quaternion().setFromAxisAngle(ax.normalize(), axisVec ? -ang : ang)
          f = (w) => w.clone().sub(P).applyQuaternion(q).add(P)
        } else {
          const d0 = Math.max(4, Math.hypot(m.x0 - m.center.x, m.y0 - m.center.y))
          const s = Math.hypot(m.x - m.center.x, m.y - m.center.y) / d0
          const sv = axisVec ? new THREE.Vector3(1, 1, 1).add(axisVec.clone().normalize().multiplyScalar(s - 1)) : new THREE.Vector3(s, s, s)
          f = (w) => w.clone().sub(P).multiply(sv).add(P)
        }
        const inv = m.inv
        const verts = m.verts
        store.editMesh((mesh) => {
          for (const v of verts) {
            const l = f(v.world).applyMatrix4(inv)
            mesh.pos[v.i * 3] = +l.x.toFixed(5); mesh.pos[v.i * 3 + 1] = +l.y.toFixed(5); mesh.pos[v.i * 3 + 2] = +l.z.toFixed(5)
          }
        })
        return
      }
      for (const s of m.starts) {
        if (m.mode === 'translate') {
          const dist = cam.position.distanceTo(s.world)
          const r = canvas.current!.getBoundingClientRect()
          const k = (2 * Math.tan((cam.fov * D2R) / 2) * dist) / r.height
          const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
          const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
          let delta = right.multiplyScalar(dx * k).add(up.multiplyScalar(-dy * k))
          if (axisVec) {
            // slide along the axis by how far the mouse moved along its on-screen direction
            const a = s.world.clone().project(cam), b = s.world.clone().add(axisVec).project(cam)
            const sd = new THREE.Vector2((b.x - a.x) * r.width / 2, -(b.y - a.y) * r.height / 2)
            const len2 = sd.lengthSq()
            const amt = len2 > 1e-6 ? (dx * sd.x + dy * sd.y) / len2 : 0
            delta = axisVec.clone().multiplyScalar(amt)
          }
          const worldNew = s.world.clone().add(delta).applyMatrix4(s.parentInv)
          store.setVec(s.id, 'pos', worldNew.toArray() as Vec3)
        } else if (m.mode === 'rotate') {
          const a0 = Math.atan2(m.y0 - m.center.y, m.x0 - m.center.x)
          const a1 = Math.atan2(m.y - m.center.y, m.x - m.center.x)
          const ang = -(a1 - a0)
          const ax = axisVec ?? new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate()
          const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.rot[0] * D2R, s.rot[1] * D2R, s.rot[2] * D2R, 'XYZ'))
          const q = new THREE.Quaternion().setFromAxisAngle(ax.normalize(), axisVec ? -ang : ang).multiply(q0)
          const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
          store.setVec(s.id, 'rot', [e.x * R2D, e.y * R2D, e.z * R2D])
        } else {
          const d0 = Math.max(4, Math.hypot(m.x0 - m.center.x, m.y0 - m.center.y))
          const f = Math.hypot(m.x - m.center.x, m.y - m.center.y) / d0
          const sc = s.scale.map((v, i) => (!m.axis || 'xyz'[i] === m.axis ? v * f : v)) as Vec3
          store.setVec(s.id, 'scale', sc)
        }
      }
    }
    const move = (e: PointerEvent) => {
      const m = { ...modalRef.current!, x: e.clientX, y: e.clientY }
      modalRef.current = m
      setModal(m)
      apply(m)
    }
    const finish = (ok: boolean) => {
      if (ok) store.endGesture(); else store.cancelGesture()
      modalRef.current = null
      setModal(null)
      // wake the render loop so the gizmo comes back on the result
      store.emit()
    }
    const down = (e: PointerEvent) => {
      e.preventDefault(); e.stopImmediatePropagation()
      finish(e.button === 0)
    }
    const key = (e: KeyboardEvent) => {
      // the app's own shortcuts (X deletes!) must not see keys meant for the modal
      e.preventDefault(); e.stopImmediatePropagation()
      const k = e.key.toLowerCase()
      if (k === 'escape') return finish(false)
      if (k === 'enter' || k === ' ') return finish(true)
      if (k === 'x' || k === 'y' || k === 'z') {
        const m = { ...modalRef.current!, axis: modalRef.current!.axis === k ? null : k, dir: undefined } as Modal
        modalRef.current = m
        setModal(m)
        apply(m)
      }
      if (k === 'g' || k === 'r' || k === 's') {
        const mode = k === 'g' ? 'translate' : k === 'r' ? 'rotate' : 'scale'
        store.cancelGesture()
        store.beginGesture()
        const m = { ...modalRef.current!, mode } as Modal
        modalRef.current = m
        setModal(m)
        apply(m)
      }
    }
    const ctx = (e: MouseEvent) => e.preventDefault()
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('contextmenu', ctx, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('contextmenu', ctx, true)
    }
  }, [modal !== null])

  const track = (e: React.PointerEvent) => {
    viewportApi.mouse = { x: e.clientX, y: e.clientY, inside: true }
  }

  const s = project.settings
  const modeLabel = { translate: '이동', rotate: '회전', scale: '크기' }
  return (
    <div className="panel viewport-panel">
      <div className={'viewport' + (camView ? ' cam' : '')} ref={wrap}
        onPointerMove={track}
        onPointerLeave={() => { if (viewportApi.mouse) viewportApi.mouse.inside = false }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}>
        <div className="vp-stage">
          <canvas ref={canvas} className="vp-canvas" />
          <canvas ref={overlay} className="vp-overlay" />
        </div>

        <div className="vp-tools">
          {!camView && (
            <div className="vp-group">
              <button className={'vp-btn' + (ui.edit ? ' on' : '')} title="편집 모드 (Tab)" onClick={toggleEdit}>
                <i className="fa-solid fa-draw-polygon" />
              </button>
            </div>
          )}
          <div className="vp-group">
            {(['translate', 'rotate', 'scale'] as GizmoMode[]).map((m) => (
              <button key={m} className={'vp-btn' + (ui.gizmo === m ? ' on' : '')} title={`${modeLabel[m]} (${m === 'translate' ? 'G' : m === 'rotate' ? 'R' : 'S'})`}
                onClick={() => store.setUi({ gizmo: m })}>
                <i className={'fa-solid ' + (m === 'translate' ? 'fa-up-down-left-right' : m === 'rotate' ? 'fa-rotate' : 'fa-up-right-and-down-left-from-center')} />
              </button>
            ))}
          </div>
          <div className="vp-group">
            <button className="vp-btn" title="추가 (Shift A)" onClick={(e) => openAddMenu(e.clientX, e.clientY + 14)}>
              <i className="fa-solid fa-plus" />
            </button>
          </div>
        </div>

        <div className="vp-tools right">
          <Seg value={ui.shading} onChange={(v) => store.setUi({ shading: v })} options={[
            { v: 'wire', icon: 'fa-draw-polygon', title: '와이어' },
            { v: 'solid', icon: 'fa-circle', title: '단색' },
            { v: 'render', icon: 'fa-sun', title: '렌더' },
          ]} />
        </div>

        {ui.edit && !camView && (
          <div className="vp-editbar">
            <Seg value={ui.edit.mode} onChange={setEditMode} options={[
              { v: 'vert', label: '정점', title: '정점 선택 (1)' }, { v: 'face', label: '면', title: '면 선택 (3)' },
            ]} />
            <button className="btn ghost sm" title="돌출 (E)" disabled={!ui.edit.sel.length}
              onClick={() => { const n = editExtrude(); if (n) viewportApi.startModal?.('translate', n) }}>
              <i className="fa-solid fa-arrow-up-from-bracket" />돌출
            </button>
            <button className="btn ghost sm" title="세분화" disabled={!ui.edit.sel.length} onClick={editSubdivide}>
              <i className="fa-solid fa-table-cells" />세분화
            </button>
            <button className="btn ghost sm" title="병합 (M)" disabled={ui.edit.sel.length < 2} onClick={editMerge}>
              <i className="fa-solid fa-compress" />병합
            </button>
            <button className="btn ghost sm" title="삭제 (X)" disabled={!ui.edit.sel.length} onClick={editDelete}>
              <i className="fa-solid fa-trash" />
            </button>
            <span className="vp-editcount">{ui.edit.sel.length}</span>
            <button className="btn sm primary" onClick={toggleEdit}>완료</button>
          </div>
        )}

        {!camView && (
          <svg className="vp-axes" ref={axisRef} width="80" height="80" viewBox="0 0 80 80">
            <g className="axes">
              {([['+x', '#ff5266', 'X'], ['+y', '#8fd13a', 'Y'], ['+z', '#5aa9ff', 'Z'], ['-x', '#ff5266', ''], ['-y', '#8fd13a', ''], ['-z', '#5aa9ff', '']] as const).map(([a, c, l]) => (
                <g key={a} data-axis={a} style={{ cursor: 'pointer' }}
                  onClick={() => viewportApi.view?.(({ '+x': 'right', '-x': 'left', '+y': 'top', '-y': 'bottom', '+z': 'front', '-z': 'back' } as const)[a])}>
                  <circle r={l ? 9 : 6.5} fill={c} fillOpacity={l ? 1 : 0.45} />
                  {l && <text textAnchor="middle" dy="3.6" fontSize="10" fontWeight="800" fill="#14161a">{l}</text>}
                </g>
              ))}
            </g>
          </svg>
        )}

        {modal && (
          <div className="vp-modal">
            <b>{modeLabel[modal.mode]}</b>
            {modal.axis && <span className={'ax ' + modal.axis}>{modal.axis === 'n' ? '법선' : modal.axis.toUpperCase() + '축'}</span>}
            <span className="dim">X Y Z 축 고정 · 클릭 확정 · 우클릭 취소</span>
          </div>
        )}
        {camView && !store.project.clips.some((c) => c.kind === 'shot') && !store.project.objects.some((o) => o.kind === 'camera') && (
          <div className="vp-note">카메라가 없어요 — 왼쪽 추가 탭에서 카메라를 넣어 주세요</div>
        )}
      </div>

      <div className="transport">
        <button className="btn ghost icon sm" title="처음으로 (Home)" onClick={() => store.setTime(0)}><i className="fa-solid fa-backward-step" /></button>
        <button className="play-btn" title="재생 (Space)" onClick={() => store.setPlaying(!playing)}>
          <i className={'fa-solid ' + (playing ? 'fa-pause' : 'fa-play')} />
        </button>
        <button className="btn ghost icon sm" title="끝으로 (End)" onClick={() => store.setTime(s.duration)}><i className="fa-solid fa-forward-step" /></button>
        <div className="tc"><span className="cur">{timecode(time, s.fps)}</span><span className="dur"> / {timecode(s.duration, s.fps)}</span></div>
        <div className="spacer" />
        <button className={'btn sm' + (camView ? ' on' : ' ghost')} title="카메라 시점 (Numpad 0)" onClick={() => store.setUi({ camView: !camView })}>
          <i className="fa-solid fa-video" />카메라 시점
        </button>
      </div>
    </div>
  )
}

/**
 * --selftest / --shots: drives the real app, checks that the scene actually
 * renders, that editing works end to end, and that export writes a file.
 */
import { store } from './core/store'
import { newProject, makeMesh, makeLight, makeCamera, makeShot, makeTitle, makeFx } from './core/defaults'
import { applyMaterial, applyMotion, setEditMode, toggleEdit } from './ui/actions'
import { viewportApi } from './ui/vpApi'
import { Exporter, FrameRenderer } from './engine/exporter'
import { ensureFont } from './engine/geometry'
import type { Project } from './core/types'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { projectFromBlend } from './engine/blendImport'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function demo(): Project {
  const p = newProject('데모')
  const cube = p.objects[1]
  const ball = makeMesh('sphere', [-1.8, 0.6, 0.6]); ball.name = '공'
  ball.mat!.color = '#ff5a5f'; ball.mat!.roughness = 0.25
  const knot = makeMesh('knot', [1.9, 0.9, -0.4]); knot.name = '매듭'
  knot.mat!.color = '#f5c451'; knot.mat!.metalness = 1; knot.mat!.roughness = 0.2
  const text = makeMesh('text', [0, 0, -2.2]); text.prim!.text = '오딧 3D'
  text.mat!.color = '#ffffff'
  const spot = makeLight('point', [-2, 2.5, 2])
  spot.light!.color = '#7cc4ff'
  const cam2 = makeCamera([0, 1.2, 4]); cam2.name = '정면 카메라'; cam2.camera!.target = cube.id
  p.objects.push(ball, knot, text, spot, cam2)
  cube.anim['rot.y'] = [{ t: 0, v: 0, e: 'cubicInOut' }, { t: 4, v: 180, e: 'cubicInOut' }]
  cube.anim['pos.y'] = [{ t: 0, v: 0.5, e: 'quadOut' }, { t: 1, v: 1.4, e: 'quadIn' }, { t: 2, v: 0.5, e: 'linear' }]
  p.clips = [makeShot(p.objects[3].id, 0, 4), { ...makeShot(cam2.id, 4, 4), trans: 'blend', transDur: 1 }]
  const title = makeTitle(0.5); title.text = 'ODIT 3D'; title.size = 110; title.y = 0.2; title.anim = 'rise'
  p.clips.push(title, makeFx('vignette', 0))
  p.clips[p.clips.length - 1].dur = 8
  return p
}

function lum(c: HTMLCanvasElement) {
  const x = document.createElement('canvas')
  x.width = 64; x.height = 36
  const g = x.getContext('2d')!
  g.drawImage(c, 0, 0, 64, 36)
  const d = g.getImageData(0, 0, 64, 36).data
  let s = 0, var2 = 0
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3
  const mean = s / (d.length / 4)
  for (let i = 0; i < d.length; i += 4) var2 += ((d[i] + d[i + 1] + d[i + 2]) / 3 - mean) ** 2
  return { mean, sd: Math.sqrt(var2 / (d.length / 4)) }
}

export async function run({ shots }: { shots: boolean }) {
  const lines: string[] = []
  let ok = true
  const check = (name: string, cond: boolean, extra = '') => {
    lines.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
    if (!cond) ok = false
  }
  window.addEventListener('error', (e) => {
    // synthetic pointer events have no live pointer to capture; that is the harness, not the app
    if (/PointerCapture/.test(e.message)) return
    lines.push('ERROR ' + e.message); ok = false
  })
  try {
    await wait(600)
    if (shots) await window.odit.harness.shot('01-home')
    await ensureFont()
    store.load(demo(), null)
    // a fresh profile compiles every shader on the first frame, which can take seconds
    for (let i = 0; i < 60; i++) {
      await wait(250)
      const c = document.querySelector('.vp-canvas') as HTMLCanvasElement | null
      if (c && lum(c).sd > 4 && viewportApi.engine?.nodes.size) break
    }
    await wait(300)
    check('editor mounted', !!document.querySelector('.viewport canvas'))
    check('engine alive', !!viewportApi.engine)
    const vc = document.querySelector('.vp-canvas') as HTMLCanvasElement
    const L = lum(vc)
    check('viewport renders something', L.sd > 4, `mean ${L.mean.toFixed(1)} sd ${L.sd.toFixed(1)}`)
    const textNode = viewportApi.engine!.nodes.get(store.project.objects.find((o) => o.prim?.kind === 'text')!.id)
    check('3D text has geometry', (textNode?.mesh?.geometry.getAttribute('position')?.count ?? 0) > 100)

    // edit: select, material, motion, undo
    const cube = store.project.objects[1]
    store.select([cube.id])
    applyMaterial('chrome')
    check('material preset applies', store.obj(cube.id)!.mat!.metalness === 1)
    store.setTime(2)
    applyMotion('spin')
    check('motion writes keys', (store.obj(cube.id)!.anim['rot.y']?.length ?? 0) >= 3)
    store.doUndo()
    check('undo reverts motion', store.obj(cube.id)!.anim['rot.y'].length === 2)
    store.setTime(0)
    await wait(300)
    if (shots) await window.odit.harness.shot('02-editor')

    store.setUi({ camView: true })
    store.setTime(1.2)
    await wait(600)
    const L2 = lum(vc)
    check('camera view renders', L2.sd > 4, `sd ${L2.sd.toFixed(1)}`)
    if (shots) await window.odit.harness.shot('03-camview')
    store.setTime(4.5)
    await wait(400)
    if (shots) await window.odit.harness.shot('04-blend')
    store.setUi({ camView: false, shading: 'solid' })
    await wait(300)
    if (shots) await window.odit.harness.shot('05-solid')
    store.setUi({ shading: 'render' })

    // interaction: modal grab with the mouse, like G in Blender
    store.setUi({ camView: false })
    store.setTime(3)
    await wait(200)
    const r0 = vc.getBoundingClientRect()
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2
    const vp = document.querySelector('.viewport')!
    vp.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true }))
    const before = store.obj(cube.id)!.pos.slice()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', bubbles: true }))
    await wait(100)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: cx + 120, clientY: cy, bubbles: true }))
    await wait(100)
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx + 120, clientY: cy, button: 0, bubbles: true }))
    await wait(100)
    const after = store.obj(cube.id)!.pos
    check('G + X moves along X only', Math.abs(after[0] - before[0]) > 0.1 && Math.abs(after[2] - before[2]) < 1e-6, `${before.map((v) => v.toFixed(3))} -> ${after.map((v) => v.toFixed(3))}`)

    // timeline: drag the title clip right
    const title = document.querySelector('.clip.k-title') as HTMLElement
    const tr = title.getBoundingClientRect()
    const s0 = store.project.clips.find((c) => c.kind === 'title')!.start
    title.dispatchEvent(new PointerEvent('pointerdown', { clientX: tr.left + 30, clientY: tr.top + 5, button: 0, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: tr.left + 30 + 90, clientY: tr.top + 5, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: tr.left + 30 + 90, clientY: tr.top + 5, bubbles: true }))
    await wait(100)
    const s1 = store.project.clips.find((c) => c.kind === 'title')!.start
    check('clip drag moves the clip', s1 > s0 + 0.5, `${s0} -> ${s1.toFixed(2)}`)

    // split + add menu
    const n0 = store.project.clips.length
    store.selectClip(null)
    store.setTime(2)
    store.split()
    check('split cuts clips under the playhead', store.project.clips.length > n0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', shiftKey: true, bubbles: true }))
    await wait(100)
    const menuEl = document.querySelector('.ctx-menu') as HTMLElement | null
    check('Shift A opens the add menu', !!menuEl, menuEl ? JSON.stringify(menuEl.getBoundingClientRect()) + ' ' + getComputedStyle(menuEl).opacity : '')
    await wait(300)
    if (shots) await window.odit.harness.shot('06-addmenu')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(100)

    // mesh edit mode
    store.setTime(0)
    store.select([cube.id])
    toggleEdit()
    await wait(300)
    const em = store.obj(cube.id)!.edit
    check('Tab turns the cube into an editable mesh', !!em && !!store.ui.edit && !store.obj(cube.id)!.prim, em ? `${em.pos.length / 3} verts` : '')
    const vcount0 = em!.pos.length / 3
    // box-select over the whole viewport picks the visible vertices
    const vr = vc.getBoundingClientRect()
    vc.dispatchEvent(new PointerEvent('pointerdown', { clientX: vr.left + 5, clientY: vr.top + 5, button: 0, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: vr.right - 5, clientY: vr.bottom - 5, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: vr.right - 5, clientY: vr.bottom - 5, bubbles: true }))
    vc.dispatchEvent(new PointerEvent('pointerup', { clientX: vr.right - 5, clientY: vr.bottom - 5, button: 0, bubbles: true }))
    await wait(100)
    const boxed = store.ui.edit!.sel.length
    check('box select picks visible vertices only', boxed > 0 && boxed < vcount0, `${boxed} / ${vcount0}`)
    // select the top face ring and extrude it upward with the mouse
    const top = Math.max(...em!.pos.filter((_, i) => i % 3 === 1))
    const topIds = Array.from({ length: vcount0 }, (_, i) => i).filter((i) => em!.pos[i * 3 + 1] > top - 1e-4)
    setEditMode('face')
    store.setEditSel(topIds)
    vp.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true }))
    await wait(150)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy - 120, bubbles: true }))
    await wait(80)
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy - 120, button: 0, bubbles: true }))
    await wait(150)
    const ex = store.obj(cube.id)!.edit!
    const top2 = Math.max(...ex.pos.filter((_, i) => i % 3 === 1))
    check('E extrudes and pulls along the normal', ex.pos.length / 3 > vcount0 && top2 > top + 0.2, `${vcount0} -> ${ex.pos.length / 3} verts, top ${top.toFixed(2)} -> ${top2.toFixed(2)}`)
    if (shots) await window.odit.harness.shot('07-edit')
    const beforeMerge = ex.pos.length / 3
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }))
    await wait(80)
    check('M merges the selection', store.obj(cube.id)!.edit!.pos.length / 3 < beforeMerge)
    store.doUndo()
    check('undo restores the extruded mesh', store.obj(cube.id)!.edit!.pos.length / 3 === beforeMerge)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }))
    await wait(100)
    check('Tab leaves edit mode', !store.ui.edit)

    // separate preview panel
    store.setUi({ preview: true })
    await wait(800)
    const pvc = document.querySelector('.preview-panel canvas') as HTMLCanvasElement | null
    check('preview panel renders the output', !!pvc && lum(pvc).sd > 4, pvc ? `sd ${lum(pvc).sd.toFixed(1)}` : 'missing')
    store.setTime(1.2)
    await wait(400)
    if (shots) await window.odit.harness.shot('08-preview')

    // timeline: an object with no keys still expands to its property rows
    const ball = store.project.objects.find((o) => o.name === '공')!
    store.setUi({ expanded: { ['tl:' + ball.id]: true } })
    await wait(150)
    check('timeline expands an unkeyed object', document.querySelectorAll('.tl-row.krow.sub').length >= 9)
    store.setTime(0.5)
    ;(document.querySelector('.tl-row.krow.sub .tl-key') as HTMLButtonElement).click()
    await wait(80)
    check('row key button keys the property', (store.obj(ball.id)!.anim['pos.x']?.length ?? 0) === 1)

    // settings
    store.setUi({ settings: true })
    await wait(300)
    check('settings open', !!document.querySelector('.modal.settings'))
    if (shots) await window.odit.harness.shot('09-settings')
    store.setUi({ settings: false })

    // a Blender-style glTF (mesh with keys, camera under a correction node, sun) becomes a project
    const blendOk = await blendCheck(check)
    if (blendOk && shots) { await wait(1500); await window.odit.harness.shot('10-blend') }

    check('updater loads', await window.odit.update.loadable())

    // offline frame + export
    const fr = new FrameRenderer(320, 180)
    await fr.prepare(store.project)
    fr.draw(store.project, 1)
    const L3 = lum(fr.out)
    fr.dispose()
    check('offline frame renders', L3.sd > 4, `sd ${L3.sd.toFixed(1)}`)

    const info = await window.odit.app.info()
    const out = info.temp + '\\odit3d-selftest.mp4'
    const short = { ...store.project, settings: { ...store.project.settings, duration: 1.5 } }
    const r = await new Exporter().run(short, { out, format: 'mp4', width: 640, height: 360, fps: 30, from: 0, to: 1.5, crf: 23, audio: false }, () => {})
    check('mp4 export', r.ok && (r.size ?? 0) > 5000, r.ok ? `${r.size} bytes` : r.error)
  } catch (e: any) {
    lines.push('EXCEPTION ' + (e?.stack ?? e))
    ok = false
  }
  await window.odit.harness.result(ok, lines)
}

async function blendCheck(check: (n: string, c: boolean, x?: string) => void): Promise<boolean> {
  const sc = new THREE.Scene()
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff7a1a }))
  cube.name = 'Cube'
  cube.position.set(0, 1, 0)
  sc.add(cube)
  const holder = new THREE.Object3D()
  holder.name = 'Camera'
  holder.position.set(5, 3, 6)
  // Object3D.lookAt aims +Z; a camera looks down -Z, so aim the holder away from the cube
  holder.lookAt(10, 5, 12)
  const cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 100)
  cam.name = 'Camera_Orientation'
  holder.add(cam)
  sc.add(holder)
  const sun = new THREE.DirectionalLight(0xffffff, 3)
  sun.name = 'Sun'
  sun.position.set(3, 6, 2)
  sc.add(sun)
  // frames 1..48 at 24 fps, as Blender writes them
  const times = [1 / 24, 1, 2]
  const clip = new THREE.AnimationClip('CubeAction', -1, [
    new THREE.VectorKeyframeTrack('Cube.position', times, [0, 1, 0, 0, 2.5, 0, 0, 1, 0]),
    new THREE.QuaternionKeyframeTrack('Cube.quaternion', times, [
      ...new THREE.Quaternion().toArray(),
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI * 0.9, 0)).toArray(),
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI * 1.8, 0)).toArray(),
    ]),
  ])
  const glbBuf = await new GLTFExporter().parseAsync(sc, { binary: true, animations: [clip] }) as ArrayBuffer
  const info = await window.odit.app.info()
  const glb = info.temp + '\\odit3d-blend-test.glb'
  await window.odit.fs.writeBinary(glb, glbBuf)
  const p = await projectFromBlend(glb, {
    fps: 24, start: 1, end: 48, w: 1280, h: 720, camera: 'Camera', world: [0.05, 0.05, 0.06], version: 'test', objects: [],
  }, 'blend-test')
  const model = p.objects.find((o) => o.kind === 'model')
  const camObj = p.objects.find((o) => o.kind === 'camera')
  const light = p.objects.find((o) => o.kind === 'light')
  check('blend: mesh becomes its own object', !!model && model.name === 'Cube' && model.model?.node !== undefined)
  check('blend: position keys, shifted to frame 1 = 0s', (model?.anim['pos.y']?.length ?? 0) === 3 && model!.anim['pos.y'][0].t === 0,
    JSON.stringify(model?.anim['pos.y']?.map((k) => [k.t, k.v])))
  const ry = model?.anim['rot.y']?.map((k) => k.v) ?? []
  check('blend: rotation keeps turning past 180°', ry.length === 3 && ry[2] > 300, JSON.stringify(ry.map((v) => Math.round(v))))
  check('blend: camera under its correction node + shot', !!camObj && !!camObj.parentId && p.clips.some((c) => c.kind === 'shot' && c.cameraId === camObj.id))
  check('blend: sun light', light?.light?.kind === 'sun')
  check('blend: render settings', p.settings.fps === 24 && p.settings.duration === 2 && p.settings.width === 1280)
  store.load(p, null)
  store.setUi({ preview: true })
  await wait(1500)
  const n = viewportApi.engine?.nodes.get(model!.id)
  check('blend: model node loads in the scene', !!n?.model)
  return true
}

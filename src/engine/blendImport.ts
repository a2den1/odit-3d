import * as THREE from 'three'
import type { BlendInfo } from '../../electron/preload'
import type { Keyframe, Project, SceneObject, Tracks } from '../core/types'
import { defaultSettings, makeCamera, makeEmpty, makeLight, makeShot } from '../core/defaults'
import { uid } from '../core/util'
import type { EasingKind } from '../core/easing'
import { loadRaw } from './models'

const R2D = 180 / Math.PI
const r4 = (v: number) => +v.toFixed(4)

function hexOf(c: [number, number, number]) {
  // Blender stores linear colour; the picker and the background want sRGB
  return '#' + new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace).getHexString()
}

/** keyframes for position / rotation / scale of one node, from every clip that animates it */
function nodeTracks(clips: THREE.AnimationClip[], name: string, shift: number): Tracks {
  const out: Tracks = {}
  for (const clip of clips) for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf('.')
    if (tr.name.slice(0, dot) !== name) continue
    const prop = tr.name.slice(dot + 1)
    const size = prop === 'quaternion' ? 4 : 3
    const n = tr.times.length
    // cubic-spline tracks carry in-tangent, value, out-tangent per key
    const cubic = tr.values.length === n * size * 3
    const at = (i: number, k: number) => tr.values[(cubic ? i * 3 + 1 : i) * size + k]
    const interp = tr.getInterpolation()
    const e: EasingKind = interp === THREE.InterpolateDiscrete ? 'hold' : cubic ? 'smooth' : 'linear'
    const t = (i: number) => r4(Math.max(0, tr.times[i] - shift))
    if (prop === 'position' || prop === 'scale') {
      const f = prop === 'position' ? 'pos' : 'scale'
      for (let k = 0; k < 3; k++) {
        out[`${f}.${'xyz'[k]}`] = Array.from({ length: n }, (_, i): Keyframe => ({ t: t(i), v: r4(at(i, k)), e }))
      }
    } else if (prop === 'quaternion') {
      const q = new THREE.Quaternion(), eu = new THREE.Euler()
      const prev = [0, 0, 0]
      const rows: number[][] = []
      for (let i = 0; i < n; i++) {
        q.set(at(i, 0), at(i, 1), at(i, 2), at(i, 3)).normalize()
        eu.setFromQuaternion(q, 'XYZ')
        const a = [eu.x * R2D, eu.y * R2D, eu.z * R2D]
        // every XYZ rotation has a twin (x+180, 180-y, z+180); take whichever,
        // unwrapped by whole turns, sits closest to the previous key so a spin
        // keeps spinning instead of flipping axes halfway round
        const twin = [a[0] + 180, 180 - a[1], a[2] + 180]
        const near = (d: number[]) => d.map((v, k) => (i === 0 ? v : v + Math.round((prev[k] - v) / 360) * 360))
        const ca = near(a), cb = near(twin)
        const dist = (d: number[]) => d.reduce((acc, v, k) => acc + Math.abs(v - prev[k]), 0)
        const deg = i === 0 ? a : dist(cb) < dist(ca) - 1e-6 ? cb : ca
        prev[0] = deg[0]; prev[1] = deg[1]; prev[2] = deg[2]
        rows.push(deg)
      }
      for (let k = 0; k < 3; k++) {
        out[`rot.${'xyz'[k]}`] = rows.map((d, i): Keyframe => ({ t: t(i), v: r4(d[k]), e }))
      }
    }
  }
  // a channel that never moves is noise in the timeline
  for (const [k, keys] of Object.entries(out)) if (keys.every((x) => Math.abs(x.v - keys[0].v) < 1e-4)) delete out[k]
  return out
}

function placeFrom(o: SceneObject, m: THREE.Matrix4) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  m.decompose(p, q, s)
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  o.pos = [r4(p.x), r4(p.y), r4(p.z)]
  o.rot = [r4(e.x * R2D), r4(e.y * R2D), r4(e.z * R2D)]
  o.scale = [r4(s.x), r4(s.y), r4(s.z)]
}

/**
 * Turn the scene Blender exported into an ODIT project: every top-level
 * object stays its own object with its keyframes, cameras and lights become
 * real ODIT cameras and lights, and the scene camera becomes the first shot.
 */
export async function projectFromBlend(glb: string, info: BlendInfo, name: string): Promise<Project> {
  const { scene, clips } = await loadRaw(glb)
  scene.updateMatrixWorld(true)

  const fps = Math.max(1, Math.round(info.fps * 1000) / 1000)
  const frames = Math.max(1, info.end - info.start + 1)
  const settings = {
    ...defaultSettings(),
    width: Math.max(2, Math.round(info.w / 2) * 2),
    height: Math.max(2, Math.round(info.h / 2) * 2),
    fps, duration: r4(frames / fps),
    envIntensity: 0.5,
  }
  if (info.world) settings.background = hexOf(info.world)

  // Blender keys live on scene frames; frame `start` is the first frame of the video
  let minT = Infinity
  for (const c of clips) for (const tr of c.tracks) if (tr.times.length) minT = Math.min(minT, tr.times[0])
  const shift = minT >= info.start / fps - 1e-3 ? info.start / fps : 0

  const objects: SceneObject[] = []
  let sceneCam: string | null = null

  scene.children.forEach((node, index) => {
    let cam: THREE.PerspectiveCamera | null = null
    let light: THREE.Light | null = null
    let mesh = false
    node.traverse((x) => {
      if ((x as THREE.PerspectiveCamera).isPerspectiveCamera && !cam) cam = x as THREE.PerspectiveCamera
      if ((x as THREE.Light).isLight && !light) light = x as THREE.Light
      if ((x as THREE.Mesh).isMesh) mesh = true
    })
    const anim = nodeTracks(clips, node.name, shift)
    const nm = node.name || '오브젝트'

    const wrapIfNested = (inner: THREE.Object3D, made: SceneObject) => {
      if (inner === node) {
        placeFrom(made, node.matrixWorld)
        made.anim = anim
        objects.push(made)
        return made
      }
      // the camera or light sits under a correction node: keep that node as a parent
      const holder = makeEmpty()
      holder.name = nm
      placeFrom(holder, node.matrixWorld)
      holder.anim = anim
      const rel = new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(inner.matrixWorld)
      placeFrom(made, rel)
      made.parentId = holder.id
      objects.push(holder, made)
      return made
    }

    if (cam && !mesh) {
      const c: THREE.PerspectiveCamera = cam
      const o = makeCamera()
      o.name = nm
      o.camera = { fov: r4(c.fov), target: null }
      wrapIfNested(c, o)
      if (info.camera && (node.name === info.camera || node.name.replace(/_/g, ' ') === info.camera.replace(/_/g, ' '))) sceneCam = o.id
      if (!sceneCam) sceneCam = o.id
      return
    }
    if (light && !mesh) {
      const l: THREE.Light = light
      const kind = (l as THREE.DirectionalLight).isDirectionalLight ? 'sun' : (l as THREE.SpotLight).isSpotLight ? 'spot' : 'point'
      const o = makeLight(kind)
      o.name = nm
      o.light!.color = '#' + l.color.getHexString()
      o.light!.intensity = r4(Math.min(kind === 'sun' ? 20 : 5000, l.intensity))
      if (kind === 'spot') {
        o.light!.angle = r4(((l as THREE.SpotLight).angle * R2D))
        o.light!.softness = r4((l as THREE.SpotLight).penumbra)
      }
      if (kind !== 'sun') o.light!.range = r4((l as THREE.PointLight).distance ?? 0)
      wrapIfNested(l, o)
      return
    }
    if (!mesh && node.children.length === 0) {
      const o = makeEmpty()
      o.name = nm
      wrapIfNested(node, o)
      return
    }
    const o: SceneObject = {
      id: uid('o'), name: nm, kind: 'model', parentId: null, visible: node.visible, locked: false,
      pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], shadow: true, anim: {},
      model: { path: glb, node: index },
    }
    wrapIfNested(node, o)
  })

  const project: Project = { version: 1, name, settings, objects, clips: [] }
  if (sceneCam) project.clips.push(makeShot(sceneCam, 0, settings.duration))
  // a scene with no lights of its own still needs to be seen
  if (!objects.some((o) => o.kind === 'light')) {
    const sun = makeLight('sun')
    objects.push(sun)
  }
  return project
}

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Project, SceneObject } from '../core/types'
import { valueAt, vecAt } from '../core/anim'
import { easeAt } from '../core/easing'
import { buildGeometry, primSignature, onFontReady } from './geometry'
import { loadModel, instanceOf } from './models'
import { fxAt, shotAt, type FxState } from './timeline'
import { selectedTris, visibleEdges } from './editmesh'

const D2R = Math.PI / 180
const ACCENT = new THREE.Color('#ccff1f')

interface Node {
  id: string
  group: THREE.Group
  sig: string
  mesh?: THREE.Mesh
  mat?: THREE.MeshPhysicalMaterial
  light?: THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight
  cam?: THREE.PerspectiveCamera
  model?: THREE.Object3D
  mixer?: THREE.AnimationMixer
  /** editor-only drawing: lives in the helper scene and follows the group */
  helper?: THREE.Object3D
  helperSig?: string
}

export type ShadingMode = 'wire' | 'solid' | 'render'

export interface RenderOpts {
  /** through the shot camera (output) or the free editor camera */
  output: boolean
  shading: ShadingMode
  selection?: string[]
  /** editor overlays: grid, light and camera glyphs, selection outline */
  overlays: boolean
  /** timeline effects (only meaningful through the output camera) */
  fx?: FxState | null
  /** mesh edit mode overlay */
  edit?: { id: string; mode: 'vert' | 'face'; sel: number[] } | null
}

const GRADE = {
  uniforms: {
    tDiffuse: { value: null }, res: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
    vignette: { value: 0 }, grain: { value: 0 }, mono: { value: 0 }, temp: { value: 0 }, fade: { value: 0 },
    flash: { value: 0 }, chroma: { value: 0 }, pixel: { value: 0 }, invert: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float time;
    uniform float vignette, grain, mono, temp, fade, flash, chroma, pixel, invert;
    varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      if (pixel > 0.001) { vec2 cell = vec2(mix(1.0, 40.0, pixel)) / res; uv = (floor(uv / cell) + 0.5) * cell; }
      vec3 c;
      if (chroma > 0.001) {
        vec2 d = (uv - 0.5) * chroma * 0.018;
        c = vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
      } else c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(l), mono);
      c *= vec3(1.0 + temp * 0.12, 1.0 + temp * 0.015, 1.0 - temp * 0.15);
      float d = length((vUv - 0.5) * vec2(res.x / res.y, 1.0));
      c *= mix(1.0, smoothstep(1.05, 0.25, d), vignette);
      c += (rnd(vUv * res + fract(time * 7.31) * 91.0) - 0.5) * grain * 0.18;
      c = mix(c, 1.0 - c, invert);
      c = mix(c, vec3(1.0), clamp(flash, 0.0, 1.0));
      c *= 1.0 - clamp(fade, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
}

export class SceneEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly root = new THREE.Group()
  readonly helperScene = new THREE.Scene()
  readonly editorCam = new THREE.PerspectiveCamera(42, 1, 0.05, 2000)
  readonly outCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 2000)
  readonly nodes = new Map<string, Node>()
  private composer: EffectComposer
  private renderPass: RenderPass
  private helperPass: RenderPass
  private outline: OutlinePass
  private bloom: UnrealBloomPass
  private grade: ShaderPass
  private env: THREE.Texture
  private grid: THREE.Group
  private solidMat = new THREE.MeshStandardMaterial({ color: 0x8e929a, roughness: 0.9, metalness: 0 })
  private wireMat = new THREE.MeshBasicMaterial({ color: 0xaab0bb, wireframe: true })
  private textures = new Map<string, THREE.Texture>()
  private loading = new Set<Promise<unknown>>()
  private w = 1
  private h = 1
  /** called when something that loads in the background arrives */
  onAsync: (() => void) | null = null
  private offFont: () => void
  private lastProject: Project | null = null
  private editOv: THREE.Group | null = null
  private editSig = ''
  private editId: string | null = null

  constructor(readonly canvas: HTMLCanvasElement, private opts: { pixelRatio?: number } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(opts.pixelRatio ?? 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.AgXToneMapping

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    this.scene.add(this.root)
    this.editorCam.position.set(6, 4.5, 7.5)
    this.editorCam.lookAt(0, 0.5, 0)
    this.editorCam.layers.enableAll()

    this.grid = makeGrid()
    this.helperScene.add(this.grid)

    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
    this.renderPass = new RenderPass(this.scene, this.editorCam)
    this.outline = new OutlinePass(new THREE.Vector2(1, 1), this.scene, this.editorCam)
    this.outline.visibleEdgeColor.copy(ACCENT)
    this.outline.hiddenEdgeColor.set('#4d5c12')
    this.outline.edgeStrength = 5
    this.outline.edgeThickness = 1
    this.outline.edgeGlow = 0
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.5, 0.82)
    this.helperPass = new RenderPass(this.helperScene, this.editorCam)
    this.helperPass.clear = false
    this.grade = new ShaderPass(GRADE)
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.outline)
    this.composer.addPass(this.bloom)
    this.composer.addPass(this.helperPass)
    this.composer.addPass(new OutputPass())
    this.composer.addPass(this.grade)

    this.offFont = onFontReady(() => this.onAsync?.())
  }

  setSize(w: number, h: number) {
    this.w = Math.max(1, Math.round(w))
    this.h = Math.max(1, Math.round(h))
    this.renderer.setSize(this.w, this.h, false)
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(this.w, this.h)
    this.editorCam.aspect = this.w / this.h
    this.editorCam.updateProjectionMatrix()
    const pr = this.renderer.getPixelRatio()
    this.grade.uniforms.res.value.set(this.w * pr, this.h * pr)
  }

  /** resolves once every model and texture the last sync asked for is in */
  async whenReady() {
    while (this.loading.size) await Promise.allSettled([...this.loading])
  }

  /* ------------------------------------------------------------- build */

  sync(p: Project, t: number) {
    this.lastProject = p
    const s = p.settings
    this.scene.background = new THREE.Color(s.background)
    this.scene.environment = s.env === 'studio' ? this.env : null
    this.scene.environmentIntensity = s.envIntensity
    this.renderer.toneMappingExposure = s.exposure
    this.renderer.shadowMap.enabled = s.shadows
    if (s.fog > 0) {
      if (!(this.scene.fog instanceof THREE.FogExp2)) this.scene.fog = new THREE.FogExp2(s.background, 0)
      ;(this.scene.fog as THREE.FogExp2).color.set(s.background)
      ;(this.scene.fog as THREE.FogExp2).density = s.fog * 0.12
    } else this.scene.fog = null

    const alive = new Set<string>()
    for (const o of p.objects) {
      alive.add(o.id)
      let n = this.nodes.get(o.id)
      if (!n) {
        n = { id: o.id, group: new THREE.Group(), sig: '' }
        n.group.userData.objId = o.id
        this.nodes.set(o.id, n)
      }
      this.updateNode(n, o, t, p)
    }
    for (const [id, n] of this.nodes) {
      if (alive.has(id)) continue
      this.disposeNode(n)
      this.nodes.delete(id)
    }
    // hierarchy
    for (const o of p.objects) {
      const n = this.nodes.get(o.id)!
      const parent = (o.parentId && this.nodes.get(o.parentId)?.group) || this.root
      if (n.group.parent !== parent) parent.add(n.group)
    }
    this.root.updateMatrixWorld(true)

    // aim cameras that follow a target
    for (const o of p.objects) {
      const n = this.nodes.get(o.id)!
      if (n.cam) {
        const tgt = o.camera?.target ? this.nodes.get(o.camera.target) : null
        if (tgt) {
          const wp = new THREE.Box3().setFromObject(tgt.group)
          const at = wp.isEmpty() ? tgt.group.getWorldPosition(new THREE.Vector3()) : wp.getCenter(new THREE.Vector3())
          n.cam.lookAt(at)
        } else n.cam.quaternion.identity()
        n.cam.updateMatrixWorld(true)
      }
    }
  }

  private updateNode(n: Node, o: SceneObject, t: number, p: Project) {
    const g = n.group
    const [px, py, pz] = vecAt(o, 'pos', t)
    const [rx, ry, rz] = vecAt(o, 'rot', t)
    const [sx, sy, sz] = vecAt(o, 'scale', t)
    g.position.set(px, py, pz)
    g.rotation.set(rx * D2R, ry * D2R, rz * D2R, 'XYZ')
    g.scale.set(sx || 1e-4, sy || 1e-4, sz || 1e-4)
    g.visible = o.visible
    g.name = o.name

    const shadows = p.settings.shadows

    if (o.kind === 'mesh' && (o.prim || o.edit)) {
      const sig = primSignature(o)
      if (!n.mesh) {
        n.mat = new THREE.MeshPhysicalMaterial()
        n.mesh = new THREE.Mesh(new THREE.BufferGeometry(), n.mat)
        n.mesh.userData.objId = o.id
        g.add(n.mesh)
      }
      if (sig !== n.sig) {
        n.mesh.geometry.dispose()
        n.mesh.geometry = buildGeometry(o)
        n.sig = sig
      }
      n.mesh.castShadow = o.shadow && shadows && o.prim?.kind !== 'plane'
      n.mesh.receiveShadow = shadows
      this.applyMaterial(n.mat!, o, t)
    }

    if (o.kind === 'model' && o.model) {
      const sig = o.model.path
      if (n.sig !== sig) {
        n.sig = sig
        if (n.model) { g.remove(n.model); n.model = undefined }
        n.mixer = undefined
        const pr = loadModel(sig).then((m) => {
          if (n.sig !== sig || !this.nodes.has(n.id)) return
          const inst = instanceOf(m)
          inst.traverse((x) => { x.userData.objId = o.id })
          n.model = inst
          g.add(inst)
          if (m.clips.length) {
            n.mixer = new THREE.AnimationMixer(inst)
            n.mixer.clipAction(m.clips[0]).play()
          }
          this.onAsync?.()
        }).catch((e) => { console.error('[model]', sig, e) })
        this.track(pr)
      }
      if (n.mixer) n.mixer.setTime(t)
      if (n.model) n.model.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh) { m.castShadow = o.shadow && shadows; m.receiveShadow = shadows } })
    }

    if (o.kind === 'light' && o.light) {
      const L = o.light
      if (n.sig !== 'light:' + L.kind) {
        if (n.light) { g.remove(n.light); (n.light as any).dispose?.() }
        n.light = L.kind === 'sun' ? new THREE.DirectionalLight() : L.kind === 'spot' ? new THREE.SpotLight() : new THREE.PointLight()
        if (n.light instanceof THREE.DirectionalLight || n.light instanceof THREE.SpotLight) {
          n.light.target.position.set(0, 0, -1)
          n.light.add(n.light.target)
        }
        n.light.shadow.mapSize.set(2048, 2048)
        n.light.shadow.bias = -0.0004
        n.light.shadow.normalBias = 0.02
        if (n.light instanceof THREE.DirectionalLight) {
          const c = n.light.shadow.camera
          c.left = -12; c.right = 12; c.top = 12; c.bottom = -12; c.near = 0.1; c.far = 80
          // a sun only needs a direction; step it back so its shadow camera sees the scene
          n.light.position.set(0, 0, 30)
        }
        g.add(n.light)
        n.sig = 'light:' + L.kind
      }
      const l = n.light!
      l.color.set(L.color)
      l.intensity = valueAt(o, 'light.intensity', t)
      l.castShadow = L.shadow && shadows
      if (l instanceof THREE.PointLight || l instanceof THREE.SpotLight) { l.distance = L.range; l.decay = 2 }
      if (l instanceof THREE.SpotLight) { l.angle = Math.min(89, L.angle) * D2R; l.penumbra = L.softness }
    }

    if (o.kind === 'camera' && o.camera) {
      if (!n.cam) {
        n.cam = new THREE.PerspectiveCamera()
        g.add(n.cam)
      }
      n.cam.fov = valueAt(o, 'camera.fov', t)
      n.cam.aspect = p.settings.width / p.settings.height
      n.cam.updateProjectionMatrix()
    }
  }

  private applyMaterial(m: THREE.MeshPhysicalMaterial, o: SceneObject, t: number) {
    const src = o.mat!
    m.color.set(src.color)
    m.metalness = valueAt(o, 'mat.metalness', t)
    m.roughness = valueAt(o, 'mat.roughness', t)
    m.emissive.set(src.emissive)
    m.emissiveIntensity = valueAt(o, 'mat.emissiveIntensity', t)
    const op = valueAt(o, 'mat.opacity', t)
    m.opacity = op
    m.transparent = op < 0.999
    m.depthWrite = op > 0.5
    m.transmission = src.transmission
    m.thickness = src.transmission > 0 ? 0.6 : 0
    m.ior = 1.45
    m.wireframe = src.wireframe
    if (m.flatShading !== src.flat) { m.flatShading = src.flat; m.needsUpdate = true }
    m.side = o.prim?.kind === 'plane' || o.prim?.kind === 'ring' || o.edit ? THREE.DoubleSide : THREE.FrontSide
    const tex = src.map ? this.texture(src.map) : null
    if (m.map !== tex) { m.map = tex; m.needsUpdate = true }
  }

  private texture(p: string): THREE.Texture {
    let tx = this.textures.get(p)
    if (!tx) {
      tx = new THREE.TextureLoader().load(window.odit.fs.url(p), () => this.onAsync?.())
      tx.colorSpace = THREE.SRGBColorSpace
      tx.anisotropy = 8
      this.textures.set(p, tx)
    }
    return tx
  }

  private track(pr: Promise<unknown>) {
    this.loading.add(pr)
    pr.finally(() => this.loading.delete(pr))
  }

  private disposeNode(n: Node) {
    n.group.removeFromParent()
    n.mesh?.geometry.dispose()
    n.mat?.dispose()
    ;(n.light as any)?.dispose?.()
    if (n.helper) { n.helper.removeFromParent(); disposeTree(n.helper) }
    // children re-parent to root on the next sync; detach them now so they are not lost
    for (const c of [...n.group.children]) if (c.userData.objId && c !== n.mesh && c !== n.model) this.root.add(c)
  }

  /* ------------------------------------------------------------- helpers */

  private syncHelpers(p: Project, sel: Set<string>, show: boolean) {
    this.grid.visible = show && p.settings.floorGrid
    for (const o of p.objects) {
      const n = this.nodes.get(o.id)!
      const wants = o.kind === 'light' || o.kind === 'camera' || o.kind === 'empty'
      if (!wants) continue
      const selected = sel.has(o.id)
      const sig = [o.kind, o.light?.kind, o.light?.color, o.light?.angle, o.kind === 'camera' ? n.cam?.fov.toFixed(1) : '', p.settings.width / p.settings.height, selected].join('|')
      if (n.helperSig !== sig) {
        if (n.helper) { n.helper.removeFromParent(); disposeTree(n.helper) }
        n.helper = makeGlyph(o, n, p, selected)
        n.helper.traverse((x) => { x.userData.objId = o.id })
        n.helper.matrixAutoUpdate = false
        this.helperScene.add(n.helper)
        n.helperSig = sig
      }
      const h = n.helper!
      const src = n.cam ?? n.group
      h.matrix.copy(src.matrixWorld)
      // glyphs keep their size however the object is scaled
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
      h.matrix.decompose(pos, q, s)
      h.matrix.compose(pos, q, new THREE.Vector3(1, 1, 1))
      h.visible = show && visibleChain(n.group)
      h.matrixWorldNeedsUpdate = true
    }
    for (const [id, n] of this.nodes) if (n.helper && !p.objects.some((o) => o.id === id)) { n.helper.removeFromParent() }
    this.helperScene.updateMatrixWorld(true)
  }

  /* ------------------------------------------------------------- edit overlay */

  /** vertices, edges and selected faces of the mesh being edited, drawn over it */
  private syncEdit(p: Project, e: RenderOpts['edit']) {
    const o = e ? p.objects.find((x) => x.id === e.id) : undefined
    const n = o ? this.nodes.get(o.id) : undefined
    // the edited surface steps back a hair in depth so its own wires and dots win
    if (this.editId && this.editId !== o?.id) {
      const old = this.nodes.get(this.editId)?.mat
      if (old) { old.polygonOffset = false }
    }
    this.editId = o?.id ?? null
    if (!e || !o?.edit || !n) {
      if (this.editOv) { this.editOv.removeFromParent(); disposeTree(this.editOv); this.editOv = null; this.editSig = '' }
      return
    }
    if (n.mat) { n.mat.polygonOffset = true; n.mat.polygonOffsetFactor = 1; n.mat.polygonOffsetUnits = 1 }
    const m = o.edit
    const sig = [o.id, m.v, m.pos.length, m.idx.length, e.mode, e.sel.join(',')].join('|')
    if (sig !== this.editSig) {
      if (this.editOv) { this.editOv.removeFromParent(); disposeTree(this.editOv) }
      const g = new THREE.Group()
      g.matrixAutoUpdate = false
      const sel = new Set(e.sel)
      const lime = new THREE.Color('#ccff1f'), pale = new THREE.Color('#e6e8ec'), dark = new THREE.Color('#15171b')

      // selected faces
      const tris = selectedTris(m, sel)
      if (tris.length) {
        const fi: number[] = []
        for (const t of tris) fi.push(m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2])
        const fg = new THREE.BufferGeometry()
        fg.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3))
        fg.setIndex(fi)
        const fm = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
          color: lime, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
        }))
        g.add(fm)
      }
      // edges: plain and selected
      const plain: number[] = [], hot: number[] = []
      for (const [a, b] of visibleEdges(m)) {
        const arr = sel.has(a) && sel.has(b) ? hot : plain
        arr.push(m.pos[a * 3], m.pos[a * 3 + 1], m.pos[a * 3 + 2], m.pos[b * 3], m.pos[b * 3 + 1], m.pos[b * 3 + 2])
      }
      const lines = (arr: number[], c: THREE.Color, op: number) => {
        const lg = new THREE.BufferGeometry()
        lg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
        return new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: op }))
      }
      g.add(lines(plain, dark, 0.85))
      if (hot.length) g.add(lines(hot, lime, 1))
      // vertices
      if (e.mode === 'vert') {
        const cols = new Float32Array(m.pos.length)
        for (let i = 0; i < m.pos.length / 3; i++) (sel.has(i) ? lime : dark).toArray(cols, i * 3)
        const pg = new THREE.BufferGeometry()
        pg.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3))
        pg.setAttribute('color', new THREE.BufferAttribute(cols, 3))
        const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true }))
        pts.renderOrder = 3
        g.add(pts)
        // selected dots again on top, so a selection behind the surface is still findable
        const sp: number[] = []
        for (const i of sel) sp.push(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2])
        if (sp.length) {
          const sg = new THREE.BufferGeometry()
          sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3))
          const top = new THREE.Points(sg, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, color: lime, transparent: true, opacity: 0.35, depthTest: false }))
          top.renderOrder = 4
          g.add(top)
        }
      }
      void pale
      this.editOv = g
      this.helperScene.add(g)
      this.editSig = sig
    }
    this.editOv!.matrix.copy(n.group.matrixWorld)
    this.editOv!.matrixWorldNeedsUpdate = true
    this.editOv!.visible = true
  }

  /* ------------------------------------------------------------- shots */

  /** Point the output camera where the timeline says it should be at t. Returns the dip-to-black amount. */
  placeOutputCamera(p: Project, t: number, fx?: FxState | null): number {
    const st = shotAt(p, t)
    const aspect = p.settings.width / p.settings.height
    const cam = this.outCam
    cam.aspect = aspect
    let dip = 0
    const src = (id: string | undefined) => (id ? this.nodes.get(id)?.cam : undefined)
    const cur = src(st.cur?.cameraId) ?? [...this.nodes.values()].find((n) => n.cam)?.cam
    if (!cur) {
      cam.position.set(6, 4, 7); cam.lookAt(0, 0.5, 0); cam.fov = 40
    } else if (st.prev && st.cur) {
      const prev = src(st.prev.cameraId) ?? cur
      if (st.cur.trans === 'blend') {
        const u = easeAt('cubicInOut', st.u)
        const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion()
        prev.matrixWorld.decompose(pa, qa, new THREE.Vector3())
        cur.matrixWorld.decompose(pb, qb, new THREE.Vector3())
        cam.position.lerpVectors(pa, pb, u)
        cam.quaternion.slerpQuaternions(qa, qb, u)
        cam.fov = prev.fov + (cur.fov - prev.fov) * u
      } else {
        // dip: out on the old shot, back in on the new one
        const from = st.u < 0.5 ? prev : cur
        from.matrixWorld.decompose(cam.position, cam.quaternion, new THREE.Vector3())
        cam.fov = from.fov
        dip = 1 - Math.abs(st.u * 2 - 1)
      }
    } else {
      cur.matrixWorld.decompose(cam.position, cam.quaternion, new THREE.Vector3())
      cam.fov = cur.fov
    }
    if (fx && fx.shake > 0) {
      const a = fx.shake
      cam.position.x += (Math.sin(t * 37.1) + Math.sin(t * 23.7)) * 0.02 * a
      cam.position.y += (Math.sin(t * 41.3) + Math.sin(t * 19.1)) * 0.02 * a
      cam.rotateZ(Math.sin(t * 29.3) * 0.012 * a)
    }
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)
    return dip
  }

  /* ------------------------------------------------------------- render */

  render(p: Project, t: number, o: RenderOpts) {
    const cam = o.output ? this.outCam : this.editorCam
    let dip = 0
    if (o.output) dip = this.placeOutputCamera(p, t, o.fx)
    const sel = new Set(o.selection ?? [])
    this.syncHelpers(p, sel, o.overlays)
    this.syncEdit(p, o.overlays ? o.edit : null)
    this.helperScene.updateMatrixWorld(true)

    this.renderPass.camera = cam
    this.helperPass.camera = cam
    this.outline.renderCamera = cam
    this.renderPass.overrideMaterial = o.shading === 'solid' ? this.solidMat : o.shading === 'wire' ? this.wireMat : null
    this.helperPass.enabled = o.overlays

    const outlined: THREE.Object3D[] = []
    if (o.overlays) for (const id of sel) {
      if (o.edit?.id === id) continue
      const n = this.nodes.get(id)
      if (n && (n.mesh || n.model)) outlined.push(n.group)
    }
    this.outline.selectedObjects = outlined
    this.outline.enabled = outlined.length > 0

    const fx = o.fx
    const bloom = o.shading === 'render' ? (fx ? fx.bloom : p.settings.bloom) : 0
    this.bloom.enabled = bloom > 0.001
    this.bloom.strength = bloom * 0.9
    this.bloom.radius = 0.55

    const u = this.grade.uniforms
    u.time.value = t
    u.vignette.value = fx?.vignette ?? 0
    u.grain.value = fx?.grain ?? 0
    u.mono.value = fx?.mono ?? 0
    u.temp.value = fx?.temp ?? 0
    u.fade.value = Math.max(fx?.fade ?? 0, dip)
    u.flash.value = fx?.flash ?? 0
    u.chroma.value = fx?.chroma ?? 0
    u.pixel.value = fx?.pixel ?? 0
    u.invert.value = fx?.invert ?? 0

    this.composer.render()
  }

  /** Convenience for exports and thumbnails: sync + output render with the timeline's effects. */
  renderOutput(p: Project, t: number) {
    this.sync(p, t)
    this.render(p, t, { output: true, shading: 'render', overlays: false, fx: fxAt(p, t) })
  }

  /* ------------------------------------------------------------- picking */

  pick(ndc: THREE.Vector2): string | null {
    const ray = new THREE.Raycaster()
    ray.layers.enableAll()
    ray.params.Line = { threshold: 0.08 }
    ray.setFromCamera(ndc, this.editorCam)
    const hits = ray.intersectObjects([this.root, ...this.helperScene.children.filter((c) => c !== this.grid && c.visible)], true)
    for (const h of hits) {
      let x: THREE.Object3D | null = h.object
      if (!visibleChain(x)) continue
      while (x && !x.userData.objId) x = x.parent
      if (x) return x.userData.objId
    }
    return null
  }

  /** world-space bounds of an object and its children */
  boundsOf(id: string): THREE.Box3 | null {
    const n = this.nodes.get(id)
    if (!n) return null
    const b = new THREE.Box3().setFromObject(n.group)
    if (b.isEmpty()) {
      const c = n.group.getWorldPosition(new THREE.Vector3())
      b.setFromCenterAndSize(c, new THREE.Vector3(1, 1, 1))
    }
    return b
  }

  dispose() {
    this.offFont()
    for (const n of this.nodes.values()) this.disposeNode(n)
    this.nodes.clear()
    for (const t of this.textures.values()) t.dispose()
    this.composer.dispose()
    this.env.dispose()
    this.renderer.dispose()
  }
}

function visibleChain(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false
  return true
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh
    m.geometry?.dispose?.()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((q) => q.dispose()); else mat?.dispose?.()
  })
}

/* ---------------------------------------------------------------- glyphs */

function makeGrid(): THREE.Group {
  const g = new THREE.Group()
  const size = 40, step = 1
  const pts: number[] = []
  const major: number[] = []
  for (let i = -size / 2; i <= size / 2; i += step) {
    if (i === 0) continue
    const arr = i % 5 === 0 ? major : pts
    arr.push(i, 0, -size / 2, i, 0, size / 2, -size / 2, 0, i, size / 2, 0, i)
  }
  const line = (arr: number[], color: string, opacity: number) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
  }
  g.add(line(pts, '#ffffff', 0.05))
  g.add(line(major, '#ffffff', 0.1))
  g.add(line([-size / 2, 0, 0, size / 2, 0, 0], '#ff5266', 0.55))
  g.add(line([0, 0, -size / 2, 0, 0, size / 2], '#8fd13a', 0.55))
  g.renderOrder = -1
  return g
}

function makeGlyph(o: SceneObject, n: Node, p: Project, selected: boolean): THREE.Object3D {
  const g = new THREE.Group()
  const col = selected ? '#ccff1f' : o.kind === 'light' ? (o.light?.color ?? '#ffffff') : '#c9ccd3'
  const lineMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: selected ? 1 : 0.75, depthTest: false })
  const seg = (arr: number[]) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    const l = new THREE.LineSegments(geo, lineMat)
    l.renderOrder = 10
    return l
  }
  const circle = (r: number, axis: 'xy' | 'xz', z = 0) => {
    const arr: number[] = []
    const N = 32
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2
      if (axis === 'xy') arr.push(Math.cos(a0) * r, Math.sin(a0) * r, z, Math.cos(a1) * r, Math.sin(a1) * r, z)
      else arr.push(Math.cos(a0) * r, z, Math.sin(a0) * r, Math.cos(a1) * r, z, Math.sin(a1) * r)
    }
    return arr
  }
  // a small solid core so the glyph is easy to click
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12),
    new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.95 }))
  core.renderOrder = 11

  if (o.kind === 'light') {
    const k = o.light!.kind
    g.add(core)
    if (k === 'sun') {
      g.add(seg([...circle(0.22, 'xy'), 0, 0, 0, 0, 0, -1.6]))
      const rays: number[] = []
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        rays.push(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0, Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0)
      }
      g.add(seg(rays))
    } else if (k === 'point') {
      g.add(seg([...circle(0.22, 'xy'), ...circle(0.22, 'xz')]))
    } else {
      const len = 1.4
      const r = Math.tan((Math.min(o.light!.angle, 80) * Math.PI) / 180) * len
      const arr = circle(r, 'xy', -len)
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        arr.push(0, 0, 0, Math.cos(a) * r, Math.sin(a) * r, -len)
      }
      g.add(seg(arr))
    }
  } else if (o.kind === 'camera') {
    const fov = ((n.cam?.fov ?? 40) * Math.PI) / 180
    const aspect = p.settings.width / p.settings.height
    const d = 0.9
    const hh = Math.tan(fov / 2) * d, hw = hh * aspect
    const c = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    const arr: number[] = []
    for (let i = 0; i < 4; i++) {
      const [x, y] = c[i], [x2, y2] = c[(i + 1) % 4]
      arr.push(0, 0, 0, x, y, -d, x, y, -d, x2, y2, -d)
    }
    // the little roof marks which way is up
    arr.push(-hw * 0.5, hh * 1.1, -d, 0, hh * 1.6, -d, 0, hh * 1.6, -d, hw * 0.5, hh * 1.1, -d, hw * 0.5, hh * 1.1, -d, -hw * 0.5, hh * 1.1, -d)
    g.add(seg(arr))
    core.scale.setScalar(0.8)
    g.add(core)
  } else {
    g.add(seg([-0.4, 0, 0, 0.4, 0, 0, 0, -0.4, 0, 0, 0.4, 0, 0, 0, -0.4, 0, 0, 0.4]))
    core.scale.setScalar(0.6)
    g.add(core)
  }
  return g
}

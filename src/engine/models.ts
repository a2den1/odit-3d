import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { basename, extname } from '../core/util'

export interface LoadedModel {
  scene: THREE.Object3D
  clips: THREE.AnimationClip[]
}

const cache = new Map<string, Promise<LoadedModel>>()

let draco: DRACOLoader | null = null
function gltfLoader() {
  const l = new GLTFLoader()
  if (!draco) { draco = new DRACOLoader(); draco.setDecoderPath('./draco/') }
  l.setDRACOLoader(draco)
  return l
}

/* The URL carries the file's own name after the encoded path, so a loader
   resolving "textures/wood.png" against it lands next to the model. */
const urlOf = (p: string) => `${window.odit.fs.url(p)}/${encodeURIComponent(basename(p))}`

/**
 * Whatever a file's own units, it arrives standing on the floor, centred,
 * and at a size you can see — a 2000-unit FBX and a 2 cm glTF both come in
 * about two units tall.
 */
function normalise(root: THREE.Object3D): THREE.Object3D {
  const wrap = new THREE.Group()
  wrap.add(root)
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return wrap
  const size = box.getSize(new THREE.Vector3())
  const big = Math.max(size.x, size.y, size.z)
  const k = big > 20 || big < 0.2 ? 2 / big : 1
  const c = box.getCenter(new THREE.Vector3())
  root.position.set(-c.x * k, -box.min.y * k, -c.z * k)
  root.scale.setScalar(k)
  return wrap
}

async function load(p: string): Promise<LoadedModel> {
  const url = urlOf(p)
  const ext = extname(p)
  let scene: THREE.Object3D
  let clips: THREE.AnimationClip[] = []
  if (ext === 'glb' || ext === 'gltf') {
    const g = await gltfLoader().loadAsync(url)
    scene = g.scene
    clips = g.animations
  } else if (ext === 'fbx') {
    scene = await new FBXLoader().loadAsync(url)
    clips = (scene as any).animations ?? []
  } else if (ext === 'obj') {
    scene = await new OBJLoader().loadAsync(url)
  } else if (ext === 'stl') {
    const geo = await new STLLoader().loadAsync(url)
    geo.computeVertexNormals()
    scene = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9dbe0, roughness: 0.5 }))
    scene.rotation.x = -Math.PI / 2 // STL is Z-up
  } else {
    throw new Error('지원하지 않는 형식: ' + ext)
  }
  scene.traverse((n) => {
    const m = n as THREE.Mesh
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true }
  })
  return { scene: normalise(scene), clips }
}

export function loadModel(p: string): Promise<LoadedModel> {
  let pr = cache.get(p)
  if (!pr) {
    pr = load(p)
    cache.set(p, pr)
    pr.catch(() => cache.delete(p))
  }
  return pr
}

/** a private copy for one object, skinned meshes included */
export function instanceOf(m: LoadedModel): THREE.Object3D {
  return skeletonClone(m.scene)
}

/* ---------------------------------------------------------- blender scenes */

const rawCache = new Map<string, Promise<LoadedModel>>()

/** A whole glTF scene exactly as authored — no re-centering or rescaling — for scenes brought in from Blender. */
export function loadRaw(p: string): Promise<LoadedModel> {
  let pr = rawCache.get(p)
  if (!pr) {
    pr = gltfLoader().loadAsync(urlOf(p)).then((g) => {
      g.scene.traverse((n) => {
        const m = n as THREE.Mesh
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true }
      })
      return { scene: g.scene, clips: g.animations }
    })
    rawCache.set(p, pr)
    pr.catch(() => rawCache.delete(p))
  }
  return pr
}

/**
 * One top-level node of a raw scene as its own object. The node's own
 * transform is left to the ODIT object (and its keyframes), so it is reset
 * here; animation inside the node (bones, children) comes back as a clip.
 */
export function instanceNode(m: LoadedModel, index: number): { obj: THREE.Object3D; clip: THREE.AnimationClip | null } {
  const src = m.scene.children[index]
  if (!src) return { obj: new THREE.Group(), clip: null }
  const obj = skeletonClone(src)
  obj.position.set(0, 0, 0)
  obj.quaternion.identity()
  obj.scale.set(1, 1, 1)
  const inside = new Set<string>()
  src.traverse((n) => { if (n !== src) inside.add(n.name) })
  const tracks: THREE.KeyframeTrack[] = []
  for (const c of m.clips) for (const t of c.tracks) {
    const target = t.name.slice(0, t.name.lastIndexOf('.'))
    if (inside.has(target)) tracks.push(t)
  }
  return { obj, clip: tracks.length ? new THREE.AnimationClip('inner', -1, tracks) : null }
}

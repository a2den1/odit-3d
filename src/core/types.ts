import type { EasingKind } from './easing'

export type Vec3 = [number, number, number]

export interface Keyframe { t: number; v: number; e: EasingKind }
/** property path ('pos.x', 'mat.opacity', …) -> keys, sorted by time */
export type Tracks = Record<string, Keyframe[]>

export type PrimKind =
  | 'cube' | 'sphere' | 'icosphere' | 'cylinder' | 'cone' | 'torus'
  | 'plane' | 'capsule' | 'knot' | 'ring' | 'pyramid' | 'text'

export type ObjKind = 'mesh' | 'model' | 'light' | 'camera' | 'empty'
export type LightKind = 'point' | 'spot' | 'sun'

export interface Material {
  color: string
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  opacity: number
  /** glass-like see-through with refraction */
  transmission: number
  flat: boolean
  wireframe: boolean
  /** absolute path of an image used as the colour map */
  map: string | null
}

export interface LightProps {
  kind: LightKind
  color: string
  intensity: number
  /** point/spot falloff distance, 0 = infinite */
  range: number
  /** spot cone angle in degrees */
  angle: number
  /** spot edge softness 0..1 */
  softness: number
  shadow: boolean
}

export interface CameraProps {
  fov: number
  /** a camera can look at another object instead of using its own rotation */
  target: string | null
}

/** welded triangle mesh the user has edited by hand (object-local space) */
export interface EditMesh {
  pos: number[]
  idx: number[]
  /** bumped on every change so the renderer knows to rebuild */
  v: number
}

export interface SceneObject {
  id: string
  name: string
  kind: ObjKind
  parentId: string | null
  visible: boolean
  locked: boolean
  pos: Vec3
  /** degrees, XYZ order */
  rot: Vec3
  scale: Vec3
  prim?: { kind: PrimKind; p: Record<string, number>; text?: string }
  edit?: EditMesh
  mat?: Material
  light?: LightProps
  camera?: CameraProps
  /** node: one top-level node of a scene brought in from Blender, used as-is */
  model?: { path: string; node?: number }
  shadow: boolean
  anim: Tracks
}

/* ------------------------------------------------------------ timeline */

export type ShotTransition = 'cut' | 'dip' | 'blend'
export type TitleAnim = 'none' | 'fade' | 'rise' | 'pop' | 'type' | 'blur' | 'slide'
export type FxKind = 'bloom' | 'vignette' | 'grain' | 'mono' | 'warm' | 'cool' | 'fade' | 'chroma' | 'shake' | 'flash' | 'pixel' | 'invert'

interface ClipBase { id: string; start: number; dur: number }

export interface ShotClip extends ClipBase {
  kind: 'shot'
  cameraId: string
  /** how this shot arrives from the previous one */
  trans: ShotTransition
  transDur: number
}

export interface TitleClip extends ClipBase {
  kind: 'title'
  text: string
  size: number
  color: string
  weight: number
  /** 0..1 of the frame */
  x: number
  y: number
  anim: TitleAnim
  /** pill behind the text */
  box: boolean
  boxColor: string
}

export interface FxClip extends ClipBase {
  kind: 'fx'
  fx: FxKind
  amount: number
}

export interface AudioClip extends ClipBase {
  kind: 'audio'
  path: string
  name: string
  /** seconds into the file where the clip begins */
  offset: number
  srcDur: number
  volume: number
  fadeIn: number
  fadeOut: number
}

export type Clip = ShotClip | TitleClip | FxClip | AudioClip
export type ClipKind = Clip['kind']

export interface Settings {
  width: number
  height: number
  fps: number
  duration: number
  background: string
  /** image-based lighting */
  env: 'studio' | 'none'
  envIntensity: number
  exposure: number
  bloom: number
  shadows: boolean
  fog: number
  floorGrid: boolean
}

export interface Project {
  version: 1
  name: string
  settings: Settings
  objects: SceneObject[]
  clips: Clip[]
  thumb?: string | null
}

import type {
  AudioClip, FxClip, FxKind, LightKind, Material, PrimKind, Project, SceneObject, Settings, ShotClip, TitleClip, Vec3,
} from './types'
import { uid } from './util'

export const PRIMS: { kind: PrimKind; name: string; icon: string; p: Record<string, number> }[] = [
  { kind: 'cube', name: '정육면체', icon: 'fa-cube', p: { w: 1, h: 1, d: 1, bevel: 0 } },
  { kind: 'sphere', name: '구', icon: 'fa-circle', p: { r: 0.6, seg: 48 } },
  { kind: 'cylinder', name: '원기둥', icon: 'fa-database', p: { r: 0.5, h: 1.2, seg: 48 } },
  { kind: 'cone', name: '원뿔', icon: 'fa-caret-up', p: { r: 0.6, h: 1.2, seg: 48 } },
  { kind: 'torus', name: '도넛', icon: 'fa-life-ring', p: { r: 0.55, tube: 0.2, seg: 64 } },
  { kind: 'plane', name: '평면', icon: 'fa-square', p: { w: 2, d: 2 } },
  { kind: 'capsule', name: '캡슐', icon: 'fa-capsules', p: { r: 0.35, h: 0.8, seg: 24 } },
  { kind: 'icosphere', name: '다면체 구', icon: 'fa-dice-d20', p: { r: 0.6, detail: 1 } },
  { kind: 'pyramid', name: '피라미드', icon: 'fa-play', p: { r: 0.7, h: 1 } },
  { kind: 'ring', name: '고리', icon: 'fa-ring', p: { r: 0.6, inner: 0.35, seg: 64 } },
  { kind: 'knot', name: '매듭', icon: 'fa-infinity', p: { r: 0.45, tube: 0.14, p: 2, q: 3 } },
  { kind: 'text', name: '3D 글자', icon: 'fa-font', p: { size: 0.6, depth: 0.2, bevel: 0.02 } },
]
export const PRIM_MAP = Object.fromEntries(PRIMS.map((p) => [p.kind, p])) as Record<PrimKind, (typeof PRIMS)[number]>

/** Labels and ranges for the shape parameters the inspector shows. */
export const PRIM_PARAMS: Record<string, { label: string; min: number; max: number; step: number }> = {
  w: { label: '너비', min: 0.01, max: 50, step: 0.01 },
  h: { label: '높이', min: 0.01, max: 50, step: 0.01 },
  d: { label: '깊이', min: 0.01, max: 50, step: 0.01 },
  r: { label: '반지름', min: 0.01, max: 25, step: 0.01 },
  inner: { label: '안쪽 반지름', min: 0, max: 25, step: 0.01 },
  tube: { label: '두께', min: 0.01, max: 10, step: 0.01 },
  seg: { label: '분할', min: 3, max: 128, step: 1 },
  detail: { label: '세밀도', min: 0, max: 5, step: 1 },
  bevel: { label: '모서리 둥글기', min: 0, max: 0.5, step: 0.005 },
  size: { label: '글자 크기', min: 0.05, max: 10, step: 0.01 },
  depth: { label: '두께', min: 0, max: 5, step: 0.01 },
  p: { label: '감김 P', min: 1, max: 9, step: 1 },
  q: { label: '감김 Q', min: 1, max: 9, step: 1 },
}

export const defaultMaterial = (color = '#d9dbe0'): Material => ({
  color, metalness: 0, roughness: 0.45, emissive: '#000000', emissiveIntensity: 0,
  opacity: 1, transmission: 0, flat: false, wireframe: false, map: null,
})

export const MATERIAL_PRESETS: { id: string; name: string; m: Partial<Material> }[] = [
  { id: 'clay', name: '점토', m: { color: '#d9dbe0', metalness: 0, roughness: 0.8 } },
  { id: 'plastic', name: '플라스틱', m: { color: '#ff5a5f', metalness: 0, roughness: 0.3 } },
  { id: 'glossy', name: '유광', m: { color: '#1e1f24', metalness: 0.1, roughness: 0.08 } },
  { id: 'chrome', name: '크롬', m: { color: '#f2f3f5', metalness: 1, roughness: 0.05 } },
  { id: 'gold', name: '금', m: { color: '#f5c451', metalness: 1, roughness: 0.22 } },
  { id: 'copper', name: '구리', m: { color: '#d9825b', metalness: 1, roughness: 0.3 } },
  { id: 'brushed', name: '브러시드', m: { color: '#b9bcc4', metalness: 1, roughness: 0.45 } },
  { id: 'glass', name: '유리', m: { color: '#ffffff', metalness: 0, roughness: 0.02, transmission: 1 } },
  { id: 'rubber', name: '고무', m: { color: '#2a2c31', metalness: 0, roughness: 1 } },
  { id: 'neon', name: '네온', m: { color: '#ccff1f', emissive: '#ccff1f', emissiveIntensity: 3, roughness: 0.4 } },
  { id: 'lava', name: '용암', m: { color: '#ff5a1f', emissive: '#ff3d00', emissiveIntensity: 2, roughness: 0.7 } },
  { id: 'jelly', name: '젤리', m: { color: '#ff7ab8', metalness: 0, roughness: 0.15, transmission: 0.7 } },
  { id: 'mint', name: '민트', m: { color: '#5ce0b8', metalness: 0, roughness: 0.5 } },
  { id: 'sky', name: '하늘', m: { color: '#7cc4ff', metalness: 0, roughness: 0.5 } },
  { id: 'wire', name: '와이어', m: { color: '#ccff1f', wireframe: true, roughness: 1 } },
  { id: 'flat', name: '로우폴리', m: { color: '#e9b872', flat: true, roughness: 0.9 } },
]

export const LIGHTS: { kind: LightKind; name: string; icon: string }[] = [
  { kind: 'sun', name: '태양', icon: 'fa-sun' },
  { kind: 'point', name: '전구', icon: 'fa-lightbulb' },
  { kind: 'spot', name: '스포트', icon: 'fa-bullseye' },
]

export const FX_LIST: { fx: FxKind; name: string; icon: string; amount: number }[] = [
  { fx: 'bloom', name: '빛 번짐', icon: 'fa-sun', amount: 1 },
  { fx: 'vignette', name: '비네트', icon: 'fa-circle-half-stroke', amount: 0.7 },
  { fx: 'grain', name: '필름 노이즈', icon: 'fa-braille', amount: 0.5 },
  { fx: 'mono', name: '흑백', icon: 'fa-droplet-slash', amount: 1 },
  { fx: 'warm', name: '따뜻하게', icon: 'fa-fire', amount: 0.6 },
  { fx: 'cool', name: '차갑게', icon: 'fa-snowflake', amount: 0.6 },
  { fx: 'fade', name: '페이드', icon: 'fa-moon', amount: 1 },
  { fx: 'flash', name: '플래시', icon: 'fa-bolt', amount: 1 },
  { fx: 'chroma', name: '색수차', icon: 'fa-layer-group', amount: 0.6 },
  { fx: 'shake', name: '카메라 흔들림', icon: 'fa-wave-square', amount: 0.5 },
  { fx: 'pixel', name: '픽셀', icon: 'fa-chess-board', amount: 0.5 },
  { fx: 'invert', name: '반전', icon: 'fa-yin-yang', amount: 1 },
]
export const FX_MAP = Object.fromEntries(FX_LIST.map((f) => [f.fx, f])) as Record<FxKind, (typeof FX_LIST)[number]>

export const TITLE_PRESETS: { id: string; name: string; c: Partial<TitleClip> }[] = [
  { id: 'basic', name: '기본', c: { size: 64, weight: 800, color: '#ffffff', anim: 'fade', box: false } },
  { id: 'big', name: '큰 제목', c: { size: 120, weight: 900, color: '#ffffff', anim: 'rise', box: false, y: 0.5 } },
  { id: 'lime', name: '포인트', c: { size: 72, weight: 900, color: '#ccff1f', anim: 'pop', box: false } },
  { id: 'caption', name: '자막', c: { size: 42, weight: 700, color: '#ffffff', anim: 'fade', box: true, boxColor: '#000000', y: 0.86 } },
  { id: 'type', name: '타자기', c: { size: 56, weight: 600, color: '#ffffff', anim: 'type', box: false } },
  { id: 'blur', name: '흐림 등장', c: { size: 88, weight: 800, color: '#ffffff', anim: 'blur', box: false } },
  { id: 'tag', name: '라벨', c: { size: 36, weight: 800, color: '#14180a', anim: 'slide', box: true, boxColor: '#ccff1f', x: 0.2, y: 0.18 } },
]

export function defaultSettings(): Settings {
  return {
    width: 1920, height: 1080, fps: 30, duration: 8,
    background: '#1a1c21', env: 'studio', envIntensity: 0.6, exposure: 1,
    bloom: 0, shadows: true, fog: 0, floorGrid: true,
  }
}

/* --------------------------------------------------------------- factories */

function base(kind: SceneObject['kind'], name: string, pos: Vec3 = [0, 0, 0]): SceneObject {
  return {
    id: uid('o'), name, kind, parentId: null, visible: true, locked: false,
    pos, rot: [0, 0, 0], scale: [1, 1, 1], shadow: true, anim: {},
  }
}

export function makeMesh(kind: PrimKind, pos?: Vec3): SceneObject {
  const def = PRIM_MAP[kind]
  const o = base('mesh', def.name, pos ?? [0, kind === 'plane' ? 0 : 0.5, 0])
  o.prim = { kind, p: { ...def.p }, text: kind === 'text' ? 'ODIT' : undefined }
  o.mat = defaultMaterial()
  return o
}

export function makeLight(kind: LightKind, pos?: Vec3): SceneObject {
  const name = LIGHTS.find((l) => l.kind === kind)!.name
  const o = base('light', name, pos ?? (kind === 'sun' ? [4, 6, 3] : [1.5, 2.5, 1.5]))
  if (kind === 'sun') o.rot = [-55, 35, 0]
  if (kind === 'spot') o.rot = [-90, 0, 0]
  o.light = {
    kind, color: '#ffffff', intensity: kind === 'sun' ? 2.2 : kind === 'point' ? 12 : 30,
    range: 0, angle: 35, softness: 0.4, shadow: true,
  }
  return o
}

export function makeCamera(pos: Vec3 = [4.2, 2.6, 5.2]): SceneObject {
  const o = base('camera', '카메라', pos)
  o.rot = [-18, 38, 0]
  o.camera = { fov: 40, target: null }
  o.shadow = false
  return o
}

export function makeEmpty(pos?: Vec3): SceneObject {
  const o = base('empty', '빈 오브젝트', pos)
  o.shadow = false
  return o
}

export function makeModel(path: string, name: string): SceneObject {
  const o = base('model', name)
  o.model = { path }
  return o
}

export function makeShot(cameraId: string, start: number, dur: number): ShotClip {
  return { id: uid('c'), kind: 'shot', start, dur, cameraId, trans: 'cut', transDur: 0.6 }
}

export function makeTitle(start: number, preset = TITLE_PRESETS[0]): TitleClip {
  return {
    id: uid('c'), kind: 'title', start, dur: 3, text: '제목을 입력하세요',
    size: 64, color: '#ffffff', weight: 800, x: 0.5, y: 0.5, anim: 'fade',
    box: false, boxColor: '#000000', ...preset.c,
  }
}

export function makeFx(fx: FxKind, start: number): FxClip {
  return { id: uid('c'), kind: 'fx', start, dur: 2, fx, amount: FX_MAP[fx].amount }
}

export function makeAudio(path: string, name: string, start: number, srcDur: number): AudioClip {
  return {
    id: uid('c'), kind: 'audio', start, dur: srcDur, path, name, offset: 0, srcDur,
    volume: 1, fadeIn: 0, fadeOut: 0,
  }
}

/** A new project opens on a small lit scene, so the first thing on screen is something. */
export function newProject(name = '새 프로젝트'): Project {
  const floor = makeMesh('plane', [0, 0, 0])
  floor.name = '바닥'
  floor.prim!.p = { w: 14, d: 14 }
  floor.mat = { ...defaultMaterial('#2a2d33'), roughness: 0.9 }
  const cube = makeMesh('cube')
  cube.mat = { ...defaultMaterial('#ccff1f'), roughness: 0.35 }
  const sun = makeLight('sun')
  const cam = makeCamera()
  cam.camera!.target = cube.id
  const s = defaultSettings()
  return {
    version: 1, name, settings: s,
    objects: [floor, cube, sun, cam],
    clips: [makeShot(cam.id, 0, s.duration)],
  }
}

/* ---------------------------------------------------------- motion presets */

export const MOTIONS: { id: string; name: string; icon: string }[] = [
  { id: 'spin', name: '회전', icon: 'fa-rotate' },
  { id: 'bounce', name: '통통', icon: 'fa-basketball' },
  { id: 'float', name: '둥실', icon: 'fa-feather' },
  { id: 'popIn', name: '뿅 등장', icon: 'fa-wand-magic-sparkles' },
  { id: 'popOut', name: '뿅 퇴장', icon: 'fa-wind' },
  { id: 'dropIn', name: '떨어지기', icon: 'fa-arrow-down' },
  { id: 'wobble', name: '흔들흔들', icon: 'fa-bell' },
  { id: 'pulse', name: '두근두근', icon: 'fa-heart-pulse' },
  { id: 'flip', name: '뒤집기', icon: 'fa-arrows-rotate' },
  { id: 'orbit', name: '공전', icon: 'fa-circle-notch' },
  { id: 'fadeIn', name: '나타나기', icon: 'fa-eye' },
  { id: 'fadeOut', name: '사라지기', icon: 'fa-eye-slash' },
]

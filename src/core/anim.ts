import { easeAt, type EasingKind } from './easing'
import type { Keyframe, SceneObject, Vec3 } from './types'
import { getPrefs } from './settings'

export const KEY_EPS = 1 / 240

export function evalKeys(keys: Keyframe[] | undefined, t: number, fallback: number): number {
  if (!keys || keys.length === 0) return fallback
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1]
    if (t >= a.t && t < b.t) {
      const u = (t - a.t) / Math.max(b.t - a.t, 1e-9)
      return a.v + (b.v - a.v) * easeAt(a.e, u)
    }
  }
  return last.v
}

export function setKey(keys: Keyframe[] | undefined, t: number, v: number, e: EasingKind = getPrefs().defaultEase): Keyframe[] {
  const list = (keys ?? []).filter((k) => Math.abs(k.t - t) > KEY_EPS)
  const prev = keys?.find((k) => Math.abs(k.t - t) <= KEY_EPS)
  list.push({ t, v, e: prev?.e ?? e })
  return list.sort((a, b) => a.t - b.t)
}

export const keyAt = (keys: Keyframe[] | undefined, t: number) => keys?.find((k) => Math.abs(k.t - t) <= KEY_EPS)

/* ------------------------------------------------------------- properties */

export interface PropDef {
  key: string
  label: string
  group: string
  get: (o: SceneObject) => number | undefined
  set: (o: SceneObject, v: number) => void
}

const vec = (field: 'pos' | 'rot' | 'scale', i: 0 | 1 | 2, label: string, group: string): PropDef => ({
  key: `${field}.${'xyz'[i]}`, label, group,
  get: (o) => o[field][i],
  set: (o, v) => { (o[field] as Vec3)[i] = v },
})

/** Everything the timeline can keyframe, in the order it lists them. */
export const PROPS: PropDef[] = [
  vec('pos', 0, '위치 X', '위치'), vec('pos', 1, '위치 Y', '위치'), vec('pos', 2, '위치 Z', '위치'),
  vec('rot', 0, '회전 X', '회전'), vec('rot', 1, '회전 Y', '회전'), vec('rot', 2, '회전 Z', '회전'),
  vec('scale', 0, '크기 X', '크기'), vec('scale', 1, '크기 Y', '크기'), vec('scale', 2, '크기 Z', '크기'),
  { key: 'mat.opacity', label: '불투명도', group: '재질', get: (o) => o.mat?.opacity, set: (o, v) => { if (o.mat) o.mat.opacity = v } },
  { key: 'mat.emissiveIntensity', label: '발광 세기', group: '재질', get: (o) => o.mat?.emissiveIntensity, set: (o, v) => { if (o.mat) o.mat.emissiveIntensity = v } },
  { key: 'mat.metalness', label: '금속성', group: '재질', get: (o) => o.mat?.metalness, set: (o, v) => { if (o.mat) o.mat.metalness = v } },
  { key: 'mat.roughness', label: '거칠기', group: '재질', get: (o) => o.mat?.roughness, set: (o, v) => { if (o.mat) o.mat.roughness = v } },
  { key: 'light.intensity', label: '빛 세기', group: '조명', get: (o) => o.light?.intensity, set: (o, v) => { if (o.light) o.light.intensity = v } },
  { key: 'camera.fov', label: '화각', group: '카메라', get: (o) => o.camera?.fov, set: (o, v) => { if (o.camera) o.camera.fov = v } },
]
export const PROP_MAP: Record<string, PropDef> = Object.fromEntries(PROPS.map((p) => [p.key, p]))

/** The value a property has at time t — its keys if it has any, else the stored value. */
export function valueAt(o: SceneObject, key: string, t: number): number {
  const def = PROP_MAP[key]
  const base = def?.get(o) ?? 0
  return evalKeys(o.anim[key], t, base)
}

export const vecAt = (o: SceneObject, field: 'pos' | 'rot' | 'scale', t: number): Vec3 =>
  [0, 1, 2].map((i) => valueAt(o, `${field}.${'xyz'[i]}`, t)) as Vec3

export function animatedKeys(o: SceneObject): string[] {
  return PROPS.map((p) => p.key).filter((k) => (o.anim[k]?.length ?? 0) > 0)
}

export function allKeyTimes(o: SceneObject): number[] {
  const s = new Set<number>()
  for (const k of Object.values(o.anim)) for (const kf of k) s.add(Math.round(kf.t * 1000) / 1000)
  return [...s].sort((a, b) => a - b)
}

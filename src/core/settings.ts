import { useSyncExternalStore } from 'react'
import type { EasingKind } from './easing'

/** App preferences — per machine, not per project. */
export interface Prefs {
  /** which mouse button orbits the view; the other one pans */
  orbitButton: 'middle' | 'right'
  /** left-drag on empty space orbits too (object mode), handy on a touchpad */
  leftOrbit: boolean
  invertZoom: boolean
  /** viewport render scale */
  quality: 'low' | 'normal' | 'high'
  autosave: boolean
  autosaveMin: number
  /** easing given to newly made keys */
  defaultEase: EasingKind
  /** where the preview panel sits next to the 3D view */
  previewDock: 'right' | 'bottom'
  /** blender.exe, when it was not found on its own */
  blenderPath: string
}

export const DEFAULT_PREFS: Prefs = {
  orbitButton: 'middle', leftOrbit: false, invertZoom: false, quality: 'high',
  autosave: true, autosaveMin: 1, defaultEase: 'smooth', previewDock: 'right', blenderPath: '',
}

let prefs: Prefs = { ...DEFAULT_PREFS }
let ver = 0
const subs = new Set<() => void>()

export const getPrefs = () => prefs

export async function loadPrefs() {
  try {
    const saved = await window.odit.store.get<Partial<Prefs>>('prefs')
    if (saved) prefs = { ...DEFAULT_PREFS, ...saved }
  } catch { /* defaults */ }
  ver++
  for (const f of subs) f()
}

export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p }
  ver++
  for (const f of subs) f()
  window.odit.store.set('prefs', prefs).catch(() => {})
}

export const subscribePrefs = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }

export function usePrefs(): Prefs {
  useSyncExternalStore(subscribePrefs, () => ver)
  return prefs
}

import type * as THREE from 'three'
import type { GizmoMode } from '../core/store'
import type { SceneEngine } from '../engine/engine'

/** the live viewport, reachable from keyboard handlers elsewhere */
export const viewportApi: {
  frameSelected?: () => void
  view?: (dir: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom') => void
  startModal?: (m: GizmoMode, dir?: THREE.Vector3) => void
  mouse?: { x: number; y: number; inside: boolean }
  engine?: SceneEngine
  /** a G/R/S transform is following the mouse and owns the keyboard */
  modal?: boolean
} = {}

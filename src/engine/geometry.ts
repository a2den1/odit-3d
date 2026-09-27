import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import * as opentype from 'opentype.js'
import type { SceneObject } from '../core/types'
import { toGeometry } from './editmesh'

/* ------------------------------------------------------------------ font */

/* 3D text needs real glyph outlines. The system's Malgun Gothic Bold covers
   Hangul and Latin; it is parsed once and each string is turned into shapes
   on demand, which is far cheaper than converting the whole font up front. */
let font: opentype.Font | null = null
let fontLoading: Promise<void> | null = null
export let fontVersion = 0
const fontListeners = new Set<() => void>()
export const onFontReady = (fn: () => void) => { fontListeners.add(fn); return () => fontListeners.delete(fn) }

const FONT_PATHS = ['C:\\Windows\\Fonts\\malgunbd.ttf', 'C:\\Windows\\Fonts\\malgun.ttf']

export function ensureFont(): Promise<void> {
  if (font) return Promise.resolve()
  if (!fontLoading) {
    fontLoading = (async () => {
      for (const p of FONT_PATHS) {
        try {
          const buf = await (await fetch(window.odit.fs.url(p))).arrayBuffer()
          font = opentype.parse(buf)
          fontVersion++
          for (const f of fontListeners) f()
          return
        } catch { /* try the next one */ }
      }
    })()
  }
  return fontLoading
}

function textGeometry(text: string, size: number, depth: number, bevel: number): THREE.BufferGeometry {
  if (!font) { ensureFont(); return new THREE.BufferGeometry() }
  const lines = (text || ' ').split('\n')
  const shapes: THREE.Shape[] = []
  const unit = 100
  const k = size / unit
  lines.forEach((line, li) => {
    const p = font!.getPath(line, 0, li * unit * 1.25, unit)
    const sp = new THREE.ShapePath()
    for (const c of p.commands) {
      if (c.type === 'M') sp.moveTo(c.x * k, -c.y * k)
      else if (c.type === 'L') sp.lineTo(c.x * k, -c.y * k)
      else if (c.type === 'Q') sp.quadraticCurveTo(c.x1 * k, -c.y1 * k, c.x * k, -c.y * k)
      else if (c.type === 'C') sp.bezierCurveTo(c.x1 * k, -c.y1 * k, c.x2 * k, -c.y2 * k, c.x * k, -c.y * k)
    }
    shapes.push(...sp.toShapes())
  })
  const b = Math.min(bevel, size * 0.08)
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(depth, 0.0001), curveSegments: 6,
    bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 3,
  })
  g.computeBoundingBox()
  const bb = g.boundingBox!
  // sit on the floor, centred on the origin, facing the front
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
  return g
}

/* ------------------------------------------------------------- primitives */

export function primSignature(o: SceneObject): string {
  if (o.edit) return 'edit:' + o.edit.v + ':' + o.edit.pos.length + ':' + o.edit.idx.length
  if (!o.prim) return ''
  return JSON.stringify([o.prim.kind, o.prim.p, o.prim.text ?? '', o.prim.kind === 'text' ? fontVersion : 0])
}

export function buildGeometry(o: SceneObject): THREE.BufferGeometry {
  if (o.edit) return toGeometry(o.edit)
  const pr = o.prim!
  const p = pr.p
  const seg = Math.round(p.seg ?? 32)
  switch (pr.kind) {
    case 'cube': {
      const bevel = Math.min(p.bevel ?? 0, Math.min(p.w, p.h, p.d) / 2 - 1e-3)
      return bevel > 0.0005
        ? new RoundedBoxGeometry(p.w, p.h, p.d, 4, bevel)
        : new THREE.BoxGeometry(p.w, p.h, p.d)
    }
    case 'sphere': return new THREE.SphereGeometry(p.r, seg, Math.max(8, Math.round(seg * 0.66)))
    case 'icosphere': return new THREE.IcosahedronGeometry(p.r, Math.round(p.detail))
    case 'cylinder': return new THREE.CylinderGeometry(p.r, p.r, p.h, seg)
    case 'cone': return new THREE.ConeGeometry(p.r, p.h, seg)
    case 'pyramid': return new THREE.ConeGeometry(p.r, p.h, 4)
    case 'torus': return new THREE.TorusGeometry(p.r, p.tube, Math.max(8, Math.round(seg / 3)), seg)
    case 'knot': return new THREE.TorusKnotGeometry(p.r, p.tube, 160, 20, Math.round(p.p), Math.round(p.q))
    case 'capsule': return new THREE.CapsuleGeometry(p.r, p.h, 8, seg)
    case 'ring': {
      const g = new THREE.RingGeometry(Math.min(p.inner, p.r - 0.001), p.r, seg)
      g.rotateX(-Math.PI / 2)
      return g
    }
    case 'plane': {
      const g = new THREE.PlaneGeometry(p.w, p.d)
      g.rotateX(-Math.PI / 2)
      return g
    }
    case 'text': return textGeometry(pr.text ?? '', p.size, p.depth, p.bevel)
  }
}

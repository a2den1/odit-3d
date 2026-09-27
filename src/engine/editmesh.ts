import * as THREE from 'three'
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { EditMesh } from '../core/types'

/*
 * Editable meshes are stored as welded triangles: one position per corner
 * shared by every triangle that touches it, so moving a vertex moves every
 * face around it. "Faces" as the user sees them are groups of coplanar,
 * touching triangles — a cube side is one face, not two triangles.
 */

export function fromGeometry(g: THREE.BufferGeometry): EditMesh {
  const plain = new THREE.BufferGeometry()
  plain.setAttribute('position', g.getAttribute('position').clone())
  if (g.index) plain.setIndex(g.index.clone())
  const w = mergeVertices(plain, 1e-4)
  const pos = Array.from(w.getAttribute('position').array as Float32Array).map((v) => +v.toFixed(5))
  const idx = w.index ? Array.from(w.index.array) : pos.map((_, i) => i).slice(0, pos.length / 3)
  // drop degenerate triangles welding can leave behind (e.g. sphere poles)
  const out: number[] = []
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]]
    if (a !== b && b !== c && a !== c) out.push(a, b, c)
  }
  return compact({ pos, idx: out, v: 1 })
}

/** Geometry to draw: sharp above 35°, smooth below, like auto-smooth. */
export function toGeometry(m: EditMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3))
  g.setIndex(m.idx)
  if (!m.idx.length) return g
  const out = toCreasedNormals(g, (35 * Math.PI) / 180)
  g.dispose()
  boxUV(out)
  return out
}

/** simple box-projected UVs so an image map still lands on an edited mesh */
function boxUV(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal')
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    let u, v
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i) } else if (ay >= az) { u = p.getX(i); v = p.getZ(i) } else { u = p.getX(i); v = p.getY(i) }
    uv[i * 2] = u + 0.5; uv[i * 2 + 1] = v + 0.5
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

export const vcount = (m: EditMesh) => m.pos.length / 3
export const vget = (m: EditMesh, i: number) => new THREE.Vector3(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2])
export function vset(m: EditMesh, i: number, v: THREE.Vector3) {
  m.pos[i * 3] = +v.x.toFixed(5); m.pos[i * 3 + 1] = +v.y.toFixed(5); m.pos[i * 3 + 2] = +v.z.toFixed(5)
}

function triNormal(m: EditMesh, t: number) {
  const a = vget(m, m.idx[t * 3]), b = vget(m, m.idx[t * 3 + 1]), c = vget(m, m.idx[t * 3 + 2])
  return b.sub(a).cross(c.sub(a)).normalize()
}

const ek = (a: number, b: number) => (a < b ? a * 1048576 + b : b * 1048576 + a)

/** edge -> triangles that use it */
function edgeMap(m: EditMesh) {
  const map = new Map<number, number[]>()
  for (let t = 0; t < m.idx.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const key = ek(m.idx[t * 3 + k], m.idx[t * 3 + (k + 1) % 3])
      const l = map.get(key)
      if (l) l.push(t); else map.set(key, [t])
    }
  }
  return map
}

/** face groups: triangle -> group id, grouping coplanar neighbours */
export function faceGroups(m: EditMesh): { of: Int32Array; groups: number[][] } {
  const n = m.idx.length / 3
  const of = new Int32Array(n).fill(-1)
  const normals = Array.from({ length: n }, (_, t) => triNormal(m, t))
  const edges = edgeMap(m)
  const groups: number[][] = []
  for (let s = 0; s < n; s++) {
    if (of[s] >= 0) continue
    const g: number[] = []
    const id = groups.length
    const stack = [s]
    of[s] = id
    while (stack.length) {
      const t = stack.pop()!
      g.push(t)
      for (let k = 0; k < 3; k++) {
        for (const u of edges.get(ek(m.idx[t * 3 + k], m.idx[t * 3 + (k + 1) % 3])) ?? []) {
          if (of[u] < 0 && normals[u].dot(normals[s]) > 0.9995) { of[u] = id; stack.push(u) }
        }
      }
    }
    groups.push(g)
  }
  return { of, groups }
}

/** Visible edges only: the diagonal inside a flat quad is not drawn. */
export function visibleEdges(m: EditMesh): [number, number][] {
  const out: [number, number][] = []
  for (const [key, tris] of edgeMap(m)) {
    const a = Math.floor(key / 1048576), b = key % 1048576
    if (tris.length === 2 && triNormal(m, tris[0]).dot(triNormal(m, tris[1])) > 0.9995) continue
    out.push([a, b])
  }
  return out
}

export const selectedTris = (m: EditMesh, sel: Set<number>) => {
  const out: number[] = []
  for (let t = 0; t < m.idx.length / 3; t++) {
    if (sel.has(m.idx[t * 3]) && sel.has(m.idx[t * 3 + 1]) && sel.has(m.idx[t * 3 + 2])) out.push(t)
  }
  return out
}

/** remove vertices no triangle uses; returns old -> new index */
export function compact(m: EditMesh, keep?: Set<number>): EditMesh & { remap?: Int32Array } {
  const used = new Uint8Array(vcount(m))
  for (const i of m.idx) used[i] = 1
  if (keep) for (const i of keep) used[i] = 1
  const remap = new Int32Array(vcount(m)).fill(-1)
  const pos: number[] = []
  let n = 0
  for (let i = 0; i < used.length; i++) {
    if (!used[i]) continue
    remap[i] = n++
    pos.push(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2])
  }
  return { pos, idx: m.idx.map((i) => remap[i]), v: m.v, remap }
}

/* -------------------------------------------------------------- operations */

/**
 * Extrude the selected faces as one region: the region is lifted onto new
 * vertices and walls are built along its outline. Returns the new selection
 * and the region's average normal (the way it should be pulled).
 */
export function extrude(m: EditMesh, sel: Set<number>): { mesh: EditMesh; sel: number[]; normal: THREE.Vector3 } | null {
  const F = selectedTris(m, sel)
  if (!F.length) return null
  const inF = new Set(F)
  const normal = new THREE.Vector3()
  for (const t of F) normal.add(triNormal(m, t))
  normal.normalize()

  const pos = m.pos.slice()
  const dup = new Map<number, number>()
  const nv = (i: number) => {
    let j = dup.get(i)
    if (j === undefined) {
      j = pos.length / 3
      pos.push(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2])
      dup.set(i, j)
    }
    return j
  }
  // boundary: region edges used by exactly one region triangle, kept in that triangle's winding
  const count = new Map<number, number>()
  for (const t of F) for (let k = 0; k < 3; k++) {
    const key = ek(m.idx[t * 3 + k], m.idx[t * 3 + (k + 1) % 3])
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  const idx: number[] = []
  for (let t = 0; t < m.idx.length / 3; t++) if (!inF.has(t)) idx.push(m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2])
  for (const t of F) {
    const [a, b, c] = [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]]
    idx.push(nv(a), nv(b), nv(c))
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (count.get(ek(p, q)) !== 1) continue
      idx.push(p, q, nv(q), p, nv(q), nv(p))
    }
  }
  const res = compact({ pos, idx, v: m.v + 1 })
  const newSel = [...dup.values()].map((j) => res.remap![j]).filter((j) => j >= 0)
  return { mesh: { pos: res.pos, idx: res.idx, v: res.v }, sel: newSel, normal }
}

/** delete: in vertex mode every triangle touching a selected vertex goes, in face mode only whole faces */
export function remove(m: EditMesh, sel: Set<number>, mode: 'vert' | 'face'): EditMesh {
  const idx: number[] = []
  for (let t = 0; t < m.idx.length / 3; t++) {
    const tri = [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]]
    const hit = mode === 'vert' ? tri.some((i) => sel.has(i)) : tri.every((i) => sel.has(i))
    if (!hit) idx.push(...tri)
  }
  const r = compact({ pos: m.pos, idx, v: m.v + 1 })
  return { pos: r.pos, idx: r.idx, v: r.v }
}

/** merge the selection into one vertex at its centre */
export function merge(m: EditMesh, sel: Set<number>): { mesh: EditMesh; sel: number[] } | null {
  if (sel.size < 2) return null
  const list = [...sel]
  const c = new THREE.Vector3()
  for (const i of list) c.add(vget(m, i))
  c.multiplyScalar(1 / list.length)
  const keep = list[0]
  const pos = m.pos.slice()
  vset({ pos, idx: [], v: 0 }, keep, c)
  const idx: number[] = []
  for (let t = 0; t < m.idx.length / 3; t++) {
    const tri = [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]].map((i) => (sel.has(i) ? keep : i))
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) idx.push(...tri)
  }
  const r = compact({ pos, idx, v: m.v + 1 }, new Set([keep]))
  return { mesh: { pos: r.pos, idx: r.idx, v: r.v }, sel: [r.remap![keep]] }
}

/** Split each selected triangle into four (neighbours share the new edge points). */
export function subdivide(m: EditMesh, sel: Set<number>): { mesh: EditMesh; sel: number[] } | null {
  const F = new Set(selectedTris(m, sel))
  if (!F.size) return null
  const pos = m.pos.slice()
  const mids = new Map<number, number>()
  const mid = (a: number, b: number) => {
    const key = ek(a, b)
    let j = mids.get(key)
    if (j === undefined) {
      j = pos.length / 3
      pos.push((m.pos[a * 3] + m.pos[b * 3]) / 2, (m.pos[a * 3 + 1] + m.pos[b * 3 + 1]) / 2, (m.pos[a * 3 + 2] + m.pos[b * 3 + 2]) / 2)
      mids.set(key, j)
    }
    return j
  }
  for (const t of F) for (let k = 0; k < 3; k++) mid(m.idx[t * 3 + k], m.idx[t * 3 + (k + 1) % 3])
  const idx: number[] = []
  const newSel = new Set(sel)
  for (let t = 0; t < m.idx.length / 3; t++) {
    const [a, b, c] = [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]]
    const ab = mids.get(ek(a, b)), bc = mids.get(ek(b, c)), ca = mids.get(ek(c, a))
    if (F.has(t)) {
      idx.push(a, ab!, ca!, ab!, b, bc!, ca!, bc!, c, ab!, bc!, ca!)
      for (const x of [ab!, bc!, ca!]) newSel.add(x)
      continue
    }
    // a neighbour with a split edge is fanned so no crack opens
    const cut = [ab, bc, ca]
    const n = cut.filter((x) => x !== undefined).length
    if (n === 0) { idx.push(a, b, c); continue }
    const corners = [a, b, c]
    const poly: number[] = []
    for (let k = 0; k < 3; k++) { poly.push(corners[k]); if (cut[k] !== undefined) poly.push(cut[k]!) }
    // fan from a corner that is not a midpoint
    for (let k = 1; k < poly.length - 1; k++) idx.push(poly[0], poly[k], poly[k + 1])
  }
  return { mesh: { pos, idx, v: m.v + 1 }, sel: [...newSel] }
}

/** the stored triangle closest to a point in the mesh's own space */
export function nearestTri(m: EditMesh, p: THREE.Vector3): number {
  const tri = new THREE.Triangle(), q = new THREE.Vector3()
  let best = -1, bd = Infinity
  for (let t = 0; t < m.idx.length / 3; t++) {
    tri.set(vget(m, m.idx[t * 3]), vget(m, m.idx[t * 3 + 1]), vget(m, m.idx[t * 3 + 2]))
    const d = tri.closestPointToPoint(p, q).distanceToSquared(p)
    if (d < bd) { bd = d; best = t }
  }
  return best
}

// Geometry kit: accumulate primitives per material and merge them, so each building costs a
// handful of draw calls instead of dozens. UVs are rescaled to world metres for even texel density.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MAT, type MatKey } from './materials'

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()

function scaleBoxUV(g: THREE.BoxGeometry, w: number, h: number, d: number, tile: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute
  // faces: +x, -x, +y, -y, +z, -z  (4 verts each, no segments)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile)
    }
  }
}

export class Kit {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>()

  add(mat: MatKey, g: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) {
    _e.set(rot[0], rot[1], rot[2])
    _q.setFromEuler(_e)
    _m.compose(_p.set(...pos), _q, _s.set(...scale))
    let geo = g.index ? g.toNonIndexed() : g
    if (geo === g) geo = g.clone()
    g.dispose()
    geo.applyMatrix4(_m)
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2))
    }
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k)
    const list = this.parts.get(mat) ?? []
    list.push(geo)
    this.parts.set(mat, list)
    return this
  }

  /** Box whose base sits at y (pos[1] is the bottom), centred on x/z. */
  box(mat: MatKey, size: [number, number, number], pos: [number, number, number], rotY = 0, tile = 8) {
    const [w, h, d] = size
    const g = new THREE.BoxGeometry(w, h, d)
    scaleBoxUV(g, w, h, d, tile)
    return this.add(mat, g, [pos[0], pos[1] + h / 2, pos[2]], [0, rotY, 0])
  }

  /** Box with arbitrary rotation, centred at pos. */
  boxR(mat: MatKey, size: [number, number, number], pos: [number, number, number], rot: [number, number, number], tile = 8) {
    const [w, h, d] = size
    const g = new THREE.BoxGeometry(w, h, d)
    scaleBoxUV(g, w, h, d, tile)
    return this.add(mat, g, pos, rot)
  }

  cyl(mat: MatKey, rTop: number, rBot: number, h: number, pos: [number, number, number], seg = 16, rot: [number, number, number] = [0, 0, 0], open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open)
    const uv = g.attributes.uv as THREE.BufferAttribute
    const circ = Math.PI * 2 * Math.max(rTop, rBot)
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / 8, (uv.getY(i) * h) / 8)
    return this.add(mat, g, [pos[0], pos[1] + h / 2, pos[2]], rot)
  }

  /** Prism from a 2D outline (x,z) extruded upward by h. */
  prism(mat: MatKey, outline: [number, number][], h: number, pos: [number, number, number], bevel = 0) {
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 })
    g.rotateX(-Math.PI / 2)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8)
    return this.add(mat, g, pos)
  }

  /** Tapered block (frustum with rectangular cross-section). */
  taper(mat: MatKey, bottom: [number, number], top: [number, number], h: number, pos: [number, number, number], rotY = 0) {
    const g = new THREE.BoxGeometry(1, 1, 1)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const up = p.getY(i) > 0
      const [w, d] = up ? top : bottom
      p.setXYZ(i, p.getX(i) * w, (p.getY(i) + 0.5) * h, p.getZ(i) * d)
    }
    g.computeVertexNormals()
    scaleBoxUV(g, Math.max(bottom[0], top[0]), h, Math.max(bottom[1], top[1]), 8)
    return this.add(mat, g, pos, [0, rotY, 0])
  }

  sphere(mat: MatKey, r: number, pos: [number, number, number], seg = 20, hemi = false) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2), 0, Math.PI * 2, 0, hemi ? Math.PI / 2 : Math.PI)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * r * 6) / 8, (uv.getY(i) * r * 3) / 8)
    return this.add(mat, g, pos)
  }

  build(): { mat: MatKey; geometry: THREE.BufferGeometry }[] {
    const out: { mat: MatKey; geometry: THREE.BufferGeometry }[] = []
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false)
      list.forEach((g) => g.dispose())
      if (merged) {
        merged.computeBoundingSphere()
        out.push({ mat, geometry: merged })
      }
    }
    this.parts.clear()
    return out
  }
}

export function materialFor(k: MatKey) {
  return MAT[k]()
}

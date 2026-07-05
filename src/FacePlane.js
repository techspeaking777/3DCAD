/**
 * FacePlane.js  —  Phase 2 Step 3b
 *
 * Represents an arbitrary sketch plane aligned to a solid face.
 * Provides the same coordinate transforms as SketchPlane.js but
 * for any orientation in 3D space.
 *
 * A FacePlane is defined by:
 *   origin  — THREE.Vector3  point on the face (centroid)
 *   normal  — THREE.Vector3  face outward normal (unit)
 *   uAxis   — THREE.Vector3  local X axis (right in sketch, unit)
 *   vAxis   — THREE.Vector3  local Y axis (up in sketch, unit)
 *
 * Sketch space convention: Y-down (matches 2D canvas), so:
 *   sketch.x = dot(worldPoint - origin, uAxis)
 *   sketch.y = -dot(worldPoint - origin, vAxis)   ← negative for Y-down
 */

import * as THREE from 'three'

export class FacePlane {
  constructor(origin, normal, uAxis, vAxis) {
    this.id     = 'face'          // distinguishes from 'XY'|'XZ'|'YZ'
    this.origin = origin.clone()
    this.normal = normal.clone().normalize()
    this.uAxis  = uAxis.clone().normalize()
    this.vAxis  = vAxis.clone().normalize()
    // THREE.Plane for raycasting
    this.threePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.normal, this.origin)
  }

  /** 3D world Vector3 → 2D sketch {x,y} */
  worldToSketch(worldPt) {
    const rel = new THREE.Vector3().subVectors(worldPt, this.origin)
    return {
      x:  rel.dot(this.uAxis),
      y: -rel.dot(this.vAxis),  // Y-down
    }
  }

  /** 2D sketch {x,y} → 3D world Vector3 */
  sketchToWorld(sx, sy) {
    return new THREE.Vector3()
      .copy(this.origin)
      .addScaledVector(this.uAxis,  sx)
      .addScaledVector(this.vAxis, -sy)  // Y-down → negate
  }

  /** Camera position for looking straight at this face */
  getCameraView(distance=600) {
    // Camera sits along the normal, looking at the face origin
    const pos = new THREE.Vector3()
      .copy(this.origin)
      .addScaledVector(this.normal, distance)

    // Camera "up" = vAxis (the "up" direction on the face surface)
    // But if vAxis is nearly parallel to the normal (degenerate), use worldUp
    let up = this.vAxis.clone()
    if (Math.abs(up.dot(this.normal)) > 0.9) {
      up = new THREE.Vector3(0, 1, 0)
    }

    return {
      position: pos,
      target:   this.origin.clone(),
      up,
    }
  }
}

/**
 * Build a FacePlane from a THREE.js raycaster intersection result.
 * @param {THREE.Intersection} hit  — result from raycaster.intersectObjects()
 * @returns {FacePlane|null}
 */
export function faceHitToPlane(hit) {
  if (!hit?.face) return null

  // Face normal in world space
  const normal = hit.face.normal.clone()
    .transformDirection(hit.object.matrixWorld)
    .normalize()

  // Ensure normal points TOWARD the camera (outward from solid)
  const rayDir = hit.ray ? hit.ray.direction.clone() : new THREE.Vector3(0,0,-1)
  if (normal.dot(rayDir) > 0) normal.negate()

  // Find all coplanar vertices (same normal) and compute their centroid
  // as the face plane origin — so {0,0} in sketch space = face centre
  const geo = hit.object.geometry
  const pos = geo?.attributes?.position
  const norms = geo?.attributes?.normal

  let origin
  if (pos && norms) {
    const idx = geo.index
    const count = idx ? idx.count : pos.count
    let sumX=0, sumY=0, sumZ=0, n=0

    for (let i=0; i<count; i+=3) {
      const a = idx ? idx.getX(i) : i
      // Check this triangle's vertex normal against the hit face normal
      const vn = new THREE.Vector3(norms.getX(a),norms.getY(a),norms.getZ(a))
        .transformDirection(hit.object.matrixWorld).normalize()
      if (vn.dot(normal) > 0.999) {
        for (const vi of [a, idx?idx.getX(i+1):i+1, idx?idx.getX(i+2):i+2]) {
          const wp = new THREE.Vector3(pos.getX(vi),pos.getY(vi),pos.getZ(vi))
            .applyMatrix4(hit.object.matrixWorld)
          sumX+=wp.x; sumY+=wp.y; sumZ+=wp.z; n++
        }
      }
    }
    origin = n > 0
      ? new THREE.Vector3(sumX/n, sumY/n, sumZ/n)
      : hit.point.clone()
  } else {
    origin = hit.point.clone()
  }

  // Nudge slightly outward so sketch sits on surface, not inside solid
  origin.addScaledVector(normal, 0.5)

  // Build orthonormal basis
  const worldUp = Math.abs(normal.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0)

  const uAxis = new THREE.Vector3()
    .crossVectors(worldUp, normal)
    .normalize()

  const vAxis = new THREE.Vector3()
    .crossVectors(normal, uAxis)
    .normalize()

  const plane = new FacePlane(origin, normal, uAxis, vAxis)
  try {
    plane.refSegments = extractFaceBoundarySegments(hit, plane)
  } catch (err) {
    // Snap-to-edge is a best-effort bonus — never let it break face sketching/extruding.
    console.warn('extractFaceBoundarySegments failed:', err)
    plane.refSegments = []
  }
  return plane
}

/**
 * Extracts the boundary edge(s) of the coplanar face region hit by raycasting, in the
 * given FacePlane's sketch-space coordinates. Lets sketch tools snap onto the existing
 * solid's own edges/corners (endpoint/midpoint/online snap) when sketching on its face,
 * not just onto other sketch geometry.
 *
 * Returns an array of {x1,y1,x2,y2} segments (one closed loop, or more if the face has
 * an interior hole). Works by finding all triangles sharing the hit face's normal AND
 * plane, then keeping only edges that appear exactly once in that triangle set — an
 * edge shared by two adjacent coplanar triangles is interior, one used by only a single
 * triangle is on the boundary.
 */
function extractFaceBoundarySegments(hit, facePlane, epsilon=0.05) {
  const geo = hit.object.geometry
  const pos = geo?.attributes?.position
  const norms = geo?.attributes?.normal
  if (!pos || !norms) return []

  const mat = hit.object.matrixWorld
  const idx = geo.index
  const count = idx ? idx.count : pos.count

  const vAt = i => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mat)
  const nAt = i => new THREE.Vector3(norms.getX(i), norms.getY(i), norms.getZ(i)).transformDirection(mat).normalize()
  const keyOf = p => `${Math.round(p.x*100)}_${Math.round(p.y*100)}_${Math.round(p.z*100)}`

  // facePlane.threePlane sits on the NUDGED origin (offset 0.5 units off the surface
  // so sketches don't clip into the solid) — comparing actual mesh vertices against it
  // would put every vertex ~0.5 off-plane. Build a plane from the raw (unnudged) hit
  // point instead, purely for the coplanarity test below.
  const rawPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(facePlane.normal, hit.point)

  const edges = new Map()   // "keyA|keyB" (sorted) → { count, a, b }
  for (let i=0; i<count; i+=3) {
    const ia = idx ? idx.getX(i)   : i
    const ib = idx ? idx.getX(i+1) : i+1
    const ic = idx ? idx.getX(i+2) : i+2
    if (nAt(ia).dot(facePlane.normal) < 0.999) continue
    const va=vAt(ia), vb=vAt(ib), vc=vAt(ic)
    if (Math.abs(rawPlane.distanceToPoint(va)) > epsilon) continue

    ;[[va,vb],[vb,vc],[vc,va]].forEach(([p1,p2]) => {
      const k1=keyOf(p1), k2=keyOf(p2)
      if (k1===k2) return
      const key = k1<k2 ? `${k1}|${k2}` : `${k2}|${k1}`
      const existing = edges.get(key)
      if (existing) existing.count++
      else edges.set(key, { count:1, a:p1, b:p2 })
    })
  }

  const boundary = [...edges.values()].filter(e => e.count===1)
  // Sanity cap — a real face's boundary is a handful of edges. If something
  // unexpected produced way more, bail rather than risk a slow O(n^2) chain-up.
  if (!boundary.length || boundary.length > 500) return []

  // Chain boundary edges into ordered loop(s) by shared endpoints
  const used = new Array(boundary.length).fill(false)
  const loops = []
  for (let i=0; i<boundary.length; i++) {
    if (used[i]) continue
    used[i] = true
    const loop = [boundary[i].a, boundary[i].b]
    let extended = true
    while (extended) {
      extended = false
      const tailKey = keyOf(loop[loop.length-1])
      for (let j=0; j<boundary.length; j++) {
        if (used[j]) continue
        const {a,b} = boundary[j]
        if (keyOf(a)===tailKey) { loop.push(b); used[j]=true; extended=true; break }
        if (keyOf(b)===tailKey) { loop.push(a); used[j]=true; extended=true; break }
      }
    }
    loops.push(loop)
  }

  const segments = []
  loops.forEach(loop => {
    for (let i=0; i<loop.length-1; i++) {
      const p1 = facePlane.worldToSketch(loop[i])
      const p2 = facePlane.worldToSketch(loop[i+1])
      segments.push({ x1:p1.x, y1:p1.y, x2:p2.x, y2:p2.y })
    }
    const first=loop[0], last=loop[loop.length-1]
    if (keyOf(first)!==keyOf(last)) {
      const p1 = facePlane.worldToSketch(last)
      const p2 = facePlane.worldToSketch(first)
      segments.push({ x1:p1.x, y1:p1.y, x2:p2.x, y2:p2.y })
    }
  })
  return segments
}

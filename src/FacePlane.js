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

    // Camera "up" = vAxis — MUST match the sketch's own vertical axis, or the
    // rendered 3D view and the 2D sketch overlay drawn on top of it disagree
    // about which way is "up" (tried decoupling this once to fix a tilted
    // camera on wide-in-Y end-cap faces; that broke the far more important
    // invariant that camera and sketch always agree, causing a 90° mismatch
    // instead). If vAxis is nearly parallel to the normal (degenerate), fall
    // back to world up.
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
export function faceHitToPlane(hit, overrideEdge = null) {
  if (!hit?.face) return null

  // Face normal in world space
  const normal = hit.face.normal.clone()
    .transformDirection(hit.object.matrixWorld)
    .normalize()

  // Ensure normal points TOWARD the camera (outward from solid)
  const rayDir = hit.ray ? hit.ray.direction.clone() : new THREE.Vector3(0,0,-1)
  if (normal.dot(rayDir) > 0) normal.negate()

  // Find all coplanar vertices (same normal AND same plane) — used for the
  // centroid (origin). Checking the normal alone isn't enough once a solid
  // has more than one region facing the same direction at different
  // positions — e.g. after Join, a boss's flat top cap shares the base's
  // upward normal but sits at a different height, all within ONE merged
  // mesh/geometry buffer (pre-join they're separate objects, so a raycast
  // hit's geometry only ever contained the one clicked face's own data —
  // this bug was latent until Join made hit.object.geometry span multiple
  // solids). Without the plane-distance check below, clicking the base's
  // top would silently average in the boss's top-cap vertices too, pulling
  // the sketch origin toward the boss instead of the clicked face. Same
  // rawPlane/epsilon check extractFaceBoundaryLoops3D already uses.
  const geo = hit.object.geometry
  const pos = geo?.attributes?.position
  const norms = geo?.attributes?.normal
  const originPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point)
  const COPLANAR_EPS = 0.05

  const coplanarVerts = []
  if (pos && norms) {
    const idx = geo.index
    const count = idx ? idx.count : pos.count
    for (let i=0; i<count; i+=3) {
      const a = idx ? idx.getX(i) : i
      // Check this triangle's vertex normal against the hit face normal
      const vn = new THREE.Vector3(norms.getX(a),norms.getY(a),norms.getZ(a))
        .transformDirection(hit.object.matrixWorld).normalize()
      if (vn.dot(normal) > 0.999) {
        const va = new THREE.Vector3(pos.getX(a),pos.getY(a),pos.getZ(a)).applyMatrix4(hit.object.matrixWorld)
        if (Math.abs(originPlane.distanceToPoint(va)) > COPLANAR_EPS) continue
        for (const vi of [a, idx?idx.getX(i+1):i+1, idx?idx.getX(i+2):i+2]) {
          coplanarVerts.push(
            new THREE.Vector3(pos.getX(vi),pos.getY(vi),pos.getZ(vi)).applyMatrix4(hit.object.matrixWorld)
          )
        }
      }
    }
  }

  const origin = coplanarVerts.length > 0
    ? coplanarVerts.reduce((s,v)=>s.add(v), new THREE.Vector3()).multiplyScalar(1/coplanarVerts.length)
    : hit.point.clone()

  // Nudge slightly outward so sketch sits on surface, not inside solid
  origin.addScaledVector(normal, 0.5)

  // Orient the sketch from the CLICKED edge, not a geometric guess. Four
  // rounds of "derive up/horizontal from face proportions alone" (Gram-Schmidt
  // against a preferred world axis, then measuring extent to pick the wide
  // dimension as horizontal, then anchoring vAxis's sign, then trying to
  // decouple the camera from it) each fixed one case while breaking another —
  // there's no purely geometric answer to "which way is up" for an arbitrary
  // face. Instead: whichever boundary edge of the face is nearest the actual
  // click point becomes the sketch's bottom/horizontal reference (the same
  // disambiguation Solid Edge and similar tools use) — deterministic and
  // user-controlled instead of another heuristic. `overrideEdge` lets the
  // caller substitute a Tab-cycled edge instead (see Viewport3D.jsx's
  // cycleFaceBottomEdge) — same {a,b} shape nearestBoundarySegment returns.
  const boundaryLoops = extractFaceBoundaryLoops3D(hit, normal)
  const nearest = overrideEdge || nearestBoundarySegment(boundaryLoops, hit.point)

  let uAxis, vAxis
  if (nearest) {
    uAxis = nearest.b.clone().sub(nearest.a).normalize()
    vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize()
    // "Up" should mean "away from the clicked edge, into the face" — check
    // vAxis points from the edge's midpoint toward the face centroid; if not,
    // flip BOTH axes together (preserves vAxis = normal × uAxis, since
    // negating both leaves the cross product's sign unchanged, and keeps
    // whichever direction was chosen as horizontal).
    const mid = nearest.a.clone().add(nearest.b).multiplyScalar(0.5)
    if (vAxis.dot(origin.clone().sub(mid)) < 0) {
      uAxis.negate()
      vAxis.negate()
    }
  } else {
    // Fallback for the rare case no boundary was found at all (degenerate
    // mesh) — a reasonable default so face-sketching never hard-fails.
    const refAxis = Math.abs(normal.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 0, 1)
    uAxis = refAxis.clone().addScaledVector(normal, -refAxis.dot(normal)).normalize()
    vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize()
  }

  const plane = new FacePlane(origin, normal, uAxis, vAxis)
  try {
    plane.refSegments = loopsToSketchSegments(boundaryLoops, plane)
  } catch (err) {
    // Snap-to-edge is a best-effort bonus — never let it break face sketching/extruding.
    console.warn('loopsToSketchSegments failed:', err)
    plane.refSegments = []
  }
  return plane
}

/**
 * Live hover preview (before a click commits it): given a raycast hit
 * `{object, point}` against a solid face and that face's world-space normal,
 * returns the boundary edge nearest the hit point — the same edge
 * `faceHitToPlane` would pick as the sketch's bottom/horizontal reference if
 * this face were clicked right now. Returns {a, b} (world-space Vector3
 * endpoints) or null. Doesn't need `hit.face`/`hit.ray` — just the mesh and
 * the current hover point — so callers can reuse a normal they've already
 * computed themselves (e.g. Viewport3D's per-frame face-hover highlight).
 */
export function previewBottomEdge(hit, normal) {
  return nearestBoundarySegment(extractFaceBoundaryLoops3D(hit, normal), hit.point)
}

/**
 * Flat, ordered list of a face's boundary edges as {a,b} world-space Vector3
 * pairs (all loops concatenated, each including its closing segment) — used
 * to Tab-cycle the bottom-edge preview through every candidate edge instead
 * of only following the cursor. Same {hit, normal} inputs as previewBottomEdge.
 */
export function faceBoundarySegments(hit, normal) {
  const loops = extractFaceBoundaryLoops3D(hit, normal)
  const segments = []
  for (const loop of loops) {
    for (let i = 0; i < loop.length - 1; i++) segments.push({ a: loop[i], b: loop[i+1] })
    const first = loop[0], last = loop[loop.length-1]
    if (keyOf3D(first) !== keyOf3D(last)) segments.push({ a: last, b: first })
  }
  return segments
}

/** Closest point on segment a→b to point p, in 3D. Returns {point, distSq}. */
function closestPointOnSegment3D(p, a, b) {
  const ab = b.clone().sub(a)
  const lenSq = ab.lengthSq()
  const t = lenSq < 1e-12 ? 0 : THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1)
  const point = a.clone().addScaledVector(ab, t)
  return { point, distSq: point.distanceToSquared(p) }
}

// Rounded-coordinate identity key — matches loopsToSketchSegments' own
// convention for "is this loop already closed" (comparing Vector3 object
// references directly would almost never match, since chained points are
// separate instances even when numerically coincident).
const keyOf3D = p => `${Math.round(p.x*100)}_${Math.round(p.y*100)}_${Math.round(p.z*100)}`

/** Finds the boundary segment (across all loops) nearest to `point`. Returns {a, b} or null. */
function nearestBoundarySegment(loops, point) {
  let best = null, bestDistSq = Infinity
  for (const loop of loops) {
    for (let i = 0; i < loop.length - 1; i++) {
      const { distSq } = closestPointOnSegment3D(point, loop[i], loop[i+1])
      if (distSq < bestDistSq) { bestDistSq = distSq; best = { a: loop[i], b: loop[i+1] } }
    }
    // Closing segment (last point back to first), same convention loopsToSketchSegments uses.
    const first = loop[0], last = loop[loop.length-1]
    if (keyOf3D(first) !== keyOf3D(last)) {
      const { distSq } = closestPointOnSegment3D(point, last, first)
      if (distSq < bestDistSq) { bestDistSq = distSq; best = { a: last, b: first } }
    }
  }
  return best
}

/**
 * Extracts the boundary loop(s) of the coplanar face region hit by raycasting, as raw
 * 3D THREE.Vector3 point chains (one per loop — more than one if the face has an
 * interior hole). No FacePlane needed — this only depends on the face's normal, so it
 * can run BEFORE a FacePlane's own axes are chosen (faceHitToPlane uses the result to
 * choose them, from the click-nearest edge; loopsToSketchSegments below converts the
 * same loops to sketch space afterward, for the snap-to-edge reference lines).
 *
 * Works by finding all triangles sharing the hit face's normal AND plane, then keeping
 * only edges that appear exactly once in that triangle set — an edge shared by two
 * adjacent coplanar triangles is interior, one used by only a single triangle is on
 * the boundary.
 */
function extractFaceBoundaryLoops3D(hit, normal, epsilon=0.05) {
  const geo = hit.object.geometry
  const pos = geo?.attributes?.position
  const norms = geo?.attributes?.normal
  if (!pos || !norms) return []

  const mat = hit.object.matrixWorld
  const idx = geo.index
  const count = idx ? idx.count : pos.count

  const vAt = i => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mat)
  const nAt = i => new THREE.Vector3(norms.getX(i), norms.getY(i), norms.getZ(i)).transformDirection(mat).normalize()
  const keyOf = keyOf3D

  // Raw (un-nudged) plane through the actual hit point, purely for the coplanarity test.
  const rawPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point)

  const edges = new Map()   // "keyA|keyB" (sorted) → { count, a, b }
  for (let i=0; i<count; i+=3) {
    const ia = idx ? idx.getX(i)   : i
    const ib = idx ? idx.getX(i+1) : i+1
    const ic = idx ? idx.getX(i+2) : i+2
    if (nAt(ia).dot(normal) < 0.999) continue
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
  return loops
}

/** Converts raw 3D boundary loops (from extractFaceBoundaryLoops3D) to sketch-space {x1,y1,x2,y2} segments. */
function loopsToSketchSegments(loops, facePlane) {
  const keyOf = keyOf3D
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

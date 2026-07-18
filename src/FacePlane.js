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
  // A perfectly (or near-perfectly) round face — e.g. a cylinder's flat end
  // cap — has no boundary edge that's genuinely "nearest" the click: every
  // one of the tessellated micro-segments around the circle is roughly
  // equidistant from a click anywhere near the face's centre, so
  // nearestBoundarySegment's choice degenerates into whichever segment wins
  // by sub-pixel floating-point margin — effectively an arbitrary rotation
  // of the sketch's u/v axes that has nothing to do with where the user
  // actually clicked. Skip the edge search for this case and fall through
  // to the same deterministic Gram-Schmidt basis used when no boundary is
  // found at all — every rotation looks identical on a circular face
  // anyway, so there's no meaningful "wrong" choice to disambiguate here,
  // just a need for it to be STABLE from click to click. An explicit
  // overrideEdge (Tab-cycled) still wins — that's a deliberate user choice.
  const allLoopsRound = !overrideEdge && boundaryLoops.length > 0 && boundaryLoops.every(loop => loopIsRound(loop))
  const nearest = !allLoopsRound && (overrideEdge || nearestBoundarySegment(boundaryLoops, hit.point))

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
  // Reference geometry is a best-effort bonus (snap targets + the dashed
  // outline + Include From Face) — never let a failure here break face
  // sketching/extruding itself. Each loop becomes exactly one of: a whole
  // circle (refCircles), or a mix of collapsed straight runs (refSegments)
  // and detected arcs (refArcs) — see segmentLoopIntoPrimitives.
  plane.refSegments = []
  plane.refCircles = []
  plane.refArcs = []
  for (const loop of boundaryLoops) {
    try {
      const circle = fitCircleIfRound(loop, plane)
      if (circle) { plane.refCircles.push(circle); continue }
      const { lines, arcs } = segmentLoopIntoPrimitives(loop, plane)
      plane.refSegments.push(...lines)
      plane.refArcs.push(...arcs)
    } catch (err) {
      console.warn('face reference-geometry classification failed for one loop:', err)
    }
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

// Orientation-independent roundness test — works directly on raw 3D loop
// points (all coplanar, since a loop always bounds one flat face region),
// unlike fitCircleIfRound below which needs a FacePlane's own uAxis/vAxis
// already chosen. Used by faceHitToPlane to detect "this face has no
// meaningful edge to orient from" BEFORE picking uAxis/vAxis, not after.
function loopIsRound(loop, tolerance = 0.03) {
  if (loop.length < 5) return false
  const centroid = loop.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / loop.length)
  const dists = loop.map(p => centroid.distanceTo(p))
  const avgR = dists.reduce((a, b) => a + b, 0) / dists.length
  if (avgR < 1e-6) return false
  return dists.every(d => Math.abs(d - avgR) / avgR <= tolerance)
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

// Classifies a boundary loop as circular if every point sits within
// `tolerance` (relative to the fitted radius) of a common centroid — true
// for a tessellated OCC circular edge (a many-sided regular polygon), false
// for a real straight-edged N-gon face (whose vertex-to-centroid distances
// vary far more than that).
//
// minPoints is low (5) because this app's render/reference mesh is
// tessellated coarsely — cadWorker.js's shape.mesh() uses angularTolerance:
// 30°, so a real circular edge produces as few as ~6 boundary segments, not
// the dozens a finer mesh would give. That means this test genuinely cannot
// distinguish a coarsely-tessellated circle from a real, perfectly regular
// hand-drawn hexagon of the same segment count — both have vertices
// equidistant from their centroid by definition. Biased toward catching
// every circle (the common case: bosses, holes, shafts) at the cost of an
// occasional false-positive center snap on a deliberately regular polygon
// face (rare, and a harmless extra snap point even when it happens).
// Centroid + average-radius circle fit — no tolerance check, just the raw
// fit. Only valid for a point set with reasonably full, symmetric coverage
// around the true circle (errors average out) — that's true for a WHOLE
// closed boundary loop (fitCircleIfRound, below), but badly wrong for a
// small local arc segment covering just a slice of the circle (the centroid
// of a few clustered points isn't anywhere near the true center) — use
// fitCircleLeastSquares for that case instead (segmentLoopIntoPrimitives,
// fitArcToRun).
function fitCircleCentroid(pts) {
  const cx = pts.reduce((s,p)=>s+p.x,0) / pts.length
  const cy = pts.reduce((s,p)=>s+p.y,0) / pts.length
  const dists = pts.map(p => Math.hypot(p.x-cx, p.y-cy))
  const r = dists.reduce((s,d)=>s+d,0) / dists.length
  return { cx, cy, r, dists }
}

// Proper least-squares circle fit (Kåsa method — linear least squares on
// x²+y² = D·x + E·y + F, closed-form via a 3x3 normal-equation solve), used
// wherever a small/local point set needs an accurate center — unlike
// fitCircleCentroid's plain average, this is correct even for just 3-4
// points covering a small arc slice. Returns null if the points are
// (near-)colinear (no unique circle).
function fitCircleLeastSquares(pts) {
  const n = pts.length
  let sx=0, sy=0, sxx=0, syy=0, sxy=0, sxz=0, syz=0, sz=0
  for (const p of pts) {
    const z = p.x*p.x + p.y*p.y
    sx+=p.x; sy+=p.y; sxx+=p.x*p.x; syy+=p.y*p.y; sxy+=p.x*p.y
    sxz+=p.x*z; syz+=p.y*z; sz+=z
  }
  const A = [[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]]
  const B = [sxz,syz,sz]
  const det3 = m => m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
  const D0 = det3(A)
  if (Math.abs(D0) < 1e-9) return null
  const replaceCol = col => A.map((row,i) => row.map((v,j) => j===col ? B[i] : v))
  const D = det3(replaceCol(0)) / D0
  const E = det3(replaceCol(1)) / D0
  const F = det3(replaceCol(2)) / D0
  const cx = D/2, cy = E/2
  const r2 = F + cx*cx + cy*cy
  if (!(r2 > 0)) return null
  return { cx, cy, r: Math.sqrt(r2) }
}

function fitCircleIfRound(loop, facePlane, tolerance = 0.03, minPoints = 5) {
  if (loop.length < minPoints) return null
  const pts = loop.map(p => facePlane.worldToSketch(p))
  const { cx, cy, r, dists } = fitCircleCentroid(pts)
  if (dists.some(d => Math.abs(d-r)/r > tolerance)) return null
  return { cx, cy, r }
}

// Perpendicular distance from p to the infinite line through a,b (0 if a,b
// coincide, falling back to plain distance-to-point).
function distToLine(p, a, b) {
  const len = Math.hypot(b.x-a.x, b.y-a.y)
  if (len < 1e-9) return Math.hypot(p.x-a.x, p.y-a.y)
  return Math.abs((b.x-a.x)*(a.y-p.y) - (a.x-p.x)*(b.y-a.y)) / len
}

// Splits a boundary loop into straight `lines` and circular `arcs` in
// sketch space, for a loop that ISN'T one whole circle (fitCircleIfRound
// already covers that) but isn't pure straight lines either — e.g. a slot
// or rounded-rectangle face.
//
// Walks the loop incrementally, growing a "current run" of points and
// testing each NEW point against the run's actual geometric fit (distance
// to the run's line, or distance to its fitted circle) rather than
// comparing local turning angles between neighboring vertices. An earlier
// version tried turning-angle comparison and broke on the very case this
// function exists for: a tangent-continuous line-to-arc transition (e.g. a
// slot's straight side meeting its rounded end) has an inherent "half-step"
// turning angle right at the seam — a discretized chord's direction always
// differs from the true continuous tangent by about half one segment's
// angle, no matter how fine the tessellation — so comparing raw angle
// values at that vertex reliably misclassifies it. Testing actual
// point-to-fit distance instead sidesteps that: a seam point measures as a
// near-perfect fit to BOTH its neighboring line and its neighboring circle
// (it's genuinely on both), so whichever run reaches it first correctly
// absorbs it as a shared boundary point.
//
// A 3-point circle always technically exists unless the points are exactly
// colinear, so telling a real tessellated arc segment from one sharp
// polygon corner (checked first as its own 3-point "circle") needs a
// second signal beyond "some circle fits": maxStepAngle rejects a
// candidate circle whose points are spread too far apart angularly to be a
// real coarse-tessellated curve at this app's mesh density (a handful of
// degrees per segment — see fitCircleIfRound's tessellation comment) — a
// rectangle's 90° corner fails this immediately, while even a fairly
// tight-radius real fillet's few-degree steps pass easily.
function segmentLoopIntoPrimitives(loop, facePlane, opts = {}) {
  const { lineTol = 0.05, radiusTol = 0.04, maxStepAngle = 0.45, minArcPoints = 4 } = opts
  const raw = loop.map(p => facePlane.worldToSketch(p))
  // Drop a duplicated closing point (loop already returns to its start) so
  // every entry below is a distinct vertex; the loop still closes
  // implicitly from the last point back to the first.
  const pts = raw.length > 1 && Math.hypot(raw[raw.length-1].x-raw[0].x, raw[raw.length-1].y-raw[0].y) < 1e-6
    ? raw.slice(0, -1) : raw
  const n = pts.length
  if (n < 3) return { lines: [], arcs: [] }

  const angleSpan = (fit, ptsIn) => {
    const angles = ptsIn.map(p => Math.atan2(p.y-fit.cy, p.x-fit.cx))
    let min = Math.min(...angles), max = Math.max(...angles)
    // Two ways around a circle — use whichever span is smaller.
    return Math.min(max - min, Math.PI*2 - (max - min))
  }

  const tryExtend = run => {
    const p = run._next
    if (run.pts.length < 2) return true   // always accept the 2nd point — mode still undetermined
    if (run.mode === null) {
      // Deciding 3rd point: colinear with the first two -> line. Otherwise,
      // only accept as the start of an arc if the resulting 3-point circle's
      // angular spread per step is small enough to be a real curve, not a
      // sharp corner (see function comment).
      const [a, b] = run.pts
      // Scale to the incremental step (b -> p), not the a-b span — see the
      // matching comment on the already-in-'line'-mode branch below (at this
      // point a-b IS the only step so far, but the same "don't let a long
      // first edge loosen the tolerance" reasoning still applies once this
      // decision generalizes to a run whose first edge is itself long).
      const stepLen = Math.max(1, Math.hypot(p.x-b.x, p.y-b.y))
      if (distToLine(p, a, b) < lineTol * stepLen) { run.mode = 'line'; return true }
      const fit = fitCircleLeastSquares([a, b, p])
      // A near-but-not-quite-colinear 3-point set (just failed the colinear
      // check above) fits a huge, nearly-degenerate circle whose angular
      // span LOOKS small enough to pass the maxStepAngle test on its own —
      // reject that by also requiring the fitted radius stay within a sane
      // multiple of the points' own spread. A genuine small arc's radius is
      // comparable to its chord length (a handful of times at most), not
      // 15-20x+ larger.
      // Scale to the newest increment only (b -> p) — NOT the a-b span, which
      // can be long-established and unrelated to whether a curve is
      // starting right now (same "stay local" principle as stepLen above).
      const sane = fit && fit.r > 1e-6 && fit.r < 15 * stepLen
      if (sane && angleSpan(fit, [a, b, p]) / 2 < maxStepAngle) { run.mode = 'arc'; return true }
      // Neither colinear nor a sane arc start — p doesn't belong with [a,b] at
      // all (e.g. p is actually the first point of a new curve on the far
      // side of a tangent seam). Reject rather than defaulting to 'line': the
      // caller then closes the run at just [a,b] and reseeds a new run at
      // [b,p], so p gets a fair, undecided re-evaluation next step instead of
      // being force-absorbed into a straight edge it doesn't lie on.
      return false
    }
    if (run.mode === 'line') {
      // Test against the run's start-to-end line, but scale the tolerance to
      // the INCREMENTAL step (last point -> new point), not the run's total
      // accumulated length — a tolerance relative to total length keeps
      // growing looser as a long straight run extends, which would happily
      // absorb the first several points of a real curve (a gentle,
      // large-radius arc's early deviation is small relative to a long
      // straight run's overall span, even though it's clearly too much
      // relative to how far the polyline actually moved in this one step).
      const a = run.pts[0], b = run.pts[run.pts.length-1]
      const stepLen = Math.max(1, Math.hypot(p.x-b.x, p.y-b.y))
      return distToLine(p, a, b) < lineTol * stepLen
    }
    // mode === 'arc'
    const fit = fitCircleLeastSquares(run.pts)
    if (!fit || !(fit.r > 1e-6)) return false
    const d = Math.hypot(p.x-fit.cx, p.y-fit.cy)
    return Math.abs(d - fit.r) / fit.r < radiusTol
  }

  const runs = []
  let cur = { mode: null, pts: [pts[0]] }
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n]
    cur._next = p
    if (tryExtend(cur)) {
      cur.pts.push(p)
    } else {
      delete cur._next
      runs.push(cur)
      cur = { mode: null, pts: [cur.pts[cur.pts.length-1], p] }
    }
  }
  delete cur._next
  runs.push(cur)

  // Merge wraparound: the walk's first and last run may really be one run
  // split by the arbitrary starting vertex — only when they ended up the
  // same mode (an unresolved seam between genuinely different features,
  // e.g. line-mode meeting arc-mode, is a real boundary, not a split).
  if (runs.length > 1) {
    const f = runs[0], l = runs[runs.length-1]
    if (f.mode && f.mode === l.mode) {
      f.pts = [...l.pts.slice(0, -1), ...f.pts]   // shared point at the seam, don't duplicate
      runs.pop()
    } else if (l.mode === null && l.pts.length === 2 && f.mode) {
      // The trailing run is a 2-point fragment that never got a fair
      // classification — the walk started arbitrarily mid-way through what
      // is now `f`, so `f`'s true starting point may actually be `l`'s first
      // point (l.pts[0]), rejected only because it was tested against the
      // wrong neighbor (l.pts[1], not f's own run) right as the walk ran out
      // of iterations. Test whether it belongs prepended to `f` using f's
      // own established mode, same fit tests tryExtend uses.
      const extra = l.pts[0]
      const fits = f.mode === 'line'
        ? distToLine(extra, f.pts[0], f.pts[f.pts.length-1]) < lineTol * Math.max(1, Math.hypot(extra.x-f.pts[0].x, extra.y-f.pts[0].y))
        : (() => {
            const fit = fitCircleLeastSquares(f.pts)
            if (!fit || !(fit.r > 1e-6)) return false
            const d = Math.hypot(extra.x-fit.cx, extra.y-fit.cy)
            return Math.abs(d - fit.r) / fit.r < radiusTol
          })()
      if (fits) {
        f.pts = [extra, ...f.pts]
        runs.pop()
      }
    }
  }

  const lines = [], arcs = []
  for (const run of runs) {
    if (run.pts.length < 2) continue
    if (run.mode === 'arc' && run.pts.length >= minArcPoints) {
      const arc = fitArcToRun(run.pts)
      if (arc) { arcs.push(arc); continue }
    }
    // Straight run, or an arc-candidate too short to trust (realistic for a
    // small-radius fillet under this app's coarse mesh) — emit as one line
    // spanning the run, collapsing any interior points.
    const a = run.pts[0], b = run.pts[run.pts.length-1]
    if (Math.hypot(b.x-a.x, b.y-a.y) > 1e-6) lines.push({ x1:a.x, y1:a.y, x2:b.x, y2:b.y })
  }
  return { lines, arcs }
}

// Fits a circle to a run of consecutive arc points (already established as
// one consistent curve by segmentLoopIntoPrimitives) and returns
// {cx,cy,r,startAngle,endAngle}, using the run's OWN middle point to
// disambiguate sweep direction — the same "pick a third point to resolve
// which way the arc actually goes" approach emitArc/threePointsArcTo
// already use elsewhere in this codebase for the identical start/end
// ambiguity a bare pair of endpoint angles can't resolve on its own.
function fitArcToRun(runPts) {
  const fit = fitCircleLeastSquares(runPts)
  if (!fit || !(fit.r > 1e-6)) return null
  const { cx, cy, r } = fit
  const angleOf = p => Math.atan2(p.y-cy, p.x-cx)
  const a0 = angleOf(runPts[0])
  const a1raw = angleOf(runPts[runPts.length-1])
  const aMid = angleOf(runPts[Math.floor(runPts.length/2)])
  let e1 = a1raw; while (e1 < a0) e1 += Math.PI*2
  let em = aMid; while (em < a0) em += Math.PI*2
  if (em <= e1) return { cx, cy, r, startAngle: a0, endAngle: e1 }
  // Midpoint isn't on the a0->e1 sweep — the arc actually goes the other way around.
  let e0 = a0; while (e0 < a1raw) e0 += Math.PI*2
  return { cx, cy, r, startAngle: a1raw, endAngle: e0 }
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

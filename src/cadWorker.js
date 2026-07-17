import opencascade from 'replicad-opencascadejs/src/replicad_single.js'
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import { setOC, Sketcher, Plane, makePlane, sketchCircle, getOC, cast, localGC, FaceFinder, Vector } from 'replicad'

const SCALE = 2
// Tolerance (mm) for matching a picked screen point to the actual OCC edge —
// generous enough for mesh-tessellation slop, tight enough to avoid grabbing
// a neighboring edge. Shared by the fillet3d handler and STL export's fallback replay.
const EDGE_PICK_TOL = 0.75
// Fuzzy tolerance (mm) for boolean fuse — a face-sketched boss meant to sit
// flush on another solid's face can end up a hair's-width off (0.01-0.5mm)
// due to floating-point round-tripping through the sketch's mm<->px
// conversions. Plain BRepAlgoAPI_Fuse treats that as "not touching" and
// silently returns a Compound of two still-separate bodies instead of one
// merged Solid — SetFuzzyValue tells OCC to treat gaps within this tolerance
// as coincident, same intent as buildExtrude's cut-side OVH protrusion.
const FUSE_FUZZY_TOL = 0.5

// Fuse two shapes with a fuzzy tolerance so near-coincident (but not exactly
// touching) faces still merge into one Solid instead of silently degrading to
// a Compound of two disjoint bodies — see FUSE_FUZZY_TOL above.
function fuseTolerant(a, b) {
  const [r, gc] = localGC()
  const oc = getOC()
  const progress = r(new oc.Message_ProgressRange_1())
  const op = r(new oc.BRepAlgoAPI_Fuse_3(a.wrapped, b.wrapped, progress))
  op.SetFuzzyValue(FUSE_FUZZY_TOL)
  op.Build(progress)
  op.SimplifyResult(true, true, 1e-3)
  const result = cast(op.Shape())
  gc()
  return result
}

let ocReady = false
async function initOC() {
  const OC = await opencascade({ locateFile: () => opencascadeWasm })
  setOC(OC)
  ocReady = true
  self.postMessage({ type:'ready' })
}
initOC().catch(err =>
  self.postMessage({ type:'error', id:null, message:`OCC: ${err.message}` })
)

// Stateful shape store — keyed by solidId so cutouts can subtract directly
const shapeStore = new Map()

self.onmessage = async function(e) {
  if (!ocReady) {
    self.postMessage({ type:'error', id:e.data.id, message:'OCC not ready' })
    return
  }
  const { type, id, params } = e.data
  try {
    if (type==='exportSTL') {
      // Each entry in params.solids is one top-level solid (its cutouts/fillets
      // already baked in). Prefer the shapeStore's current cached shape (fast,
      // and reflects the live state exactly); rebuild from base+ops only if
      // the cache doesn't have it — e.g. after a fresh load with no edits yet.
      const shapes = params.solids.map(({ solidId, base, ops }) => {
        let shape = shapeStore.get(solidId)
        if (!shape) {
          shape = buildBase(base)
          for (const op of ops) {
            if (op.type === 'fillet') {
              shape = shape.fillet(op.radius, e => e.either(
                op.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
              ))
            } else {
              const cut = op.params
              shape = shape.cut(cut.axis ? buildRevolve(cut) : buildExtrude({ ...cut, isCut: true }))
            }
          }
        }
        return shape
      })
      if (shapes.length === 0) throw new Error('No solids to export')
      let fused = shapes[0]
      for (let i = 1; i < shapes.length; i++) fused = fuseTolerant(fused, shapes[i])
      // Same tolerances used for the on-screen render mesh elsewhere in this
      // file, so the printed geometry matches what was previewed.
      const blob = fused.blobSTL({ tolerance:0.05, angularTolerance:30, binary: true })
      self.postMessage({ type:'result', id, stlBlob: blob })
      return
    }

    if (type==='exportFaceDXF') {
      // Reads the picked face's REAL OCC topology (outerWire + every
      // innerWire/hole) instead of reconstructing geometry from the
      // tessellated render mesh — exact curves, and holes come along for
      // free since OCC already separates them from the outer boundary
      // (unlike the render-mesh-based "Include From Face" tool, which has to
      // reverse-engineer circles/arcs from boundary-edge chains and can miss
      // internal loops).
      let base = shapeStore.get(params.solidId)
      if (!base) {
        if (!params.base) throw new Error('exportFaceDXF-MISS: base not in store and no fallback params')
        base = buildBase(params.base)
      }
      const face = new FaceFinder().withinDistance(EDGE_PICK_TOL, params.point).find(base, { unique: true })
      const normal = face.normalAt()
      // Stable local (u,v) frame for a flat projection — Gram-Schmidt a world
      // axis against the normal. No "which edge is bottom" concern the way
      // FacePlane.js's sketch-orientation logic has (see faceHitToPlane's own
      // fallback branch, same technique) — a flat DXF export just needs ANY
      // consistent frame, not a user-meaningful orientation.
      const refAxis = Math.abs(normal.x) < 0.9 ? new Vector([1, 0, 0]) : new Vector([0, 0, 1])
      const uAxis = refAxis.sub(normal.multiply(refAxis.dot(normal))).normalize()
      const vAxis = normal.cross(uAxis).normalize()
      const origin = face.center
      const project = v => { const rel = v.sub(origin); return { x: rel.dot(uAxis), y: rel.dot(vAxis) } }

      const lines = [], circles = [], arcs = []
      // face.outerWire()/innerWires() each DELETE their receiver as a side
      // effect (replicad's "consuming" idiom — see Face.outerWire()/
      // innerWires() in replicad.js), so calling both directly on the same
      // `face` would use-after-delete on the second call. Clone for the
      // outer-wire call so the original `face` survives for innerWires().
      const wires = [face.clone().outerWire(), ...face.innerWires()]
      for (const wire of wires) {
        for (const edge of wire.edges) {
          if (edge.geomType === 'CIRCLE') {
            // No convenience center/radius getter on Edge/Curve — drop to the
            // raw OCC circle adaptor, same "replicad doesn't cover this, use
            // .wrapped directly" pattern already used throughout this file.
            const circ = edge.curve.wrapped.Circle()
            const loc = circ.Location()
            const center = project(new Vector([loc.X(), loc.Y(), loc.Z()]))
            const r = circ.Radius()
            if (edge.isClosed) {
              circles.push({ cx: center.x, cy: center.y, r })
            } else {
              const sp = project(edge.startPoint), ep = project(edge.endPoint)
              arcs.push({
                cx: center.x, cy: center.y, r,
                startAngle: Math.atan2(sp.y - center.y, sp.x - center.x),
                endAngle:   Math.atan2(ep.y - center.y, ep.x - center.x),
              })
            }
          } else {
            // Any other curve type (LINE, or an unexpected BEZIER/BSPLINE
            // edge) — a straight chord between endpoints is a reasonable
            // fallback for DXF export.
            const sp = project(edge.startPoint), ep = project(edge.endPoint)
            lines.push({ x1: sp.x, y1: sp.y, x2: ep.x, y2: ep.y })
          }
        }
      }
      self.postMessage({ type:'result', id, dxfData: { lines, circles, arcs } })
      return
    }

    let shape
    if (type==='extrude'||type==='cutout') {
      shape = buildExtrude(params)
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='revolve') {
      shape = buildRevolve(params)
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='loft') {
      shape = buildLoft(params)
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='fillet3d') {
      // Edge-pick fillet: applies to whatever this solid currently looks like
      // (shapeStore holds cuts/prior fillets already baked in). edgePoints is
      // an array of [x,y,z] mm points, each near a picked edge — replicad's
      // EdgeFinder does the real edge lookup, we just need to be close enough
      // (see EDGE_PICK_TOL). One edge is just a 1-element array — same path,
      // no separate single-edge code needed.
      let base = shapeStore.get(params.solidId)
      if (!base) {
        if (!params.base) throw new Error(`Fillet-MISS: base not in store and no fallback params`)
        console.warn('[cadWorker] shapeStore miss — rebuilding base from params')
        base = buildBase(params.base)
      }
      try {
        shape = base.fillet(params.radius, e => e.either(
          params.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
        ))
      } catch(e) {
        throw new Error(`Fillet failed: ${e.message}`)
      }
      shapeStore.set(params.solidId, shape)
    } else if (type==='subtract') {
      let base = shapeStore.get(params.baseSolidId)
      const fromStore = !!base
      if (!base) {
        if (!params.base) throw new Error(`Step1-MISS: base not in store and no fallback params`)
        console.warn('[cadWorker] shapeStore miss — rebuilding base from params')
        try { base = buildBase(params.base) }
        catch(e) { throw new Error(`Step1-BASE: ${e.message} | planeId=${params.base.planeId} dir=${params.base.direction}`) }
      }
      let cutShape
      try {
        // A revolve-cutout's params carry `axis` (no depthMm/direction) — build
        // a solid of revolution to subtract instead of a linear prism. Plain
        // cuts: App3D sets depthMm=10000+direction='both' for through-all, or
        // user values for blind cut; isCut=true adds 1mm protrusion on the
        // entry side to avoid coincident-face OCC failures.
        cutShape = params.cut.axis
          ? buildRevolve(params.cut)
          : buildExtrude({ ...params.cut, isCut: true })
      } catch(e) {
        throw new Error(`Step2-CUT: ${e.message} | planeId=${params.cut.planeId} facePlane=${!!params.cut.normal} store=${fromStore}`)
      }
      try {
        shape = base.cut(cutShape)
      } catch(e) {
        throw new Error(`Step3-BOOL: ${e.message} | store=${fromStore}`)
      }
      shapeStore.set(params.baseSolidId, shape)
    } else if (type==='mirrorShape') {
      // Mirroring a whole solid across a plane is this app's first
      // cross-solid dependency (a mirror-solid depends on its SOURCE solid's
      // current shape) — nothing guarantees shapeStore[sourceSolidId] is
      // fresh at rebuild time (fresh page load, or a dependent-mirror
      // rebuild that didn't just touch the source), so always cold-rebuild
      // the source's full chain from params rather than trusting the cache —
      // the same safety fallback buildBase already provides on a fillet3d/
      // subtract cache MISS, just made unconditional here since there's no
      // "hot path" to prefer in the first place.
      let base = buildBase(params.base)
      for (const op of params.ops || []) {
        if (op.type === 'fillet') {
          base = base.fillet(op.radius, e => e.either(
            op.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
          ))
        } else {
          base = base.cut(op.params.axis ? buildRevolve(op.params) : buildExtrude({ ...op.params, isCut: true }))
        }
      }
      // Work-plane mirror: pass the PlaneName string directly — replicad's
      // mirror() accepts 'XY'/'XZ'/'YZ' natively, and this app's work planes
      // always pass through the world origin (see WorkPlanes.js), so no
      // origin override is needed. Face mirror: build a real Plane the same
      // way buildProfilePlane's own planeId==='face' branch does.
      const mirrorPlane = params.plane.kind === 'face'
        ? new Plane(params.plane.origin, params.plane.uAxis, params.plane.normal)
        : params.plane.planeId
      shape = base.mirror(mirrorPlane)
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='joinShapes') {
      // Boolean-union several existing solids into one. Unlike mirrorShape,
      // trusting shapeStore here is safe rather than a shortcut: every member
      // is a currently-rendered, up-to-date solid at the moment of joining
      // (members can't be edited while locked/joined — see App3D.jsx — so
      // there's no "went stale after the fact" case to guard against). Same
      // shapeStore-or-cold-rebuild-from-params fallback exportSTL already
      // uses for its own multi-solid fuse, reused here per member.
      const shapes = params.members.map(m => {
        let s = shapeStore.get(m.solidId)
        if (!s) {
          s = buildBase(m.base)
          for (const op of m.ops || []) {
            if (op.type === 'fillet') {
              s = s.fillet(op.radius, e => e.either(
                op.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
              ))
            } else {
              s = s.cut(op.params.axis ? buildRevolve(op.params) : buildExtrude({ ...op.params, isCut: true }))
            }
          }
        }
        return s
      })
      if (shapes.length < 2) throw new Error('Need at least 2 shapes to join')
      shape = shapes.reduce((a, b) => fuseTolerant(a, b))
      // A fuse can come back wrapped in a Compound container even when it
      // DID successfully weld into one continuous body — cast() only looks
      // at the outer shape type, not whether it holds one Solid or several.
      // Count the actual TopoDS_SOLID sub-shapes: >1 means the members are
      // still genuinely disjoint (didn't touch/overlap even within
      // FUSE_FUZZY_TOL) and were just bundled together, not welded — surface
      // that clearly instead of silently handing back a "join" that would
      // look merged in the feature tree but never actually weld (e.g. a
      // later fillet across the "seam" would apply to one member's edge in
      // isolation and visibly not blend into the other body).
      const solidCount = [...shape._iterTopo('solid')].length
      if (solidCount > 1) {
        throw new Error('The selected bodies don’t touch or overlap — move them so they intersect or share a face before joining.')
      }
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else {
      throw new Error(`Unknown: ${type}`)
    }
    if (!shape) throw new Error('Null shape')
    const faces = shape.mesh({ tolerance:0.05, angularTolerance:30 })
    const edges = shape.meshEdges({ keepMesh:true })
    self.postMessage({ type:'result', id, faces, edges })
  } catch(err) {
    self.postMessage({ type:'error', id, message:err.message||String(err) })
  }
}

function toRep(pts) {
  return pts.map(p => [p.x/SCALE, -p.y/SCALE])
}

// Drop consecutive (and wrap-around) near-duplicate points before handing a
// profile to the Sketcher. Font-glyph outlines (bezier-sampled at a fixed
// segment count) can produce a curve endpoint that lands almost exactly on
// the next straight-line command's point — OCC then sees a near-zero-length
// edge and throws an opaque native exception with no useful message. This is
// generic defensive cleanup, not text-specific — any point-array profile
// benefits from it.
function dedupeRep(rep, epsilon=0.005) {
  const out = [rep[0]]
  for (let i = 1; i < rep.length; i++) {
    const [x,y] = rep[i]
    const [px,py] = out[out.length-1]
    if (Math.hypot(x-px, y-py) > epsilon) out.push(rep[i])
  }
  if (out.length > 2) {
    const [x0,y0] = out[0]
    const [xl,yl] = out[out.length-1]
    if (Math.hypot(xl-x0, yl-y0) < epsilon) out.pop()
  }
  return out
}

/**
 * Build profile at a signed offset along the plane normal.
 * Uses new Sketcher(planeId, offset) — same API that makes symmetric work.
 *
 * offset > 0  → plane is shifted in +normal direction (front side)
 * offset < 0  → plane is shifted in -normal direction (back side)
 * offset = 0  → plane at world origin (standard position)
 */
// Builds (and returns, un-deleted) the Plane a profile sits on — factored out
// of makeProfile so revolve's axis-line conversion can reuse the EXACT same
// plane (via .toWorldCoords()) that the profile itself was built on, keeping
// the axis perfectly aligned with the sketch regardless of plane/face/offset.
function buildProfilePlane(planeId, offsetMm, normal, origin, uAxis) {
  if (typeof planeId !== 'string') {
    throw new Error(`buildProfilePlane: planeId must be a string, got ${JSON.stringify(planeId)} (${typeof planeId})`)
  }
  if (planeId === 'face' && normal && origin) {
    const off = [
      origin[0] + (normal[0]||0)*offsetMm,
      origin[1] + (normal[1]||0)*offsetMm,
      origin[2] + (normal[2]||0)*offsetMm,
    ]
    // Plane(origin, xDirection, normal) — replicad 0.23 API; plain objects not accepted
    return new Plane(off, uAxis, normal)
  }
  // new Sketcher(planeString, offset) internally just calls makePlane(plane, origin)
  // anyway — building it explicitly here is equivalent and lets other callers share it.
  return makePlane(planeId || 'XY', offsetMm)
}

// pt (sketch px, Y-down) → plane-local mm (Y-up) — same convention as toRep().
function toMm(p) { return [p.x/SCALE, -p.y/SCALE] }

// Converts a Catmull-Rom control-point sequence into a list of cubic Bezier
// segments ({start, end, cp1, cp2}, sketch-px units) — an EXACT conversion,
// not an approximation: Catmull-Rom is a special case of cubic Hermite
// interpolation with tangent T_i = (P_{i+1}-P_{i-1})/2 at each point, and the
// standard Hermite→Bezier control points are P_i + T_i/3, P_{i+1} - T_{i+1}/3.
// Mirrors the neighbor-extension convention splineMath.js's sampleSpline uses
// for open vs. closed curves (kept self-contained here rather than imported —
// this worker already duplicates small constants like SCALE rather than
// cross-importing from src/tools/*, avoiding any risk of pulling that
// module's own dependency chain into the worker's bundle).
function catmullRomToBezierSegments(pts, closed) {
  const n = pts.length
  if (n < 2) return []
  const ext = closed
    ? [pts[n-1], ...pts, pts[0], pts[1]]
    : [pts[0],   ...pts, pts[n-1]]
  const segCount = closed ? n : n - 1
  const segments = []
  for (let i = 0; i < segCount; i++) {
    const p0 = ext[i], p1 = ext[i+1], p2 = ext[i+2], p3 = ext[i+3]
    const t1 = { x: (p2.x-p0.x)/2, y: (p2.y-p0.y)/2 }
    const t2 = { x: (p3.x-p1.x)/2, y: (p3.y-p1.y)/2 }
    segments.push({
      start: p1, end: p2,
      cp1: { x: p1.x + t1.x/3, y: p1.y + t1.y/3 },
      cp2: { x: p2.x - t2.x/3, y: p2.y - t2.y/3 },
    })
  }
  return segments
}

// Emits one real curve — a chain of cubic Beziers reproducing the original
// hand-drawn spline exactly (see catmullRomToBezierSegments) — onto a
// Sketcher already positioned at controlPoints[0].
function emitBezierChain(sketcher, controlPoints) {
  for (const { start, end, cp1, cp2 } of catmullRomToBezierSegments(controlPoints, false)) {
    // Degenerate guard: two control points placed on top of each other would
    // produce a near-zero-length edge OCC can choke on — same defensive
    // spirit as dedupeRep. 0.01px ≈ dedupeRep's 0.005mm epsilon (×SCALE).
    if (Math.hypot(end.x-start.x, end.y-start.y) < 0.01) sketcher.lineTo(toMm(end))
    else sketcher.cubicBezierCurveTo(toMm(end), toMm(cp1), toMm(cp2))
  }
}

// Emits one real circular-arc edge onto a Sketcher already positioned at the
// arc's start point, using replicad's three-point arc (start is implicit —
// wherever the sketcher's pointer already is — end + a point on the arc
// unambiguously define the same sweep direction the polygon-sampling
// profile-detection code walked).
function emitArc(sketcher, seg) {
  const midAngle = (seg.startAngle + seg.endAngle) / 2
  const endPt = { x: seg.cx + Math.cos(seg.endAngle)*seg.r, y: seg.cy + Math.sin(seg.endAngle)*seg.r }
  const midPt = { x: seg.cx + Math.cos(midAngle)*seg.r,     y: seg.cy + Math.sin(midAngle)*seg.r }
  sketcher.threePointsArcTo(toMm(endPt), toMm(midPt))
}

// Mixed profile: walks `pts` by index, switching between straight .lineTo()
// calls and real curve commands (spline/arc) wherever a curveSegments entry
// says so — see detectProfiles() in extrudeMath.js for how these get
// attached. `i` jumps forward by a segment's `count` after emitting its
// curve, skipping the now-redundant polygon-sampled points for that span.
function buildMixedProfile(sketcher, pts, curveSegments) {
  const segs = [...curveSegments].sort((a,b)=>a.startIdx-b.startIdx)
  const n = pts.length
  sketcher.movePointerTo(toMm(pts[0]))
  let i = 0, segPtr = 0
  while (i < n) {
    const seg = (segPtr < segs.length && segs[segPtr].startIdx === i) ? segs[segPtr] : null
    if (seg) {
      if (seg.type === 'spline') emitBezierChain(sketcher, seg.controlPoints)
      else if (seg.type === 'arc') emitArc(sketcher, seg)
      i = seg.startIdx + seg.count
      segPtr++
    } else {
      i++
      if (i < n) sketcher.lineTo(toMm(pts[i]))
    }
  }
  return sketcher.close()
}

function makeProfile(pts, planeId, offsetMm, normal, origin, uAxis, circle=null) {
  if (circle) {
    // True circular curve — a plain circle/hole should have 2 rim edges + 1 seam,
    // not the ~60 straight facets the point-sampled polygon path below produces.
    // pts (the polygon approximation) still gets sent alongside `circle` for
    // preview/profile-detection code that just wants points; only the actual
    // solid-building path here needs the real curve.
    const plane = buildProfilePlane(planeId, offsetMm, normal, origin, uAxis)
    // Sketch-space (px, Y-down) → plane-local mm (Y-up) — same convention as toRep().
    const cx = circle.cx / SCALE
    const cy = -circle.cy / SCALE
    const centered = plane.translate(plane.xDir.multiply(cx).add(plane.yDir.multiply(cy)))
    plane.delete()
    const sketch = sketchCircle(circle.r / SCALE, { plane: centered })
    centered.delete()
    return sketch
  }

  const plane = buildProfilePlane(planeId, offsetMm, normal, origin, uAxis)
  const sketcher = new Sketcher(plane)
  plane.delete()

  // Real curve segments (splines/arcs — see detectProfiles in extrudeMath.js)
  // build a mixed sketch of straight lines + real curves; everything else
  // (plain line/arc-only profiles) keeps the exact original polygon path.
  if (pts.curveSegments && pts.curveSegments.length > 0) {
    return buildMixedProfile(sketcher, pts, pts.curveSegments)
  }

  const rep = dedupeRep(toRep(pts))
  sketcher.movePointerTo(rep[0])
  for (let i=1; i<rep.length; i++) sketcher.lineTo(rep[i])
  return sketcher.close()
}

/**
 * Revolve a 2D profile around an axis (drawn as a line within the SAME sketch
 * plane, via the sketch environment's "Axis" tool) to build a solid of
 * revolution. angleDeg defaults to 360 for a full solid; a smaller value
 * produces a partial "pie slice" revolve.
 */
function buildRevolve({ pts, planeId, normal, origin, uAxis, circle=null, axis, angleDeg=360, reverse=false }) {
  // offsetMm=0 — unlike extrude, revolve has no depth/direction offset to
  // apply; the profile sketches exactly at the plane it was drawn on.
  const plane = buildProfilePlane(planeId, 0, normal, origin, uAxis)
  const sketch = makeProfile(pts, planeId, 0, normal, origin, uAxis, circle)

  // Axis endpoints are 2D points in the SAME sketch plane as the profile —
  // convert to world space via the plane's own coordinate transform so the
  // revolution axis lines up exactly with where the user drew it.
  const p1 = plane.toWorldCoords([axis.x1/SCALE, -axis.y1/SCALE])
  const p2 = plane.toWorldCoords([axis.x2/SCALE, -axis.y2/SCALE])
  const axisOrigin = [p1.x, p1.y, p1.z]
  let axisDir = [p2.x-p1.x, p2.y-p1.y, p2.z-p1.z]
  plane.delete()

  // CW/CCW toggle: the sweep direction follows the right-hand rule around the
  // axis vector, so reversing it flips which way the profile sweeps. OCC's
  // revolve angle is expected to stay positive, so we flip the vector rather
  // than negate the angle (not guaranteed to behave the same in the native API).
  if (reverse) axisDir = [-axisDir[0], -axisDir[1], -axisDir[2]]

  return sketch.revolve(axisDir, { origin: axisOrigin, angle: angleDeg })
}

/**
 * Loft a solid through 2+ profiles sketched on parallel planes sharing the
 * same normal/uAxis — only the offset along the normal differs between them
 * (App3D.jsx enforces this: every loft profile is built from one shared
 * basis + a per-profile offsetMm, see buildLoftFacePlane). Each profile is
 * built via the SAME makeProfile() extrude/revolve already use (handles
 * true circles, mixed line/arc/spline curves, and plain polygons
 * identically).
 *
 * Built as N-1 PAIRWISE loftWith() calls (profile 1→2, 2→3, ...) fused
 * together, rather than one loftWith() call across every profile at once.
 * With 3+ profiles, a single all-at-once ThruSections call lets OCC's
 * solver decide how to blend across every section together, which gets
 * increasingly unpredictable/uncontrollable the more profiles you add —
 * exactly the complaint that motivated this change. Segmenting means each
 * individual loft only ever has to blend between exactly two profiles (the
 * same reasoning that made "Include From Face" chaining segments by hand
 * useful — see that feature — just done automatically here). Each
 * segment's shared boundary is the literal same profile data on both
 * sides, so fusing them back together with fuseTolerant (same helper
 * joinShapes uses) is a full-face-coincident union, one of the more robust
 * cases for OCC's boolean fuse rather than a risky one. For exactly 2
 * profiles this reduces to one segment and no fuse call — byte-identical
 * to the single-loftWith()-call behavior this replaces.
 *
 * Known trade-off: positions match exactly at each segment join (they
 * share a real boundary), but the surface's tangent/slope isn't
 * guaranteed to match there — a possible subtle kink at intermediate
 * profiles that a single continuous loft wouldn't have. Not addressed
 * here; flagged as acceptable given the alternative (the old unpredictable
 * all-at-once blend) was the actual problem being solved.
 *
 * ruled=false (smooth blend) is the default; ruled=true gives a faceted
 * transition within each segment instead — passed through unchanged to
 * every pairwise loftWith() call.
 */
function buildLoft({ profiles, normal, origin, uAxis, ruled=false }) {
  if (!profiles || profiles.length < 2) throw new Error('Loft needs at least 2 profiles')
  // A fresh Sketch per (segment, side) rather than one Sketch array reused
  // across segments — every middle profile participates in TWO loftWith()
  // calls (end of one segment, start of the next), and Sketch.loftWith()
  // consumes/invalidates its own wire internally, so sharing one Sketch
  // instance across two calls throws "This object has been deleted" on the
  // second use. Rebuilding is cheap (makeProfile is pure geometry, no OCC
  // solve) and keeps every loftWith() call working with an object nobody
  // else has touched.
  const buildSketch = p => makeProfile(p.pts, 'face', p.offsetMm, normal, origin, uAxis, p.circle)
  const segments = []
  for (let i = 0; i < profiles.length - 1; i++) {
    segments.push(buildSketch(profiles[i]).loftWith([buildSketch(profiles[i + 1])], { ruled }))
  }
  return segments.length === 1 ? segments[0] : segments.reduce((a, b) => fuseTolerant(a, b))
}

function buildExtrude({ pts, depthMm, planeId, direction='both',
                        normal, origin, uAxis, vAxis, isCut=false, circle=null }) {
  if (!circle && (!pts||pts.length<3)) throw new Error('Need ≥3 pts')
  const half = depthMm / 2
  // 1mm protrusion on the entry face prevents OCC coincident-face Boolean failures
  const OVH = isCut ? 1 : 0

  if (direction === 'front') {
    if (planeId === 'face' && isCut) {
      // Replicad face plane normal points OUTWARD; 'front' cut means INWARD.
      // Put profile depthMm inside the solid and extrude outward through the face + OVH.
      return makeProfile(pts, planeId, -depthMm, normal, origin, uAxis, circle).extrude(depthMm + OVH)
    }
    // Work plane, or a regular (non-cut) extrude off a face: profile sits right at the
    // face/plane and grows outward by depthMm. Applying the cutout's "profile inside,
    // extrude back out to the face" math here for a plain extrude would build the new
    // solid entirely inside the existing one — geometrically valid but invisible.
    return makeProfile(pts, planeId, -OVH, normal, origin, uAxis, circle).extrude(depthMm + OVH)
  }

  if (direction === 'back') {
    // Profile stays at depth; extend extrude by OVH so exit face clears the solid boundary.
    return makeProfile(pts, planeId, -depthMm, normal, origin, uAxis, circle).extrude(depthMm + OVH)
  }

  // 'both': sketch at -half, extrude +depth → symmetric around sketch plane (no coincident face)
  return makeProfile(pts, planeId, -half, normal, origin, uAxis, circle).extrude(depthMm)
}

// Rebuilds a solid's OWN base shape (no cuts/fillets applied) from its stored
// params — used whenever the worker's shapeStore doesn't have a solid cached
// (e.g. right after a fresh page load). `profiles` (array) means Loft;
// `axis` means Revolve, not a linear extrude — same discriminators already
// used everywhere else a base gets cold-rebuilt (cuts, fillets, STL export,
// Join member fallback), so Loft slots into all of them for free.
function buildBase(params) {
  if (params.profiles) return buildLoft(params)
  return params.axis ? buildRevolve(params) : buildExtrude(params)
}


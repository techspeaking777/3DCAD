import opencascade from 'replicad-opencascadejs/src/replicad_single.js'
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import { setOC, Sketcher, Plane, makePlane, sketchCircle, sketchHelix, getOC, cast, localGC, FaceFinder, Vector, importSTEP } from 'replicad'

const SCALE = 2
// Tolerance (mm) for matching a picked screen point to the actual OCC edge —
// generous enough for mesh-tessellation slop, tight enough to avoid grabbing
// a neighboring edge. Shared by the fillet3d handler and STL export's fallback replay.
const EDGE_PICK_TOL = 0.75
// Shared by every "replay a fillet/chamfer op onto a cold-rebuilt base"
// site (STL/STEP export's fallback rebuild, mirrorShape, joinShapes,
// transformShape) — same edge-matching filter either operation call
// accepts, just picking which OCC call to make based on the op's own
// `operation` field (defaults to 'fillet' for ops saved before chamfer
// support existed).
function applyFilletOrChamfer(shape, op) {
  const edgeFilter = e => e.either(op.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt)))
  return op.operation === 'chamfer' ? shape.chamfer(op.radius, edgeFilter) : shape.fillet(op.radius, edgeFilter)
}
// Shell — hollows a solid, removing whichever faces were picked (by
// proximity, same EDGE_PICK_TOL idiom as the fillet filter above).
// replicad's own shell() negates thickness internally to hollow inward, so
// a 'outward' op flips the sign here to thicken outward instead.
function applyShell(shape, op) {
  const faceFilter = f => f.either(op.facePoints.map(pt => g => g.withinDistance(EDGE_PICK_TOL, pt)))
  const signedThickness = op.direction === 'outward' ? -op.thickness : op.thickness
  return shape.shell(signedThickness, faceFilter)
}
// Fuzzy tolerance (mm) for boolean fuse — a face-sketched boss meant to sit
// flush on another solid's face can end up a hair's-width off due to
// floating-point round-tripping through the sketch's mm<->px conversions.
// Plain BRepAlgoAPI_Fuse treats that as "not touching" and silently returns
// a Compound of two still-separate bodies instead of one merged Solid —
// SetFuzzyValue tells OCC to treat gaps within this tolerance as coincident,
// same intent as buildExtrude's cut-side OVH protrusion.
// Was 0.5 — comfortably covers rounding noise, but also silently swallowed
// any intentionally-thin wall/gap at that scale: a cutout sketched to leave
// a precise 0.5mm web of material would get treated as flush with the real
// edge instead, corrupting the cut into a degenerate sliver rather than
// preserving the thin wall. 0.05 is still 5x the low end of the original
// "0.01-0.5mm" round-off estimate this was sized against, so it should still
// absorb genuine floating-point/round-tripping noise — it just no longer
// treats a deliberately-designed sub-0.5mm feature as noise too.
const FUSE_FUZZY_TOL = 0.05

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

// Shared by exportSTL/exportSTEP: each entry in `solidsParams` is one
// top-level solid (its cutouts/fillets already baked in). Prefer the
// shapeStore's current cached shape (fast, and reflects the live state
// exactly); rebuild from base+ops only if the cache doesn't have it — e.g.
// after a fresh load with no edits yet. Multiple solids get welded into one
// with fuseTolerant (see the exportSTL/exportSTEP handler's own comment on
// why not makeCompound).
async function gatherAndFuseExportSolids(solidsParams) {
  const shapes = []
  for (const { solidId, base, ops } of solidsParams) {
    let shape = shapeStore.get(solidId)
    if (!shape) {
      shape = await buildBase(base)
      for (const op of ops) {
        if (op.type === 'fillet') {
          shape = applyFilletOrChamfer(shape, op)
        } else if (op.type === 'shell') {
          shape = applyShell(shape, op)
        } else {
          shape = cutTolerant(shape, buildCutShape(clampCutDepth(op.params, base)))
        }
      }
    }
    shapes.push(shape)
  }
  if (shapes.length === 0) throw new Error('No solids to export')
  let fused = shapes[0]
  for (let i = 1; i < shapes.length; i++) fused = fuseTolerant(fused, shapes[i])
  return fused
}

// Cut with the same fuzzy tolerance as fuseTolerant above — a cut tool
// ending exactly flush with an existing boundary (e.g. one band of a
// multi-band grille pattern sitting right at the edge of an earlier cut)
// hits the same coincident-face ambiguity plain BRepAlgoAPI_Cut has trouble
// with on fuse. Used everywhere a cut op is replayed (subtract, exportSTL,
// mirrorShape, joinShapes) so all four stay in sync.
//
// Deliberately skips SimplifyResult (unlike fuseTolerant, which keeps it) —
// verified live that calling it here can silently corrupt an arc-bearing
// cut result in a way invisible to its own face/vertex counts, but that
// then makes the VERY NEXT boolean op against that shape fail (a plain
// rectangle cut immediately after an arc-shaped cut went from a correct
// result to a total no-op, purely from this one call). No case was found
// where keeping it helped; dropping it just leaves a few more
// coplanar/redundant faces in the mesh, which costs nothing functionally.
function cutTolerant(a, b) {
  const [r, gc] = localGC()
  const oc = getOC()
  const progress = r(new oc.Message_ProgressRange_1())
  const op = r(new oc.BRepAlgoAPI_Cut_3(a.wrapped, b.wrapped, progress))
  op.SetFuzzyValue(FUSE_FUZZY_TOL)
  op.Build(progress)
  // Was silently absent — a failed boolean (e.g. a cut tool exactly
  // coincident with the target's own face) previously fell through to
  // cast(op.Shape()) regardless, returning whatever partial/unmodified
  // shape OCC happened to leave behind with no error at all, which is
  // exactly what made a genuinely failed spring cut look like "nothing
  // happened" instead of a clear failure.
  if (!op.IsDone() || op.HasErrors()) {
    gc()
    throw new Error('Cut failed — the cut geometry may not actually intersect the target, or is too complex for this boolean to resolve.')
  }
  const result = cast(op.Shape())
  // IsDone()/HasErrors() only catch the algorithm itself erroring out — OCC
  // can report a cut as cleanly "done" while still handing back a Compound
  // of the untouched target PLUS the leftover cut tool as a separate solid,
  // instead of a real single subtracted body (same failure class joinShapes'
  // own solid-count check below guards against, for the opposite operation:
  // a fuse that never actually welds). A genuine cut that doesn't sever the
  // material always stays exactly one solid; more than one here means the
  // "cut" silently no-op'd — visually a full, uncut target with the tool's
  // own faint edges bleeding through it, which is exactly what made this
  // look like "nothing happened" instead of a clear failure.
  const solidCount = [...result._iterTopo('solid')].length
  if (solidCount !== 1) {
    gc()
    throw new Error(`Cut failed — the boolean produced ${solidCount} separate bodies instead of one cleanly cut solid. Try a different wire size or pitch.`)
  }
  gc()
  return result
}

// Classifies one OCC edge against a projection (u,v) basis and pushes true
// geometry into the output buckets. Shared by exportFaceDXF (basis derived
// from a picked FACE's own normal — every circle it touches is guaranteed
// view-parallel by construction, so it never passes viewNormal and always
// takes the true-circle/arc branch below) and computeOrthoViews (a FIXED
// axis-aligned basis independent of any given edge's own plane, so circles
// can come in view-parallel, edge-on, or oblique — hence the extra checks
// that only activate when viewNormal is supplied).
function projectEdge(edge, project, lines, circles, arcs, splines, viewNormal) {
  if (edge.geomType === 'CIRCLE') {
    // No convenience center/radius getter on Edge/Curve — drop to the raw OCC
    // circle adaptor, same "replicad doesn't cover this, use .wrapped
    // directly" pattern already used throughout this file.
    const circ = edge.curve.wrapped.Circle()
    const loc = circ.Location()
    const center3D = new Vector([loc.X(), loc.Y(), loc.Z()])
    const center = project(center3D)
    const r = circ.Radius()
    let cosAngle = 1, circNormal = null
    if (viewNormal) {
      const ax = circ.Axis().Direction()
      circNormal = new Vector([ax.X(), ax.Y(), ax.Z()])
      cosAngle = Math.abs(circNormal.dot(viewNormal))
    }
    // edge.isClosed (OCC's topological "is this edge a full loop" flag) can
    // misreport true for a genuine partial arc with a large sweep — e.g. a
    // fillet on a narrow/obtuse corner, where the trimmed circle's start and
    // end parameters sit close to a full period even though they're distinct
    // points. Trust the actual 3D start/end points instead: real coincidence
    // means a true full circle, anything else is a partial arc no matter
    // what isClosed claims.
    const reallyClosed = edge.startPoint.sub(edge.endPoint).Length < 1e-6
    if (cosAngle > 0.999) {
      if (reallyClosed) {
        circles.push({ cx: center.x, cy: center.y, r })
      } else {
        const sp = project(edge.startPoint), ep = project(edge.endPoint)
        let startAngle = Math.atan2(sp.y - center.y, sp.x - center.x)
        let endAngle   = Math.atan2(ep.y - center.y, ep.x - center.x)
        // A DXF ARC entity always sweeps CCW from startAngle to endAngle —
        // atan2 on the endpoints alone doesn't say whether that CCW sweep is
        // the short way (through the real material) or the long way around
        // (an obtuse-corner fillet's short sweep can easily be the CW one).
        // Verify against the edge's true midpoint and swap start/end if the
        // naive CCW sweep would miss it, so the arc always traces where the
        // actual curve is instead of doubling back over other geometry.
        const mid = project(edge.pointAt(0.5))
        const midAngle = Math.atan2(mid.y - center.y, mid.x - center.x)
        const TWO_PI = Math.PI * 2
        const norm = a => ((a % TWO_PI) + TWO_PI) % TWO_PI
        if (norm(midAngle - startAngle) > norm(endAngle - startAngle)) {
          ;[startAngle, endAngle] = [endAngle, startAngle]
        }
        arcs.push({ cx: center.x, cy: center.y, r, startAngle, endAngle })
      }
      return
    }
    if (reallyClosed) {
      // Not view-parallel: the true projection of a full circle is a line
      // (edge-on) or an ellipse (oblique) — this app has no ellipse
      // primitive, so sample the real 3D circle and emit a closed polyline
      // instead (same {points,closed} shape parseDXF's LWPOLYLINE import
      // already produces). Sampling naturally degenerates to a thin sliver
      // in the edge-on case too, so no separate branch is needed for that.
      //
      // gp_Circ has no "point at parameter" method in this OCC build
      // (confirmed live: .Value() is not a function) — build the sample
      // points manually instead, from an in-plane (xDir,yDir) basis derived
      // off circNormal via the same Gram-Schmidt technique this file already
      // uses to build a face-normal projection frame (see exportFaceDXF).
      const refAxis = Math.abs(circNormal.x) < 0.9 ? new Vector([1,0,0]) : new Vector([0,0,1])
      const xDir = refAxis.sub(circNormal.multiply(refAxis.dot(circNormal))).normalize()
      const yDir = circNormal.cross(xDir).normalize()
      const pts = []
      const N = 48
      for (let i = 0; i < N; i++) {
        const t = (i / N) * 2 * Math.PI
        const p3d = center3D.add(xDir.multiply(r*Math.cos(t))).add(yDir.multiply(r*Math.sin(t)))
        pts.push(project(p3d))
      }
      splines.push({ points: pts, closed: true })
      return
    }
    // Non-view-parallel partial arc: falls through to the straight-chord
    // fallback below, same accepted policy as any other non-circle curve.
  }
  const sp = project(edge.startPoint), ep = project(edge.endPoint)
  lines.push({ x1: sp.x, y1: sp.y, x2: ep.x, y2: ep.y })
}

// A periodic surface (cylinder, cone, sphere, torus) needs a "seam" edge in
// its parametrization — the line where the surface's U (or V) coordinate
// wraps back from 2π to 0. It's not a real design feature (drilling a plain
// hole always produces one, running the hole's full depth), just an
// artifact of how OCC describes curved surfaces internally — but
// meshEdges() returns it exactly like any other edge, so a clean cylindrical
// hole/boss renders with a straight line drawn down one side of it.
// BRepTools.IsReallyClosed(edge, face) is OCC's own canonical test for
// this — an edge is a seam on a given face if the face's boundary uses it
// twice (both parametric directions), which is exactly what a real shared
// edge between two DIFFERENT faces never does. Reuses the identical
// per-face `for (const face of shape.faces) { for (const edge of
// face.edges) }` traversal replicad's own meshEdges() already performs
// internally (confirmed by reading its source) — same edgeHash values line
// up 1:1 with `edgeGroups[].edgeId`, so filtering is a plain lookup.
function getSeamEdgeHashes(shape) {
  const oc = getOC()
  const seamHashes = new Set()
  for (const face of shape.faces) {
    for (const edge of face.edges) {
      if (oc.BRepTools.IsReallyClosed(edge.wrapped, face.wrapped)) seamHashes.add(edge.hashCode)
    }
  }
  return seamHashes
}

// For a cylindrical face viewed non-end-on, meshEdges/projectEdge alone
// produce only the seam edge (an arbitrary line down one side, now filtered
// via getSeamEdgeHashes above) plus whatever end-circles/arcs bound the
// face — never the pair of straight silhouette lines a real orthographic
// drawing needs to read a cylinder as a rectangle. Those lines aren't
// topological edges at all (nothing in the BREP sits there), so they have
// to be constructed geometrically: the two U angles where the circular
// cross-section's tangent runs parallel to the view direction, i.e. where
// the radius vector aligns with axis × viewNormal. Each angle only
// produces a line if it actually falls inside the face's own U range (via
// UVBounds) — a fillet's cylindrical face only sweeps a fraction of the
// full circle, so unlike a full hole/boss it may silhouette on only one
// side, or neither. The V range (also from UVBounds) is literal arc-length
// distance along the axis per OCC's Geom_CylindricalSurface, so
// face.pointOnSurface(u,0)/(u,1) — already normalized against UVBounds —
// naturally bounds the line to this face's own axial extent, correct for
// blind holes/bosses too, not just through ones.
function cylinderSilhouetteLines(face, normal, project) {
  const cyl = face.surface.wrapped.Cylinder()
  const axisDir = cyl.Axis().Direction()
  const axis = new Vector([axisDir.X(), axisDir.Y(), axisDir.Z()]).normalize()
  if (Math.abs(axis.dot(normal)) > 0.999) return [] // viewed end-on: already a circle/arc
  const perp = axis.cross(normal)
  if (perp.Length < 1e-9) return []
  perp.normalize()
  const xDir0 = cyl.XAxis().Direction(), yDir0 = cyl.YAxis().Direction()
  const xDir = new Vector([xDir0.X(), xDir0.Y(), xDir0.Z()])
  const yDir = new Vector([yDir0.X(), yDir0.Y(), yDir0.Z()])
  const { uMin, uMax } = face.UVBounds
  const width = uMax - uMin
  const TWO_PI = Math.PI * 2
  const out = []
  for (const dir of [perp, perp.multiply(-1)]) {
    const angle = Math.atan2(dir.dot(yDir), dir.dot(xDir))
    let rel = (angle - uMin) % TWO_PI
    if (rel < 0) rel += TWO_PI
    if (rel > width + 1e-9) continue // this side of the cylinder isn't part of the face (e.g. a fillet)
    const uNorm = rel / width
    const p1 = project(face.pointOnSurface(uNorm, 0))
    const p2 = project(face.pointOnSurface(uNorm, 1))
    out.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y })
  }
  return out
}

function stripSeamEdges(shape, meshData) {
  const seamHashes = getSeamEdgeHashes(shape)
  if (!seamHashes.size) return meshData
  const lines = [], edgeGroups = []
  for (const g of meshData.edgeGroups) {
    if (seamHashes.has(g.edgeId)) continue
    const newStart = lines.length / 3
    for (let i = g.start * 3; i < (g.start + g.count) * 3; i++) lines.push(meshData.lines[i])
    edgeGroups.push({ ...g, start: newStart })
  }
  return { lines, edgeGroups }
}

// Pure-JS estimate of how big baseParams's own solid is, in mm — deliberately
// avoids calling live OCC's .boundingBox() on the actual built shape: a
// solid that already has one or more cuts baked in can fail BRepBndLib's
// bounding-box traversal outright (a native WASM exception, no catchable
// message), which is itself just another symptom of the same boolean-
// robustness degradation this whole clamp exists to work around — the box
// computed here would be needed on exactly the shapes it can't be trusted
// on. Reading straight off baseParams's own 2D profile points (always the
// solid's ORIGINAL, never-cut params — see the 4 call sites below) sidesteps
// that entirely, so every cut in a chain gets clamped, not just the first.
//
// Deliberately the MAX of the part's three dimensions, not the full 3D
// diagonal — verified live (a real multi-hole grille chain, varying this
// value from 100mm to 10000mm) that bigger is not safer here: the diagonal
// of a wide, thin plate is dominated by its footprint and ends up several
// times the actual material thickness, and that extra, unnecessary tool
// length measurably HURT chained-cut reliability rather than helping —
// e.g. one specific part broke on the 2nd chained cut at depth 870mm but
// was reliable up to the 5th at every depth from 100-850mm. A single-axis
// cut only ever needs to clear the part along that one axis; max(w,h,depth)
// covers that for the axis-aligned/face-normal cuts this app actually
// produces, without padding in directions the cut was never going anyway.
function estimateBaseMaxDimMm(baseParams) {
  if (!baseParams) return null
  const ptsLists = baseParams.pts ? [baseParams.pts]
    : baseParams.profiles ? baseParams.profiles.map(p => p.pts)
    : null
  if (!ptsLists) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const pts of ptsLists) for (const p of pts) {
    const x = Array.isArray(p) ? p[0] : p.x, y = Array.isArray(p) ? p[1] : p.y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const w = (maxX - minX) / SCALE, h = (maxY - minY) / SCALE // px -> mm
  // Revolve bases have no depthMm — fall back to the planar extent itself as
  // a generous stand-in for the swept-solid's third dimension.
  const depth = baseParams.depthMm || Math.max(w, h)
  return Math.max(w, h, depth)
}

// App3D sends depthMm=10000 as a "definitely bigger than any part" sentinel
// for through-all cuts, so it never needs to know the target's real
// thickness. But a 10000mm-long cutting prism swept through a ~50mm profile
// is a numerically hostile shape for OCC's boolean cut (extreme aspect
// ratio) — chaining several such cuts onto the same solid (e.g. a multi-hole
// grille pattern) degrades rapidly and can empty the solid out entirely, or
// silently no-op a later cut, after only 2-4 chained cuts, even though each
// individual cut is fine in isolation. Clamping depthMm to comfortably
// larger than the target solid's own largest dimension keeps the tool "big
// enough to always fully cut" without the pathological aspect ratio. Only
// ever shrinks depths that are already far bigger than the part itself — a
// legitimate smaller blind-cut depth the user actually typed passes through
// unchanged.
function clampCutDepth(cut, baseParams) {
  if (!cut.depthMm) return cut
  const maxDim = estimateBaseMaxDimMm(baseParams)
  if (!maxDim) return cut
  const maxSensible = maxDim * 1.5 + 20
  return cut.depthMm > maxSensible ? { ...cut, depthMm: maxSensible } : cut
}

// Spring-cut equivalent of extendLoftCutProfiles/extendSweepCutPath below —
// same "avoid an exactly-coincident cut face" purpose (a cut tube whose
// length exactly matches the material it's punching through — e.g. a coil
// cut sketched to run the full height of a cylinder — leaves both its flat
// end caps exactly coincident with the target's own top/bottom faces, which
// OCC's boolean can't reliably classify as "definitely overlapping").
// Unlike extendSweepCutPath's path (a sampled polyline/curve whose start
// tangent is only ever a best-effort approximation of what the sketched
// profile was actually anchored to), a helix's tangent is a pure function
// of its pitch/radius/angle of revolution — translating its origin along
// its own axis doesn't change that tangent at all, so it's safe to extend
// BOTH ends here, not just the far one the way extendSweepCutPath must.
// This only ever touches the CUT TOOL's final geometry (called from
// buildCutShape below) — it never touches computeSpringPathPlane's own
// origin/height, so the profile the user actually sketched stays anchored
// exactly where they drew it.
const SPRING_CUT_OVH_MM = 1
function extendSpringCutPath(cut) {
  const { origin, normal, heightMm } = cut
  const [nx, ny, nz] = normal
  return {
    ...cut,
    origin: [origin[0] - nx*SPRING_CUT_OVH_MM, origin[1] - ny*SPRING_CUT_OVH_MM, origin[2] - nz*SPRING_CUT_OVH_MM],
    heightMm: heightMm + 2*SPRING_CUT_OVH_MM,
  }
}

// Builds the shape to subtract for one cut op — linear extrude (plain),
// revolve (`axis` present), or loft (`profiles` present, e.g. a tapered
// pocket cut via App3D.jsx's Loft Cutout tool). Same discriminator
// convention buildBase() below already uses for cold-rebuild fallbacks;
// this is the cut-shape counterpart, shared by every op-replay loop
// (subtract, mirrorShape, joinShapes, exportSTL) so all four stay in sync.
// isCut adds a 1mm protrusion so a cut ending flush with a solid's face
// doesn't fail on coincident-face booleans — see extendLoftCutProfiles,
// extendSpringCutPath, and extendSweepCutPath for the loft-, spring-, and
// sweep-shaped-cut equivalents (buildRevolve has no such treatment yet).
function buildCutShape(cut) {
  return cut.profiles ? buildLoft({ ...cut, profiles: extendLoftCutProfiles(cut.profiles) })
    : cut.axis ? buildRevolve(cut)
    : cut.pitchMm !== undefined ? buildSpring(extendSpringCutPath(cut))
    : cut.pathPts ? buildSweep(extendSweepCutPath(cut))
    : buildExtrude({ ...cut, isCut: true })
}

// Pushes a loft cutout's first/last profile 1mm further out along the
// shared normal — buildExtrude's isCut protrusion (above) exists because a
// cut ending exactly flush with a target's face can leave an uncut sliver
// there (OCC's boolean treats an exactly-coincident face as ambiguous, not
// "definitely overlapping"); buildLoft has no equivalent margin, so a loft
// cutout whose length exactly matches the material it's punching through
// (e.g. a hole meant to go clean through a 200mm cylinder, sketched 200mm
// deep) can fail to fully cut the far end face. Only touches the two
// endpoint planes' position — the profile shapes/points themselves, and
// every profile in between, are untouched, so the taper the user actually
// sketched is preserved; the 1mm extension just falls outside the target
// solid either way.
const LOFT_CUT_OVH_MM = 1
function extendLoftCutProfiles(profiles) {
  if (profiles.length < 2) return profiles
  const extended = profiles.map(p => ({ ...p }))
  extended[0].offsetMm -= LOFT_CUT_OVH_MM
  extended[extended.length - 1].offsetMm += LOFT_CUT_OVH_MM
  return extended
}

// Sweep-cut equivalent of extendLoftCutProfiles above — same "avoid an
// exactly-coincident cut face" purpose, but ONLY extends the path's FAR end
// (pts[last]), never pts[0]. buildSweep's sweepSketch call computes the
// profile's plane from the wire's own start point AND tangent (see its own
// comment) — App3D.jsx's computeSweepProfilePlane already anchors the
// profile there using the path's EXACT tangent (real arc/spline math, see
// sweepPathStartTangent), matching what the user actually saw while
// sketching the profile. Prepending a point before pts[0] would change the
// wire's start tangent to this extension's straight chord direction instead
// — for a straight path that's identical to the original tangent (harmless,
// which is why this bug shipped unnoticed with a line-only path), but for
// an arc/spline path it diverges from the exact tangent already baked into
// the profile's orientation, twisting the profile relative to what
// sweepSketch actually sweeps and producing a self-intersecting pipe shell
// (surfaced as "could not build a valid solid from this path and profile").
// Extending only the far end sidesteps this entirely — it's never the wire
// end sweepSketch anchors anything to — at the cost of leaving the near/
// entry end (where the profile is sketched, often flush against a face)
// with no margin, same posture buildRevolve's cut path already has today.
const SWEEP_CUT_OVH_MM = 1
function extendSweepCutPath(cut) {
  const pts = cut.pathPts
  if (!pts || pts.length < 2) return cut
  const ovhPx = SWEEP_CUT_OVH_MM * SCALE
  const anchor = pts[pts.length-1]
  // Naive default: chord direction between the last two SAMPLED points.
  // Exact for a straight path (there's only ever two points), but for a
  // curve this is only ever an approximation of the true end tangent — and
  // empirically, "close enough" isn't reliably close enough. An arc's
  // coarse sampling (as few as 4 points across its whole span, see
  // detectPath) can diverge enough from its real end tangent that the
  // straight stub below meets it at a small but real kink, which made
  // replicad's sweepSketch throw outright (a raw native exception, not even
  // the graceful BRepCheck_Analyzer failure this function was written to
  // avoid). A spline samples far more densely (sampleSpline(...,16)) so the
  // chord is a much closer approximation — but "closer" isn't "exact", and
  // a sharp enough curve combined with a large enough profile (both
  // observed live: a spline doubling back on itself swept with a ~20mm-
  // radius circle) still lets that residual error tip a valid sweep into
  // BRepCheck_Analyzer's "invalid solid" failure. Both cases have an exact
  // fix available from the curve's own defining data (not its sampled
  // polygon), so use that whenever the anchor is a real curve's true end.
  let dx, dy
  const segs = pts.curveSegments
  const lastSeg = segs && segs.length ? segs[segs.length - 1] : null
  const curveEndsAtAnchor = lastSeg && (lastSeg.startIdx + lastSeg.count) === pts.length - 1
  if (curveEndsAtAnchor && lastSeg.type === 'arc') {
    // Exact tangent: perpendicular to the radius, signed to the arc's own
    // sweep direction — G1-continuous with the arc by construction.
    const sign = lastSeg.endAngle >= lastSeg.startAngle ? 1 : -1
    dx = -Math.sin(lastSeg.endAngle) * sign
    dy = Math.cos(lastSeg.endAngle) * sign
  } else if (curveEndsAtAnchor && lastSeg.type === 'spline' && lastSeg.controlPoints.length >= 2) {
    // Exact tangent for an open Catmull-Rom spline's last control point:
    // catmullRomToBezierSegments' own open-curve extension duplicates the
    // final control point as its own virtual neighbor (ext = [...pts,
    // pts[n-1]]), which reduces the standard T_i=(P_{i+1}-P_{i-1})/2
    // tangent formula at the endpoint to just P_last - P_secondLast — the
    // chord between the last two CONTROL points (sparse, exact), not the
    // last two SAMPLED points (dense, approximate) used above.
    const cp = lastSeg.controlPoints
    const last = cp[cp.length-1], prev = cp[cp.length-2]
    dx = last.x - prev.x
    dy = last.y - prev.y
  } else {
    const neighbor = pts[pts.length-2]
    dx = anchor.x - neighbor.x
    dy = anchor.y - neighbor.y
  }
  const len = Math.hypot(dx, dy) || 1
  const postEnd = { x: anchor.x + dx/len*ovhPx, y: anchor.y + dy/len*ovhPx }
  const extended = [...pts, postEnd]
  // No index shift needed — appending after the end never moves any
  // existing point, so every curveSegments.startIdx still matches.
  if (pts.curveSegments) extended.curveSegments = pts.curveSegments
  return { ...cut, pathPts: extended }
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
    if (type==='exportSTL' || type==='exportSTEP') {
      // Shared by both export formats — see gatherAndFuseExportSolids below.
      // Deliberately NOT using replicad's makeCompound (which would keep
      // multiple selected solids as separate bodies in the STEP file,
      // STEP's real advantage over STL) — makeCompound calls .delete() on
      // every input shape, and these shapes come straight from the live
      // shapeStore cache below, reused unmodified. Compounding them would
      // free cache entries out from under the app: the next unrelated
      // operation touching that solid would throw on an already-deleted
      // WASM object instead of cleanly cache-missing. fuseTolerant only
      // reads .wrapped, never deletes its operands, so it's safe here —
      // same reasoning Join/exportSTL's own multi-solid fuse already rely on.
      const fused = await gatherAndFuseExportSolids(params.solids)
      if (type==='exportSTL') {
        // Same tolerances used for the on-screen render mesh elsewhere in
        // this file, so the printed geometry matches what was previewed.
        const blob = fused.blobSTL({ tolerance:0.05, angularTolerance:30, binary: true })
        self.postMessage({ type:'result', id, stlBlob: blob })
      } else {
        const blob = fused.blobSTEP()
        self.postMessage({ type:'result', id, stepBlob: blob })
      }
      return
    }

    if (type==='exportFaceDXF') {
      // Reads each picked face's REAL OCC topology (outerWire + every
      // innerWire/hole) instead of reconstructing geometry from the
      // tessellated render mesh — exact curves, and holes come along for
      // free since OCC already separates them from the outer boundary
      // (unlike the render-mesh-based "Include From Face" tool, which has to
      // reverse-engineer circles/arcs from boundary-edge chains and can miss
      // internal loops).
      //
      // App3D.jsx lets the student click multiple faces before exporting
      // (e.g. every letter of a sign) rather than this worker guessing which
      // OTHER faces "belong together" — an earlier auto-coplanar-detection
      // pass here kept missing real letters because no fixed tolerance
      // reliably separated "same surface, floating-point noise" from "a
      // genuinely different, nearby surface" once text was built from
      // separate features/boolean joins. Manual pick has no tolerance to get
      // wrong. Each pick carries its OWN solidId rather than assuming one
      // shared solid — a base plate and its lettering are very often
      // separate, never-joined solids, not one fused body.
      const picks = params.picks || [{ solidId: params.solidId, point: params.point }]
      const baseCache = new Map()
      const getBase = solidId => {
        if (baseCache.has(solidId)) return baseCache.get(solidId)
        const base = shapeStore.get(solidId)
        if (!base) throw new Error(`exportFaceDXF-MISS: solid ${solidId} not in store`)
        baseCache.set(solidId, base)
        return base
      }
      const faces = picks.map(({ solidId, point }) =>
        new FaceFinder().withinDistance(EDGE_PICK_TOL, point).find(getBase(solidId), { unique: true }))
      const normal = faces[0].normalAt()
      // Stable local (u,v) frame for a flat projection, anchored on the
      // FIRST picked face — Gram-Schmidt a world axis against the normal. No
      // "which edge is bottom" concern the way FacePlane.js's sketch-
      // orientation logic has (see faceHitToPlane's own fallback branch,
      // same technique) — a flat DXF export just needs ANY consistent
      // frame, not a user-meaningful orientation. Every other picked face
      // projects into this SAME frame so multiple letters land correctly
      // positioned relative to each other in the one output drawing.
      const refAxis = Math.abs(normal.x) < 0.9 ? new Vector([1, 0, 0]) : new Vector([0, 0, 1])
      const uAxis = refAxis.sub(normal.multiply(refAxis.dot(normal))).normalize()
      const vAxis = normal.cross(uAxis).normalize()
      const origin = faces[0].center
      const project = v => { const rel = v.sub(origin); return { x: rel.dot(uAxis), y: rel.dot(vAxis) } }

      const lines = [], circles = [], arcs = [], splines = []
      for (const f of faces) {
        // face.outerWire()/innerWires() each DELETE their receiver as a side
        // effect (replicad's "consuming" idiom — see Face.outerWire()/
        // innerWires() in replicad.js), so calling both directly on the same
        // face would use-after-delete on the second call. Clone for the
        // outer-wire call so the original survives for innerWires().
        const wires = [f.clone().outerWire(), ...f.innerWires()]
        for (const wire of wires) {
          // No viewNormal passed — every circle on a face's own boundary is
          // guaranteed view-parallel to that face's projection basis by
          // construction, so projectEdge always takes the true-circle/arc
          // branch here (splines stays empty for this call site).
          for (const edge of wire.edges) projectEdge(edge, project, lines, circles, arcs, splines)
        }
      }
      self.postMessage({ type:'result', id, dxfData: { lines, circles, arcs } })
      return
    }

    if (type==='computeOrthoViews') {
      // Front/top/right reuse this app's existing on-screen view conventions
      // (Viewport3D.jsx's PLANE_VIEWS, SketchPlane.js's worldToSketch) so a
      // generated front/top/right view visually matches what clicking those
      // work planes in the 3D tab already shows. back/left/bottom mirror the
      // opposite pair.
      const VIEW_BASES = {
        front:  { uAxis: new Vector([1,0,0]),  vAxis: new Vector([0,0,1]), normal: new Vector([0,-1,0]) },
        back:   { uAxis: new Vector([-1,0,0]), vAxis: new Vector([0,0,1]), normal: new Vector([0,1,0]) },
        right:  { uAxis: new Vector([0,1,0]),  vAxis: new Vector([0,0,1]), normal: new Vector([1,0,0]) },
        left:   { uAxis: new Vector([0,-1,0]), vAxis: new Vector([0,0,1]), normal: new Vector([-1,0,0]) },
        top:    { uAxis: new Vector([1,0,0]),  vAxis: new Vector([0,1,0]), normal: new Vector([0,0,1]) },
        bottom: { uAxis: new Vector([1,0,0]),  vAxis: new Vector([0,-1,0]), normal: new Vector([0,0,-1]) },
      }
      const views = {}
      for (const viewName of params.views) {
        const basis = VIEW_BASES[viewName]
        if (!basis) throw new Error(`computeOrthoViews: unknown view "${viewName}"`)
        const { uAxis, vAxis, normal } = basis
        // Origin is the world origin (not a per-face center like
        // exportFaceDXF) so every solid's edges land in ONE shared frame per
        // view — required for the client-side layout step to bbox solids
        // correctly relative to each other.
        const project = v => ({ x: v.dot(uAxis), y: v.dot(vAxis) })
        const lines = [], circles = [], arcs = [], splines = []
        for (const solidId of params.solidIds) {
          const shape = shapeStore.get(solidId)
          if (!shape) throw new Error(`computeOrthoViews-MISS: solid ${solidId} not in store`)
          const seamHashes = getSeamEdgeHashes(shape)
          for (const edge of shape.edges) {
            if (seamHashes.has(edge.hashCode)) continue
            projectEdge(edge, project, lines, circles, arcs, splines, normal)
          }
          for (const face of shape.faces) {
            if (face.geomType !== 'CYLINDRE') continue
            lines.push(...cylinderSilhouetteLines(face, normal, project))
          }
        }
        views[viewName] = { lines, circles, arcs, splines }
      }
      self.postMessage({ type:'result', id, orthoViews: { views } })
      return
    }

    if (type==='springProfilePlane') {
      self.postMessage({ type:'result', id, planeData: computeSpringPathPlane(params) })
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
    } else if (type==='sweep') {
      shape = buildSweep(params)
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='spring') {
      shape = buildSpring(params)
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
        base = await buildBase(params.base)
      }
      // operation defaults to 'fillet' for older callers/saved ops that
      // predate chamfer support — see App3D.jsx's `f.operation ?? 'fillet'`
      // convention used at every op-builder call site.
      const isChamferOp = params.operation === 'chamfer'
      const opLabel = isChamferOp ? 'Chamfer' : 'Fillet'
      try {
        const edgeFilter = e => e.either(
          params.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
        )
        shape = isChamferOp ? base.chamfer(params.radius, edgeFilter) : base.fillet(params.radius, edgeFilter)
      } catch(e) {
        throw new Error(`${opLabel} failed: ${e.message}`)
      }
      // BRepFilletAPI_MakeFillet/MakeChamfer can report success while the
      // blend actually self-intersects (radius too large for the local edge
      // run — e.g. two concave corners close enough together that their
      // fillets overlap). Left unchecked, this bakes an invalid solid into
      // shapeStore that looks fine at a glance but produces garbage later
      // (e.g. a closed circular edge instead of an arc on DXF face export).
      // Catch it here, at the point the user picked the radius, instead of
      // downstream.
      {
        const oc = getOC()
        const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false)
        const valid = analyzer.IsValid_2()
        analyzer.delete()
        if (!valid) throw new Error(`${opLabel} failed: radius too large for the selected edge(s) — try a smaller radius`)
      }
      shapeStore.set(params.solidId, shape)
    } else if (type==='shell3d') {
      // Face-pick shell: applies to whatever this solid currently looks like,
      // same shapeStore-or-cold-rebuild fallback fillet3d uses. facePoints is
      // an array of [x,y,z] mm points, each near a picked face to remove.
      let base = shapeStore.get(params.solidId)
      if (!base) {
        if (!params.base) throw new Error(`Shell-MISS: base not in store and no fallback params`)
        console.warn('[cadWorker] shapeStore miss — rebuilding base from params')
        base = await buildBase(params.base)
      }
      try {
        shape = applyShell(base, params)
      } catch(e) {
        throw new Error(`Shell failed: ${e.message}`)
      }
      // Same self-intersection guard fillet3d uses — a wall thickness too
      // large for the local geometry can report success while the offset
      // faces actually collide.
      {
        const oc = getOC()
        const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false)
        const valid = analyzer.IsValid_2()
        analyzer.delete()
        if (!valid) throw new Error('Shell failed: wall thickness too large for this geometry — try a smaller thickness')
      }
      shapeStore.set(params.solidId, shape)
    } else if (type==='subtract') {
      let base = shapeStore.get(params.baseSolidId)
      const fromStore = !!base
      if (!base) {
        if (!params.base) throw new Error(`Step1-MISS: base not in store and no fallback params`)
        console.warn('[cadWorker] shapeStore miss — rebuilding base from params')
        try { base = await buildBase(params.base) }
        catch(e) { throw new Error(`Step1-BASE: ${e.message} | planeId=${params.base.planeId} dir=${params.base.direction}`) }
      }
      let cutShape
      try {
        // A revolve-cutout's params carry `axis` (no depthMm/direction), a
        // loft-cutout's carry `profiles` — build the matching shape to
        // subtract instead of assuming a linear prism. Plain cuts: App3D
        // sets depthMm=10000+direction='both' for through-all, or user
        // values for blind cut; isCut=true adds 1mm protrusion on the entry
        // side to avoid coincident-face OCC failures (see buildCutShape).
        cutShape = buildCutShape(clampCutDepth(params.cut, params.base))
      } catch(e) {
        throw new Error(`Step2-CUT: ${e.message} | planeId=${params.cut.planeId} facePlane=${!!params.cut.normal} store=${fromStore}`)
      }
      try {
        shape = cutTolerant(base, cutShape)
      } catch(e) {
        throw new Error(`Step3-BOOL: ${e.message} | store=${fromStore}`)
      }
      shapeStore.set(params.baseSolidId, shape)
    } else if (type==='mirrorShape') {
      // Mirroring a whole solid across a plane is this app's first
      // cross-solid dependency (a mirror-solid depends on its SOURCE solid's
      // current shape) — nothing guarantees shapeStore[sourceSolidId] is
      // fresh at rebuild time (fresh page load, or a dependent-mirror
      // rebuild that didn't just touch the source), so cold-rebuild the
      // source's full chain from params whenever a flat rebuild description
      // is available — the same safety fallback buildBase already provides
      // on a fillet3d/subtract cache MISS.
      // A join or a mirror source has no such flat description (see
      // buildBaseWorkerParams' own comment — join/mirror solids aren't
      // rebuildable from pts/depth/plane, only via joinShapes()/mirrorShape()
      // themselves) — params.base is null for these, and the caller passes
      // params.sourceSolidId instead so the ALREADY-built shape can be read
      // straight out of shapeStore. This is safe (not the "trusting a stale
      // cache" risk the comment above guards against) because App3D.jsx only
      // ever reaches this branch once the source's own shapeStore entry has
      // already been freshly set — at creation time for live editing, or by
      // an earlier, awaited replay step for a project reload (see
      // rebuildProjectFromFeatures' ordering guarantee).
      let base
      if (params.base) {
        base = await buildBase(params.base)
      } else {
        base = shapeStore.get(params.sourceSolidId)
        if (!base) throw new Error('Mirror source shape not found in cache (join/mirror source not yet built)')
      }
      for (const op of params.ops || []) {
        if (op.type === 'fillet') {
          base = applyFilletOrChamfer(base, op)
        } else if (op.type === 'shell') {
          base = applyShell(base, op)
        } else {
          base = cutTolerant(base, buildCutShape(clampCutDepth(op.params, params.base)))
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
      const shapes = []
      for (const m of params.members) {
        let s = shapeStore.get(m.solidId)
        if (!s) {
          s = await buildBase(m.base)
          for (const op of m.ops || []) {
            if (op.type === 'fillet') {
              s = applyFilletOrChamfer(s, op)
            } else if (op.type === 'shell') {
              s = applyShell(s, op)
            } else {
              s = cutTolerant(s, buildCutShape(clampCutDepth(op.params, m.base)))
            }
          }
        }
        shapes.push(s)
      }
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
      // Each fuseTolerant() step already runs SimplifyResult on its OWN
      // pairwise result, but chaining many members (reduce() above) means a
      // seam between, say, member 1 and member 10 only becomes exactly
      // coincident once every fuse in between has run — no single step's
      // cleanup ever gets a chance to catch it. Left alone this bakes in
      // redundant coincident edges/faces along those seams, which later
      // surfaces as literal duplicate overlapping lines when the joined
      // solid's edges get walked one-by-one (DXF export, ortho drawings,
      // "include edge"). One more unify pass over the FINAL shape catches
      // what the per-step passes couldn't.
      {
        const oc = getOC()
        const unifier = new oc.ShapeUpgrade_UnifySameDomain_2(shape.wrapped, true, true, false)
        unifier.Build()
        shape = cast(unifier.Shape())
        unifier.delete()
      }
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='transformShape') {
      // Bakes a Move/Copy/Rotate's transform into the solid's actual OCC
      // geometry — same shapeStore-or-cold-rebuild-from-params fallback
      // fillet3d already uses on a cache miss. Move re-targets the SAME
      // solidId (no sourceSolidId) so this reads and overwrites one
      // shapeStore entry — repeated live moves/rotates each send only the
      // NEW delta, since the shape already sitting in the cache reflects
      // every prior move/rotate already applied (the cumulative total
      // lives on the feature/solid's own `transform` field in App3D.jsx,
      // not in the worker). Copy passes a distinct `sourceSolidId` to read
      // from and `solidId` to write the new body's shape to, mirroring
      // mirrorShape's own source/target split.
      let base = shapeStore.get(params.sourceSolidId ?? params.solidId)
      if (!base) {
        if (!params.base) throw new Error('Transform-MISS: base not in store and no fallback params')
        base = await buildBase(params.base)
        for (const op of params.ops || []) {
          if (op.type === 'fillet') {
            base = applyFilletOrChamfer(base, op)
          } else if (op.type === 'shell') {
            base = applyShell(base, op)
          } else {
            base = cutTolerant(base, buildCutShape(clampCutDepth(op.params, params.base)))
          }
        }
      }
      // rotation.pivot present = a live incremental rotate delta (App3D
      // already knows the body's CURRENT world pivot at drag time — the
      // shape found above may already carry prior transforms, this is
      // just the fresh delta on top). rotation.pivot ABSENT = a full
      // cumulative rebuild (rebuildSolidChain/rebuildFeatureSolid's mirror
      // branch, replaying the feature's whole stored `transform` in one
      // shot against a pristine, never-transformed shape) — pivot must be
      // that pristine shape's OWN center, which only the worker can know
      // (boundingBox is OCC-side). Order is fixed: rotate about that
      // pivot, THEN translate — matches how `transform.rotation`'s
      // cumulative angle is defined relative to the untransformed shape.
      if (params.rotation) {
        const pivot = params.rotation.pivot ?? base.boundingBox.center
        base = base.rotate(params.rotation.angleDeg, pivot, params.rotation.axis)
      }
      shape = params.position ? base.translate(params.position) : base
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='importStep') {
      // A fresh user-initiated import and a cold-rebuild's re-import (via
      // buildBase's own stepText branch above) both end up here with the
      // same stepText — there's only one code path either way, unlike
      // extrude/revolve/etc. which distinguish "build fresh" from "replay
      // ops on top of a cold-rebuilt base." An imported body has no ops to
      // replay at import time itself; cutouts/fillets added to it later go
      // through the normal subtract/fillet3d handlers same as any other solid.
      shape = await importSTEP(new Blob([params.stepText]))
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else {
      throw new Error(`Unknown: ${type}`)
    }
    if (!shape) throw new Error('Null shape')
    const faces = shape.mesh({ tolerance:0.05, angularTolerance:30 })
    const edges = stripSeamEdges(shape, shape.meshEdges({ keepMesh:true }))
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
// snapEndTo (mm, optional): when this arc is the LAST thing drawn before the
// wire closes, its end is supposed to land exactly back on the wire's start
// — but that start came from a stored `pts` value (survivor of a trim's own
// line/circle-intersection math), while this arc's end is computed fresh
// from cx/cy/r/angle: two independent floating-point paths to what should
// be the identical point, verified live to disagree by up to ~1e-6mm. That
// gap is small enough to be invisible on screen but sits right at OCC's
// wire-closing tolerance edge — BRepBuilderAPI_MakeWire silently accepts
// the resulting near-but-not-quite-closed wire, and the face/solid built
// from it goes on to make the very NEXT boolean cut against it fail
// outright (see cutTolerant). Snapping only this one endpoint back onto the
// true start when they're already within dedupeRep's own "same point"
// tolerance closes that gap exactly, without touching any other point's
// precision (unlike a blanket rounding pass, which was tried and reliably
// broke legitimately fine, closely-spaced geometry elsewhere).
function emitArc(sketcher, seg, snapEndTo=null) {
  // A near-zero angular span is trim debris, not a real curve — a genuine
  // arc needs 3 meaningfully distinct points, and threePointsArcTo can
  // throw an unrecoverable native error when start/mid/end collapse onto
  // each other. Draw a line to the (barely different) end point instead;
  // at this angular scale the two are visually and dimensionally identical.
  if (Math.abs(seg.endAngle - seg.startAngle) < 1e-6) {
    const endPt = { x: seg.cx + Math.cos(seg.endAngle)*seg.r, y: seg.cy + Math.sin(seg.endAngle)*seg.r }
    sketcher.lineTo(toMm(endPt))
    return
  }
  const midAngle = (seg.startAngle + seg.endAngle) / 2
  const endPt = { x: seg.cx + Math.cos(seg.endAngle)*seg.r, y: seg.cy + Math.sin(seg.endAngle)*seg.r }
  const midPt = { x: seg.cx + Math.cos(midAngle)*seg.r,     y: seg.cy + Math.sin(midAngle)*seg.r }
  let endMm = toMm(endPt)
  if (snapEndTo && Math.hypot(endMm[0]-snapEndTo[0], endMm[1]-snapEndTo[1]) < 0.005) endMm = snapEndTo
  sketcher.threePointsArcTo(endMm, toMm(midPt))
}

// Mixed profile: walks `pts` by index, switching between straight .lineTo()
// calls and real curve commands (spline/arc) wherever a curveSegments entry
// says so — see detectProfiles() in extrudeMath.js for how these get
// attached. `i` jumps forward by a segment's `count` after emitting its
// curve, skipping the now-redundant polygon-sampled points for that span.
// close=false (Sweep's path only — see makePath) skips the anchor-snap on a
// trailing arc (there's no closing point to snap onto) and finishes with
// .done() instead of .close(), leaving the wire open exactly as drawn.
function buildMixedProfile(sketcher, pts, curveSegments, close=true) {
  const segs = [...curveSegments].sort((a,b)=>a.startIdx-b.startIdx)
  const n = pts.length
  const anchor = toMm(pts[0])
  sketcher.movePointerTo(anchor)
  let i = 0, segPtr = 0
  while (i < n) {
    const seg = (segPtr < segs.length && segs[segPtr].startIdx === i) ? segs[segPtr] : null
    if (seg) {
      if (seg.type === 'spline') emitBezierChain(sketcher, seg.controlPoints)
      else if (seg.type === 'arc') {
        // Last segment overall, and its jump reaches (or passes) the end of
        // pts — nothing but close() follows, so this arc's end IS the wire's
        // closing point back onto anchor. Never true when close=false.
        const isLastBeforeClose = close && segPtr === segs.length - 1 && (seg.startIdx + seg.count) >= n
        emitArc(sketcher, seg, isLastBeforeClose ? anchor : null)
      }
      i = seg.startIdx + seg.count
      segPtr++
    } else {
      i++
      if (i < n) sketcher.lineTo(toMm(pts[i]))
    }
  }
  return close ? sketcher.close() : sketcher.done()
}

// close=false builds an OPEN wire (via Sketcher.done(), no forced closure) —
// used only by makePath (Sweep's path curve). Every other caller keeps the
// default close=true (unchanged behavior).
function makeProfile(pts, planeId, offsetMm, normal, origin, uAxis, circle=null, close=true) {
  const plane = buildProfilePlane(planeId, offsetMm, normal, origin, uAxis)
  const sketch = makeProfileOnPlane(pts, plane, close, circle)
  plane.delete()
  return sketch
}

// The part of makeProfile that only needs an already-built Plane object —
// factored out so buildSweep's profile callback (which receives its plane
// straight from replicad's own sweepSketch, see buildSweep below) can share
// this instead of duplicating the Sketcher/curve-emission/circle logic.
// Never deletes `plane` — ownership stays with the caller (makeProfile
// deletes its own right after; buildSweep's callback doesn't own its
// replicad-provided plane at all).
function makeProfileOnPlane(pts, plane, close=true, circle=null) {
  if (circle) {
    // True circular curve — a plain circle/hole should have 2 rim edges + 1
    // seam, not the ~60 straight facets the point-sampled polygon path
    // below produces. pts (the polygon approximation) still gets sent
    // alongside `circle` for preview/profile-detection code that just wants
    // points; only the actual solid-building path here needs the real
    // curve. A circle is inherently closed — `close` doesn't apply to it
    // (Sweep never sends a circle as its path, only as its profile).
    const cx = circle.cx / SCALE
    const cy = -circle.cy / SCALE
    const centered = plane.translate(plane.xDir.multiply(cx).add(plane.yDir.multiply(cy)))
    const sketch = sketchCircle(circle.r / SCALE, { plane: centered })
    centered.delete()
    return sketch
  }

  const sketcher = new Sketcher(plane)

  // Real curve segments (splines/arcs — see detectProfiles/detectPath in
  // extrudeMath.js) build a mixed sketch of straight lines + real curves;
  // everything else (plain line/arc-only profiles) keeps the exact original
  // polygon path.
  if (pts.curveSegments && pts.curveSegments.length > 0) {
    return buildMixedProfile(sketcher, pts, pts.curveSegments, close)
  }

  const rep = dedupeRep(toRep(pts))
  sketcher.movePointerTo(rep[0])
  for (let i=1; i<rep.length; i++) sketcher.lineTo(rep[i])
  return close ? sketcher.close() : sketcher.done()
}

// Sweep's path curve — same point/curve data shape as a profile (see
// detectPath in extrudeMath.js) but built as an OPEN wire (close=false),
// never force-closed back to its own start the way a normal profile is.
function makePath(pts, planeId, normal, origin, uAxis) {
  return makeProfile(pts, planeId, 0, normal, origin, uAxis, null, false)
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

/**
 * Sweep a closed profile along a path curve (open or closed — see
 * detectPath in extrudeMath.js; a path is never force-closed either way).
 * The path is built as an open wire (makePath, close=false) on its own
 * sketch plane; replicad's Sketch.sweepSketch then computes the profile's
 * plane ITSELF from the path wire's own start point + start tangent and
 * hands it to the callback below — profilePts must already be consistent
 * with whatever plane App3D.jsx showed the user while they sketched the
 * profile (see App3D.jsx's computeSweepProfilePlane), or the swept solid
 * comes out subtly rotated/twisted relative to what they saw on screen.
 */
function buildSweep({ pathPts, planeId, normal, origin, uAxis, profilePts, profileCircle }) {
  const pathSketch = makePath(pathPts, planeId, normal, origin, uAxis)
  const shape = pathSketch.sweepSketch((plane) => makeProfileOnPlane(profilePts, plane, true, profileCircle))
  // sweepSketch has no built-in validity check (unlike fillet/chamfer,
  // which throw on an empty edge selection) — same BRepCheck_Analyzer guard
  // already used after fillet/chamfer/draft, so a self-intersecting
  // path/profile combination surfaces as a clean error instead of a
  // corrupted solid.
  const oc = getOC()
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false)
  const valid = analyzer.IsValid_2()
  analyzer.delete()
  if (!valid) throw new Error('Sweep failed: could not build a valid solid from this path and profile')
  return shape
}

// Spring — a hand-sketched wire cross-section swept along a helical path.
// Unlike a plain circle wire, the profile here is real user-sketched
// geometry (same shape detectProfiles/buildMixedProfile produce for Sweep's
// own profile), sketched on the EXACT plane replicad's sweepSketch call
// below will compute internally — see computeSpringPathPlane, which App3D.jsx
// calls BEFORE showing the sketch canvas, so what the user draws lines up
// with what actually gets swept. The path itself is still purely parametric
// (no hand-drawn points): replicad's own sketchHelix(pitch, height, radius,
// center, dir, lefthand) builds the whole helical Sketch directly from plain
// [x,y,z] arrays — no Plane/Vector wrapping, no makePath involved.
function buildSpring({ pitchMm, heightMm, coilRadiusMm, origin, normal, lefthand=false, profilePts, profileCircle }) {
  // A circular wire whose diameter reaches or exceeds the pitch means
  // consecutive coils physically overlap before any sweep math even runs —
  // BRepCheck_Analyzer's validity guard below only catches LOCAL topological
  // defects (gaps, bad winding) on a single coil, not this kind of GLOBAL
  // self-intersection between separate turns of the same solid, so a
  // self-overlapping spring can silently build into a fused/degenerate lump
  // instead of failing. Catch the unambiguous case (a true circular wire —
  // profileCircle.r is still in raw px/SCALE units here, same convention
  // makeProfileOnPlane divides out below) up front with an actionable error.
  if (profileCircle) {
    const wireDiameterMm = (profileCircle.r / SCALE) * 2
    if (wireDiameterMm >= pitchMm) {
      throw new Error(`Spring failed: wire diameter (${wireDiameterMm.toFixed(2)}mm) must be smaller than the pitch (${pitchMm}mm), or consecutive coils will overlap — increase pitch or use a thinner wire`)
    }
  }
  const pathSketch = sketchHelix(pitchMm, heightMm, coilRadiusMm, origin, normal, lefthand)
  // frenet:true is required here — replicad's genericSweep defaults to
  // frenet:false (OCC's "CorrectedFrenet" trihedron law), which deliberately
  // MINIMIZES the profile's rotation along the spine to avoid gratuitous
  // twisting. For a circular profile that's invisible (rotationally
  // symmetric), which is why this went unnoticed while Spring only supported
  // a plain circle wire — but for any real hand-sketched (non-circular)
  // profile it means the cross-section stays at a near-fixed orientation in
  // world space as it travels, instead of rotating WITH the coil, producing
  // radial fin/blade artifacts instead of a properly twisted wire. True
  // Frenet mode rotates the profile to track the spine's own natural
  // rotation — for a helix, exactly one full 360° turn of the profile per
  // coil, matching the coil's own geometry.
  const shape = pathSketch.sweepSketch((plane) => makeProfileOnPlane(profilePts, plane, true, profileCircle), { frenet: true })
  // Same BRepCheck_Analyzer guard as buildSweep — a wire cross-section too
  // large relative to the pitch/coil radius can self-intersect.
  const oc = getOC()
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false)
  const valid = analyzer.IsValid_2()
  analyzer.delete()
  if (!valid) throw new Error('Spring failed: could not build a valid solid — try a smaller wire profile or larger pitch')
  return shape
}

// Returns the exact plane buildSpring's own sweepSketch call will hand its
// profile-building callback — mirrors Sketch.sweepSketch's plane math
// EXACTLY (see node_modules/replicad/dist/replicad.js): startPoint =
// wire.startPoint, normal = -tangentAt(~0) (normalized), xDir =
// normal×defaultDirection×-1. sketchHelix's Sketch is built via `new
// Sketch(assembleWire(...))` with no defaultOrigin/defaultDirection
// override, so defaultDirection stays the class default [0,0,1] here —
// NOT origin/normal, and NOT basis.normal the way a hand-sketched Sweep
// path's own Sketcher(plane)-built Sketch would carry.
//
// This is computed by actually building the helix wire and reading real
// values off it (wire.startPoint/tangentAt), rather than independently
// re-deriving OpenCascade's gp_Ax3(origin,dir) X-direction convention by
// hand — that convention is a real, deterministic algorithm, but it's
// undocumented from the JS binding's perspective and not worth risking a
// silent mismatch (a mirrored/misaligned profile plane) when replicad's own
// wire object already knows the exact answer for free.
function computeSpringPathPlane({ pitchMm, heightMm, coilRadiusMm, origin, normal, lefthand=false }) {
  const pathSketch = sketchHelix(pitchMm, heightMm, coilRadiusMm, origin, normal, lefthand)
  const startPoint = pathSketch.wire.startPoint
  const tangent = pathSketch.wire.tangentAt(1e-9).multiply(-1).normalize()
  const xDir = tangent.cross(new Vector([0, 0, 1])).multiply(-1).normalize()
  return {
    origin: [startPoint.x, startPoint.y, startPoint.z],
    normal: [tangent.x, tangent.y, tangent.z],
    uAxis: [xDir.x, xDir.y, xDir.z],
  }
}

function buildExtrude({ pts, depthMm, planeId, direction='both',
                        normal, origin, uAxis, vAxis, isCut=false, circle=null,
                        draftAngleDeg=0, draftDirection='out' }) {
  if (!circle && (!pts||pts.length<3)) throw new Error('Need ≥3 pts')
  const half = depthMm / 2
  // 1mm protrusion on the entry face prevents OCC coincident-face Boolean failures
  const OVH = isCut ? 1 : 0

  let shape
  if (direction === 'front') {
    if (planeId === 'face' && isCut) {
      // Replicad face plane normal points OUTWARD; 'front' cut means INWARD.
      // Put profile depthMm inside the solid and extrude outward through the face + OVH.
      shape = makeProfile(pts, planeId, -depthMm, normal, origin, uAxis, circle).extrude(depthMm + OVH)
    } else {
      // Work plane, or a regular (non-cut) extrude off a face: profile sits right at the
      // face/plane and grows outward by depthMm. Applying the cutout's "profile inside,
      // extrude back out to the face" math here for a plain extrude would build the new
      // solid entirely inside the existing one — geometrically valid but invisible.
      shape = makeProfile(pts, planeId, -OVH, normal, origin, uAxis, circle).extrude(depthMm + OVH)
    }
  } else if (direction === 'back') {
    // Profile stays at depth; extend extrude by OVH so exit face clears the solid boundary.
    shape = makeProfile(pts, planeId, -depthMm, normal, origin, uAxis, circle).extrude(depthMm + OVH)
  } else {
    // 'both': sketch at -half, extrude +depth → symmetric around sketch plane (no coincident face)
    shape = makeProfile(pts, planeId, -half, normal, origin, uAxis, circle).extrude(depthMm)
  }

  if (draftAngleDeg) {
    // Draft is a plain-extrude-only option (never applied for isCut) — a tapered
    // pocket/hole isn't wired up yet, see the feature plan. The neutral plane is
    // always the ORIGINAL sketch plane at offset 0, regardless of direction mode:
    // buildProfilePlane with offsetMm=0 reproduces exactly where the user drew
    // their profile, independent of the -OVH/-half/-depthMm shifts above that
    // only exist for OCC boolean robustness.
    const neutralPlane = buildProfilePlane(planeId, 0, normal, origin, uAxis)
    // FaceFinder.atAngleWith(dir, 90) is sign-invariant (perpendicularity
    // doesn't care which way `dir` points), so negating this vector for
    // 'back' has zero effect on which faces get selected — it's only here
    // to read naturally as "the direction the extrude grew".
    const pull = direction === 'back' ? neutralPlane.zDir.multiply(-1) : neutralPlane.zDir
    // OCC's actual taper direction is governed by neutralPlane's own normal
    // (always +local-Z here, regardless of front/back) — NOT by the `pull`
    // vector above. 'back' builds into -Z from the neutral plane (the
    // opposite of 'front', which builds into +Z), so with an unflipped
    // signedAngle "Out" would come out wider at the NEAR end (toward Z=0)
    // instead of the far end — flip the sign for 'back' so "Out"/"In" mean
    // the same visual thing (wider/narrower at the far end from the sketch)
    // no matter which direction the extrude actually grew. Verified
    // empirically: front+Out tapers wide-away-from-sketch correctly as-is;
    // back+Out needed this flip to match (confirmed live, both directions).
    let signedAngle = draftDirection === 'in' ? draftAngleDeg : -draftAngleDeg
    if (direction === 'back') signedAngle = -signedAngle
    try {
      shape = shape.draft(signedAngle, f => f.atAngleWith(pull, 90), neutralPlane)
    } catch(e) {
      // OCC/replicad can throw a bare string or a non-Error exception here
      // (confirmed live: an 85°-on-5mm draft threw something with no
      // .message at all) — fall back to a message that's still actionable
      // instead of surfacing "Draft failed: undefined".
      throw new Error(`Draft failed: ${e?.message || 'angle too steep for this depth — try a smaller angle'}`)
    }
    // Shape.draft() has no built-in validity check (unlike fillet/chamfer, which
    // throw on an empty edge selection) — it silently returns whatever OCC built
    // even when the angle is steep enough to self-intersect a short wall. Same
    // BRepCheck_Analyzer guard already used after fillet/chamfer, so a bad draft
    // surfaces as a clean error instead of a corrupted solid.
    const oc = getOC()
    const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false)
    const valid = analyzer.IsValid_2()
    analyzer.delete()
    if (!valid) throw new Error('Draft failed: angle too steep for this depth — try a smaller angle')
  }

  return shape
}

// Rebuilds a solid's OWN base shape (no cuts/fillets applied) from its stored
// params — used whenever the worker's shapeStore doesn't have a solid cached
// (e.g. right after a fresh page load). `profiles` (array) means Loft;
// `axis` means Revolve, not a linear extrude; `stepText` means an imported
// STEP body being re-imported (same text, same result, every time) — same
// discriminators already used everywhere else a base gets cold-rebuilt
// (cuts, fillets, STL export, Join member fallback), so both Loft and
// Import slot into all of them for free. Async (unlike every other branch
// here) only because importSTEP itself is — it has to read the Blob's
// bytes before OCC can parse them.
async function buildBase(params) {
  if (params.stepText) return await importSTEP(new Blob([params.stepText]))
  if (params.profiles) return buildLoft(params)
  // Pre-existing gap: Sweep's pathPts shape had no branch here at all,
  // silently falling through to buildExtrude and throwing "Need ≥3 pts" —
  // surfaced by mirrorShape (below), which calls buildBase unconditionally
  // whenever base params are supplied, unlike subtract/fillet3d's
  // shapeStore-first fallback. Fixed alongside adding Spring's own params,
  // which would hit the identical gap otherwise.
  if (params.pitchMm !== undefined) return buildSpring(params)
  if (params.pathPts) return buildSweep(params)
  return params.axis ? buildRevolve(params) : buildExtrude(params)
}


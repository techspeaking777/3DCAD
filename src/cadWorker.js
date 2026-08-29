import opencascade from 'replicad-opencascadejs/src/replicad_single.js'
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import { setOC, Sketcher, Plane, makePlane, sketchCircle, getOC, cast, localGC, FaceFinder, Vector, importSTEP } from 'replicad'

const SCALE = 2
// Tolerance (mm) for matching a picked screen point to the actual OCC edge —
// generous enough for mesh-tessellation slop, tight enough to avoid grabbing
// a neighboring edge. Shared by the fillet3d handler and STL export's fallback replay.
const EDGE_PICK_TOL = 0.75
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
          shape = shape.fillet(op.radius, e => e.either(
            op.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
          ))
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
  const result = cast(op.Shape())
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
    if (cosAngle > 0.999) {
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
      return
    }
    if (edge.isClosed) {
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

// Builds the shape to subtract for one cut op — linear extrude (plain),
// revolve (`axis` present), or loft (`profiles` present, e.g. a tapered
// pocket cut via App3D.jsx's Loft Cutout tool). Same discriminator
// convention buildBase() below already uses for cold-rebuild fallbacks;
// this is the cut-shape counterpart, shared by every op-replay loop
// (subtract, mirrorShape, joinShapes, exportSTL) so all four stay in sync.
// isCut adds a 1mm protrusion so a cut ending flush with a solid's face
// doesn't fail on coincident-face booleans — see extendLoftCutProfiles for
// the loft-shaped-cut equivalent (buildRevolve has no such treatment yet).
function buildCutShape(cut) {
  return cut.profiles ? buildLoft({ ...cut, profiles: extendLoftCutProfiles(cut.profiles) })
    : cut.axis ? buildRevolve(cut) : buildExtrude({ ...cut, isCut: true })
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
        base = await buildBase(params.base)
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
          base = base.fillet(op.radius, e => e.either(
            op.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
          ))
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
              s = s.fillet(op.radius, e => e.either(
                op.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
              ))
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
            base = base.fillet(op.radius, e => e.either(
              op.edgePoints.map(pt => f => f.withinDistance(EDGE_PICK_TOL, pt))
            ))
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
function buildMixedProfile(sketcher, pts, curveSegments) {
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
        // closing point back onto anchor.
        const isLastBeforeClose = segPtr === segs.length - 1 && (seg.startIdx + seg.count) >= n
        emitArc(sketcher, seg, isLastBeforeClose ? anchor : null)
      }
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
  return params.axis ? buildRevolve(params) : buildExtrude(params)
}


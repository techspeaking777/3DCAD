import opencascade from 'replicad-opencascadejs/src/replicad_single.js'
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url'
import { setOC, Sketcher, Plane, makePlane, sketchCircle } from 'replicad'

const SCALE = 2

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
      // Each entry in params.solids is one top-level extrude body (its cutouts
      // already baked in). Prefer the shapeStore's current cached shape (fast,
      // and reflects the live state exactly); rebuild from base+cuts only if
      // the cache doesn't have it — e.g. after a fresh load with no edits yet.
      const shapes = params.solids.map(({ solidId, base, cuts }) => {
        let shape = shapeStore.get(solidId)
        if (!shape) {
          shape = buildExtrude(base)
          for (const cut of cuts) shape = shape.cut(buildExtrude({ ...cut, isCut: true }))
        }
        return shape
      })
      if (shapes.length === 0) throw new Error('No solids to export')
      let fused = shapes[0]
      for (let i = 1; i < shapes.length; i++) fused = fused.fuse(shapes[i])
      // Same tolerances used for the on-screen render mesh elsewhere in this
      // file, so the printed geometry matches what was previewed.
      const blob = fused.blobSTL({ tolerance:0.05, angularTolerance:30, binary: true })
      self.postMessage({ type:'result', id, stlBlob: blob })
      return
    }

    let shape
    if (type==='extrude'||type==='cutout') {
      shape = buildExtrude(params)
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='revolve') {
      shape = buildRevolve(params)
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='fillet') {
      shape = buildFillet(params)
      if (params.solidId) shapeStore.set(params.solidId, shape)
    } else if (type==='subtract') {
      let base = shapeStore.get(params.baseSolidId)
      const fromStore = !!base
      if (!base) {
        if (!params.base) throw new Error(`Step1-MISS: base not in store and no fallback params`)
        console.warn('[cadWorker] shapeStore miss — rebuilding base from params')
        try { base = buildExtrude(params.base) }
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

function buildFillet({ filletRadius=2, ...rest }) {
  const solid = buildExtrude(rest)
  try { return solid.fillet(filletRadius) }
  catch(e) { console.warn('Fillet failed:', e.message); return solid }
}


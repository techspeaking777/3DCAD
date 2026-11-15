import * as THREE from 'three'
import { pxToMm, norm2pi } from '../constants.js'
import { splineToPolyline } from './splineMath.js'
import { dimPrimitives } from './dimGeometry.js'
import { FacePlane } from '../FacePlane.js'

function dlText(filename, content, mime) {
  const a = Object.assign(document.createElement('a'), {
    href: 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(content),
    download: filename
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── JSON Save ─────────────────────────────────────────────────────────────────
export function saveJSON(lines, circles, arcs, splines=[], dims=[], filename = 'drawing.json') {
  const data = JSON.stringify({ lines, circles, arcs, splines, dims }, null, 2)
  dlText(filename, data, 'application/json')
}

// True in Chromium browsers (Chrome, Edge) — lets the user pick both the
// folder and filename via the OS's native Save dialog. Firefox/Safari lack this,
// so callers should fall back to prompting for a filename and downloading normally.
export const canPickSaveLocation = () => typeof window !== 'undefined' && !!window.showSaveFilePicker

// Saves the project under a chosen name. When the File System Access API is
// available, opens the native Save dialog (folder + filename, pre-filled with
// suggestedName) and writes directly to the chosen file. Otherwise downloads
// to the browser's default download location using suggestedName.
// Returns 'saved', 'cancelled' (user closed the native dialog), or 'downloaded'.
export async function saveProjectAs(lines, circles, arcs, splines=[], dims=[], suggestedName='drawing.json') {
  const data = JSON.stringify({ lines, circles, arcs, splines, dims }, null, 2)
  if (canPickSaveLocation()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'CAD drawing', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(data)
      await writable.close()
      return 'saved'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  dlText(suggestedName, data, 'application/json')
  return 'downloaded'
}

// Generic binary counterpart to saveProjectAs()/exportFaceDXF() — same native
// Save dialog when available, straight Blob download otherwise. Used for STL
// export (and anything else that hands over a ready-made Blob rather than
// text). `accept` is a File System Access API accept map, e.g.
// {'model/stl': ['.stl']}. Returns 'saved', 'cancelled', or 'downloaded'.
export async function saveBlobAs(blob, suggestedName, description, accept) {
  if (canPickSaveLocation()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return 'downloaded'
}

// ── Whole-project save/load (.trc) ──────────────────────────────────────────
// Unlike saveJSON/loadJSON above (which only ever captured the active 2D
// sketch buffer), this serializes the full `features` array — the feature
// tree's actual source of truth — so reopening a project reconstructs every
// sketch/extrude/cutout/fillet/mirror/join/loft, not just whatever sketch
// happened to be on screen. Solids themselves are never serialized (they're
// live Three.js groups backed by WASM/OCC shapes with no JSON form) — on
// load the whole tree is replayed through cadEngine instead, the same way
// editing a feature already rebuilds its dependency chain today.
//
// Two field shapes need special handling because plain JSON.stringify either
// mangles or silently drops them:
//   - FacePlane is a class instance (THREE.Vector3 fields + a derived
//     THREE.Plane). Its numeric fields *would* survive stringify/parse, but
//     the result loses its prototype (no worldToSketch/sketchToWorld), so it
//     must be unpacked to plain arrays and reconstructed with `new FacePlane`.
//   - profilePts (and each loft profile's `pts`) carry circleMeta/
//     curveSegments as bolted-on NON-INDEX array properties (see
//     tools/extrudeMath.js) — JSON.stringify only serializes index
//     properties on arrays, so a raw `JSON.stringify(profilePts)` silently
//     drops them, corrupting true-circle/arc/spline profile info.

function vec3ToArr(v) { return v ? [v.x, v.y, v.z] : null }
function arrToVec3(a) { return a ? new THREE.Vector3(a[0], a[1], a[2]) : null }

function serializeFacePlane(fp) {
  if (!fp) return null
  return {
    origin: vec3ToArr(fp.origin),
    normal: vec3ToArr(fp.normal),
    uAxis:  vec3ToArr(fp.uAxis),
    vAxis:  vec3ToArr(fp.vAxis),
    ...(fp.free ? { free: true } : {}),
  }
}
function deserializeFacePlane(obj) {
  if (!obj) return null
  const fp = new FacePlane(arrToVec3(obj.origin), arrToVec3(obj.normal), arrToVec3(obj.uAxis), arrToVec3(obj.vAxis))
  if (obj.free) fp.free = true
  return fp
}

// Packs a profile-points array (possibly carrying .circleMeta/.curveSegments/
// .holes) into a plain, fully JSON-safe object. `pts` itself is undefined
// for features that never had a profile (e.g. mirror/join) — pass through
// null. `.holes` (nested closed loops resolved as holes of this profile —
// see resolveNestedHoles in extrudeMath.js) is itself an array of pts-arrays
// that can carry their OWN circleMeta/curveSegments (e.g. a round hole), so
// it's packed recursively through this same function rather than as a bare
// array — a plain `pts.holes` was silently dropped entirely by
// JSON.stringify same as circleMeta/curveSegments, since it's a non-index
// array property, which meant every nested hole vanished on save/reload.
function serializePts(pts) {
  if (!pts) return null
  return {
    arr: pts.map(p => ({ ...p })),
    circleMeta: pts.circleMeta || null,
    curveSegments: pts.curveSegments || null,
    holes: pts.holes ? pts.holes.map(serializePts) : null,
  }
}
function deserializePts(obj) {
  if (!obj) return null
  const arr = obj.arr.map(p => ({ ...p }))
  if (obj.circleMeta) arr.circleMeta = obj.circleMeta
  if (obj.curveSegments) arr.curveSegments = obj.curveSegments
  if (obj.holes) arr.holes = obj.holes.map(deserializePts)
  return arr
}

// A sketch entity (line/circle/arc/spline) drawn on a face carries its own
// `.facePlane` — every draw tool tags it via planeTag() in App3D.jsx, not
// just the feature-level one handled above. Left as a raw FacePlane class
// instance, a plain JSON.stringify still "succeeds" (no error) but silently
// flattens it to a dead plain object — origin/normal/etc. survive as {x,y,z}
// but the prototype (sketchToWorld) is gone. pt2three() in Viewport3D.jsx
// checks `facePlane.sketchToWorld` before using it, so this doesn't crash or
// even show up while the project is still open — it only surfaces after a
// save/reload, when every face-sketched entity's points silently render at
// the wrong (default XY-at-origin) position while the entity's own 2D data
// (and the FEATURE's own facePlane, correctly reconstructed above) stays
// perfectly fine, which is exactly why the camera and the FEATURE outline
// snap to the right place but the individual sketch lines/circles drift off
// as you orbit away from square-on. Same fix shape as serializeFacePlane
// above, just applied per-entity across a whole array.
function serializeSketchEntities(arr) {
  if (!arr) return arr
  return arr.map(e => e.facePlane ? { ...e, facePlane: serializeFacePlane(e.facePlane) } : e)
}
function deserializeSketchEntities(arr) {
  if (!arr) return arr
  return arr.map(e => e.facePlane ? { ...e, facePlane: deserializeFacePlane(e.facePlane) } : e)
}

// Every array of raw sketch entities that might carry a per-entity
// .facePlane — the standalone-sketch field names (lines/circles/arcs/
// splines) and the extrude/cutout saved-sketch-buffer names (sketchLines/
// sketchCircles/sketchArcs/sketchSplines) both need it.
const SKETCH_ENTITY_FIELDS = ['lines', 'circles', 'arcs', 'splines', 'sketchLines', 'sketchCircles', 'sketchArcs', 'sketchSplines']

// `hidden` is passed in explicitly (from the matching `solids` entry) since
// it lives on solid state, not the feature itself — see saveProjectFileAs.
export function serializeFeature(feat, hidden = false) {
  const out = { ...feat, hidden }
  if (feat.facePlane) out.facePlane = serializeFacePlane(feat.facePlane)
  if (feat.profilePts) out.profilePts = serializePts(feat.profilePts)
  // A Sweep path is a bare point array whose `.curveSegments` (the real spline/
  // arc data) is an expression-property JSON.stringify silently drops — saved
  // as plain points, a smooth spline path reloaded as a 100-segment zig-zag
  // that the sweep could no longer build. Files written before this fix still
  // hold plain arrays; deserializeFeature accepts both.
  if (feat.pathPts) out.pathPts = serializePts(feat.pathPts)
  if (feat.profiles) out.profiles = feat.profiles.map(p => ({ ...p, pts: serializePts(p.pts) }))
  for (const key of SKETCH_ENTITY_FIELDS) {
    if (feat[key]) out[key] = serializeSketchEntities(feat[key])
  }
  return out
}
export function deserializeFeature(obj) {
  const out = { ...obj }
  if (obj.facePlane) out.facePlane = deserializeFacePlane(obj.facePlane)
  if (obj.profilePts) out.profilePts = deserializePts(obj.profilePts)
  if (obj.pathPts && !Array.isArray(obj.pathPts)) out.pathPts = deserializePts(obj.pathPts)
  if (obj.profiles) out.profiles = obj.profiles.map(p => ({ ...p, pts: deserializePts(p.pts) }))
  for (const key of SKETCH_ENTITY_FIELDS) {
    if (obj[key]) out[key] = deserializeSketchEntities(obj[key])
  }
  return out
}

const PROJECT_FORMAT_VERSION = 1

// `drawingSheet` (optional) is the Drawing tab's own content — lines/circles/
// arcs/splines/dims/pageConfig, the same shape its own plain-JSON save
// already uses (see App.jsx's getSheetData) — folded in as a sibling to
// `features` so one .trc round-trips both the 3D feature tree and whatever's
// on the Drawing tab's sheet. Absent on older files; loads as an empty sheet.
// Exported (not just used internally by saveProjectFileAs below) so
// cloudSave.js's account-save path can produce the exact same payload
// shape — a saved project should be identical whether it lands in a local
// .trc file or a cad_projects row.
//
// `snapshots` (optional, [{solidId, data}] from cadEngine.snapshotShapes) are the
// finished shapes of the bodies, saved NEXT TO the feature recipe so opening the
// project can skip replaying every feature. They are only a cache: the features stay
// the source of truth, and the block carries a fingerprint of them so a snapshot that
// no longer matches (file edited by hand, features changed) is ignored on load.
// Bump when the worker starts building a saved recipe DIFFERENTLY (v2: failed
// circle cuts are re-cut as true arcs, not a 96-gon; v3: a spline is ONE B-spline
// edge, not a Bezier per span; v4: a closed spline is a closed curve, not open +
// a straight closing line; v5: features made before that build the old way —
// markLegacySplines) — older cached shapes are
// then ignored once and every body is rebuilt from its features on next open.
const SNAPSHOT_FORMAT_VERSION = 5

// A hash of the features that decide the geometry — not their name, colour or hidden
// flag (those change without touching a shape). Works on the plain objects as saved,
// so it comes out the same when recomputed from a parsed file.
export function featuresFingerprint(featureObjs) {
  const text = JSON.stringify(featureObjs.map(f => { const rest = { ...f }; delete rest.hidden; delete rest.color; delete rest.name; return rest }))
  // cyrb53 — a fast 53-bit string hash; plenty to tell "same recipe" from "different".
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + text.length
}

export function serializeProject(features, solids, drawingSheet, snapshots = null) {
  const hiddenById = new Map(solids.map(s => [s.id, !!s.hidden]))
  const featureObjs = features.map(f => serializeFeature(f, hiddenById.get(f.solidId) || false))
  return JSON.stringify({
    formatVersion: PROJECT_FORMAT_VERSION,
    app: '3d-retro-cad',
    splineBuild: SPLINE_BUILD,   // see markLegacySplines
    features: featureObjs,
    ...(snapshots?.length ? {
      snapshots: { version: SNAPSHOT_FORMAT_VERSION, fingerprint: featuresFingerprint(featureObjs), shapes: snapshots },
    } : {}),
    ...(drawingSheet ? { sheet: drawingSheet } : {}),
  }, null, 2)
}

// Saves the whole feature tree under a chosen name — the .trc counterpart of
// saveProjectAs() above. Same native-Save-dialog-or-download behavior.
//
// `existingHandle` (a FileSystemFileHandle from a previous save) lets a
// caller implement real "Save" semantics on top of this "Save As" primitive:
// pass the handle back in and this re-writes the SAME file silently, with no
// dialog at all — skipping both the repeated native-dialog popup AND the
// dialog re-suggesting the generic `suggestedName` every time, which is what
// made every Ctrl+S look like it was always saving a fresh "drawing.trc".
// Falls through to a fresh picker if the handle has gone stale (file moved/
// deleted/permission revoked) rather than failing outright.
//
// The native picker is opened BEFORE serializing (`serializeProject` can be
// non-trivial for a large feature tree — dense splines, text-extrude glyph
// outlines, etc.) so the dialog appears immediately instead of after a
// noticeable blocked-main-thread delay.
//
// Returns {status: 'saved'|'cancelled'|'downloaded', handle: FileSystemFileHandle|null}.
// `getSnapshots` (optional async fn → [{solidId, data}] | null) supplies the body snapshots;
// it is awaited AFTER the picker so a slow worker never eats the click's permission to open it,
// and a failure there only costs the cache, never the save.
export async function saveProjectFileAs(features, solids, suggestedName = 'drawing.trc', existingHandle = null, drawingSheet = null, getSnapshots = null) {
  if (existingHandle) {
    try {
      const data = serializeProject(features, solids, drawingSheet, await safeSnapshots(getSnapshots))
      const writable = await existingHandle.createWritable()
      await writable.write(data)
      await writable.close()
      return { status: 'saved', handle: existingHandle }
    } catch { /* stale handle — fall through to a fresh picker below */ }
  }
  if (canPickSaveLocation()) {
    let handle
    try {
      handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: '3D Retro CAD project', accept: { 'application/json': ['.trc'] } }],
      })
    } catch (err) {
      if (err && err.name === 'AbortError') return { status: 'cancelled', handle: null }
      throw err
    }
    const data = serializeProject(features, solids, drawingSheet, await safeSnapshots(getSnapshots))
    const writable = await handle.createWritable()
    await writable.write(data)
    await writable.close()
    return { status: 'saved', handle }
  }
  const data = serializeProject(features, solids, drawingSheet, await safeSnapshots(getSnapshots))
  dlText(suggestedName, data, 'application/json')
  return { status: 'downloaded', handle: null }
}

async function safeSnapshots(getSnapshots) {
  if (!getSnapshots) return null
  try { return await getSnapshots() } catch { return null }
}

// Validates and unpacks an already-parsed project object (the same shape
// serializeProject() produces) into {features, formatVersion, sheet} —
// pulled out of loadProjectFile below so cloudSave.js's account-load path
// can run a project fetched as JSON (no File involved) through the exact
// same validation/deserialization a local .trc file gets, rather than
// duplicating it. Throws if `features` isn't present/an array.
// ── Old spline build ──────────────────────────────────────────────────────────
// On 2026-11-15 (commits 7406870, 879264c) a hand-drawn spline started building
// as ONE smooth B-spline edge, and a closed spline as a truly closed curve. That
// changed the shape of curved bodies made BEFORE then: fillets and cuts made on
// the old split walls stopped fitting (a student's 3.6 mm fillet now fits only
// 1.3 mm, and on the live site the whole body vanished). Old work must rebuild
// exactly as it was made, so a project saved without `splineBuild` gets the
// spline curve segments of every feature created before the change marked
// `legacy: true`, which the worker builds the old way (emitBezierSegs /
// isClosedSplineSeg). The mark is saved with the curve from then on; a sketch
// that is re-drawn gets fresh, unmarked (new-build) segments.
export const SPLINE_BUILD = 2
const SPLINE_CUTOVER_MS = Date.parse('2026-11-15T05:39:42Z')
// When a feature was made: the timestamp in its id, else its body id (both come
// from Date.now()); 0 (= old) when neither has one.
function featureCreatedMs(f) {
  const m = /(\d{12,14})/.exec(String(f.id ?? ''))
  if (m) return Number(m[1])
  const sid = Number(f.solidId)
  return Number.isFinite(sid) && sid > 1e12 ? sid : 0
}
function markLegacySplines(node, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) {
    if (node.curveSegments) for (const seg of node.curveSegments) if (seg?.type === 'spline') seg.legacy = true
    if (node.holes) markLegacySplines(node.holes, seen)
    for (const item of node) {
      if (item && typeof item === 'object' && !(typeof item.x === 'number' && typeof item.y === 'number')) markLegacySplines(item, seen)
    }
    return
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') markLegacySplines(v, seen)
}

export function parseProjectData(data) {
  if (!data || !Array.isArray(data.features)) throw new Error('Not a project file (no feature tree)')
  // Snapshots are used only when they were written for exactly these features.
  const snap = data.snapshots
  const snapshots = snap && snap.version === SNAPSHOT_FORMAT_VERSION && Array.isArray(snap.shapes) && snap.shapes.length
    && snap.fingerprint === featuresFingerprint(data.features)
    ? snap.shapes : null
  const features = data.features.map(deserializeFeature)
  if (!(data.splineBuild >= SPLINE_BUILD)) {
    for (const f of features) if (featureCreatedMs(f) < SPLINE_CUTOVER_MS) markLegacySplines(f)
  }
  return { features, formatVersion: data.formatVersion, sheet: data.sheet || null, snapshots }
}

// Parses a .trc (or legacy-incompatible) file. Throws if `features` isn't
// present/an array so callers can fall back to the old sketch-buffer-only
// loadJSON() for files saved before this format existed.
export function loadProjectFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file'))
    const reader = new FileReader()
    reader.onload = e => {
      try {
        resolve(parseProjectData(JSON.parse(e.target.result)))
      } catch (err) {
        reject(err.message === 'Not a project file (no feature tree)' ? err : new Error('Could not parse file'))
      }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsText(file)
  })
}

// ── JSON Load ─────────────────────────────────────────────────────────────────
export function loadJSON(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file'))
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result)
        if (!Array.isArray(data.lines) || !Array.isArray(data.circles) || !Array.isArray(data.arcs))
          return reject(new Error('Invalid drawing file'))
        resolve({
          lines:   data.lines,
          circles: data.circles,
          arcs:    data.arcs,
          splines: Array.isArray(data.splines) ? data.splines : [],
        })
      } catch {
        reject(new Error('Could not parse file'))
      }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsText(file)
  })
}

// ── DXF Export ────────────────────────────────────────────────────────────────
// Lines exported as LINE entities.
// Circles exported as native CIRCLE entities (mathematically exact).
// Arcs exported as native ARC entities (mathematically exact).
// Splines sampled to polyline LINE segments (DXF SPLINE uses NURBS which differs
// from Catmull-Rom, so polyline approximation is the safe choice).

function dxfLayer(style) {
  return style==='construction' ? 'CONSTRUCTION' : '0'
}

function dxfLtype(style) {
  return style==='dashed' ? '\n6\nDASHED' : style==='center' ? '\n6\nCENTER' : ''
}

function dxfLine(x1,y1,x2,y2,style) {
  return `0\nLINE\n8\n${dxfLayer(style)}${dxfLtype(style)}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0.0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0.0\n`
}

// Native DXF CIRCLE entity — exact, one entity, readable by all CAD applications
function dxfCircle(cx,cy,r,style) {
  return `0\nCIRCLE\n8\n${dxfLayer(style)}${dxfLtype(style)}\n10\n${cx.toFixed(4)}\n20\n${cy.toFixed(4)}\n30\n0.0\n40\n${r.toFixed(4)}\n`
}

// Native DXF ARC entity — exact, CCW convention, Y-axis already flipped by caller
function dxfArc(cx,cy,r,startDeg,endDeg,style) {
  return `0\nARC\n8\n${dxfLayer(style)}${dxfLtype(style)}\n10\n${cx.toFixed(4)}\n20\n${cy.toFixed(4)}\n30\n0.0\n40\n${r.toFixed(4)}\n50\n${startDeg.toFixed(6)}\n51\n${endDeg.toFixed(6)}\n`
}

// An arc whose startAngle/endAngle are (within noise) equal represents a full
// 2π sweep with an endpoint marker for chaining onto another entity — e.g. a
// circle trimmed at a single tangent point, where there's nothing to actually
// cut, just a connection point to introduce (see angleOnArc in
// geometry/intersections.js for the same ambiguity on the read/hit-test
// side). Writing that as a DXF ARC entity means a start/end pair a hairsbreadth
// apart (like "0°"/"359.999999°") — most DXF readers round that gap away and
// treat the arc as zero-length, silently dropping it. A native CIRCLE entity
// has no such ambiguity, so full-sweep arcs export as one instead.
function isFullSweepArc(a) {
  // Checked the SHORT way around the circle — start=2π-ε, end=0 are
  // practically the same point, but their raw difference is ≈2π, not ≈0
  // (see angleOnArc in geometry/intersections.js for the same check).
  const diff = Math.abs(norm2pi(a.startAngle) - norm2pi(a.endAngle))
  return Math.min(diff, 2*Math.PI-diff) < 1e-4
}

// A filled triangle (dimension arrowhead) as a DXF SOLID — corners 3 and 4
// are the same point for a triangle.
function dxfSolid(p, layer) {
  const [a, b, c] = p
  return `0\nSOLID\n8\n${layer}\n10\n${a[0].toFixed(4)}\n20\n${a[1].toFixed(4)}\n30\n0.0\n11\n${b[0].toFixed(4)}\n21\n${b[1].toFixed(4)}\n31\n0.0\n12\n${c[0].toFixed(4)}\n22\n${c[1].toFixed(4)}\n32\n0.0\n13\n${c[0].toFixed(4)}\n23\n${c[1].toFixed(4)}\n33\n0.0\n`
}

// `opts.dims` / `opts.dimStyle`: the Drawing tab's dimensions, written as
// plain lines, arcs and filled arrows on a DIMENSIONS layer (from the same
// dimGeometry primitives the canvas and PDF draw).
export function exportDXF(lines, circles, arcs, splines=[], filename='drawing.dxf', opts={}) {
  const mm   = px => pxToMm(px)
  const fy   = y  => -mm(y)
  const mmPt = p  => ({x:mm(p.x), y:fy(p.y)})

  // Convert canvas-space angle (radians, Y-down) to DXF angle (degrees, Y-up)
  const toDXFdeg = rad => { const d = -rad * 180 / Math.PI; return ((d % 360) + 360) % 360 }

  let entities = ''

  // ── Lines ──────────────────────────────────────────────────────────────────
  lines.forEach(l => {
    entities += dxfLine(mm(l.x1), fy(l.y1), mm(l.x2), fy(l.y2), l.style)
  })

  // ── Circles — native CIRCLE entity ────────────────────────────────────────
  circles.forEach(c => {
    entities += dxfCircle(mm(c.cx), fy(c.cy), mm(c.r), c.style)
  })

  // ── Arcs — native ARC entity ───────────────────────────────────────────────
  // Canvas arcs are CW (Y-down). DXF arcs are CCW (Y-up).
  // Y-flip reverses direction so we swap start/end angles.
  arcs.forEach(a => {
    const cx = mm(a.cx), cy = fy(a.cy), r = mm(a.r)
    if (isFullSweepArc(a)) { entities += dxfCircle(cx, cy, r, a.style); return }
    const startDeg = toDXFdeg(a.endAngle)
    const endDeg   = toDXFdeg(a.startAngle)
    entities += dxfArc(cx, cy, r, startDeg, endDeg, a.style)
  })

  // ── Splines — polyline LINE segments ──────────────────────────────────────
  splines.forEach(sp => {
    if (sp.points.length < 2) return
    const pts = sp.polyline ? sp.points : splineToPolyline(sp.points, sp.closed, 24)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = mmPt(pts[i]), b = mmPt(pts[i+1])
      entities += dxfLine(a.x, a.y, b.x, b.y, sp.style)
    }
  })

  // ── Dimensions ────────────────────────────────────────────────────────────
  for (const d of opts.dims || []) {
    const pr = dimPrimitives(d, opts.dimStyle)
    pr.lines.forEach(l => {
      entities += `0\nLINE\n8\nDIMENSIONS\n10\n${mm(l.x1).toFixed(4)}\n20\n${fy(l.y1).toFixed(4)}\n30\n0.0\n11\n${mm(l.x2).toFixed(4)}\n21\n${fy(l.y2).toFixed(4)}\n31\n0.0\n`
    })
    pr.arcs.forEach(a => {
      entities += `0\nARC\n8\nDIMENSIONS\n10\n${mm(a.cx).toFixed(4)}\n20\n${fy(a.cy).toFixed(4)}\n30\n0.0\n40\n${mm(a.r).toFixed(4)}\n50\n${toDXFdeg(a.end).toFixed(6)}\n51\n${toDXFdeg(a.start).toFixed(6)}\n`
    })
    pr.arrows.forEach(t => { entities += dxfSolid(t.map(([x, y]) => [mm(x), fy(y)]), 'DIMENSIONS') })
  }
  const dxf =
    '0\nSECTION\n2\nHEADER\n' +
    '9\n$INSUNITS\n70\n4\n' +
    '0\nENDSEC\n' +
    '0\nSECTION\n2\nENTITIES\n' +
    entities +
    '0\nENDSEC\n0\nEOF\n'

  dlText(filename, dxf, 'application/dxf')
}

// Writes a DXF for a solid face exported straight from its real OCC geometry
// (see cadEngine.exportFaceDXF/cadWorker.js) — lines/circles/arcs here are
// ALREADY in real mm and already in a standard right-handed (u,v) frame, not
// the app's screen-space Y-down sketch convention exportDXF() above converts
// from. Don't route this through exportDXF(): its pxToMm/Y-flip would double-
// convert already-correct data.
// Opens the native Save dialog (folder + filename, pre-filled with
// suggestedName) when the File System Access API is available — same
// canPickSaveLocation()/showSaveFilePicker() pattern as saveProjectAs()
// above. Otherwise downloads to the browser's default location. Returns
// 'saved', 'cancelled' (user closed the native dialog), or 'downloaded'.
export async function exportFaceDXF(lines, circles, arcs, suggestedName='face.dxf') {
  const toDeg = rad => { const d = rad * 180 / Math.PI; return ((d % 360) + 360) % 360 }
  let entities = ''
  lines.forEach(l => { entities += dxfLine(l.x1, l.y1, l.x2, l.y2) })
  circles.forEach(c => { entities += dxfCircle(c.cx, c.cy, c.r) })
  arcs.forEach(a => {
    if (isFullSweepArc(a)) { entities += dxfCircle(a.cx, a.cy, a.r); return }
    entities += dxfArc(a.cx, a.cy, a.r, toDeg(a.startAngle), toDeg(a.endAngle))
  })
  const dxf =
    '0\nSECTION\n2\nHEADER\n' +
    '9\n$INSUNITS\n70\n4\n' +
    '0\nENDSEC\n' +
    '0\nSECTION\n2\nENTITIES\n' +
    entities +
    '0\nENDSEC\n0\nEOF\n'
  if (canPickSaveLocation()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'DXF drawing', accept: { 'application/dxf': ['.dxf'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(dxf)
      await writable.close()
      return 'saved'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  dlText(suggestedName, dxf, 'application/dxf')
  return 'downloaded'
}

// ── DXF Import ────────────────────────────────────────────────────────────────
// Parses DXF files and converts to our data model.
// Supports: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE/VERTEX, SPLINE

// Moves a parsed DXF ({lines, circles, arcs, splines}) so the middle of its
// overall bounding box sits on the origin — DXFs usually have their origin at
// the part's bottom-left corner, which otherwise lands the part off to one
// side. The whole drawing moves as one, so pieces keep their spacing.
// Returns {...result, box:{minX,maxX,minY,maxY}} (box after the move), or the
// result unchanged (box:null) when it has nothing in it.
export function centreDxfResult(result) {
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity
  const add = (x, y) => { minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y) }
  result.lines.forEach(l => { add(l.x1, l.y1); add(l.x2, l.y2) })
  result.circles.forEach(c => { add(c.cx-c.r, c.cy-c.r); add(c.cx+c.r, c.cy+c.r) })
  result.arcs.forEach(a => {
    // Real arc extent (ends + any compass points the sweep passes), not the
    // full circle — a big shallow arc would otherwise pull the centre off.
    const sweep = norm2pi(a.endAngle - a.startAngle) || 2*Math.PI
    const steps = 32
    for (let i = 0; i <= steps; i++) {
      const t = a.startAngle + sweep*i/steps
      add(a.cx + a.r*Math.cos(t), a.cy + a.r*Math.sin(t))
    }
  })
  result.splines.forEach(s => (s.points || []).forEach(p => add(p.x, p.y)))
  if (!isFinite(minX)) return { ...result, box: null }
  const dx = -(minX+maxX)/2, dy = -(minY+maxY)/2
  return {
    ...result,
    lines:   result.lines.map(l => ({ ...l, x1:l.x1+dx, y1:l.y1+dy, x2:l.x2+dx, y2:l.y2+dy })),
    circles: result.circles.map(c => ({ ...c, cx:c.cx+dx, cy:c.cy+dy })),
    arcs:    result.arcs.map(a => ({ ...a, cx:a.cx+dx, cy:a.cy+dy })),
    splines: result.splines.map(s => ({ ...s, points:(s.points || []).map(p => ({ ...p, x:p.x+dx, y:p.y+dy })) })),
    box: { minX:minX+dx, maxX:maxX+dx, minY:minY+dy, maxY:maxY+dy },
  }
}

// The drawing units a DXF says it is in (header $INSUNITS), as mm per unit.
// Unitless (0) or missing is taken as mm, as before. Common US / laser-cutter
// files are in inches and came in 25.4× too small without this.
const DXF_UNITS = {
  1: { name: "inches", mmPer: 25.4 }, 2: { name: "feet", mmPer: 304.8 },
  4: { name: "mm", mmPer: 1 }, 5: { name: "cm", mmPer: 10 }, 6: { name: "metres", mmPer: 1000 },
  8: { name: "microinches", mmPer: 0.0000254 }, 9: { name: "mils", mmPer: 0.0254 },
  10: { name: "yards", mmPer: 914.4 }, 13: { name: "microns", mmPer: 0.001 }, 14: { name: "decimetres", mmPer: 100 },
}
export function dxfUnits(dxfText) {
  const m = /\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(-?\d+)/.exec(dxfText)
  return (m && DXF_UNITS[parseInt(m[1])]) || { name: "mm", mmPer: 1 }
}

export function parseDXF(dxfText, pxPerMm=2) {
  // scale = px per DXF unit: our px-per-mm (SCALE) × the file's mm-per-unit.
  const units = dxfUnits(dxfText)
  const scale = pxPerMm * units.mmPer
  const mm = v => v * scale
  const lines_out = [], circles_out = [], arcs_out = [], splines_out = []

  // Split into group code / value pairs
  const raw = dxfText.replace(/\r/g,'').split('\n')
  const pairs = []
  for (let i = 0; i < raw.length-1; i+=2) {
    pairs.push([parseInt(raw[i].trim()), raw[i+1].trim()])
  }

  // Find ENTITIES section
  let inEntities = false
  let i = 0
  while (i < pairs.length) {
    const [code, val] = pairs[i]
    if (code===0 && val==='SECTION') { i++; continue }
    if (code===2 && val==='ENTITIES') { inEntities=true; i++; continue }
    if (code===2 && val==='ENDSEC' && inEntities) { break }
    if (!inEntities) { i++; continue }

    if (code===0) {
      const type=val
      i++
      // Read all properties of this entity
      const props = {}
      while (i < pairs.length && pairs[i][0] !== 0) {
        const [c,v] = pairs[i]
        if (c===8)  props.layer=v
        if (c===6)  props.linetype=v
        if (c===10) props.x=parseFloat(v)
        if (c===20) props.y=parseFloat(v)
        if (c===11) props.x2=parseFloat(v)
        if (c===21) props.y2=parseFloat(v)
        if (c===40) props.r=parseFloat(v)     // radius or bulge
        if (c===41) props.r2=parseFloat(v)    // start param
        if (c===42) props.r3=parseFloat(v)    // end param
        if (c===50) props.startAngle=parseFloat(v)*Math.PI/180
        if (c===51) props.endAngle=parseFloat(v)*Math.PI/180
        if (c===70) props.flags=parseInt(v)
        if (c===72) props.n=parseInt(v)       // vertex count
        i++
      }

      // Determine style from layer name
      const layer=(props.layer||'').toLowerCase()
      const style = layer.includes('construction')||layer.includes('cnst') ? 'construction'
                  : layer.includes('dashed')||layer.includes('dash') ? 'dashed'
                  : undefined

      const s = style?{style}:{}

      if (type==='LINE' && props.x!==undefined) {
        lines_out.push({
          x1:mm(props.x),  y1:-mm(props.y),   // flip Y (DXF Y-up, canvas Y-down)
          x2:mm(props.x2), y2:-mm(props.y2),
          ...s
        })
      }
      else if (type==='CIRCLE' && props.x!==undefined) {
        circles_out.push({ cx:mm(props.x), cy:-mm(props.y), r:mm(props.r), ...s })
      }
      else if (type==='ARC' && props.x!==undefined) {
        // DXF arc: CCW from startAngle to endAngle, Y-axis flipped
        const sa = -props.endAngle    // flip for canvas
        const ea = -props.startAngle
        arcs_out.push({ cx:mm(props.x), cy:-mm(props.y), r:mm(props.r),
          startAngle:sa, endAngle:ea, ...s })
      }
      else if (type==='LWPOLYLINE') {
        // Read vertices from group codes 10/20 sequences
        // We already read first x,y - need to re-scan
        // Actually LWPOLYLINE stores coords differently - handle inline
        // Re-parse from raw pairs for this entity
        const pts = []
        // pairs[i] is now at next entity — look back
        // We'll collect from props which only captured last x,y
        // Better: re-collect all 10/20 pairs for this entity
        // Since we consumed them above, collect from 'vertices' array approach below
        // Fall through to POLYLINE path using pts we can reconstruct
        if (props.x!==undefined) pts.push({x:mm(props.x),y:-mm(props.y)})
        if (pts.length>=2)
          splines_out.push({points:pts,closed:!!(props.flags&1),polyline:true,...s})
      }
      else if (type==='SPLINE') {
        // Control points from group 10/20 — same issue as LWPOLYLINE
        if (props.x!==undefined)
          splines_out.push({points:[{x:mm(props.x),y:-mm(props.y)}],closed:false,polyline:false,...s})
      }
      // Skip other entity types
    } else {
      i++
    }
  }

  // LWPOLYLINE and SPLINE need special treatment — re-parse with multi-vertex
  // support. parseDXFMultiVertex's own LINE/CIRCLE/ARC branches exist only
  // because it shares one raw-pairs walk with the vertex-entity handling —
  // its results for those three are otherwise identical to lines_out/
  // circles_out/arcs_out above, so only its splines are actually new data;
  // merging its lines/circles/arcs too would double every plain entity.
  const betterResult = parseDXFMultiVertex(dxfText, scale)

  return {
    lines: [...lines_out, ...betterResult.polyLines],
    circles: circles_out,
    arcs: [...arcs_out, ...betterResult.polyArcs],
    splines: betterResult.splines,
    units: units.name,
  }
}

// Second pass: handle multi-vertex entities properly
function parseDXFMultiVertex(dxfText, scale) {
  const mm = v => v * scale
  const lines_out = [], circles_out = [], arcs_out = [], splines_out = []
  const polyLines = [], polyArcs = []   // a rounded polyline's spans (new data, unlike lines_out/arcs_out)

  const raw = dxfText.replace(/\r/g,'').split('\n')

  let inEntities = false
  let i = 0
  while (i < raw.length) {
    const code = parseInt(raw[i]?.trim())
    const val  = raw[i+1]?.trim()
    i += 2
    if (isNaN(code)) continue

    if (code===2 && val==='ENTITIES') { inEntities=true; continue }
    if (code===2 && val==='ENDSEC') break
    if (!inEntities) continue

    if (code===0 && (val==='LWPOLYLINE'||val==='POLYLINE')) {
      // Vertices {x, y, b} in DXF units; b = the BULGE of the span leaving that
      // vertex (0 = straight, else tan(¼ of the arc's included angle), + = CCW).
      // LWPOLYLINE lists 10/20/42 per vertex; POLYLINE has a header (whose own
      // 10/20 is a dummy point, NOT a vertex) followed by VERTEX entities.
      const type = val
      const verts = []
      let flags = 0, layer = '', cur = null
      while (i < raw.length) {
        const c2 = parseInt(raw[i]?.trim()), v2 = raw[i+1]?.trim()
        i += 2
        if (isNaN(c2)) continue
        if (c2 === 0) {
          if (type === 'POLYLINE' && v2 === 'VERTEX') { if (cur) verts.push(cur); cur = { x: 0, y: 0, b: 0 }; continue }
          if (cur) verts.push(cur)
          if (!(type === 'POLYLINE' && v2 === 'SEQEND')) i -= 2   // SEQEND's own codes are skipped by the main walk
          break
        }
        const header = type === 'POLYLINE' ? !cur : true
        if (c2 === 8 && (type === 'LWPOLYLINE' ? !layer : header)) layer = v2
        if (c2 === 70 && (type === 'LWPOLYLINE' || !cur)) flags = parseInt(v2)
        if (type === 'LWPOLYLINE' && c2 === 10) { if (cur) verts.push(cur); cur = { x: parseFloat(v2), y: 0, b: 0 }; continue }
        if (!cur) continue
        if (c2 === 10) cur.x = parseFloat(v2)
        if (c2 === 20) cur.y = parseFloat(v2)
        if (c2 === 42) cur.b = parseFloat(v2) || 0
      }
      const closed = !!(flags & 1)
      if (closed && verts.length > 2) {   // a closed polyline that also repeats its start
        const a = verts[0], z = verts[verts.length - 1]
        if (Math.hypot(a.x - z.x, a.y - z.y) < 1e-9) verts.pop()
      }
      const s = dxfStyle(layer)
      if (verts.some(v => Math.abs(v.b) > 1e-9)) {
        // Rounded corners: every span becomes a true LINE or ARC entity.
        const n = verts.length, spans = closed ? n : n - 1
        for (let k = 0; k < spans; k++) {
          const a = verts[k], b = verts[(k + 1) % n]
          if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue
          if (Math.abs(a.b) < 1e-9) polyLines.push({ x1: mm(a.x), y1: -mm(a.y), x2: mm(b.x), y2: -mm(b.y), ...s })
          else polyArcs.push({ ...bulgeArc(a, b, a.b, mm), ...s })
        }
      } else if (verts.length >= 2) {
        splines_out.push({ points: verts.map(v => ({ x: mm(v.x), y: -mm(v.y) })), closed, polyline: true, ...s })
      }
    }
    else if (code===0 && val==='SPLINE') {
      // A B-spline: degree (71), knots (40), control points (10/20), optional
      // weights (41) and fit points (11/21). The CONTROL points are not on the
      // curve, so the curve itself is evaluated and sampled (the solid then
      // gets one smooth curve through the samples — see polylineCurveRuns).
      let layer = '', flags = 0, degree = 3
      const knots = [], ctrl = [], weights = [], fit = []
      while (i < raw.length) {
        const c2 = parseInt(raw[i]?.trim()), v2 = raw[i+1]?.trim()
        i += 2
        if (isNaN(c2)) continue
        if (c2 === 0) { i -= 2; break }
        if (c2 === 8) layer = v2
        if (c2 === 70) flags = parseInt(v2)
        if (c2 === 71) degree = parseInt(v2)
        if (c2 === 40) knots.push(parseFloat(v2))
        if (c2 === 41) weights.push(parseFloat(v2))
        if (c2 === 10) ctrl.push({ x: parseFloat(v2), y: 0 })
        if (c2 === 20 && ctrl.length) ctrl[ctrl.length - 1].y = parseFloat(v2)
        if (c2 === 11) fit.push({ x: parseFloat(v2), y: 0 })
        if (c2 === 21 && fit.length) fit[fit.length - 1].y = parseFloat(v2)
      }
      const s = dxfStyle(layer)
      let closed = !!(flags & 1)
      let pts = null, polyline = true
      if (ctrl.length >= 2 && degree >= 1 && knots.length === ctrl.length + degree + 1) {
        pts = sampleNurbs(ctrl, knots, weights.length === ctrl.length ? weights : null, degree)
      } else if (fit.length >= 2) {
        pts = fit; polyline = false   // fit points lie ON the curve — draw a spline through them
      } else if (ctrl.length >= 2) {
        pts = ctrl
      }
      if (pts) {
        const a = pts[0], z = pts[pts.length - 1]
        if (pts.length > 2 && Math.hypot(a.x - z.x, a.y - z.y) < 1e-9) { pts = pts.slice(0, -1); closed = true }
        splines_out.push({ points: pts.map(q => ({ x: mm(q.x), y: -mm(q.y) })), closed, polyline, ...s })
      }
    }
    else if (code===0 && val==='ELLIPSE') {
      // Centre (10/20), major-axis end RELATIVE to the centre (11/21), minor/major
      // ratio (40), start/end parameter in radians (41/42). Sampled; a whole
      // ellipse becomes one closed smooth curve in the solid.
      let cx = 0, cy = 0, mx = 1, my = 0, ratio = 1, t0 = 0, t1 = Math.PI * 2, layer = ''
      while (i < raw.length) {
        const c2 = parseInt(raw[i]?.trim()), v2 = raw[i+1]?.trim()
        i += 2
        if (isNaN(c2)) continue
        if (c2 === 0) { i -= 2; break }
        if (c2 === 8) layer = v2
        if (c2 === 10) cx = parseFloat(v2); if (c2 === 20) cy = parseFloat(v2)
        if (c2 === 11) mx = parseFloat(v2); if (c2 === 21) my = parseFloat(v2)
        if (c2 === 40) ratio = parseFloat(v2)
        if (c2 === 41) t0 = parseFloat(v2); if (c2 === 42) t1 = parseFloat(v2)
      }
      let sweep = t1 - t0
      while (sweep <= 1e-9) sweep += Math.PI * 2
      const full = Math.abs(sweep - Math.PI * 2) < 1e-6
      const N = Math.max(16, Math.round(64 * sweep / (Math.PI * 2)))
      const pts = []
      for (let k = 0; k < (full ? N : N + 1); k++) {
        const t = t0 + sweep * k / N
        pts.push({ x: mm(cx + mx * Math.cos(t) - ratio * my * Math.sin(t)), y: -mm(cy + my * Math.cos(t) + ratio * mx * Math.sin(t)) })
      }
      splines_out.push({ points: pts, closed: full, polyline: true, ...dxfStyle(layer) })
    }
    else if (code===0 && val==='LINE') {
      let x1=0,y1=0,x2=0,y2=0,layer=''
      while (i<raw.length) {
        const c2=parseInt(raw[i]?.trim()),v2=raw[i+1]?.trim();i+=2
        if(isNaN(c2))continue
        if(c2===0){i-=2;break}
        if(c2===8)layer=v2
        if(c2===10)x1=parseFloat(v2);if(c2===20)y1=parseFloat(v2)
        if(c2===11)x2=parseFloat(v2);if(c2===21)y2=parseFloat(v2)
      }
      const layerL=(layer||'').toLowerCase()
      const style=layerL.includes('construction')?'construction':layerL.includes('dashed')?'dashed':undefined
      lines_out.push({x1:mm(x1),y1:-mm(y1),x2:mm(x2),y2:-mm(y2),...(style?{style}:{})})
    }
    else if (code===0 && val==='CIRCLE') {
      let cx=0,cy=0,r=1,layer=''
      while(i<raw.length){const c2=parseInt(raw[i]?.trim()),v2=raw[i+1]?.trim();i+=2;if(isNaN(c2))continue;if(c2===0){i-=2;break}if(c2===8)layer=v2;if(c2===10)cx=parseFloat(v2);if(c2===20)cy=parseFloat(v2);if(c2===40)r=parseFloat(v2)}
      const layerL=(layer||'').toLowerCase()
      const style=layerL.includes('construction')?'construction':layerL.includes('dashed')?'dashed':undefined
      circles_out.push({cx:mm(cx),cy:-mm(cy),r:mm(r),...(style?{style}:{})})
    }
    else if (code===0 && val==='ARC') {
      let cx=0,cy=0,r=1,sa=0,ea=Math.PI,layer=''
      while(i<raw.length){const c2=parseInt(raw[i]?.trim()),v2=raw[i+1]?.trim();i+=2;if(isNaN(c2))continue;if(c2===0){i-=2;break}if(c2===8)layer=v2;if(c2===10)cx=parseFloat(v2);if(c2===20)cy=parseFloat(v2);if(c2===40)r=parseFloat(v2);if(c2===50)sa=parseFloat(v2)*Math.PI/180;if(c2===51)ea=parseFloat(v2)*Math.PI/180}
      const layerL=(layer||'').toLowerCase()
      const style=layerL.includes('construction')?'construction':layerL.includes('dashed')?'dashed':undefined
      // Flip Y axis: negate angles, swap start/end
      arcs_out.push({cx:mm(cx),cy:-mm(cy),r:mm(r),startAngle:-ea,endAngle:-sa,...(style?{style}:{})})
    }
  }

  return {lines:lines_out,circles:circles_out,arcs:arcs_out,splines:splines_out,polyLines,polyArcs}
}

function dxfStyle(layer) {
  const l = (layer || '').toLowerCase()
  const style = l.includes('construction') || l.includes('cnst') ? 'construction'
              : l.includes('dashed') || l.includes('dash') ? 'dashed' : undefined
  return style ? { style } : {}
}

// A polyline span a→b with bulge b (DXF units, Y-up) as an ARC entity in the
// app's frame (px, Y-down) — the same conversion the ARC branch uses.
// bulge = tan(θ/4), θ the included angle, positive = counter-clockwise.
function bulgeArc(a, b, bulge, mm) {
  const theta = 4 * Math.atan(bulge)
  const dx = b.x - a.x, dy = b.y - a.y, c = Math.hypot(dx, dy)
  const ux = dx / c, uy = dy / c
  const h = (c / 2) / Math.tan(theta / 2)          // signed: centre left of a→b when CCW
  const cx = (a.x + b.x) / 2 - uy * h, cy = (a.y + b.y) / 2 + ux * h
  const r = Math.abs(c / (2 * Math.sin(theta / 2)))
  const aa = Math.atan2(a.y - cy, a.x - cx), ab = Math.atan2(b.y - cy, b.x - cx)
  const [sa, ea] = bulge > 0 ? [aa, ab] : [ab, aa]   // DXF arcs run CCW from start to end
  return { cx: mm(cx), cy: -mm(cy), r: mm(r), startAngle: -ea, endAngle: -sa }
}

// Samples a (possibly rational) B-spline — de Boor's algorithm over the valid
// knot range [U[p], U[n]] — into points ON the curve.
function sampleNurbs(P, U, W, p) {
  const n = P.length
  const lo = U[p], hi = U[n]
  if (!(hi > lo)) return null
  const N = Math.max(40, (n - p) * 16)
  const out = []
  for (let s = 0; s <= N; s++) {
    const t = lo + (hi - lo) * s / N
    let k = p
    while (k < n - 1 && t >= U[k + 1]) k++
    const d = []
    for (let j = 0; j <= p; j++) {
      const q = P[k - p + j], w = W ? W[k - p + j] : 1
      d.push([q.x * w, q.y * w, w])
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j, den = U[i + p - r + 1] - U[i]
        const al = den === 0 ? 0 : (t - U[i]) / den
        d[j] = [(1 - al) * d[j-1][0] + al * d[j][0], (1 - al) * d[j-1][1] + al * d[j][1], (1 - al) * d[j-1][2] + al * d[j][2]]
      }
    }
    out.push({ x: d[p][0] / d[p][2], y: d[p][1] / d[p][2] })
  }
  return out
}

import { useState, useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import viewOpIconSheet from './assets/view-op-icons.png'
import Viewport3D from './Viewport3D.jsx'
import { planeColor, planeAxisLabels, sketchToWorld } from './SketchPlane.js'
import { FacePlane } from './FacePlane.js'
import { pxToMm, mmToPx, ALIGN_SNAP_DIST, ACQUIRE_DIST, SELECT_DIST, norm2pi, zoomRef } from './constants.js'
import { angleOnArc, computeAllIntersections } from './geometry/intersections.js'
import { getGeoSnap, getAllSnapPoints, checkAngle, getAngleSnap, applyTracking, computeLiveAngle, getTanPtsOnCircle, getExternalTangentPairs, nearestPt } from './geometry/snap.js'
import { computeTrimPreview, performTrim, computeDeletePreview, distToSeg } from './tools/trimDelete.js'
import { nearestOffsetEntity, computeOffsetPreview, distToEntity } from './tools/offsetMath.js'
import { nearestMirrorEntity, buildMirror } from './tools/mirrorMath.js'
import { nearestMoveCopyEntity, buildCopies, removeSelected } from './tools/moveCopyMath.js'
import { nearestRotateCopyEntity, rotatePoint, buildRotatedCopies } from './tools/rotateCopyMath.js'
import { nearestScaleEntity, buildScaled } from './tools/scaleMath.js'
import { nearestFilletLine, computeFillet } from './tools/filletMath.js'
import { computeExtendPreview } from './tools/extendMath.js'
import { sampleSpline, nearestSpline, computeSplineTrimPreview, performSplineTrim, distToSpline } from './tools/splineMath.js'
import { selectionBBox, getBBoxHandles, hitTestHandles, computeHandleTransform, applySelectionTransform } from './tools/selectMath.js'
import { drawLineIndicator, drawHVIndicator, drawTracks, drawLabel, drawPreviewLine } from './draw/drawHelpers.js'
import { useHistory } from './tools/history.js'
import { saveJSON, loadJSON, exportDXF, parseDXF } from './tools/saveLoad.js'
import { detectProfiles, buildSolid, pickProfile } from './tools/extrudeMath.js'
import { cadEngine } from './cadEngine.js'
import { replicadMeshToThree } from './cadMesh.js'
import TracerPanel from './tools/TracerPanel.jsx'
import TextPanel from './tools/TextPanel.jsx'
import PageSetupPanel from './tools/PageSetupPanel.jsx'
import GuidePanel from './tools/GuidePanel.jsx'
import {
  IconLine, IconCircle, IconTrim, IconDelete, IconExtend, IconOffset,
  IconMirror, IconCenter, IconMoveCopy, IconRotateCopy, IconResize, IconFillet, IconTrace, IconGuide,
  IconUndo, IconRedo, IconFitView, IconSave, IconLoad, IconDXF, IconSpline, IconText, IconSelect, IconJoin, IconDim, IconAxis,
  IconIncludeFace,
  IconExtrude3D, IconCutout3D, IconFillet3D, IconMirror3D, IconLoft3D, IconJoin3D, IconMeasure3D,
} from './draw/ToolIcons.jsx'
import { glowStroke, glowFill } from './draw/vectorTheme.js'

// Vector-arcade icons for the six 3D solid-op sidebar tools (see
// draw/ToolIcons.jsx's "3D-ENVIRONMENT VECTOR ICONS" section) — replaces
// the old solid-icons.png raster sprite sheet.
const SOLID_ICON_COMPONENTS = {
  extrude: IconExtrude3D, cutout: IconCutout3D, fillet3d: IconFillet3D,
  mirror3d: IconMirror3D, loft3d: IconLoft3D, join3d: IconJoin3D,
}

// Pixel-art view-preset icons (src/assets/view-op-icons.png) — same
// background-position cropping trick as SOLID_OP_CELLS, but each icon's own
// glyph (not the surrounding card/border/label — those aren't used here,
// since the view buttons already render their own text label) has a
// different aspect ratio (SIDE is a tall thin rectangle, ISO is wider), so
// each cell stores its own w/h rather than sharing one. There's also a fifth
// "VIEW" glyph in the sheet (dashed border, crosshair) not wired to any
// button yet.
const VIEW_OP_SHEET_W = 1774, VIEW_OP_SHEET_H = 887
const VIEW_OP_CELLS = {
  top:   { x: 443,  y: 389, w: 205, h: 203 },
  front: { x: 790,  y: 393, w: 198, h: 197 },
  side:  { x: 1176, y: 389, w: 107, h: 201 },
  iso:   { x: 1453, y: 383, w: 204, h: 225 },
}
const VIEW_OP_ICON_H = 52   // 25% smaller than the 70px extrude/cutout/fillet icons — those felt too big here

function viewOpIconStyle(id) {
  const cell = VIEW_OP_CELLS[id]
  if (!cell) return null
  const scale = VIEW_OP_ICON_H / cell.h
  return {
    width: cell.w * scale, height: VIEW_OP_ICON_H,
    backgroundImage: `url(${viewOpIconSheet})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${VIEW_OP_SHEET_W * scale}px ${VIEW_OP_SHEET_H * scale}px`,
    backgroundPosition: `-${cell.x * scale}px -${cell.y * scale}px`,
    imageRendering: 'pixelated',
  }
}

// Helpers for activePlane which can be 'XY'|'XZ'|'YZ' or a FacePlane object
function getPlaneColor(ap) {
  if (!ap) return '#aaaaaa'
  if (typeof ap === 'string') return planeColor(ap)
  return '#ff9900'
}
function getPlaneLabel(ap) {
  if (!ap) return ''
  if (typeof ap === 'string') return ap
  return 'FACE'
}
function getPlaneAxes(ap) {
  if (!ap) return {h:'',v:''}
  if (typeof ap === 'string') return planeAxisLabels(ap)
  return {h:'U →', v:'N ↑'}
}

// Mirrors cadWorker.js's buildExtrude offset math exactly (isCut is always true
// for cutouts, so OVH is always 1) — returns [minMm, maxMm], the actual span of
// the cut volume along the normal relative to the sketch plane (0 = the plane
// itself). Used to build an accurate overlap-detection box for multi-solid
// cutouts, rather than a guessed/overly generous reach.
function cutExtentRangeMm(depthMm, direction, planeId) {
  const OVH = 1
  if (direction === 'front') return planeId === 'face' ? [-depthMm, OVH] : [-OVH, depthMm]
  if (direction === 'back')  return [-depthMm, OVH]
  const half = depthMm / 2
  return [-half, half]
}

// A revolve profile must stay entirely on one side of its axis — crossing it
// produces self-intersecting geometry in the CAD kernel. Uses a signed
// cross-product test against the (infinite) axis line; points essentially ON
// the axis (within tolerance) are ignored, since a profile edge commonly runs
// exactly along the axis for a valid revolve.
function profileCrossesAxis(pts, axis) {
  const dx = axis.x2 - axis.x1, dy = axis.y2 - axis.y1
  let sign = 0
  for (const p of pts) {
    const cross = dx*(p.y-axis.y1) - dy*(p.x-axis.x1)
    if (Math.abs(cross) < 0.5) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return true
  }
  return false
}

// Builds cadWorker cut params for one cutout feature — linear (depth/direction)
// or revolve-shaped (axis/angleDeg/reverse). Shared by commitExtrude, feature
// delete, and STL export so all three agree on what a stored cut looks like;
// `axis` presence is the discriminator the worker's subtract handler uses too.
function buildCutWorkerParams(cutFeat) {
  const facePlaneParams = fp => fp ? {
    normal: [fp.normal.x, fp.normal.y, fp.normal.z],
    origin: [pxToMm(fp.origin.x), pxToMm(fp.origin.y), pxToMm(fp.origin.z)],
    uAxis:  [fp.uAxis.x, fp.uAxis.y, fp.uAxis.z],
  } : {}
  if (cutFeat.revolveAxis) {
    return {
      pts: cutFeat.profilePts, planeId: cutFeat.planeId,
      axis: cutFeat.revolveAxis, angleDeg: cutFeat.angleDeg ?? 360, reverse: !!cutFeat.revolveReverse,
      circle: cutFeat.profilePts.circleMeta || null,
      ...facePlaneParams(cutFeat.facePlane),
    }
  }
  return {
    pts: cutFeat.profilePts,
    depthMm: cutFeat.cutDepthMm ?? 10000,
    planeId: cutFeat.planeId,
    direction: cutFeat.cutDirection ?? 'both',
    circle: cutFeat.profilePts.circleMeta || null,
    ...facePlaneParams(cutFeat.facePlane),
  }
}

// Builds cadWorker params to rebuild a solid's OWN base shape from scratch
// (no cuts/fillets applied) — linear extrude or revolve, mirroring
// buildCutWorkerParams. Shared by every "rebuild clean, then replay features
// in order" flow (cutout edit/delete, fillet edit/delete, STL export).
function buildBaseWorkerParams(solid) {
  // Join/mirror solids have no profilePts/depthMm/planeId at all — they're
  // not rebuildable via buildExtrude/buildRevolve, only via joinShapes()/
  // mirrorShape() respectively (see rebuildJoinBaseMesh, commitMirrorSolid).
  // Returning null here (rather than crashing on solid.profilePts.circleMeta
  // — solid.profilePts is undefined for these) means "no cold-rebuild
  // fallback available"; callers that pass this straight through as a
  // worker `base` param rely on shapeStore already being warm, which is
  // always true immediately after these solids are created — the same
  // "one-time snapshot, no live tracking" assumption Join3D/Mirror3D already
  // make elsewhere.
  if (solid.operation === 'join' || solid.operation === 'mirror') return null
  // Loft has no single profilePts/depthMm/planeId either — its "base" is an
  // ordered list of profiles sharing one normal/uAxis basis (already stored
  // in mm on the solid, see commitLoft) rebuilt via cadWorker.js's buildLoft.
  if (solid.operation === 'loft') {
    return {
      profiles: solid.profiles.map(p => ({ pts: p.pts, circle: p.circle, offsetMm: p.offsetMm })),
      normal: solid.normal, origin: solid.origin, uAxis: solid.uAxis, ruled: !!solid.ruled,
    }
  }
  const facePlaneParams = fp => fp ? {
    normal: [fp.normal.x, fp.normal.y, fp.normal.z],
    origin: [pxToMm(fp.origin.x), pxToMm(fp.origin.y), pxToMm(fp.origin.z)],
    uAxis:  [fp.uAxis.x, fp.uAxis.y, fp.uAxis.z],
  } : {}
  if (solid.operation === 'revolve') {
    return {
      pts: solid.profilePts, planeId: solid.planeId,
      axis: solid.revolveAxis, angleDeg: solid.angleDeg ?? 360, reverse: !!solid.revolveReverse,
      circle: solid.profilePts.circleMeta || null,
      ...facePlaneParams(solid.facePlane),
    }
  }
  return {
    pts: solid.profilePts,
    depthMm: solid.depthMm,
    planeId: solid.planeId,
    direction: solid.direction || 'both',
    circle: solid.profilePts.circleMeta || null,
    ...facePlaneParams(solid.facePlane),
  }
}

// Loft's shared plane basis, in SCENE units (px) — a work-plane pick has no
// FacePlane object of its own (SketchPlane.js's XY/XZ/YZ transforms are
// fixed at world origin with no offset support at all), so this derives an
// equivalent {origin, normal, uAxis} directly from SketchPlane.js's own
// per-plane sketchToWorld cases: XY sketch.x->world.x, normal=+Z; XZ
// sketch.x->world.x too, normal=+Y; YZ sketch.x->world.y, normal=+X. Work
// planes always pass through the world origin (see WorkPlanes.js), so
// origin is always (0,0,0) — same in px or mm, it's the zero vector either way.
// vAxis is stored explicitly per plane rather than derived from
// cross(normal, uAxis) — that cross product only happens to match
// SketchPlane.js's own hand-picked per-plane convention for XY and YZ;
// for XZ it comes out sign-flipped (SketchPlane's sketchToWorld gives
// world.z = -sy, but cross(normal,uAxis) for XZ yields a vAxis that would
// produce +sy instead), which would make vertical mouse movement track
// backwards specifically when lofting off the XZ plane.
function workPlaneToFacePlaneBasisPx(planeId) {
  const table = {
    XY: { normal: new THREE.Vector3(0, 0, 1), uAxis: new THREE.Vector3(1, 0, 0), vAxis: new THREE.Vector3(0, 1, 0) },
    // normal is -Y (not +Y) — matches this app's established XZ camera
    // convention (SketchPlane.js's own header: "XZ: camera at (0,-800,0)").
    // Getting this sign backwards doesn't break the sketchToWorld math (it
    // stays internally self-consistent either way), but it does put the
    // camera on the wrong side of the plane — like viewing a drawing from
    // behind the page — which renders every click mirrored left-right
    // relative to where the mouse actually is.
    XZ: { normal: new THREE.Vector3(0, -1, 0), uAxis: new THREE.Vector3(1, 0, 0), vAxis: new THREE.Vector3(0, 0, 1) },
    YZ: { normal: new THREE.Vector3(1, 0, 0), uAxis: new THREE.Vector3(0, 1, 0), vAxis: new THREE.Vector3(0, 0, 1) },
  }
  const t = table[planeId] || table.XY
  return { origin: new THREE.Vector3(0, 0, 0), normal: t.normal.clone(), uAxis: t.uAxis.clone(), vAxis: t.vAxis.clone() }
}

// Builds the FacePlane a loft profile sketches on: basis (px, from either
// workPlaneToFacePlaneBasisPx or a picked FacePlane's own origin/normal/
// uAxis/vAxis) offset along the shared normal by offsetMm (mm, converted to
// px — unit direction vectors need no conversion, only the origin position
// does). Uses basis.vAxis directly (see workPlaneToFacePlaneBasisPx) rather
// than re-deriving it, so it stays correct for every plane, not just the
// ones where cross(normal,uAxis) happens to agree with SketchPlane.js.
function buildLoftFacePlane(basis, offsetMm) {
  const origin = basis.origin.clone().addScaledVector(basis.normal, mmToPx(offsetMm))
  return new FacePlane(origin, basis.normal, basis.uAxis, basis.vAxis)
}

// Ordered cutout/fillet ops for `solid`, in the shape cadWorker.js's
// mirrorShape/exportSTL handlers expect. `features` is taken as an explicit
// parameter (not read from component closure) so callers control exactly
// which snapshot to use — matters for rebuildDependentMirrors, which must
// use freshly-built state, not a stale render's closure.
function buildSolidOpsForWorker(solid, features) {
  return features
    .filter(f => f.solidId === solid.id && (f.operation === 'cutout' || f.type === 'fillet'))
    .map(f => f.type === 'fillet'
      ? { type: 'fillet', radius: f.radius, edgePoints: f.edgePoints }
      : { type: 'cut', params: buildCutWorkerParams(f) })
}

// Rebuilds a solid's clean base mesh (via cadEngine.revolve or .extrude,
// matching how it was originally built) and seeds the worker's shapeStore
// for it — the first step of every "rebuild + replay" chain. Returns both
// the mesh (for an immediate render) and the params (as the `base` fallback
// for subsequent subtract/fillet3d calls on this solidId).
async function rebuildBaseMesh(solid) {
  const baseWorkerParams = buildBaseWorkerParams(solid)
  const meshData = solid.operation === 'revolve'
    ? await cadEngine.revolve({ solidId: solid.id, ...baseWorkerParams })
    : await cadEngine.extrude({ solidId: solid.id, ...baseWorkerParams })
  return { meshData, baseWorkerParams }
}

// Cheap bounding-box estimate (in the same world/px space as the app's other
// overlap tests) for a revolve cut's swept volume — used only as a candidate
// filter to decide which existing solids a new revolve-cutout touches; OCC
// does the real, precise boolean cut. Samples the profile at several angles
// across the sweep (not just start/end) since a revolve's silhouette can bulge
// outward mid-sweep in a way the two endpoints alone wouldn't capture.
function revolveSweepBoxPx(pts, axis, angleDeg, reverse, planeId, facePlane) {
  const toWorld = (x, y) => facePlane ? facePlane.sketchToWorld(x, y) : sketchToWorld(x, y, planeId)
  const w1 = toWorld(axis.x1, axis.y1)
  const w2 = toWorld(axis.x2, axis.y2)
  const axisOrigin = new THREE.Vector3(w1.x, w1.y, w1.z)
  const axisDir = new THREE.Vector3(w2.x-w1.x, w2.y-w1.y, w2.z-w1.z).normalize()
  const worldPts = pts.map(p => { const w = toWorld(p.x, p.y); return new THREE.Vector3(w.x, w.y, w.z) })

  const sign = reverse ? -1 : 1
  const SAMPLES = 16
  const allPts = []
  for (let i = 0; i <= SAMPLES; i++) {
    const ang = THREE.MathUtils.degToRad(sign * (i/SAMPLES) * angleDeg)
    for (const v of worldPts) {
      allPts.push(v.clone().sub(axisOrigin).applyAxisAngle(axisDir, ang).add(axisOrigin))
    }
  }
  return new THREE.Box3().setFromPoints(allPts)
}

// ── Mirror3D reflection helpers ─────────────────────────────────────────────
// Reflect a world-space point/direction across a plane (origin O, unit normal n).
function reflectPoint(p, O, n) {
  const rel = new THREE.Vector3().subVectors(p, O)
  const d = rel.dot(n)
  return p.clone().addScaledVector(n, -2 * d)
}
function reflectDir(v, n) {
  const d = v.dot(n)
  return v.clone().addScaledVector(n, -2 * d)
}

// A plain work plane (XY/XZ/YZ) has no FacePlane object of its own — derive an
// equivalent {origin,normal,uAxis,vAxis} basis DIRECTLY from sketchToWorld's
// own behavior (rather than hand-deriving normal signs per plane, which is
// easy to get backwards — e.g. XZ's raycasting normal in SketchPlane.js
// points the "wrong" way relative to the uAxis×vAxis convention FacePlane
// expects). This guarantees the basis always agrees with how points actually
// get projected, by construction.
function planeIdBasis(planeId) {
  const origin = new THREE.Vector3(0, 0, 0)
  const uAxis = sketchToWorld(1, 0, planeId).sub(sketchToWorld(0, 0, planeId)).normalize()
  // sketchToWorld uses -sy, so the raw delta for sy=1 is already -vAxis.
  const vAxis = sketchToWorld(0, 0, planeId).sub(sketchToWorld(0, 1, planeId)).normalize()
  const normal = new THREE.Vector3().crossVectors(uAxis, vAxis).normalize()
  return { origin, normal, uAxis, vAxis }
}

// ── SmartStep Bar ─────────────────────────────────────────────────────────────
// Shows the current step of the active Extrude / Cutout operation.
// Completed steps show a ✓ and are clickable to go back.
// Disappears entirely when no solid operation is running.

const EXTRUDE_STEPS = [
  { id: 1, label: 'Pick Plane' },
  { id: 2, label: 'Draw Profile' },
  { id: 3, label: 'Set Depth' },
]

function SmartStepBar({ op, currentStep, color, onStepBack, steps = EXTRUDE_STEPS, hint = null }) {
  if (!op) return null

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 52,
      background: 'rgba(12,12,26,0.97)',
      backdropFilter: 'blur(6px)',
      borderTop: `2px solid ${color}55`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      zIndex: 200,
      pointerEvents: 'all',
      gap: 0,
    }}>
      {/* Operation label badge */}
      <div style={{
        fontFamily: 'monospace',
        fontSize: 9,
        fontWeight: 'bold',
        letterSpacing: '0.18em',
        color,
        textTransform: 'uppercase',
        background: color + '18',
        border: `1px solid ${color}44`,
        borderRadius: 4,
        padding: '3px 9px',
        marginRight: 20,
        flexShrink: 0,
      }}>
        {op}
      </div>

      {/* Step pills */}
      {steps.map((step, i) => {
        const isDone   = step.id < currentStep
        const isActive = step.id === currentStep
        const canBack  = isDone

        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {/* Connector line */}
            {i > 0 && (
              <div style={{
                width: 28,
                height: 2,
                margin: '0 2px',
                borderRadius: 1,
                background: (isDone || isActive) ? color + '55' : '#1e1e36',
                transition: 'background 0.25s',
              }}/>
            )}

            {/* Pill */}
            <div
              onClick={canBack ? () => onStepBack(step.id) : undefined}
              title={canBack ? `Go back to: ${step.label}` : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 14px',
                borderRadius: 24,
                cursor: canBack ? 'pointer' : 'default',
                background: isActive ? color + '20' : 'transparent',
                border: `1.5px solid ${
                  isActive ? color :
                  isDone   ? color + '50' :
                  '#1e1e36'
                }`,
                opacity: isActive ? 1 : isDone ? 0.72 : 0.3,
                transition: 'all 0.2s',
              }}
            >
              {/* Circle number / check */}
              <div style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isDone ? 11 : 10,
                fontWeight: 'bold',
                fontFamily: 'monospace',
                background: isActive ? color      : isDone ? color + '28' : 'transparent',
                border: `1.5px solid ${isActive ? color : isDone ? color + '66' : '#2a2a4a'}`,
                color: isActive ? '#fff' : isDone ? color : '#445',
                transition: 'all 0.2s',
              }}>
                {isDone ? '✓' : step.id}
              </div>

              {/* Label */}
              <span style={{
                fontFamily: 'monospace',
                fontSize: 11,
                letterSpacing: '0.05em',
                whiteSpace: 'nowrap',
                color: isActive ? '#dce8ff' : isDone ? '#8899bb' : '#334',
                transition: 'color 0.2s',
              }}>
                {step.label}
              </span>
            </div>
          </div>
        )
      })}

      {/* Commit indicator — appears on step 3 */}
      {currentStep === 3 && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{
            width: 28, height: 2, margin: '0 2px',
            borderRadius: 1, background: color + '55',
          }}/>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 14px', borderRadius: 24,
            background: color + '18',
            border: `1.5px solid ${color}88`,
          }}>
            <span style={{
              fontFamily: 'monospace', fontSize: 11,
              color: color, letterSpacing: '0.05em',
            }}>
              ↵ Commit
            </span>
          </div>
        </div>
      )}

      <div style={{ flex: 1 }}/>

      {/* Optional trailing hint — e.g. live selection count + accept keys.
          Absent for the existing Extrude/Cutout and Mirror3D usages. */}
      {hint && (
        <span style={{
          fontFamily: 'monospace', fontSize: 10,
          color, flexShrink: 0, letterSpacing: '0.05em', marginRight: 16,
        }}>
          {hint}
        </span>
      )}

      {/* Esc hint */}
      <span style={{
        fontFamily: 'monospace', fontSize: 10,
        color: '#334455', flexShrink: 0, letterSpacing: '0.05em',
      }}>
        Esc · cancel
      </span>
    </div>
  )
}

// ── Feature Tree Panel ────────────────────────────────────────────────────────

function FeatureTree({ features, activeSketchId, sketchMode, onEditSketch, onToggleVisible, onDelete, onRename, onEditDepth, onEditExtent, onEditFilletRadius, mirrorPickActive, onPickMirrorSource, joinPickActive, joinSel, onToggleJoinMember, onEditLoft }) {
  const [editingName, setEditingName] = useState(null)
  const [editDepthId, setEditDepthId] = useState(null)
  const [depthVal, setDepthVal]       = useState('')
  const [hoveredMirrorRow, setHoveredMirrorRow] = useState(null)

  function startRename(id, currentName) {
    setEditingName(id)
    // handled inline
  }

  // A grouped (multi-body) cutout is several features under the hood (one per
  // solid it spans) but should read as ONE row — collapse to the first member
  // of each groupId. Editing/deleting that row still affects the whole group
  // (handled in App3D's handleEditSketch/handleEditExtent/handleDeleteFeature
  // via feat.groupId), this is purely a display concern.
  const seenGroups = new Set()
  const displayFeatures = features.filter(f => {
    if (!f.groupId) return true
    if (seenGroups.has(f.groupId)) return false
    seenGroups.add(f.groupId)
    return true
  })
  const groupSize = f => f.groupId ? features.filter(g => g.groupId === f.groupId).length : 1

  return (
    <div style={{
      width: 220, minWidth: 220, background: '#f8f8f8',
      borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column',
      fontFamily: 'monospace', fontSize: 12, overflowY: 'auto',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', background: '#1a1a2e', color: '#dce8ff',
        fontSize: 11, fontWeight: 'bold', letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #2a2a4a', flexShrink: 0,
      }}>
        <span>FEATURE TREE</span>
        <span style={{color:'#445566', fontWeight:'normal'}}>
          {displayFeatures.length} item{displayFeatures.length!==1?'s':''}
        </span>
      </div>

      {/* Empty state */}
      {displayFeatures.length === 0 && (
        <div style={{padding:'24px 16px', color:'#aaa', textAlign:'center', fontSize:11}}>
          No features yet.<br/>Click a work plane<br/>to start sketching.
        </div>
      )}

      {/* Feature list */}
      <div style={{flex:1, padding:'4px 0'}}>
        {displayFeatures.map((feat, idx) => {
          const isActiveSketch = feat.id === activeSketchId
          const isSketch = feat.type === 'sketch'
          const isExtrude = feat.type === 'extrude'
          const isFillet = feat.type === 'fillet'
          const isMirror = isExtrude && feat.operation === 'mirror'
          const isJoin = isExtrude && feat.operation === 'join'
          const isLoft = isExtrude && feat.operation === 'loft'
          const isLocked = !!feat.joinedInto
          const hasDependentMirror = features.some(f => f.operation === 'mirror' && f.sourceSolidId === feat.solidId)
          const isMirrorEligible = isExtrude && !isMirror && !isLocked
          const isJoinEligible = isExtrude && feat.operation !== 'cutout' && !isJoin && !isLocked && !hasDependentMirror
          const isJoinSelected = joinSel?.includes(feat.id)
          const editingDepth = editDepthId === feat.id

          const mirrorHover = mirrorPickActive && isMirrorEligible && hoveredMirrorRow === feat.id
          const itemBg = isJoinSelected ? '#fff8e0' : mirrorHover ? '#eafbe8' : isActiveSketch ? '#e8f0ff' : 'transparent'
          const borderLeft = isJoinSelected ? '3px solid #FFEE88'
                           : isActiveSketch ? '3px solid #3a7bd5'
                           : isSketch ? '3px solid #ddd'
                           : '3px solid transparent'

          return (
            <div key={feat.id}
              title={isLocked ? `Part of ${features.find(f=>f.id===feat.joinedInto)?.name || 'a Join'} — delete the join to edit` : undefined}
              onMouseEnter={()=>{ if (mirrorPickActive && isMirrorEligible) setHoveredMirrorRow(feat.id) }}
              onMouseLeave={()=>{ if (mirrorPickActive) setHoveredMirrorRow(null) }}
              onClick={()=>{
                if (mirrorPickActive && isMirrorEligible) onPickMirrorSource(feat.id)
                else if (joinPickActive && isJoinEligible) onToggleJoinMember(feat.id)
              }}
              style={{
              borderLeft, background: itemBg,
              padding: '6px 10px 6px 8px',
              borderBottom: '1px solid #eee',
              opacity: isLocked ? 0.45 : 1,
              cursor: mirrorPickActive ? (isMirrorEligible ? 'pointer' : 'default')
                    : joinPickActive   ? (isJoinEligible ? 'pointer' : 'default')
                    : (isSketch ? 'pointer' : 'default'),
            }}>
              {/* Feature header row */}
              <div style={{display:'flex', alignItems:'center', gap:6}}>
                {/* Join-pick checkbox */}
                {joinPickActive && isJoinEligible && (
                  <span style={{
                    width:13, height:13, flexShrink:0, borderRadius:3,
                    border:`1.5px solid ${isJoinSelected ? '#c9a600' : '#aaa'}`,
                    background: isJoinSelected ? '#FFEE88' : 'transparent',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:10, color:'#4a3e00', lineHeight:1,
                  }}>
                    {isJoinSelected ? '✓' : ''}
                  </span>
                )}
                {/* Icon */}
                <span style={{fontSize:14, flexShrink:0}}>
                  {isSketch ? '📐' : isFillet ? '◠' : isMirror ? '⇄' : isJoin ? '⛓' : isLoft ? '🌀' : '⬆'}
                  {isLocked ? ' 🔒' : ''}
                </span>

                {/* Name — double-click to rename */}
                {editingName === feat.id ? (
                  <input
                    autoFocus
                    defaultValue={feat.name}
                    style={{flex:1, fontSize:11, fontFamily:'monospace',
                      border:'1px solid #3a7bd5', borderRadius:3, padding:'1px 4px'}}
                    onBlur={e=>{ onRename(feat.id, e.target.value||feat.name); setEditingName(null) }}
                    onKeyDown={e=>{
                      if(e.key==='Enter'){ onRename(feat.id,e.target.value||feat.name); setEditingName(null) }
                      if(e.key==='Escape') setEditingName(null)
                    }}
                  />
                ) : (
                  <span
                    style={{flex:1, fontSize:11, fontWeight: isActiveSketch?'bold':'normal',
                      color: isActiveSketch?'#1a3a7d':'#222'}}
                    onDoubleClick={()=>setEditingName(feat.id)}
                  >
                    {feat.name}
                  </span>
                )}

                {/* Action buttons */}
                <div style={{display:'flex', gap:2, flexShrink:0}}>
                  {isSketch && (
                    <>
                      {/* Visibility toggle */}
                      <button
                        title={feat.visible?'Hide sketch':'Show sketch'}
                        onClick={e=>{e.stopPropagation(); onToggleVisible(feat.id)}}
                        style={{background:'none',border:'none',cursor:'pointer',
                          padding:'1px 3px', fontSize:11, opacity: feat.visible?1:0.4,
                          color:'#555'}}
                      >
                        {feat.visible ? '👁' : '🚫'}
                      </button>
                      {/* Edit — re-enter sketch */}
                      {!sketchMode && (
                        <button
                          title="Edit sketch"
                          onClick={e=>{e.stopPropagation(); onEditSketch(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', fontSize:11, color:'#3a7bd5'}}
                        >
                          ✏️
                        </button>
                      )}
                      {/* Delete sketch */}
                      <button
                        title="Delete sketch"
                        onClick={e=>{e.stopPropagation(); onDelete(feat.id)}}
                        style={{background:'none',border:'none',cursor:'pointer',
                          padding:'1px 3px', fontSize:12, color:'#e05a4e'}}
                      >
                        🗑
                      </button>
                    </>
                  )}
                  {isExtrude && !isLocked && (
                    <>
                      {!sketchMode && isLoft && (
                        <button title="Edit loft profiles"
                          onClick={e=>{e.stopPropagation(); onEditLoft(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', fontSize:11, color:'#3a7bd5'}}
                        >✏️</button>
                      )}
                      {!sketchMode && !isLoft && feat.sketchLines !== undefined && (
                        <button title="Edit sketch"
                          onClick={e=>{e.stopPropagation(); onEditSketch(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', fontSize:11, color:'#3a7bd5'}}
                        >✏️</button>
                      )}
                      {!sketchMode && !isMirror && !isJoin && !isLoft && (
                        <button title={feat.operation==='cutout' ? 'Edit cutout extent' : 'Edit extrusion extent'}
                          onClick={e=>{e.stopPropagation(); onEditExtent(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', fontSize:11, color:'#888'}}
                        >⚙</button>
                      )}
                      <button title="Delete"
                        onClick={e=>{e.stopPropagation(); onDelete(feat.id)}}
                        style={{background:'none',border:'none',cursor:'pointer',
                          padding:'1px 3px', fontSize:11, color:'#e05a4e'}}
                      >🗑</button>
                    </>
                  )}
                  {isFillet && (
                    <>
                      {!sketchMode && (
                        <button title="Edit fillet radius"
                          onClick={e=>{e.stopPropagation(); onEditFilletRadius(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', fontSize:11, color:'#888'}}
                        >⚙</button>
                      )}
                      <button title="Delete"
                        onClick={e=>{e.stopPropagation(); onDelete(feat.id)}}
                        style={{background:'none',border:'none',cursor:'pointer',
                          padding:'1px 3px', fontSize:11, color:'#e05a4e'}}
                      >🗑</button>
                    </>
                  )}
                </div>
              </div>

              {/* Sketch subtitle */}
              {isSketch && (
                <div style={{color:'#888', fontSize:10, marginLeft:20, marginTop:2}}>
                  {feat.planeId==='face' ? 'Face plane'
                    : feat.planeId==='XY' ? 'XY · Top'
                    : feat.planeId==='XZ' ? 'XZ · Front'
                    : feat.planeId==='YZ' ? 'YZ · Side'
                    : feat.planeId}
                  {' · '}{(feat.lines||[]).length + (feat.arcs||[]).length + (feat.circles||[]).length} entities
                  {isActiveSketch && <span style={{color:'#3a7bd5',marginLeft:6}}>● editing</span>}
                </div>
              )}

              {/* Mirror subtitle: colour + source feature + mirror plane */}
              {isMirror && (
                <div style={{marginLeft:20, marginTop:3}}>
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:feat.color||'#8E65F3', flexShrink:0}}/>
                    <span style={{color:'#777', fontSize:10}}>
                      mirror of {features.find(f=>f.id===feat.sourceFeatureId)?.name || '?'}
                      {' · '}{feat.mirrorPlane?.kind==='face' ? 'face' : feat.mirrorPlane?.planeId || '?'}
                    </span>
                  </div>
                </div>
              )}

              {/* Join subtitle: colour + member names */}
              {isJoin && (
                <div style={{marginLeft:20, marginTop:3}}>
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:feat.color||'#FFEE88', flexShrink:0}}/>
                    <span style={{color:'#777', fontSize:10}}>
                      join · {(feat.memberFeatureIds||[]).length} bodies
                    </span>
                  </div>
                </div>
              )}

              {/* Loft subtitle: colour + profile count */}
              {isLoft && (
                <div style={{marginLeft:20, marginTop:3}}>
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:feat.color||'#33D5EC', flexShrink:0}}/>
                    <span style={{color:'#777', fontSize:10}}>
                      loft · {(feat.profiles||[]).length} profiles
                    </span>
                  </div>
                </div>
              )}

              {/* Extrude subtitle: colour + depth + operation */}
              {isExtrude && !isMirror && !isJoin && !isLoft && (
                <div style={{marginLeft:20, marginTop:3}}>
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:feat.color||'#3a7bd5', flexShrink:0}}/>
                    <span style={{color:'#777', fontSize:10}}>
                      {feat.operation==='cutout'
                        ? (feat.revolveAxis ? `${feat.angleDeg ?? 360}°` : feat.extentMode==='through' ? '∞ through-all' : `${feat.depthMm||'?'}mm`)
                        : feat.operation==='revolve'
                        ? `${feat.angleDeg ?? 360}°`
                        : `${feat.depthMm||'?'}mm`
                      } · {feat.operation==='cutout' && feat.revolveAxis ? 'revolve cutout' : (feat.operation||'extrude')}
                      {feat.operation==='cutout' && !feat.revolveAxis && feat.cutDirection && feat.cutDirection!=='both'
                        ? ` · ${feat.cutDirection}` : ''}
                      {feat.operation!=='cutout' && feat.operation!=='revolve' && feat.direction && feat.direction!=='both'
                        ? ` · ${feat.direction}` : ''}
                      {groupSize(feat) > 1 ? ` · ${groupSize(feat)} bodies` : ''}
                    </span>
                  </div>
                </div>
              )}

              {/* Fillet subtitle: colour + radius */}
              {isFillet && (
                <div style={{marginLeft:20, marginTop:3}}>
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:feat.color||'#9c6ade', flexShrink:0}}/>
                    <span style={{color:'#777', fontSize:10}}>
                      R{feat.radius}mm · fillet{feat.edgePoints?.length > 1 ? ` · ${feat.edgePoints.length} edges` : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function App() {
  // ── Phase 2 Step 1: Work planes ──
  const [sketchMode,setSketchMode]=useState(false)
  const [activePlane,setActivePlane]=useState(null)
  const sketchModeRef=useRef(false)
  const activePlaneRef=useRef(null)
  useEffect(()=>{ sketchModeRef.current=sketchMode },[sketchMode])
  useEffect(()=>{ activePlaneRef.current=activePlane },[activePlane])

  // ── Phase 3 Step 4: Solids ──
  const [solids,setSolids]=useState([])
  const [extrudeTool,setExtrudeTool]=useState(null)
  const [extrudeState,setExtrudeState]=useState(null)
  const [editingFeatureId,setEditingFeatureId]=useState(null)
  const hiddenEditSolidRef=useRef(null)   // solid parked here while its sketch is being edited
  const [extrudeColor,setExtrudeColor]=useState('#3a7bd5')
  const [cachedProfiles,setCachedProfiles]=useState([])
  const sketchBeforePlaneRef=useRef(null)
  const lastClickClientRef=useRef({x:0,y:0})

  const [cadError, setCadError] = useState(null)

  // ── CAD engine (replicad + OpenCascade) ──
  const [occReady, setOccReady] = useState(false)
  const [occLoading, setOccLoading] = useState(true)

  useEffect(() => {
    // Start loading OpenCascade in the background immediately on mount
    cadEngine._ensureWorker().then(() => {
      setOccReady(true)
      setOccLoading(false)
    }).catch(err => {
      console.error('OCC failed to load:', err)
      setOccLoading(false)
    })
  }, [])
  // features: ordered list of {type:'sketch'|'extrude', id, name, ...}
  // sketches hold their own geometry; working arrays are the active sketch buffer
  const [features,setFeatures]=useState([])
  const [activeSketchId,setActiveSketchId]=useState(null)  // which sketch is being edited
  const featureCountRef=useRef({sketch:0,extrude:0,fillet:0,mirror:0,join:0,loft:0})       // for auto-naming
  const [treeCollapsed,setTreeCollapsed]=useState(false)

  const viewport3dRef=useRef(null)
  const [tool,setTool]=useState(null)
  const [lines,setLines]=useState([])
  // Face-plane sketching: snap onto the underlying solid's own edges/corners too,
  // not just onto other sketch geometry. activePlane.refSegments (set by
  // FacePlane.js's extractFaceBoundarySegments when the face was clicked) are
  // reference-only line segments merged in for snap detection — never rendered
  // or editable as real sketch geometry.
  const faceRefSegments = (activePlane && typeof activePlane === 'object' && activePlane.refSegments) || []
  const snapLines = faceRefSegments.length ? [...lines, ...faceRefSegments] : lines
  const [circles,setCircles]=useState([])
  const [arcs,setArcs]=useState([])
  const [splines,setSplines]=useState([])
  const [dims,setDims]=useState([])  // dimension annotations

  // Spline in-progress state
  const [splinePoints,setSplinePoints]=useState([])   // [{x,y},...] being placed
  const [splineClosed,setSplineClosed]=useState(false) // C key toggles
  const [startPoint,setStartPoint]=useState(null)
  const [circleCenter,setCircleCenter]=useState(null)
  const [mousePos,setMousePos]=useState(null)
  const [dimInput,setDimInput]=useState('')
  const [dimLocked,setDimLocked]=useState(false)
  const [angleInput,setAngleInput]=useState('')
  const [angleLocked,setAngleLocked]=useState(false)
  const [focusField,setFocusField]=useState('dim')
  const [trackedPts,setTrackedPts]=useState([])
  const [deferredTangent,setDeferredTangent]=useState(null)
  const [trimPreview,setTrimPreview]=useState(null)
  const [deletePreview,setDeletePreview]=useState(null)
  const [offsetEntity,setOffsetEntity]=useState(null)    // locked entity after click
  const [offsetDistInput,setOffsetDistInput]=useState('')
  const [offsetDistLocked,setOffsetDistLocked]=useState(false)
  const [offsetPreview,setOffsetPreview]=useState(null)
  const [offsetHover,setOffsetHover]=useState(null)
  const [mirrorSel,setMirrorSel]=useState([])
  const [mirrorAccepted,setMirrorAccepted]=useState(false)
  const [mirrorHover,setMirrorHover]=useState(null)
  const [mirrorP1,setMirrorP1]=useState(null)
  const [mirrorPreview,setMirrorPreview]=useState(null)

  // Centre tool state — pick geometry, Tab/right-click accepts AND commits in
  // one step (snaps the selection's bbox center to the sketch origin), unlike
  // Mirror/Resize/Fillet which need one more input after accepting.
  const [centerSel,setCenterSel]=useState([])
  const [centerHover,setCenterHover]=useState(null)

  // Move/Copy tool state
  const [moveCopySel,setMoveCopySel]=useState([])
  const [moveCopyAccepted,setMoveCopyAccepted]=useState(false)
  const [moveCopyMode,setMoveCopyMode]=useState('move')
  const [moveCopyCountInput,setMoveCopyCountInput]=useState('1')
  const [moveCopyHover,setMoveCopyHover]=useState(null)

  // Rotate/Copy tool state
  const [rotateCopySel,setRotateCopySel]=useState([])
  const [rotateCopyAccepted,setRotateCopyAccepted]=useState(false)
  const [rotateCopyMode,setRotateCopyMode]=useState('rotate')
  const [rotateCopyCountInput,setRotateCopyCountInput]=useState('1')
  const [rotateCopyHover,setRotateCopyHover]=useState(null)

  // Resize tool state
  const [resizeSel,setResizeSel]=useState([])
  const [resizeAccepted,setResizeAccepted]=useState(false)
  const [resizeScaleInput,setResizeScaleInput]=useState('')
  const [resizeHover,setResizeHover]=useState(null)

  // Fillet tool state
  const [filletSel,setFilletSel]=useState([])   // up to 2 {kind:'line',idx,clickPt}
  const [filletAccepted,setFilletAccepted]=useState(false)
  const [filletRadiusInput,setFilletRadiusInput]=useState('')
  const [filletHover,setFilletHover]=useState(null)
  const [filletPreview,setFilletPreview]=useState(null)

  // Extend tool state
  const [extendPreview,setExtendPreview]=useState(null)

  // T key toggles tangent snap mode; resets to false after each line is placed or Esc
  const [tKeyDown,setTKeyDown]=useState(false)
  const [pKeyDown,setPKeyDown]=useState(false)
  const [drawStyle,setDrawStyle]=useState(null) // null|'construction'
  const [perpSourceLineIdx,setPerpSourceLineIdx]=useState(null)
  // Trace tool state
  const [traceOpen,setTraceOpen]=useState(false)
  const [traceInsertPt,setTraceInsertPt]=useState(null)

  // Text tool state
  const [textOpen,setTextOpen]=useState(false)
  const [pageSetupOpen,setPageSetupOpen]=useState(false)
  const [pageConfig,setPageConfig]=useState({size:'A4',orientation:'landscape',margin:10,showPage:false})
  const [guideOpen,setGuideOpen]=useState(false)
  const [gridVisible,setGridVisible]=useState(false)
  const [gridSnap,setGridSnap]=useState(false)
  const [gridSizeMm,setGridSizeMm]=useState(5)
  const [textInsertPt,setTextInsertPt]=useState(null)

  const [intersectionPts,setIntersectionPts]=useState([])

  // Dimension tool state
  const [dimToolStep,setDimToolStep]=useState(0)    // 0=idle, 1=got p1, 2=got p2
  const [dimToolPts,setDimToolPts]=useState([])     // clicked points so far
  const [dimToolPreview,setDimToolPreview]=useState(null)  // live preview
  const [dimEditIdx,setDimEditIdx]=useState(null)   // index of dim being edited
  const [dimEditText,setDimEditText]=useState('')   // override text

  // Join tool state
  const [joinFirstPt,setJoinFirstPt]=useState(null)   // {lineIdx, end:'x1y1'|'x2y2', x, y} or spline equiv
  const [joinHover,setJoinHover]=useState(null)        // same structure, for hover highlight

  // Select tool state — full multi-select with bounding box handles
  const [selection,setSelection]=useState([])           // [{kind,idx},...]
  const [selectHover,setSelectHover]=useState(null)     // entity hovered but not selected
  const selectDragHandleRef=useRef(null)                // handle being dragged: null|string
  const selectDragStartRef=useRef(null)                 // world pos where handle drag started
  const selectDragStartScreenRef=useRef(null)           // screen pos where handle drag started (for click detection)
  const selectSnapshotRef=useRef(null)                  // entity snapshot at drag start
  const selectBBoxRef=useRef(null)                      // bbox at drag start
  const [selectLiveGeom,setSelectLiveGeom]=useState(null) // live-transformed geometry during drag
  // Dimension editing state
  const [selectDimField,setSelectDimField]=useState(null)   // currently focused field
  const [selectDimInput,setSelectDimInput]=useState('')      // value being typed in current field
  const [selectDimPending,setSelectDimPending]=useState({}) // {width:'',height:'',length:'',angle:'',radius:''}
  const [selectDimAnchor,setSelectDimAnchor]=useState('mc') // handle id that stays fixed

  // Drag window select — tracks an active selection rectangle
  const [dragSelectRect,setDragSelectRect]=useState(null)
  const dragStartRef=useRef(null)   // screen coords {x,y} where left-button pressed
  const dragRectRef=useRef(null)    // world coords {x1,y1,x2,y2} of current drag rect
  const wasDragRef=useRef(false)    // suppress click event after a completed drag-select

  // ── VIEWPORT ──
  // viewTransform kept as a dummy so existing helper functions that read .scale
  // continue to work — we sync .scale from the Three.js camera via onScaleChange.
  const [viewTransform,setViewTransform]=useState({x:0,y:0,scale:1})
  const [canvasSize,setCanvasSize]=useState({w:window.innerWidth-56,h:window.innerHeight-52})
  const viewTransformRef=useRef({x:0,y:0,scale:1})
  const isPanningRef=useRef(false)
  const lastPanPosRef=useRef({x:0,y:0})

  // Keep viewTransformRef.scale in sync with Three.js camera zoom
  // (fired via onScaleChange callback from Viewport3D)
  useEffect(()=>{
    viewTransformRef.current=viewTransform
    zoomRef.scale=viewTransform.scale
  },[viewTransform])

  // Resize: update canvasSize so panels reflow correctly
  useEffect(()=>{
    const onResize=()=>setCanvasSize({w:window.innerWidth-56,h:window.innerHeight-52})
    window.addEventListener('resize',onResize)
    return ()=>window.removeEventListener('resize',onResize)
  },[])

  // Called by Viewport3D whenever the camera zoom changes
  function handleScaleChange(newScale){
    const vt={x:0,y:0,scale:newScale}
    viewTransformRef.current=vt
    zoomRef.scale=newScale
    setViewTransform(vt)
  }

  // screenToWorld — Viewport3D internally switches to sketch-space coords
  // whenever activePlane is set, via activePlaneInternalRef. No stale closure risk.
  function screenToWorld(clientX, clientY){
    return viewport3dRef.current?.screenToWorld(clientX, clientY) ?? {x:0,y:0}
  }

  function zoomToFit(){
    viewport3dRef.current?.zoomToFit()
  }

  const { commit, undo, redo, canUndo, canRedo } = useHistory()
  const snapshot = () => ({ lines, circles, arcs, splines })
  const restore = (snap) => { setLines(snap.lines); setCircles(snap.circles); setArcs(snap.arcs); setSplines(snap.splines||[]) }

  const trackedPtsRef=useRef([])
  const splinePointsRef=useRef([])
  const linesRef=useRef([])
  const circlesRef=useRef([])
  const arcsRef=useRef([])
  const splinesRef=useRef([])
  const loadFileRef=useRef(null)
  const [loadError,setLoadError]=useState(null)
  useEffect(()=>{trackedPtsRef.current=trackedPts},[trackedPts])
  useEffect(()=>{splinePointsRef.current=splinePoints},[splinePoints])
  useEffect(()=>{linesRef.current=lines},[lines])
  useEffect(()=>{circlesRef.current=circles},[circles])
  useEffect(()=>{arcsRef.current=arcs},[arcs])
  useEffect(()=>{splinesRef.current=splines},[splines])

  function resetDrawState(){
    setStartPoint(null);setCircleCenter(null)
    setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
    setTrackedPts([]);trackedPtsRef.current=[];setDeferredTangent(null);setTKeyDown(false);setPKeyDown(false);setPerpSourceLineIdx(null)
  }
  function resetSelection(){
    setSelection([]);setSelectHover(null);setSelectLiveGeom(null)
    setSelectDimField(null);setSelectDimPending({});setSelectDimAnchor('mc')
    selectDragHandleRef.current=null;selectDragStartRef.current=null
    selectSnapshotRef.current=null;selectBBoxRef.current=null
  }
  function resetSpline(){
    setSplinePoints([]);setSplineClosed(false)
  }
  function resetOffset(){
    setOffsetEntity(null)
    setOffsetDistInput('');setOffsetDistLocked(false)
    setOffsetPreview(null);setOffsetHover(null)
  }
  function resetMirror(){
    setMirrorSel([]);setMirrorAccepted(false)
    setMirrorHover(null);setMirrorP1(null);setMirrorPreview(null)
  }
  function resetCenter(){
    setCenterSel([]); setCenterHover(null)
  }
  // Accept for the Centre tool IS the commit — snaps the current selection's
  // bbox center to the sketch origin, then resets back to step 1 (stays on
  // the tool, ready to pick the next selection — same as Mirror's post-commit
  // resetMirror()).
  function commitCenter(){
    if (centerSel.length===0) return
    const bbox = selectionBBox(centerSel, lines, circles, arcs, splines)
    if (!bbox) return
    const cx=(bbox.x1+bbox.x2)/2, cy=(bbox.y1+bbox.y2)/2
    commit(snapshot())
    const result = applySelectionTransform(centerSel, lines, circles, arcs, splines, {x:0,y:0}, 1, 1, -cx, -cy)
    setLines(result.lines); setCircles(result.circles); setArcs(result.arcs); setSplines(result.splines)
    resetCenter()
  }
  function resetMoveCopy(){
    setMoveCopySel([]);setMoveCopyAccepted(false)
    setMoveCopyMode('move');setMoveCopyCountInput('1')
    setMoveCopyHover(null)
  }
  function resetRotateCopy(){
    setRotateCopySel([]);setRotateCopyAccepted(false)
    setRotateCopyMode('rotate');setRotateCopyCountInput('1')
    setRotateCopyHover(null)
  }
  function resetResize(){
    setResizeSel([]);setResizeAccepted(false)
    setResizeScaleInput('');setResizeHover(null)
  }
  function resetFillet(){
    setFilletSel([]);setFilletAccepted(false)
    setFilletRadiusInput('');setFilletHover(null);setFilletPreview(null)
  }
  function resetTrace(){
    setTraceOpen(false);setTraceInsertPt(null)
  }
  function resetDim(){
    setDimToolStep(0);setDimToolPts([]);setDimToolPreview(null)
    setDimEditIdx(null);setDimEditText('')
  }
  function resetJoin(){
    setJoinFirstPt(null);setJoinHover(null)
  }
  function resetText(){
    setTextOpen(false);setTextInsertPt(null)
  }

  // Returns true when we're in a selection phase that supports drag-window select
  function inSelPhase(){
    return (tool==='mirror'&&!mirrorAccepted)||
           (tool==='center')||
           (tool==='movecopy'&&!moveCopyAccepted)||
           (tool==='rotatecopy'&&!rotateCopyAccepted)||
           (tool==='resize'&&!resizeAccepted)||
           (tool==='fillet'&&!filletAccepted)
  }

  // Execute a drag-window select: add all entities with any point inside rect to current tool's selection
  function executeDragSelect(rect){
    const minX=Math.min(rect.x1,rect.x2),maxX=Math.max(rect.x1,rect.x2)
    const minY=Math.min(rect.y1,rect.y2),maxY=Math.max(rect.y1,rect.y2)
    const ptIn=(x,y)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY
    const hits=[]
    // Ghost geometry (a Loft profile's previous profile, injected dimmed/
    // snap-only via injectLoftGhost — see the matching guard in
    // trimDelete.js) must stay unselectable here too: this one function
    // backs the Select tool's own selection (and Delete key) plus every
    // MODIFY-group tool's click/drag pick (Mirror, Centre, Move/Copy,
    // Rotate/Copy, Resize, Fillet), so skipping ghostRef entities here locks
    // them out of all of those in one place.
    linesRef.current.forEach((l,idx)=>{
      if(l.ghostRef) return
      if(ptIn(l.x1,l.y1)||ptIn(l.x2,l.y2)) hits.push({kind:'line',idx})
    })
    circlesRef.current.forEach((c,idx)=>{
      if(c.ghostRef) return
      if(ptIn(c.cx,c.cy)||ptIn(c.cx+c.r,c.cy)||ptIn(c.cx-c.r,c.cy)) hits.push({kind:'circle',idx})
    })
    arcsRef.current.forEach((arc,idx)=>{
      if(arc.ghostRef) return
      const p1x=arc.cx+arc.r*Math.cos(arc.startAngle),p1y=arc.cy+arc.r*Math.sin(arc.startAngle)
      const p2x=arc.cx+arc.r*Math.cos(arc.endAngle),p2y=arc.cy+arc.r*Math.sin(arc.endAngle)
      if(ptIn(arc.cx,arc.cy)||ptIn(p1x,p1y)||ptIn(p2x,p2y)) hits.push({kind:'arc',idx})
    })
    splinesRef.current.forEach((sp,idx)=>{
      if(sp.ghostRef) return
      if(sp.points.some(p=>ptIn(p.x,p.y))) hits.push({kind:'spline',idx})
    })
    const merge=(prev)=>{
      const m=[...prev]
      hits.forEach(h=>{if(!m.some(p=>p.kind===h.kind&&p.idx===h.idx))m.push(h)})
      return m
    }
    if(tool==='mirror')      setMirrorSel(merge)
    if(tool==='center')      setCenterSel(merge)
    if(tool==='movecopy')    setMoveCopySel(merge)
    if(tool==='rotatecopy')  setRotateCopySel(merge)
    if(tool==='resize')      setResizeSel(merge)
    if(tool==='fillet'){
      // fillet only uses lines, max 2
      const lineHits=hits.filter(h=>h.kind==='line')
      setFilletSel(prev=>{
        const m=[...prev]
        lineHits.forEach(h=>{
          if(!m.some(p=>p.kind===h.kind&&p.idx===h.idx)&&m.length<2)
            m.push({...h,clickPt:{x:(lines[h.idx].x1+lines[h.idx].x2)/2,y:(lines[h.idx].y1+lines[h.idx].y2)/2}})
        })
        return m
      })
    }
  }

  function computeEnd(start,raw,tracked){
    if (!dimLocked&&!angleLocked){
      const geo=getGeoSnap(raw,snapLines,circles,arcs,start,false,splines,intersectionPts)
      if (geo&&geo.type!=='tan') return{x:geo.x,y:geo.y,snapType:geo.type,angleSnap:checkAngle(start,geo),tracks:[]}
    }
    const{snapped,tracks}=applyTracking(raw,tracked)
    let endX=snapped.x,endY=snapped.y,angleSnap=null
    if (angleLocked){
      const θ=parseFloat(angleInput)*Math.PI/180,dir={x:Math.cos(θ),y:-Math.sin(θ)}
      const dx=snapped.x-start.x,dy=snapped.y-start.y
      const t=Math.max(5,dx*dir.x+dy*dir.y)
      endX=start.x+t*dir.x;endY=start.y+t*dir.y
    } else {
      const a=getAngleSnap(start,snapped);endX=a.x;endY=a.y;angleSnap=a.angleSnap
    }
    if (dimLocked){
      const px=mmToPx(parseFloat(dimInput)||0)
      const dx=endX-start.x,dy=endY-start.y,len=Math.hypot(dx,dy)
      if (len>0) return{x:start.x+(dx/len)*px,y:start.y+(dy/len)*px,snapType:null,angleSnap:angleLocked?null:angleSnap,tracks}
    }
    return{x:endX,y:endY,snapType:null,angleSnap:angleLocked?null:angleSnap,tracks}
  }

  const updateTracking=useCallback((pos)=>{
    const sc=viewTransformRef.current.scale
    const allPts=getAllSnapPoints(linesRef.current,circlesRef.current,arcsRef.current,splinesRef.current)
    const current=trackedPtsRef.current
    for (const p of allPts){
      if (Math.hypot(pos.x-p.x,pos.y-p.y)<ACQUIRE_DIST/sc){
        const already=current.some(tp=>Math.hypot(tp.x-p.x,tp.y-p.y)<2/sc)
        if (!already){const next=[...current,p];trackedPtsRef.current=next;setTrackedPts(next)}
        return
      }
    }
    const onAnyTrack=current.some(tp=>Math.abs(pos.y-tp.y)<ALIGN_SNAP_DIST/sc||Math.abs(pos.x-tp.x)<ALIGN_SNAP_DIST/sc)
    if (!onAnyTrack&&current.length>0){trackedPtsRef.current=[];setTrackedPts([])}
  },[])

  useEffect(()=>{
    if (tool==='trim'&&mousePos){
      const prev=computeTrimPreview(mousePos,lines,circles,arcs,splines)
      if (prev){setTrimPreview(prev);return}
      // Check if mouse is near a spline — compute trim region
      const nearest=nearestSpline(mousePos,splines)
      if (nearest){
        const sp=splines[nearest.idx]
        const spPrev=computeSplineTrimPreview(mousePos,nearest.idx,sp,lines,circles,arcs,splines)
        setTrimPreview(spPrev||{kind:'spline',idx:nearest.idx,highlightPts:null})
        return
      }
      // No intersections — fallback to deletewhole if mouse is near any entity
      const delPrev=computeDeletePreview(mousePos,lines,circles,arcs,splines)
      if (delPrev) setTrimPreview({...delPrev,deletewhole:true})
      else setTrimPreview(null)
    } else setTrimPreview(null)
  },[tool,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool==='delete'&&mousePos){
      const prev=computeDeletePreview(mousePos,lines,circles,arcs)
      if (prev){setDeletePreview(prev);return}
      const sp=nearestSpline(mousePos,splines)
      if (sp){setDeletePreview(sp);return}
      // Hit-test dimensions
      const sd=(SELECT_DIST*1.5)/zoomRef.scale
      let bestDim=null,bestDist=sd+1
      dims.forEach((dim,idx)=>{
        let d=sd+1
        if (dim.kind==='linear'&&dim.x1!=null&&dim.x2!=null){
          const len=Math.hypot(dim.x2-dim.x1,dim.y2-dim.y1)||1
          const perpX=-(dim.y2-dim.y1)/len,perpY=(dim.x2-dim.x1)/len
          const off=dim.offset||0
          const d1x=dim.x1+perpX*off,d1y=dim.y1+perpY*off
          const d2x=dim.x2+perpX*off,d2y=dim.y2+perpY*off
          d=Math.min(distToSeg(mousePos.x,mousePos.y,d1x,d1y,d2x,d2y),
                     distToSeg(mousePos.x,mousePos.y,dim.x1,dim.y1,d1x,d1y),
                     distToSeg(mousePos.x,mousePos.y,dim.x2,dim.y2,d2x,d2y))
        } else if ((dim.kind==='diameter'||dim.kind==='radius')&&dim.cx!=null){
          const ex=dim.cx+Math.cos(dim.angle)*(dim.kind==='diameter'?dim.r*2:dim.r)
          const ey=dim.cy+Math.sin(dim.angle)*(dim.kind==='diameter'?dim.r*2:dim.r)
          const sx=dim.kind==='diameter'?dim.cx-Math.cos(dim.angle)*dim.r:dim.cx
          const sy=dim.kind==='diameter'?dim.cy-Math.sin(dim.angle)*dim.r:dim.cy
          d=distToSeg(mousePos.x,mousePos.y,sx,sy,ex,ey)
        }
        if (d<bestDist){bestDist=d;bestDim={kind:'dim',idx}}
      })
      setDeletePreview(bestDim||null)
    } else setDeletePreview(null)
  },[tool,mousePos,lines,circles,arcs,splines,dims])

  useEffect(()=>{
    if (tool==='extend'&&mousePos) setExtendPreview(computeExtendPreview(mousePos,lines,circles,arcs,splines))
    else setExtendPreview(null)
  },[tool,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='offset'||!mousePos||!offsetEntity){setOffsetPreview(null);return}
    let entity
    if (offsetEntity.kind==='line')   entity=lines[offsetEntity.idx]
    if (offsetEntity.kind==='circle') entity=circles[offsetEntity.idx]
    if (offsetEntity.kind==='arc')    entity=arcs[offsetEntity.idx]
    if (offsetEntity.kind==='spline') entity=splines[offsetEntity.idx]
    if (!entity){setOffsetPreview(null);return}
    const distPx=offsetDistLocked
      ? mmToPx(parseFloat(offsetDistInput)||1)
      : distToEntity(mousePos,entity,offsetEntity.kind)
    setOffsetPreview(computeOffsetPreview(entity,offsetEntity.kind,distPx,mousePos))
  },[tool,mousePos,offsetEntity,offsetDistInput,offsetDistLocked,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='offset'||!mousePos){setOffsetHover(null);return}
    setOffsetHover(nearestOffsetEntity(mousePos,lines,circles,arcs,splines))
  },[tool,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='mirror'||mirrorAccepted||!mousePos){setMirrorHover(null);return}
    setMirrorHover(nearestMirrorEntity(mousePos,lines,circles,arcs,splines))
  },[tool,mirrorAccepted,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='center'||!mousePos){setCenterHover(null);return}
    setCenterHover(nearestMirrorEntity(mousePos,lines,circles,arcs,splines))
  },[tool,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='mirror'||!mirrorAccepted||!mirrorP1||!mousePos||!mirrorSel.length){setMirrorPreview(null);return}
    const hSnap=getGeoSnap(mousePos,snapLines,circles,arcs,mirrorP1,false,splines,intersectionPts)
    let endPt
    if (hSnap&&hSnap.type!=='tan'){endPt={x:hSnap.x,y:hSnap.y}}
    else{const{snapped}=applyTracking(mousePos,trackedPts);const angled=getAngleSnap(mirrorP1,snapped);endPt={x:angled.x,y:angled.y}}
    setMirrorPreview(buildMirror(mirrorSel,lines,circles,arcs,splines,mirrorP1.x,mirrorP1.y,endPt.x,endPt.y))
  },[tool,mirrorAccepted,mirrorP1,mousePos,mirrorSel,lines,circles,arcs,trackedPts])

  useEffect(()=>{
    if (tool!=='movecopy'||moveCopyAccepted||!mousePos){setMoveCopyHover(null);return}
    setMoveCopyHover(nearestMoveCopyEntity(mousePos,lines,circles,arcs,splines))
  },[tool,moveCopyAccepted,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='rotatecopy'||rotateCopyAccepted||!mousePos){setRotateCopyHover(null);return}
    setRotateCopyHover(nearestRotateCopyEntity(mousePos,lines,circles,arcs,splines))
  },[tool,rotateCopyAccepted,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='resize'||resizeAccepted||!mousePos){setResizeHover(null);return}
    setResizeHover(nearestScaleEntity(mousePos,lines,circles,arcs,splines))
  },[tool,resizeAccepted,mousePos,lines,circles,arcs,splines])

  // Dim tool — live preview while placing
  useEffect(()=>{
    if (tool!=='dim'||!mousePos){setDimToolPreview(null);return}
    if (dimToolStep===0){
      // Hover: detect if near circle or arc for one-click dim
      let bestCircle=null,bestArc=null,bestDist=SELECT_DIST*2/zoomRef.scale
      circles.forEach((c,idx)=>{
        const d=Math.abs(Math.hypot(mousePos.x-c.cx,mousePos.y-c.cy)-c.r)
        if(d<bestDist){bestDist=d;bestCircle={kind:'circle',idx}}
      })
      if (!bestCircle) arcs.forEach((a,idx)=>{
        const angle=norm2pi(Math.atan2(mousePos.y-a.cy,mousePos.x-a.cx))
        if(!angleOnArc(angle,a.startAngle,a.endAngle)) return
        const d=Math.abs(Math.hypot(mousePos.x-a.cx,mousePos.y-a.cy)-a.r)
        if(d<bestDist){bestDist=d;bestArc={kind:'arc',idx}}
      })
      if (bestCircle){
        const c=circles[bestCircle.idx]
        const ang=Math.atan2(mousePos.y-c.cy,mousePos.x-c.cx)
        setDimToolPreview({kind:'diameter',cx:c.cx,cy:c.cy,r:c.r,angle:ang})
      } else if (bestArc){
        const a=arcs[bestArc.idx]
        const ang=Math.atan2(mousePos.y-a.cy,mousePos.x-a.cx)
        setDimToolPreview({kind:'radius',cx:a.cx,cy:a.cy,r:a.r,angle:ang})
      } else {
        setDimToolPreview(null)
      }
    } else if (dimToolStep===1){
      // Got p1, show linear dim to mouse
      const p1=dimToolPts[0]
      const dx=mousePos.x-p1.x,dy=mousePos.y-p1.y
      const len=Math.hypot(dx,dy)
      if(len>1) setDimToolPreview({kind:'linear',x1:p1.x,y1:p1.y,x2:mousePos.x,y2:mousePos.y,offset:0})
    } else if (dimToolStep===2){
      // Got p1+p2, set offset distance
      const [p1,p2]=dimToolPts
      const dx=p2.x-p1.x,dy=p2.y-p1.y,len=Math.hypot(dx,dy)
      if(len<1) return
      // Perpendicular offset = signed distance from mouse to line p1-p2
      const nx=-dy/len,ny=dx/len
      const offset=(mousePos.x-p1.x)*nx+(mousePos.y-p1.y)*ny
      setDimToolPreview({kind:'linear',x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,offset})
    }
  },[tool,mousePos,dimToolStep,dimToolPts,circles,arcs])

  // Join tool hover — find nearest line/spline endpoint within snap distance
  useEffect(()=>{
    if (tool!=='join'||!mousePos){setJoinHover(null);return}
    const sd=SELECT_DIST*1.5/zoomRef.scale
    let best=null,bestDist=sd+1
    lines.forEach((l,lineIdx)=>{
      [{end:'x1y1',x:l.x1,y:l.y1},{end:'x2y2',x:l.x2,y:l.y2}].forEach(p=>{
        const d=Math.hypot(mousePos.x-p.x,mousePos.y-p.y)
        if(d<bestDist){bestDist=d;best={kind:'line',lineIdx,end:p.end,x:p.x,y:p.y}}
      })
    })
    splines.forEach((sp,splineIdx)=>{
      if(sp.points.length<2||sp.closed) return
      [{end:'first',x:sp.points[0].x,y:sp.points[0].y},
       {end:'last', x:sp.points[sp.points.length-1].x,y:sp.points[sp.points.length-1].y}
      ].forEach(p=>{
        const d=Math.hypot(mousePos.x-p.x,mousePos.y-p.y)
        if(d<bestDist){bestDist=d;best={kind:'spline',splineIdx,end:p.end,x:p.x,y:p.y}}
      })
    })
    setJoinHover(best)
  },[tool,mousePos,lines,splines])

  useEffect(()=>{
    if (tool!=='select'||!mousePos){setSelectHover(null);return}
    if (selectDragHandleRef.current) return
    // Skip hover when over a handle of the current selection
    const curLines   = selectLiveGeom?.lines   || lines
    const curCircles = selectLiveGeom?.circles || circles
    const curArcs    = selectLiveGeom?.arcs    || arcs
    const curSplines = selectLiveGeom?.splines || splines
    const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)
    if (bbox){
      const handles=getBBoxHandles(bbox)
      if (hitTestHandles(mousePos,handles,12/viewTransform.scale)){setSelectHover(null);return}
    }
    const sd=SELECT_DIST/zoomRef.scale
    let best=null,bestDist=sd+1
    lines.forEach((l,idx)=>{const d=distToSeg(mousePos.x,mousePos.y,l.x1,l.y1,l.x2,l.y2);if(d<bestDist){bestDist=d;best={kind:'line',idx}}})
    circles.forEach((c,idx)=>{const d=Math.abs(Math.hypot(mousePos.x-c.cx,mousePos.y-c.cy)-c.r);if(d<bestDist){bestDist=d;best={kind:'circle',idx}}})
    arcs.forEach((arc,idx)=>{
      const angle=norm2pi(Math.atan2(mousePos.y-arc.cy,mousePos.x-arc.cx))
      if (!angleOnArc(angle,arc.startAngle,arc.endAngle)) return
      const d=Math.abs(Math.hypot(mousePos.x-arc.cx,mousePos.y-arc.cy)-arc.r)
      if (d<bestDist){bestDist=d;best={kind:'arc',idx}}
    })
    splines.forEach((sp,idx)=>{
      if (sp.points.length<2) return
      const d=distToSpline(mousePos.x,mousePos.y,sp.points,sp.closed)
      if (d<bestDist){bestDist=d;best={kind:'spline',idx}}
    })
    // Hit-test dimensions — check proximity to dim line and extension lines
    dims.forEach((dim,idx)=>{
      let d=sd+1
      if (dim.kind==='linear'&&dim.x1!=null&&dim.x2!=null){
        const len=Math.hypot(dim.x2-dim.x1,dim.y2-dim.y1)||1
        const perpX=-(dim.y2-dim.y1)/len,perpY=(dim.x2-dim.x1)/len
        const off=dim.offset||0
        const d1x=dim.x1+perpX*off,d1y=dim.y1+perpY*off
        const d2x=dim.x2+perpX*off,d2y=dim.y2+perpY*off
        d=Math.min(distToSeg(mousePos.x,mousePos.y,d1x,d1y,d2x,d2y),
                   distToSeg(mousePos.x,mousePos.y,dim.x1,dim.y1,d1x,d1y),
                   distToSeg(mousePos.x,mousePos.y,dim.x2,dim.y2,d2x,d2y))
      } else if ((dim.kind==='diameter'||dim.kind==='radius')&&dim.cx!=null){
        const ex=dim.cx+Math.cos(dim.angle)*(dim.kind==='diameter'?dim.r*2:dim.r)
        const ey=dim.cy+Math.sin(dim.angle)*(dim.kind==='diameter'?dim.r*2:dim.r)
        const sx=dim.kind==='diameter'?dim.cx-Math.cos(dim.angle)*dim.r:dim.cx
        const sy=dim.kind==='diameter'?dim.cy-Math.sin(dim.angle)*dim.r:dim.cy
        d=distToSeg(mousePos.x,mousePos.y,sx,sy,ex,ey)
      }
      if (d<bestDist){bestDist=d;best={kind:'dim',idx}}
    })
    setSelectHover(best)
  },[tool,mousePos,lines,circles,arcs,splines,dims,selection,selectLiveGeom,viewTransform.scale])

  useEffect(()=>{
    setIntersectionPts(computeAllIntersections(lines,circles,arcs,splines))
  },[lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='fillet'||filletAccepted||!mousePos){setFilletHover(null);return}
    setFilletHover(nearestFilletLine(mousePos,lines))
  },[tool,filletAccepted,mousePos,lines])

  useEffect(()=>{
    if (tool!=='fillet'||!filletAccepted||filletSel.length<2){setFilletPreview(null);return}
    const r=mmToPx(parseFloat(filletRadiusInput)||0)
    if (r<=0){setFilletPreview(null);return}
    const l1=lines[filletSel[0].idx],l2=lines[filletSel[1].idx]
    setFilletPreview(computeFillet(l1,l2,r,filletSel[0].clickPt,filletSel[1].clickPt))
  },[tool,filletAccepted,filletSel,filletRadiusInput,lines])


  // ── PERP SNAP — completely separate algorithm, no tangent code ──────────────
  // Foot of perpendicular from point (px,py) onto infinite line through (x1,y1)→(x2,y2)
  function calcPerpFoot(px, py, x1, y1, x2, y2, clamp=false) {
    const dx=x2-x1, dy=y2-y1, len2=dx*dx+dy*dy
    if (len2<1e-10) return {x:x1, y:y1}
    let t=((px-x1)*dx+(py-y1)*dy)/len2
    if (clamp) t=Math.max(0,Math.min(1,t))
    return {x:x1+t*dx, y:y1+t*dy}
  }
  // Distance from point to infinite line
  function distToInfiniteLine(px, py, x1, y1, x2, y2) {
    const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy)
    if (len<1e-10) return Math.hypot(px-x1,py-y1)
    return Math.abs((py-y1)*dx-(px-x1)*dy)/len
  }
  // Find nearest line to cursor within threshold (pixels).
  // Uses SELECT_DIST (generous) so user doesn't need pixel-perfect aim.
  function findNearestLineForPerp(mouse, lines, excludeIdx=null) {
    const threshold = SELECT_DIST * 3 / zoomRef.scale
    let best=null, bestIdx=-1, bestDist=threshold+1
    lines.forEach((l,idx)=>{
      if (idx===excludeIdx) return   // skip source line
      const d=distToInfiniteLine(mouse.x,mouse.y,l.x1,l.y1,l.x2,l.y2)
      if (d<bestDist) { bestDist=d; best=l; bestIdx=idx }
    })
    if (!best) return null
    // Foot clamped to segment so indicator stays on the visible line
    return { line:best, idx:bestIdx, foot:calcPerpFoot(mouse.x,mouse.y,best.x1,best.y1,best.x2,best.y2,true) }
  }
  // Draw the perp indicator — right-angle square + PERP label (no circles, no arc symbols)
  function drawPerpIndicator(ctx, x, y, sc) {
    ctx.save()
    ctx.translate(x,y); ctx.scale(1/sc,1/sc)
    ctx.strokeStyle='#00BCD4'; ctx.lineWidth=2.5; ctx.lineCap='round'
    const s=10
    ctx.beginPath()
    ctx.moveTo(-s, s); ctx.lineTo(-s,-s); ctx.lineTo(s,-s)
    ctx.stroke()
    // Corner square
    ctx.beginPath()
    ctx.moveTo(-s, s-6); ctx.lineTo(-s+6, s-6); ctx.lineTo(-s+6, s)
    ctx.stroke()
    ctx.fillStyle='#00BCD4'; ctx.font='bold 11px monospace'
    ctx.fillText('PERP', s+4, -s+8)
    ctx.restore()
  }

  // Apply entity style to canvas context
  function applyEntityStyle(ctx, entity, sc, baseColor, baseLineWidth) {
    const s = entity?.style
    if (s==='construction') {
      ctx.strokeStyle = baseColor==='#222' ? '#aaa' : baseColor
      ctx.lineWidth = Math.min(baseLineWidth, 0.8/sc)
      ctx.setLineDash([])
    } else if (s==='dashed') {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = baseLineWidth
      ctx.setLineDash([8/sc, 4/sc])
    } else {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = baseLineWidth
      ctx.setLineDash([])
    }
  }

  // ── OVERLAY DRAW ──
  // Geometry lives in Three.js (Viewport3D). Tool overlays (snap indicators,
  // rubber-band lines, selection boxes, labels, previews) are drawn onto a
  // transparent 2D canvas that sits on top of the Three.js canvas.
  // We obtain a pre-transformed context from viewport3dRef.getOverlayCtx()
  // which matches the old viewTransform coordinate system exactly.
  // viewTransform changes on every camera move, so the overlay redraws each time.
  useEffect(()=>{
    if (!viewport3dRef.current) return
    viewport3dRef.current.clearOverlay()

    // While sketching on a face, draw the underlying solid's own face boundary —
    // these are the same segments used for snapping (activePlane.refSegments, from
    // FacePlane.js's extractFaceBoundarySegments). They were originally snap-only
    // (never rendered), but that made the reference geometry invisible even though
    // you could snap to it — draw a faint outline so it's clear what's snappable.
    if (sketchMode && faceRefSegments.length > 0) {
      const vp = viewport3dRef.current
      const oc = vp.getOverlayCanvas?.()
      if (oc) {
        const ctx = oc.getContext('2d')
        ctx.setTransform(1,0,0,1,0,0)
        ctx.save()
        ctx.strokeStyle = '#9aa5b1'
        ctx.lineWidth = 1.25
        ctx.setLineDash([5,4])
        faceRefSegments.forEach(seg => {
          const p1 = vp.sketchToScreen(seg.x1, seg.y1, 'face', activePlane)
          const p2 = vp.sketchToScreen(seg.x2, seg.y2, 'face', activePlane)
          if (!p1 || !p2) return
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()
        })
        ctx.setLineDash([])
        ctx.restore()
      }
    }

    // When extrude tool is active but NOT in sketch mode (step 1 or step 3):
    // draw cached profile outlines projected onto the 3D scene.
    // Skip this block during step 2 (sketch mode) so normal sketch drawing runs.
    if (extrudeTool && !sketchMode) {
      if (cachedProfiles.length > 0) {
        const vp = viewport3dRef.current
        const oc = vp.getOverlayCanvas?.()
        if (oc) {
          const ctx = oc.getContext('2d')
          ctx.setTransform(1,0,0,1,0,0)  // raw pixel space
          cachedProfiles.forEach(prof => {
            const color = extrudeTool==='cutout' ? '#e05a4e' : '#3a7bd5'
            const isSelected = extrudeState && extrudeState.planeId===prof.planeId &&
              extrudeState.profiles[0]===prof.pts
            // Project each sketch point to screen pixels
            const screenPts = prof.pts.map(p =>
              vp.sketchToScreen(p.x, p.y, prof.planeId, prof.facePlane||null)
            ).filter(Boolean)
            if (screenPts.length < 3) return
            ctx.save()
            ctx.beginPath()
            ctx.moveTo(screenPts[0].x, screenPts[0].y)
            screenPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
            ctx.closePath()
            ctx.fillStyle = isSelected ? color+'55' : color+'22'
            ctx.fill()
            ctx.strokeStyle = color
            ctx.lineWidth = isSelected ? 2.5 : 1.5
            ctx.setLineDash(isSelected ? [] : [6, 3])
            ctx.stroke()
            ctx.setLineDash([])
            // Centroid dot + drag arrow handle when profile is selected
            const cScreen = vp.sketchToScreen(prof.centroid.x, prof.centroid.y, prof.planeId, prof.facePlane||null)
            if (cScreen) {
              ctx.beginPath()
              ctx.arc(cScreen.x, cScreen.y, 5, 0, Math.PI*2)
              ctx.fillStyle = color
              ctx.fill()
              ctx.fillStyle = '#fff'
              ctx.font = 'bold 11px monospace'
              ctx.textAlign = 'center'
              ctx.fillText('click to ' + extrudeTool, cScreen.x, cScreen.y - 10)

              // ── Position popup near centroid (arrows are drawn by drawExtrudePreview) ──
              if (isSelected && cScreen) {
                // Position popup near centroid
                const vpEl = vp.getDomElement?.()
                const vpRect = vpEl?.parentElement?.getBoundingClientRect?.()
                if (vpRect) {
                  setExtrudeHandlePos({
                    x: vpRect.left + cScreen.x,
                    y: vpRect.top  + cScreen.y,
                  })
                }
              }
            }
            ctx.restore()
          })
        }
      }
      return
    }
    const over=viewport3dRef.current.getOverlayCtx(activePlane||'XY')
    if (!over) return
    const {ctx,sc}=over

    // In sketch mode: use dark colours on white background
    const sketchLineColor = sketchMode ? '#111111' : '#2196F3'
    const sketchHighlight = sketchMode ? '#0066cc' : '#64B5F6'

    // ── Crosshairs (sketch mode only) ─────────────────────────────────────
    // Draw X and Y axis lines through the plane origin so students can
    // see the coordinate system at a glance.
    if (sketchMode) {
      const axisColor = typeof activePlane === 'string'
        ? (activePlane==='XZ' ? '#cc3300' : activePlane==='YZ' ? '#007722' : '#0033cc')
        : '#666666'
      const large = 9999 / sc
      ctx.save()
      ctx.strokeStyle = axisColor
      ctx.lineWidth = 1 / sc
      ctx.globalAlpha = 0.35
      ctx.beginPath(); ctx.moveTo(-large, 0); ctx.lineTo(large, 0); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, -large); ctx.lineTo(0, large); ctx.stroke()
      // Origin dot
      ctx.globalAlpha = 0.7
      ctx.beginPath(); ctx.arc(0, 0, 5/sc, 0, Math.PI*2)
      ctx.fillStyle = axisColor; ctx.fill()
      ctx.restore()
    }

    // ── Closed profile shading (sketch mode only) ──────────────────────────
    // Detect closed loops and fill them with a subtle tint so students can
    // see which shapes are "ready to extrude".
    if (sketchMode && activePlane) {
      const profiles = detectProfiles(lines, arcs, activePlane, circles, splines)
      profiles.forEach(pts => {
        if (pts.length < 3) return
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
        ctx.closePath()
        // Subtle fill tint matching the active plane colour
        const pc = activePlane==='XZ' ? 'rgba(255,80,80,0.10)'
                 : activePlane==='YZ' ? 'rgba(60,220,100,0.10)'
                 : 'rgba(80,140,255,0.10)'
        ctx.fillStyle = pc
        ctx.fill()
        // Bright outline to show it's a closed profile
        const bc = activePlane==='XZ' ? '#ff5533'
                 : activePlane==='YZ' ? '#33dd66'
                 : '#4499ff'
        ctx.strokeStyle = bc
        ctx.lineWidth = 1.5/sc
        ctx.setLineDash([6/sc, 3/sc])
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      })
    }

    // Use live-transformed geometry during select handle drag
    const drawLines   = selectLiveGeom?.lines   || lines
    const drawCircles = selectLiveGeom?.circles || circles
    const drawArcs    = selectLiveGeom?.arcs    || arcs
    const drawSplines = selectLiveGeom?.splines || splines

    // ── Endpoint dots (sketch mode) ────────────────────────────────────────
    // Draw a small filled dot at each line endpoint so students can see
    // connection points clearly (like Image 4 in the reference).
    if (sketchMode) {
      const dotColor = '#111111'
      const dotR = 4/sc
      const drawn = new Set()
      const dot = (x, y) => {
        const key = `${Math.round(x*10)},${Math.round(y*10)}`
        if (drawn.has(key)) return
        drawn.add(key)
        ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI*2)
        ctx.fillStyle = dotColor; ctx.fill()
      }
      lines.forEach(l => { dot(l.x1,l.y1); dot(l.x2,l.y2) })
      arcs.forEach(a => {
        dot(a.cx+Math.cos(a.startAngle)*a.r, a.cy+Math.sin(a.startAngle)*a.r)
        dot(a.cx+Math.cos(a.endAngle)*a.r,   a.cy+Math.sin(a.endAngle)*a.r)
      })
    }
    drawLines.forEach((line,idx)=>{
      const isDelTarget=deletePreview?.kind==='line'&&deletePreview.idx===idx
      const isOffSel=offsetEntity?.kind==='line'&&offsetEntity.idx===idx
      const isOffHov=offsetHover?.kind==='line'&&offsetHover.idx===idx&&!isOffSel
      const isMirSel=mirrorSel.some(e=>e.kind==='line'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='line'&&mirrorHover.idx===idx&&!isMirSel
      const isCenSel=centerSel.some(e=>e.kind==='line'&&e.idx===idx)
      const isCenHov=centerHover?.kind==='line'&&centerHover.idx===idx&&!isCenSel
      const isMCSel=moveCopySel.some(e=>e.kind==='line'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='line'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='line'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='line'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='line'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='line'&&resizeHover.idx===idx&&!isRzSel
      const isFiSel=filletSel.some(e=>e.kind==='line'&&e.idx===idx)
      const isFiHov=filletHover?.kind==='line'&&filletHover.idx===idx&&!isFiSel
      const isSelHov=selectHover?.kind==='line'&&selectHover.idx===idx&&!selection.some(s=>s.kind==='line'&&s.idx===idx)
      const isSelected=selection.some(s=>s.kind==='line'&&s.idx===idx)
      const color=isDelTarget?'#F44336':isOffSel||isMirSel||isCenSel||isMCSel||isRCSel||isRzSel||isFiSel?'#FF9800':isOffHov||isMirHov||isCenHov||isMCHov||isRCHov||isRzHov||isFiHov?'#FFD600':isSelHov||isSelected?'#64B5F6':null
      if (!color) return
      const lw=(isDelTarget||isOffSel||isMirSel||isCenSel||isMCSel||isRCSel||isRzSel||isFiSel?3:2)/sc
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash([])
      ctx.beginPath();ctx.moveTo(line.x1,line.y1);ctx.lineTo(line.x2,line.y2);ctx.stroke()
      ctx.restore()
    })
    drawCircles.forEach((c,idx)=>{
      const isDelTarget=deletePreview?.kind==='circle'&&deletePreview.idx===idx
      const isMirSel=mirrorSel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='circle'&&mirrorHover.idx===idx&&!isMirSel
      const isCenSel=centerSel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isCenHov=centerHover?.kind==='circle'&&centerHover.idx===idx&&!isCenSel
      const isMCSel=moveCopySel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='circle'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='circle'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='circle'&&resizeHover.idx===idx&&!isRzSel
      const isSelHov=selectHover?.kind==='circle'&&selectHover.idx===idx&&!selection.some(s=>s.kind==='circle'&&s.idx===idx)
      const isSelected=selection.some(s=>s.kind==='circle'&&s.idx===idx)
      const color=isDelTarget?'#F44336':isMirSel||isCenSel||isMCSel||isRCSel||isRzSel?'#FF9800':isMirHov||isCenHov||isMCHov||isRCHov||isRzHov?'#FFD600':isSelHov||isSelected?'#64B5F6':null
      if (!color) return
      const lw=(isDelTarget||isMirSel||isCenSel||isMCSel||isRCSel||isRzSel?3:2)/sc
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash([])
      ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke();ctx.restore()
    })
    drawArcs.forEach((arc,idx)=>{
      const isDelTarget=deletePreview?.kind==='arc'&&deletePreview.idx===idx
      const isOffSel=offsetEntity?.kind==='arc'&&offsetEntity.idx===idx
      const isOffHov=offsetHover?.kind==='arc'&&offsetHover.idx===idx&&!isOffSel
      const isMirSel=mirrorSel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='arc'&&mirrorHover.idx===idx&&!isMirSel
      const isCenSel=centerSel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isCenHov=centerHover?.kind==='arc'&&centerHover.idx===idx&&!isCenSel
      const isMCSel=moveCopySel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='arc'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='arc'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='arc'&&resizeHover.idx===idx&&!isRzSel
      const isSelHov=selectHover?.kind==='arc'&&selectHover.idx===idx&&!selection.some(s=>s.kind==='arc'&&s.idx===idx)
      const isSelected=selection.some(s=>s.kind==='arc'&&s.idx===idx)
      const color=isDelTarget?'#F44336':isOffSel||isMirSel||isCenSel||isMCSel||isRCSel||isRzSel?'#FF9800':isOffHov||isMirHov||isCenHov||isMCHov||isRCHov||isRzHov?'#FFD600':isSelHov||isSelected?'#64B5F6':null
      if (!color) return
      const lw=(isDelTarget||isOffSel||isMirSel||isCenSel||isMCSel||isRCSel||isRzSel?3:2)/sc
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash([])
      ctx.beginPath();ctx.arc(arc.cx,arc.cy,arc.r,arc.startAngle,arc.endAngle,false);ctx.stroke();ctx.restore()
    })
    // Splines never got the same selection/hover highlight treatment as
    // lines/circles/arcs above (drawSplines existed, just unused here) — so
    // picking one up in Mirror/Move/Rotate/Resize/Offset worked (selection
    // state already tracks kind==='spline') but nothing ever drew the
    // orange/yellow highlight stroke on it.
    drawSplines.forEach((sp,idx)=>{
      if (sp.points.length<2) return
      const isDelTarget=deletePreview?.kind==='spline'&&deletePreview.idx===idx
      const isOffSel=offsetEntity?.kind==='spline'&&offsetEntity.idx===idx
      const isOffHov=offsetHover?.kind==='spline'&&offsetHover.idx===idx&&!isOffSel
      const isMirSel=mirrorSel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='spline'&&mirrorHover.idx===idx&&!isMirSel
      const isCenSel=centerSel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isCenHov=centerHover?.kind==='spline'&&centerHover.idx===idx&&!isCenSel
      const isMCSel=moveCopySel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='spline'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='spline'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='spline'&&resizeHover.idx===idx&&!isRzSel
      const isSelHov=selectHover?.kind==='spline'&&selectHover.idx===idx&&!selection.some(s=>s.kind==='spline'&&s.idx===idx)
      const isSelected=selection.some(s=>s.kind==='spline'&&s.idx===idx)
      const color=isDelTarget?'#F44336':isOffSel||isMirSel||isCenSel||isMCSel||isRCSel||isRzSel?'#FF9800':isOffHov||isMirHov||isCenHov||isMCHov||isRCHov||isRzHov?'#FFD600':isSelHov||isSelected?'#64B5F6':null
      if (!color) return
      const lw=(isDelTarget||isOffSel||isMirSel||isCenSel||isMCSel||isRCSel||isRzSel?3:2)/sc
      const s2=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16)
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash([])
      ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y);s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()
      ctx.restore()
    })

    // ── In-progress spline ──
    if (tool==='spline'&&splinePoints.length>0&&mousePos){
      const previewPts=[...splinePoints,mousePos]
      const showClosed=splineClosed&&previewPts.length>=3
      const sampled=previewPts.length>=2?sampleSpline(previewPts,showClosed,16):previewPts
      ctx.save();ctx.strokeStyle='#ff9800';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      ctx.beginPath();ctx.moveTo(sampled[0].x,sampled[0].y)
      sampled.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();ctx.setLineDash([])
      splinePoints.forEach((p,i)=>{
        ctx.save();ctx.translate(p.x,p.y);ctx.scale(1/sc,1/sc)
        ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2)
        ctx.fillStyle=i===0?'#f97316':'#ff9800';ctx.fill();ctx.restore()
      })
      const geo=getGeoSnap(mousePos,snapLines,circles,arcs,splinePoints[splinePoints.length-1],false,splines,intersectionPts)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
      ctx.restore()
    }

    // ── Trim highlight ──
    if (tool==='trim'&&trimPreview){
      ctx.save()
      if (trimPreview.deletewhole){
        ctx.strokeStyle='#F44336';ctx.lineWidth=3/sc
        if (trimPreview.kind==='line'){const l=lines[trimPreview.idx];if(l){ctx.beginPath();ctx.moveTo(l.x1,l.y1);ctx.lineTo(l.x2,l.y2);ctx.stroke()}}
        else if (trimPreview.kind==='circle'){const c=circles[trimPreview.idx];if(c){ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke()}}
        else if (trimPreview.kind==='arc'){const a=arcs[trimPreview.idx];if(a){ctx.beginPath();ctx.arc(a.cx,a.cy,a.r,a.startAngle,a.endAngle,false);ctx.stroke()}}
        if (mousePos) drawLabel(ctx,'click to delete',mousePos.x,mousePos.y-20/sc,'#F44336',sc)
      } else {
        ctx.strokeStyle='#FF5722';ctx.lineWidth=5/sc
        if (trimPreview.kind==='line'){ctx.beginPath();ctx.moveTo(trimPreview.hx1,trimPreview.hy1);ctx.lineTo(trimPreview.hx2,trimPreview.hy2);ctx.stroke()}
        else if (trimPreview.kind==='spline'){
          if (trimPreview.highlightPts?.length>=2){ctx.beginPath();ctx.moveTo(trimPreview.highlightPts[0].x,trimPreview.highlightPts[0].y);trimPreview.highlightPts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()}
        } else {ctx.setLineDash([5/sc,3/sc]);ctx.beginPath();ctx.arc(trimPreview.cx,trimPreview.cy,trimPreview.r,trimPreview.arcStart,trimPreview.arcEnd,false);ctx.stroke();ctx.setLineDash([])}
      }
      ctx.restore()
    }

    // ── Extend preview ──
    if (tool==='extend'&&extendPreview){
      ctx.save();ctx.strokeStyle='#00BCD4';ctx.lineWidth=2/sc;ctx.setLineDash([6/sc,3/sc])
      ctx.beginPath();ctx.moveTo(extendPreview.extStart.x,extendPreview.extStart.y);ctx.lineTo(extendPreview.extEnd.x,extendPreview.extEnd.y);ctx.stroke()
      ctx.setLineDash([]);ctx.save();ctx.translate(extendPreview.extEnd.x,extendPreview.extEnd.y);ctx.scale(1/sc,1/sc)
      ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fillStyle='#00BCD4';ctx.fill();ctx.restore();ctx.restore()
    }

    // ── Offset preview ──
    if (tool==='offset'&&offsetPreview&&mousePos){
      ctx.save();ctx.strokeStyle='#4CAF50';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      const p=offsetPreview
      if (p.kind==='line'){ctx.beginPath();ctx.moveTo(p.x1,p.y1);ctx.lineTo(p.x2,p.y2);ctx.stroke()}
      else if (p.kind==='circle'){ctx.beginPath();ctx.arc(p.cx,p.cy,p.r,0,Math.PI*2);ctx.stroke()}
      else if (p.kind==='arc'){ctx.beginPath();ctx.arc(p.cx,p.cy,p.r,p.startAngle,p.endAngle,false);ctx.stroke()}
      else if (p.kind==='spline'&&p.points?.length>=2){const s2=p.polyline?p.points:sampleSpline(p.points,p.closed,16);ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y);s2.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.stroke()}
      ctx.setLineDash([]);ctx.restore()
      const distMm=offsetDistLocked?parseFloat(offsetDistInput)||0:(offsetEntity&&mousePos?pxToMm(distToEntity(mousePos,offsetEntity.kind==='line'?drawLines[offsetEntity.idx]:offsetEntity.kind==='circle'?drawCircles[offsetEntity.idx]:offsetEntity.kind==='arc'?drawArcs[offsetEntity.idx]:drawSplines[offsetEntity.idx],offsetEntity.kind)):0)
      drawLabel(ctx,(offsetDistLocked?'🔒 ':'')+distMm.toFixed(1)+' mm · click to place',mousePos.x,mousePos.y-24/sc,'#4CAF50',sc)
    }

    // ── Mirror axis + preview ──
    if (tool==='mirror'&&mirrorAccepted&&mirrorP1&&mousePos){
      ctx.save()
      const hSnap=getGeoSnap(mousePos,snapLines,circles,arcs,mirrorP1,false,splines,intersectionPts)
      let endPt,snapType=null,angleSnap=null,tracks=[]
      if (hSnap&&hSnap.type!=='tan'&&hSnap.type!=='oncircle'){endPt={x:hSnap.x,y:hSnap.y};snapType=hSnap.type;angleSnap=checkAngle(mirrorP1,hSnap)}
      else{const{snapped,tracks:tr}=applyTracking(mousePos,trackedPts);tracks=tr;const angled=getAngleSnap(mirrorP1,snapped);endPt={x:angled.x,y:angled.y};angleSnap=angled.angleSnap}
      if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)
      ctx.strokeStyle='#9C27B0';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      ctx.beginPath();ctx.moveTo(mirrorP1.x,mirrorP1.y);ctx.lineTo(endPt.x,endPt.y);ctx.stroke();ctx.setLineDash([])
      ctx.save();ctx.translate(mirrorP1.x,mirrorP1.y);ctx.scale(1/sc,1/sc);ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#9C27B0';ctx.fill();ctx.restore()
      if (angleSnap&&!snapType) drawHVIndicator(ctx,endPt.x,endPt.y,angleSnap,false,sc)
      if (angleSnap&&snapType)  drawHVIndicator(ctx,endPt.x,endPt.y,angleSnap,true,sc)
      if (snapType) drawLineIndicator(ctx,endPt.x,endPt.y,snapType,sc)
      ctx.restore()
      if (mirrorPreview){
        ctx.save();ctx.strokeStyle='#CE93D8';ctx.lineWidth=1.5/sc;ctx.setLineDash([4/sc,3/sc])
        mirrorPreview.newLines.forEach(l=>{ctx.beginPath();ctx.moveTo(l.x1,l.y1);ctx.lineTo(l.x2,l.y2);ctx.stroke()})
        mirrorPreview.newCircles.forEach(c=>{ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke()})
        mirrorPreview.newArcs.forEach(a=>{ctx.beginPath();ctx.arc(a.cx,a.cy,a.r,a.startAngle,a.endAngle,false);ctx.stroke()})
        ;(mirrorPreview.newSplines||[]).forEach(sp=>{if(sp.points.length<2)return;const s2=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16);ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y);s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()})
        ctx.setLineDash([]);ctx.restore()
      }
    }
    if (tool==='mirror'&&mirrorAccepted&&!mirrorP1&&mousePos){
      const geo=getGeoSnap(mousePos,snapLines,circles,arcs,null,false,splines,intersectionPts)
      const{tracks}=applyTracking(mousePos,trackedPts)
      if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
    }

    // ── Move/Copy preview ──
    if (tool==='movecopy'&&moveCopyAccepted&&startPoint&&mousePos){
      const end=computeEnd(startPoint,mousePos,trackedPts)
      const dx=end.x-startPoint.x,dy=end.y-startPoint.y
      const count=Math.max(1,parseInt(moveCopyCountInput)||1)
      const previewColor=moveCopyMode==='copy'?'#2196F3':'#4CAF50'
      ctx.save();ctx.strokeStyle='#88888866';ctx.lineWidth=1/sc;ctx.setLineDash([4/sc,4/sc])
      ctx.beginPath();ctx.moveTo(startPoint.x,startPoint.y);ctx.lineTo(end.x,end.y);ctx.stroke();ctx.setLineDash([])
      ctx.strokeStyle=previewColor;ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      for (let i=1;i<=count;i++){
        moveCopySel.forEach(e=>{
          if (e.kind==='line'){const l=lines[e.idx];if(l){ctx.beginPath();ctx.moveTo(l.x1+dx*i,l.y1+dy*i);ctx.lineTo(l.x2+dx*i,l.y2+dy*i);ctx.stroke()}}
          if (e.kind==='circle'){const c=circles[e.idx];if(c){ctx.beginPath();ctx.arc(c.cx+dx*i,c.cy+dy*i,c.r,0,Math.PI*2);ctx.stroke()}}
          if (e.kind==='arc'){const a=arcs[e.idx];if(a){ctx.beginPath();ctx.arc(a.cx+dx*i,a.cy+dy*i,a.r,a.startAngle,a.endAngle,false);ctx.stroke()}}
        })
      }
      ctx.setLineDash([]);ctx.restore()
      const distMm=pxToMm(Math.hypot(dx,dy))
      drawLabel(ctx,distMm.toFixed(1)+' mm',end.x,end.y-20/sc,previewColor,sc)
    }

    // ── Fillet preview ──
    if (tool==='fillet'&&filletAccepted&&filletPreview){
      if (filletPreview.tooLarge){
        if (mousePos) drawLabel(ctx,'Radius too large',mousePos.x,mousePos.y-20/sc,'#F44336',sc)
      } else {
        ctx.save();ctx.setLineDash([6/sc,3/sc])
        ctx.strokeStyle='#4CAF50';ctx.lineWidth=2/sc
        const{newL1,newL2,arc,T1,T2}=filletPreview
        ctx.beginPath();ctx.moveTo(newL1.x1,newL1.y1);ctx.lineTo(newL1.x2,newL1.y2);ctx.stroke()
        ctx.beginPath();ctx.moveTo(newL2.x1,newL2.y1);ctx.lineTo(newL2.x2,newL2.y2);ctx.stroke()
        ctx.beginPath();ctx.arc(arc.cx,arc.cy,arc.r,arc.startAngle,arc.endAngle,false);ctx.stroke()
        ctx.setLineDash([]);[T1,T2].forEach(t=>{ctx.save();ctx.translate(t.x,t.y);ctx.scale(1/sc,1/sc);ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#4CAF50';ctx.fill();ctx.restore()})
        const r=mmToPx(parseFloat(filletRadiusInput)||0)
        drawLabel(ctx,'R '+pxToMm(r).toFixed(1)+' mm · Enter to apply',arc.cx,arc.cy-arc.r/sc-18/sc,'#4CAF50',sc)
        ctx.restore()
      }
    }

    // ── Join tool ──
    if (tool==='join'&&mousePos){
      ctx.save()
      const hov=joinFirstPt||joinHover
      if (hov){
        const isFirst=!!joinFirstPt
        ctx.beginPath();ctx.arc(hov.x,hov.y,8/sc,0,Math.PI*2)
        ctx.strokeStyle=isFirst?'#FF9800':'#26C6DA';ctx.lineWidth=2/sc;ctx.stroke()
        ctx.beginPath();ctx.arc(hov.x,hov.y,3/sc,0,Math.PI*2)
        ctx.fillStyle=isFirst?'#FF9800':'#26C6DA';ctx.fill()
      }
      if (joinFirstPt){
        const snap=getGeoSnap(mousePos,snapLines,circles,arcs,{x:joinFirstPt.x,y:joinFirstPt.y},false,splines,intersectionPts)
        const snapPt=snap||mousePos
        ctx.beginPath();ctx.moveTo(joinFirstPt.x,joinFirstPt.y);ctx.lineTo(snapPt.x,snapPt.y)
        ctx.strokeStyle='#FF980066';ctx.lineWidth=1/sc;ctx.setLineDash([6/sc,3/sc]);ctx.stroke();ctx.setLineDash([])
        if (snap) drawLineIndicator(ctx,snap.x,snap.y,snap.type,sc)
      }
      ctx.restore()
    }

    // ── Select tool: bbox, handles, dimension labels ──
    if (tool==='select'&&selection.length>0){
      const curLines=selectLiveGeom?.lines||lines,curCircles=selectLiveGeom?.circles||circles
      const curArcs=selectLiveGeom?.arcs||arcs,curSplines=selectLiveGeom?.splines||splines
      const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)
      if (bbox){
        ctx.save()
        ctx.strokeStyle='#2196F3';ctx.lineWidth=1/sc;ctx.setLineDash([6/sc,3/sc])
        ctx.strokeRect(bbox.x1,bbox.y1,bbox.w,bbox.h);ctx.setLineDash([])
        const handles=getBBoxHandles(bbox)
        const hovHandle=mousePos?hitTestHandles(mousePos,handles,12/sc):null
        Object.values(handles).forEach(h=>{
          ctx.save();ctx.translate(h.x,h.y);ctx.scale(1/sc,1/sc)
          const isHov=hovHandle===h.id
          if (h.id==='mc'){ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fillStyle=isHov?'#2196F3':'#fff';ctx.fill();ctx.strokeStyle='#2196F3';ctx.lineWidth=2;ctx.stroke()}
          else{ctx.fillStyle=isHov?'#2196F3':'#fff';ctx.fillRect(-5,-5,10,10);ctx.strokeStyle='#2196F3';ctx.lineWidth=1.5;ctx.strokeRect(-5,-5,10,10)}
          ctx.restore()
        })
        // Dimension info labels
        const activeColor='#FF9800', inactiveColor='#2196F3'
        const bx=(bbox.x1+bbox.x2)/2
        if (selection.length===1){
          const e0=selection[0]
          if (e0.kind==='line'){
            const l=curLines[e0.idx];if(l){
              const len=pxToMm(Math.hypot(l.x2-l.x1,l.y2-l.y1))
              let ang=Math.atan2(-(l.y2-l.y1),l.x2-l.x1)*180/Math.PI;if(ang<0)ang+=360
              const lenActive=selectDimField==='length', angActive=selectDimField==='angle'
              drawLabel(ctx,(lenActive?'✏ ':'')+((lenActive&&selectDimPending.length?selectDimPending.length:len.toFixed(2))+' mm'),bx,bbox.y1-36/sc,lenActive?activeColor:inactiveColor,sc)
              drawLabel(ctx,(angActive?'✏ ':'')+((angActive&&selectDimPending.angle?selectDimPending.angle:ang.toFixed(1))+'°'),bx,bbox.y1-18/sc,angActive?activeColor:inactiveColor,sc)
              if (!selectDimField) drawLabel(ctx,'Tab to edit',bx,bbox.y1-54/sc,'#444',sc)
              // Anchor grid
              const gx=bx,gy=bbox.y1-80/sc,cell=14/sc
              ctx.save();ctx.fillStyle='rgba(0,0,0,0.55)';ctx.beginPath();ctx.roundRect(gx-cell*2.4-2/sc,gy-cell*2.4-2/sc,cell*4.8+4/sc,cell*4.8+4/sc,4/sc);ctx.fill()
              ;[['tl','tc','tr'],['ml','mc','mr'],['bl','bc','br']].forEach((row,ri)=>row.forEach((id,ci)=>{
                const px=gx+(ci-1)*cell*1.6,py=gy+(ri-1)*cell*1.6,isAnc=id===selectDimAnchor
                ctx.beginPath();ctx.arc(px,py,isAnc?6/sc:3.5/sc,0,Math.PI*2);ctx.fillStyle=isAnc?'#FFD600':'#90CAF9';ctx.fill()
                if(isAnc){ctx.strokeStyle='#fff';ctx.lineWidth=1.5/sc;ctx.stroke()}
              }))
              ctx.restore()
            }
          } else if (e0.kind==='circle'){
            const c=curCircles[e0.idx];if(c){
              const radActive=selectDimField==='radius'
              drawLabel(ctx,(radActive?'✏ R ':'R ')+((radActive&&selectDimInput?selectDimInput:pxToMm(c.r).toFixed(2))+' mm'),bx,bbox.y1-18/sc,radActive?activeColor:inactiveColor,sc)
              if (!selectDimField) drawLabel(ctx,'Tab to edit',bx,bbox.y1-36/sc,'#444',sc)
            }
          } else if (e0.kind==='arc'){
            const a=curArcs[e0.idx];if(a){
              const span=norm2pi(a.endAngle-a.startAngle)*180/Math.PI
              const radActive=selectDimField==='radius',angActive=selectDimField==='angle'
              drawLabel(ctx,(radActive?'✏ R ':'R ')+((radActive&&selectDimPending.radius?selectDimPending.radius:pxToMm(a.r).toFixed(2))+' mm'),bx,bbox.y1-36/sc,radActive?activeColor:inactiveColor,sc)
              drawLabel(ctx,(angActive?'✏ ':'')+((angActive&&selectDimPending.angle?selectDimPending.angle:span.toFixed(1))+'°'),bx,bbox.y1-18/sc,angActive?activeColor:inactiveColor,sc)
              if (!selectDimField) drawLabel(ctx,'Tab to edit',bx,bbox.y1-54/sc,'#444',sc)
            }
          }
        } else {
          const wActive=selectDimField==='width',hActive=selectDimField==='height'
          drawLabel(ctx,(wActive?'✏ ':'')+('W '+(wActive&&selectDimPending.width?selectDimPending.width:pxToMm(bbox.w).toFixed(2))+' mm'),bx,bbox.y1-36/sc,wActive?activeColor:'#64B5F6',sc)
          drawLabel(ctx,(hActive?'✏ ':'')+('H '+(hActive&&selectDimPending.height?selectDimPending.height:pxToMm(bbox.h).toFixed(2))+' mm'),bx,bbox.y1-18/sc,hActive?activeColor:'#64B5F6',sc)
          if (!selectDimField) drawLabel(ctx,`${selection.length} entities · Tab to edit`,bx,bbox.y1-54/sc,'#444',sc)
        }
        ctx.restore()
      }
    }

    // ── Drag select rectangle ──
    if (dragSelectRect){
      const {x1,y1,x2,y2}=dragSelectRect
      const rx=Math.min(x1,x2),ry=Math.min(y1,y2),rw=Math.abs(x2-x1),rh=Math.abs(y2-y1)
      ctx.save();ctx.fillStyle='rgba(33,150,243,0.06)';ctx.fillRect(rx,ry,rw,rh)
      ctx.strokeStyle='#2196F3';ctx.lineWidth=1/sc;ctx.setLineDash([4/sc,4/sc])
      ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);ctx.restore()
    }

    // ── Committed dimension annotations ──
    dims.forEach((dim)=>{
      ctx.save();ctx.strokeStyle='#ccc';ctx.fillStyle='#ccc'
      const LW=0.8/sc,ARR=6/sc,FS=11/sc;ctx.lineWidth=LW
      if (dim.kind==='linear'){
        const dx=dim.x2-dim.x1,dy=dim.y2-dim.y1,len=Math.hypot(dx,dy);if(len<1){ctx.restore();return}
        const ux=dx/len,uy=dy/len,nx=-uy,ny=ux,off=dim.offset
        ctx.beginPath();ctx.moveTo(dim.x1,dim.y1);ctx.lineTo(dim.x1+nx*(off+Math.sign(off)*ARR*1.5),dim.y1+ny*(off+Math.sign(off)*ARR*1.5));ctx.moveTo(dim.x2,dim.y2);ctx.lineTo(dim.x2+nx*(off+Math.sign(off)*ARR*1.5),dim.y2+ny*(off+Math.sign(off)*ARR*1.5));ctx.stroke()
        const d1x=dim.x1+nx*off,d1y=dim.y1+ny*off,d2x=dim.x2+nx*off,d2y=dim.y2+ny*off
        ctx.beginPath();ctx.moveTo(d1x,d1y);ctx.lineTo(d2x,d2y);ctx.stroke()
        ;[[d1x,d1y,ux,uy],[d2x,d2y,-ux,-uy]].forEach(([ax,ay,ax2,ay2])=>{ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax+ax2*ARR-ay2*ARR*0.35,ay+ay2*ARR+ax2*ARR*0.35);ctx.lineTo(ax+ax2*ARR+ay2*ARR*0.35,ay+ay2*ARR-ax2*ARR*0.35);ctx.closePath();ctx.fill()})
        const txt=dim.text||pxToMm(len).toFixed(2)+' mm'
        const mx=(d1x+d2x)/2,my=(d1y+d2y)/2
        ctx.save();ctx.translate(mx,my);ctx.scale(1/sc,1/sc);let ang=Math.atan2(uy,ux);if(ang>Math.PI/2||ang<-Math.PI/2)ang+=Math.PI;ctx.rotate(ang);ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle='#ccc';ctx.fillText(txt,0,-3);ctx.restore()
      } else if (dim.kind==='diameter'){
        const {cx,cy,r,angle}=dim,cos=Math.cos(angle),sin=Math.sin(angle)
        ctx.beginPath();ctx.moveTo(cx-r*cos,cy-r*sin);ctx.lineTo(cx+r*cos,cy+r*sin);ctx.stroke()
        const txt=dim.text||'⌀'+pxToMm(r*2).toFixed(2)+' mm'
        ctx.save();ctx.translate(cx,cy);ctx.scale(1/sc,1/sc);let a=angle;if(a>Math.PI/2||a<-Math.PI/2)a+=Math.PI;ctx.rotate(a);ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,0,-3);ctx.restore()
      } else if (dim.kind==='radius'){
        const {cx,cy,r,angle}=dim,ex=cx+r*Math.cos(angle),ey=cy+r*Math.sin(angle)
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ex,ey);ctx.stroke()
        const txt=dim.text||'R'+pxToMm(r).toFixed(2)+' mm'
        ctx.save();ctx.translate(cx,cy);ctx.scale(1/sc,1/sc);let a=angle;if(a>Math.PI/2||a<-Math.PI/2)a+=Math.PI;ctx.rotate(a);ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,(r/2*sc/sc)*(a===angle?1:-1),-3);ctx.restore()
      }
      ctx.restore()
    })

    if (!mousePos) return

    // ── Line tool rubber-band ──
    if (tool==='line'&&startPoint){
      const hSnap=getGeoSnap(mousePos,snapLines,circles,arcs,startPoint,tKeyDown,splines,intersectionPts)
      let endPt,isTanEnd=false
      if (hSnap?.type==='tan'){
        const c=hSnap.circleIdx!==undefined?circles[hSnap.circleIdx]:{cx:hSnap.cx,cy:hSnap.cy,r:hSnap.r}
        const tanPts=getTanPtsOnCircle(startPoint.x,startPoint.y,c.cx,c.cy,c.r)
        tanPts.forEach(tp=>drawPreviewLine(ctx,startPoint.x,startPoint.y,tp.x,tp.y,sketchLineColor,0.25,sc))
        endPt=nearestPt(tanPts,mousePos)||hSnap;isTanEnd=true
      } else {
        const comp=computeEnd(startPoint,mousePos,trackedPts);endPt=comp
        if (comp.tracks?.length) drawTracks(ctx,comp.tracks,trackedPts,sc)
        if (comp.angleSnap&&!comp.snapType) drawHVIndicator(ctx,endPt.x,endPt.y,comp.angleSnap,false,sc)
        if (comp.angleSnap&&comp.snapType)  drawHVIndicator(ctx,endPt.x,endPt.y,comp.angleSnap,true,sc)
        if (comp.snapType) drawLineIndicator(ctx,endPt.x,endPt.y,comp.snapType,sc)
      }
      const lenMm=pxToMm(Math.hypot(endPt.x-startPoint.x,endPt.y-startPoint.y))
      const midX=(startPoint.x+endPt.x)/2,midY=(startPoint.y+endPt.y)/2
      drawPreviewLine(ctx,startPoint.x,startPoint.y,endPt.x,endPt.y,sketchLineColor,1,sc)
      ctx.save();ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc);ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2)
      ctx.fillStyle=sketchLineColor;ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='#ffffff';ctx.stroke();ctx.restore()
      drawLabel(ctx,(dimLocked?'🔒 ':'')+(dimInput||lenMm.toFixed(1))+' mm',midX,midY-2/sc,dimLocked?'#FF9800':focusField==='dim'?'#1565C0':'#2196F3',sc)
      if (!isTanEnd) drawLabel(ctx,(angleLocked?'🔒 ':'')+(angleInput||computeLiveAngle(startPoint,endPt).toFixed(1))+'°',midX,midY+22/sc,angleLocked?'#FF9800':focusField==='angle'?'#6A1B9A':'#9C27B0',sc)
      if (isTanEnd) drawLineIndicator(ctx,endPt.x,endPt.y,'tan',sc)

    // ── Axis tool rubber-band (revolve axis — simple 2-point line, dash-dot) ──
    // Reuses computeEnd (same as the Line tool) for H/V angle snap + alignment
    // tracking against other sketch geometry — an axis is still just a line,
    // it should snap and align the same way.
    } else if (tool==='axis'&&startPoint){
      const comp=computeEnd(startPoint,mousePos,trackedPts)
      const endPt=comp
      if (comp.tracks?.length) drawTracks(ctx,comp.tracks,trackedPts,sc)
      if (comp.angleSnap&&!comp.snapType) drawHVIndicator(ctx,endPt.x,endPt.y,comp.angleSnap,false,sc)
      if (comp.angleSnap&&comp.snapType)  drawHVIndicator(ctx,endPt.x,endPt.y,comp.angleSnap,true,sc)
      if (comp.snapType) drawLineIndicator(ctx,endPt.x,endPt.y,comp.snapType,sc)
      const lenMm=pxToMm(Math.hypot(endPt.x-startPoint.x,endPt.y-startPoint.y))
      const midX=(startPoint.x+endPt.x)/2,midY=(startPoint.y+endPt.y)/2
      ctx.save()
      ctx.strokeStyle='#ffffff';ctx.lineWidth=4/sc;ctx.setLineDash([10/sc,3/sc,2/sc,3/sc])
      ctx.beginPath();ctx.moveTo(startPoint.x,startPoint.y);ctx.lineTo(endPt.x,endPt.y);ctx.stroke()
      ctx.strokeStyle='#222222';ctx.lineWidth=1.5/sc
      ctx.beginPath();ctx.moveTo(startPoint.x,startPoint.y);ctx.lineTo(endPt.x,endPt.y);ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
      drawLabel(ctx,lenMm.toFixed(1)+' mm',midX,midY-2/sc,'#222222',sc)

    // ── Circle tool rubber-band ──
    } else if (tool==='circle'&&circleCenter){
      const geo=!dimLocked?getGeoSnap(mousePos,snapLines,circles,arcs,circleCenter,tKeyDown,splines,intersectionPts):null
      const {tracks}=applyTracking(mousePos,trackedPts)
      if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)
      let r=1
      if (dimLocked) r=mmToPx(parseFloat(dimInput)||1)
      else if (tKeyDown&&geo?.type==='tan'){const tc=geo.circleIdx!==undefined?circles[geo.circleIdx]:{cx:geo.cx,cy:geo.cy,r:geo.r};r=Math.max(1,Math.abs(Math.hypot(circleCenter.x-tc.cx,circleCenter.y-tc.cy)-tc.r))}
      else {const edgePt=geo&&geo.type!=='tan'?{x:geo.x,y:geo.y}:mousePos;r=Math.max(1,Math.hypot(edgePt.x-circleCenter.x,edgePt.y-circleCenter.y))}
      ctx.beginPath();ctx.arc(circleCenter.x,circleCenter.y,r,0,Math.PI*2)
      ctx.strokeStyle='#ffffff';ctx.lineWidth=4/sc;ctx.setLineDash([6/sc,3/sc]);ctx.stroke()
      ctx.strokeStyle=sketchLineColor;ctx.lineWidth=1.5/sc;ctx.stroke();ctx.setLineDash([])
      drawLineIndicator(ctx,circleCenter.x,circleCenter.y,'center',sc)
      drawLabel(ctx,(dimLocked?'🔒 R ':'R ')+(dimInput||pxToMm(r).toFixed(1))+' mm',circleCenter.x+r/2,circleCenter.y-14/sc,dimLocked?'#FF9800':'#2196F3',sc)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)

    // ── Idle snap indicator ──
    } else if (tool!=='trim'&&tool!=='delete'&&tool!=='offset'&&tool!=='mirror'&&tool!=='movecopy'&&tool!=='rotatecopy'&&tool!=='resize'&&tool!=='trace'){
      const{tracks}=applyTracking(mousePos,trackedPts)
      if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)
      const geo=getGeoSnap(mousePos,snapLines,circles,arcs,null,tKeyDown,splines,intersectionPts)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
    }

    // Snap indicator for movecopy/rotatecopy base point
    if ((tool==='movecopy'&&moveCopyAccepted||tool==='rotatecopy'&&rotateCopyAccepted)&&!startPoint){
      const geo=getGeoSnap(mousePos,snapLines,circles,arcs,null,false,splines,intersectionPts)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
    }

  },[lines,circles,arcs,splines,selection,selectHover,selectLiveGeom,selectDimField,selectDimPending,selectDimAnchor,splinePoints,splineClosed,startPoint,circleCenter,mousePos,dimInput,dimLocked,angleInput,angleLocked,focusField,trackedPts,tool,trimPreview,deletePreview,extendPreview,offsetEntity,offsetPreview,offsetDistInput,offsetDistLocked,offsetHover,mirrorSel,mirrorAccepted,mirrorPreview,mirrorP1,mirrorHover,centerSel,centerHover,moveCopySel,moveCopyAccepted,moveCopyMode,moveCopyCountInput,moveCopyHover,rotateCopySel,rotateCopyAccepted,rotateCopyMode,rotateCopyCountInput,rotateCopyHover,resizeSel,resizeAccepted,resizeScaleInput,resizeHover,filletSel,filletAccepted,filletRadiusInput,filletHover,filletPreview,dragSelectRect,viewTransform,tKeyDown,intersectionPts,joinHover,joinFirstPt,dims,selectDimInput,activePlane,sketchMode,extrudeTool,cachedProfiles,extrudeState])


  // ── Phase 2 Step 3: plane tagging ────────────────────────────────────────
  // Every entity drawn in sketch mode gets tagged with {plane:'XY'|'XZ'|'YZ'}
  // so the 3D renderer knows which plane to render it on.
  function planeTag() {
    const ap = activePlaneRef.current
    if (!ap) return {}
    if (typeof ap === 'string') return { plane: ap }
    // FacePlane — store the full object so geometry knows its orientation
    return { plane: 'face', facePlane: ap }
  }

  // ── Include From Face ────────────────────────────────────────────────────
  // General sketch tool (works while sketching on any solid face — extrude,
  // cutout, or a loft profile): copies the CURRENT face's own boundary into
  // this sketch as real, editable line geometry, so it can be traced/reused
  // as a profile instead of redrawn by hand. Sources from
  // activePlane.refSegments — already computed in sketch-space by
  // FacePlane.js's faceHitToPlane() when the face was picked (the same data
  // that already powers edge-snapping while sketching on a face), so this
  // needs no new geometry extraction. It's a mesh-derived polygon
  // approximation of the face boundary, not exact OCC curves (fine per the
  // user's explicit "don't care if it's a circle/polyline/spline/arc" — they
  // just want the shape available to work with, not a bit-exact curve).
  function includeFaceGeometry() {
    const ap = activePlaneRef.current
    if (!ap || typeof ap !== 'object' || !ap.refSegments || !ap.refSegments.length) return
    const tag = planeTag()
    const newLines = ap.refSegments.map(seg => ({
      x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, ...tag,
    }))
    commit(snapshot())
    setLines(prev => [...prev, ...newLines])
  }

  // ── Feature tree helpers ─────────────────────────────────────────────────

  function nextSketchName() {
    featureCountRef.current.sketch += 1
    return `Sketch ${featureCountRef.current.sketch}`
  }
  function nextExtrudeName() {
    featureCountRef.current.extrude += 1
    return `Extrude ${featureCountRef.current.extrude}`
  }
  function nextFilletName() {
    featureCountRef.current.fillet += 1
    return `Fillet ${featureCountRef.current.fillet}`
  }
  function nextMirrorName() {
    featureCountRef.current.mirror += 1
    return `Mirror ${featureCountRef.current.mirror}`
  }
  function nextJoinName() {
    featureCountRef.current.join += 1
    return `Join ${featureCountRef.current.join}`
  }
  function nextLoftName() {
    featureCountRef.current.loft += 1
    return `Loft ${featureCountRef.current.loft}`
  }

  // Enter sketch mode for a new or existing sketch
  function enterSketch(plane, existingId=null, initialGeometry=null) {
    activePlaneRef.current = plane  // set synchronously
    setActivePlane(plane)
    setSketchMode(true)
    setActiveSketchId(existingId)
    setTool('line')
    resetDrawState();resetOffset();resetMirror();resetCenter();resetMoveCopy()
    resetRotateCopy();resetResize();resetFillet();resetSpline()
    resetText();resetSelection();resetJoin();resetDim()

    if (existingId) {
      // Re-editing standalone sketch — populate working arrays from feature
      const feat = features.find(f=>f.id===existingId)
      if (feat) {
        setLines(feat.lines||[])
        setCircles(feat.circles||[])
        setArcs(feat.arcs||[])
        setSplines(feat.splines||[])
      }
    } else if (initialGeometry) {
      // Editing extrude/cutout's saved sketch — restore geometry
      setLines(initialGeometry.lines || [])
      setCircles(initialGeometry.circles || [])
      setArcs(initialGeometry.arcs || [])
      setSplines(initialGeometry.splines || [])
    } else {
      // New sketch — clear working arrays
      setLines([]); setCircles([]); setArcs([]); setSplines([])
    }
  }

  // ── Phase 2 Step 3b: Sketch on face ──────────────────────────────────────
  function handleFaceClick(facePlane) {
    if (tool==='mirror3d' && mirror3dSourceFeatureId) { commitMirror3D({ kind:'face', facePlane }); return }
    if (tool==='loft3d' && !loftState) { startLoftProfile1({ kind:'face', facePlane }); return }
    if (extrudeState) return  // step 3 (depth): ignore stray face clicks
    enterSketch(facePlane)
    viewport3dRef.current?.snapToFace(facePlane)
  }

  function handlePlaneClick({ id }) {
    if (tool==='mirror3d' && mirror3dSourceFeatureId) { commitMirror3D({ kind:'workplane', planeId:id }); return }
    if (tool==='loft3d' && !loftState) { startLoftProfile1({ kind:'workplane', planeId:id }); return }
    if (extrudeState) return  // step 3 (depth): ignore stray plane clicks
    // Work planes pass through/near the model with no occlusion check against
    // solids in front of them (see WorkPlanes.js's hitTestPlanes) — clicking an
    // edge near a plane could otherwise register as a plane click too and drop
    // into sketch mode. showWorkPlanes already excludes fillet3d mode; this is
    // a second guard in case a stray click still gets through.
    if (tool==='fillet3d') return
    enterSketch(id)
    viewport3dRef.current?.snapToPlane(id)
  }

  function handleFinishSketch() {
    const plane = activePlaneRef.current
    const editingId = activeSketchId
    setSketchMode(false)
    setActivePlane(null)
    setActiveSketchId(null)

    const isFace = plane && typeof plane === 'object' && plane.worldToSketch
    const planeId = isFace ? 'face' : (typeof plane === 'string' ? plane : 'XY')

    // Ghost reference geometry (the previous loft profile, injected by
    // injectLoftGhost so it renders dimmed and stays snap-able) must never
    // count as part of THIS sketch's own profile — strip it before detection.
    const ownLines = lines.filter(l => !l.ghostRef)
    const ownCircles = circles.filter(c => !c.ghostRef)
    const ownArcs = arcs.filter(a => !a.ghostRef)
    const ownSplines = splines.filter(s => !s.ghostRef)

    // Detect closed profiles (needed for both standalone sketches and extrude flow)
    const allProfiles = []
    const profiles = detectProfiles(ownLines, ownArcs, planeId, ownCircles, ownSplines)
    profiles.forEach(pts => {
      const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length
      const cy = pts.reduce((s,p)=>s+p.y,0)/pts.length
      allProfiles.push({ planeId, facePlane: isFace ? plane : null, pts, centroid:{x:cx,y:cy} })
    })
    setCachedProfiles(allProfiles)

    if (loftState) {
      // ── Loft flow: store this profile, show the step popup (never
      //    auto-commits — Next/Previous/Finish Loft all come from the popup) ──
      // Note: NOT gated on tool==='loft3d' — enterSketch() always resets
      // `tool` to 'line' once a profile sketch starts (it doubles as the
      // active 2D drawing tool), so by the time Finish Sketch is clicked
      // here, tool is whatever draw tool was last selected, not 'loft3d'.
      // loftState alone is the reliable "are we in a loft session" signal.
      if (allProfiles.length === 0) {
        setSketchMode(true)
        setActivePlane(plane)
        setCadError('No closed profile found — make sure your sketch forms a closed loop.')
        setTimeout(() => setCadError(null), 5000)
        return
      }
      const best = allProfiles[0]
      const profileEntry = {
        sketchLines: ownLines, sketchCircles: ownCircles, sketchArcs: ownArcs, sketchSplines: ownSplines,
        pts: best.pts, circle: best.pts.circleMeta || null,
        offsetMm: loftState.currentOffsetMm,
      }
      setLoftState(prev => {
        const nextProfiles = [...prev.profiles]
        nextProfiles[prev.currentIdx] = profileEntry
        return { ...prev, profiles: nextProfiles }
      })
      return
    }

    if (extrudeTool) {
      // ── Extrude/Cutout flow: step 2 ──────────────────────────────────────
      if (allProfiles.length === 0) {
        // No closed profile — warn and stay in sketch mode so the user can fix it
        setSketchMode(true)
        setActivePlane(plane)
        setCadError('No closed profile found — make sure your sketch forms a closed loop.')
        setTimeout(() => setCadError(null), 5000)
        return
      }

      const best = allProfiles[0]
      const editingFeat = editingFeatureId ? features.find(f => f.id === editingFeatureId) : null
      const isCutoutEdit = editingFeat && extrudeTool === 'cutout'

      // Whole-word text extrude: if the sketch contains text-imported letters
      // (see TextPanel.jsx's textId tagging), treat every letter sharing the
      // SAME textId as one group — one click extrudes the whole word, each
      // letter gets its own solid, and holes (the counter in O/A/8/etc.) are
      // already attached per-letter via detectProfiles/resolveTextHoles.
      // Scoped to extrude only (not cutout), and to the FIRST detected
      // profile's textId — a sketch mixing text with other shapes still only
      // extrudes one selection at a time, same as any other mixed sketch.
      const textGroup = (extrudeTool !== 'cutout' && best.pts.textId)
        ? allProfiles.filter(p => p.pts.textId === best.pts.textId).map(p => p.pts)
        : null

      // Revolve: if the sketch has an axis line (drawn with the Axis tool —
      // see App3D.jsx's tool==='axis' handling), extrude/cutout auto-detects
      // it and builds a solid (or cut volume) of revolution instead of a
      // linear one. The profile must stay entirely on one side of the axis;
      // a crossing produces self-intersecting geometry in the CAD kernel, so
      // it's blocked here with a clear message rather than left to fail
      // opaquely later.
      const axisLine = lines.find(l => l.style === 'axis' && (l.plane||'XY') === planeId)
      if (axisLine && profileCrossesAxis(best.pts, axisLine)) {
        setSketchMode(true)
        setActivePlane(plane)
        setCadError('Profile crosses the axis — a revolve needs the whole profile on one side of the axis line.')
        setTimeout(() => setCadError(null), 6000)
        return
      }
      const revolveAxis = axisLine ? { x1:axisLine.x1, y1:axisLine.y1, x2:axisLine.x2, y2:axisLine.y2 } : null

      // Use original depth/direction/extent when editing; defaults for new.
      // Cutouts store their extent under cutDirection/cutDepthMm, not direction/depthMm,
      // and extentMode may be missing on cutouts saved before it was persisted.
      let editDirection, editExtentMode
      if (isCutoutEdit) {
        editDirection  = editingFeat.cutDirection || editingFeat.direction || 'front'
        editExtentMode = editingFeat.extentMode || (editingFeat.cutDepthMm >= 10000 ? 'through' : 'value')
      } else if (editingFeat) {
        editDirection  = editingFeat.direction || 'both'
        editExtentMode = editingFeat.extentMode || 'value'
      }

      const stateObj = {
        profiles:      allProfiles.map(p => p.pts),
        planeId:       best.planeId,
        facePlane:     best.facePlane || null,
        pickedIdx:     0,
        textGroup,
        revolveAxis,
        revolveReverse: revolveAxis ? (editingFeat?.revolveReverse || false) : false,
        // depthInput doubles as the angle input (in degrees) when revolveAxis is
        // set — reuses the same field/commit path rather than a parallel one.
        depthInput:    revolveAxis
          ? String(editingFeat?.angleDeg ?? 360)
          : editingFeat ? String(editingFeat.depthMm || 20) : '20',
        direction:     editDirection || (extrudeTool === 'cutout' ? 'front' : 'both'),
        extentMode:    editExtentMode || 'through',
        armed:         true,
        centroid:      best.centroid,
        sketchPlane:   plane,
        sketchLines:   [...lines],
        sketchCircles: [...circles],
        sketchArcs:    [...arcs],
        sketchSplines: [...splines],
      }

      viewport3dRef.current?.restoreSavedView()

      if (editingFeat) {
        // Editing existing feature: skip step 3, commit directly with original params
        commitExtrude(stateObj)
      } else {
        // New extrude/cutout: show step 3 depth UI
        setExtrudeState(stateObj)
      }
      return
    }

    // ── Standalone sketch flow ─────────────────────────────────────────────
    const sketchGeom = {
      lines:   [...lines],
      circles: [...circles],
      arcs:    [...arcs],
      splines: [...splines],
    }

    if (editingId) {
      setFeatures(prev => prev.map(f =>
        f.id === editingId ? { ...f, ...sketchGeom, planeId } : f
      ))
    } else {
      const id = `sketch-${Date.now()}`
      setFeatures(prev => [...prev, {
        id, type: 'sketch', name: nextSketchName(),
        planeId, facePlane: isFace ? plane : null,
        visible: true, ...sketchGeom,
      }])
    }

    // Clear working arrays — committed geometry lives in features now
    setLines([]); setCircles([]); setArcs([]); setSplines([])
    setExtrudeHandlePos(null)
    viewport3dRef.current?.restoreSavedView()
  }

  // Cancel button next to Finish Sketch — abandons the whole in-progress
  // Cut/Extrude/Loft feature (not just the current 2D tool, which is what
  // Escape does now — see the sketchMode Escape handler). Only meaningful
  // while extrudeTool or loftState is set; a plain standalone sketch has no
  // "feature" to cancel, so this button isn't shown for that case.
  function cancelFeature() {
    resetDrawState();resetSpline();resetOffset();resetMirror();resetCenter();resetMoveCopy()
    resetRotateCopy();resetResize();resetFillet();resetText();resetSelection()
    resetJoin();resetDim()
    if (hiddenEditSolidRef.current) {
      setSolids(prev => [...prev, ...hiddenEditSolidRef.current])
      hiddenEditSolidRef.current = null
    }
    setSketchMode(false); setActivePlane(null); setActiveSketchId(null)
    activePlaneRef.current = null
    setLines([]); setCircles([]); setArcs([]); setSplines([])
    if (extrudeTool) {
      setExtrudeTool(null); setExtrudeState(null); setEditingFeatureId(null)
    }
    if (loftState) {
      resetLoft3D()
      setTool('select')
    }
    viewport3dRef.current?.restoreSavedView()
  }

  // Called when EXTRUDE or CUTOUT tool is activated from sidebar
  function activateExtrudeTool(op) {
    resetSelection()
    resetDrawState()
    // Exit sketch mode if currently in it — step 1 needs the 3D view for plane picking
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
    }
    setTool(op)
    setExtrudeTool(op)
    setExtrudeState(null)
    setExtrudeHandlePos(null)
    setEditingFeatureId(null)
    hiddenEditSolidRef.current = null
    // Fresh canvas for the integrated sketch (step 2)
    setLines([]); setCircles([]); setArcs([]); setSplines([])
    setCachedProfiles([])
  }

  // ── Fillet (3D edge) state machine ────────────────────────────────────────
  // Phase 1 (selecting): tool==='fillet3d', !fillet3dAccepted — click toggles
  //   edges in/out of fillet3dSel (same accumulate-then-act pattern as
  //   Mirror/Move-Copy/Rotate-Copy/Resize/2D-Fillet's own sel+accepted state).
  // Phase 2 (accepted): Enter/Tab promotes once fillet3dSel.length>0 — radius
  //   popup shown, no more edge picking.
  // Phase 3 (commit): popup's ↵ → cadEngine.fillet3d() rebuilds that one solid,
  //   ALL selected edges rounded together in one operation (replicad's
  //   EdgeFinder.either() combinator — see cadWorker.js).
  // Scoped to one solid per selection session (see project_fillet3d_status.md) —
  // fillet3dSel entries always share the same solidId in practice.
  const [fillet3dHover, setFillet3dHover] = useState(null)     // {solidId, edgeId, point} while hovering, unpicked
  const [fillet3dSel, setFillet3dSel] = useState([])           // [{solidId, edgeId, point}] accumulated picks
  const [fillet3dAccepted, setFillet3dAccepted] = useState(false)
  const [fillet3dRadiusInput, setFillet3dRadiusInput] = useState('2')
  const [fillet3dHandlePos, setFillet3dHandlePos] = useState(null)

  function activateFillet3DTool() {
    resetSelection()
    resetDrawState()
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
    }
    setTool('fillet3d')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setFillet3dSel([])
    setFillet3dAccepted(false)
    setFillet3dHover(null)
    setFillet3dRadiusInput('2')
    setFillet3dHandlePos(null)
    viewport3dRef.current?.restoreSavedView()
  }

  // ── Measure (3D) state machine ────────────────────────────────────────────
  // Single-click on an edge → immediate result (length for a straight edge,
  // diameter for a circular one, or a labeled curve length as a fallback —
  // see classifyEdgeGeometry, since neither the mesh data nor OCC expose a
  // curve-type tag we could read directly, only point samples). Two clicks on
  // faces/points (anywhere raycastSolidFace lands, not just vertices) →
  // distance between them. Esc clears the current result/pending point first,
  // a second Esc (nothing pending) leaves the tool — same two-stage pattern
  // as fillet3d/mirror3d/join3d.
  const [measureHover, setMeasureHover] = useState(null)       // {kind:'edge',solidId,edgeId,point} | {kind:'point',solidId,point} | null
  const [measureP1, setMeasureP1] = useState(null)             // {solidId, point} — first point of a pending distance pick
  const [measureResult, setMeasureResult] = useState(null)     // {kind:'straight'|'circular'|'curve'|'distance', ...}
  const [measureHandlePos, setMeasureHandlePos] = useState(null)

  function activateMeasureTool() {
    resetSelection()
    resetDrawState()
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
    }
    setTool('measure')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    resetMeasure()
    viewport3dRef.current?.restoreSavedView()
  }

  function resetMeasure() {
    setMeasureHover(null)
    setMeasureP1(null)
    setMeasureResult(null)
    setMeasureHandlePos(null)
    viewport3dRef.current?.clearEdgeHighlight()
    clearMeasureOverlay()
  }

  // Circumcenter of 3 non-collinear 3D points (standard closed-form via the
  // triangle's circumradius vector) — used to test whether an edge's point
  // samples lie on a circle, since nothing upstream (meshEdges/OCC as wired
  // here) tags an edge's curve type or gives a center/radius directly.
  function circumcenter3(A, B, C) {
    const ab = B.clone().sub(A)
    const ac = C.clone().sub(A)
    const abXac = ab.clone().cross(ac)
    const abXacLenSq = abXac.lengthSq()
    if (abXacLenSq < 1e-9) return null   // collinear — no unique circle
    const toCenter = abXac.clone().cross(ab).multiplyScalar(ac.lengthSq())
      .add(ac.clone().cross(abXac).multiplyScalar(ab.lengthSq()))
      .multiplyScalar(1 / (2 * abXacLenSq))
    return { center: A.clone().add(toCenter), radius: toCenter.length() }
  }

  // Classifies one edge from its point samples (getEdgePolyline) as straight
  // (length = endpoint distance), circular (fit a circle through 3 spread
  // samples, verify every other sample lands on it within tolerance —
  // diameter/radius), or a general curve (fallback: summed segment length,
  // labeled so it's not mistaken for a true diameter). Returns null if the
  // edge can't be looked up (e.g. solid rebuilt since the hover).
  function classifyEdgeGeometry(vp, solidId, edgeId) {
    const poly = vp.getEdgePolyline(solidId, edgeId)
    if (!poly?.points || poly.points.length < 6) return null
    const SCALE = 2
    const raw = poly.points
    const pts = []
    for (let i = 0; i < raw.length; i += 3) {
      const v = new THREE.Vector3(raw[i], raw[i+1], raw[i+2]).applyMatrix4(poly.matrixWorld)
      pts.push(new THREE.Vector3(v.x/SCALE, v.y/SCALE, v.z/SCALE))
    }
    let segLen = 0
    for (let i = 0; i < raw.length/3 - 1; i++) segLen += pts[i].distanceTo(pts[i+1])

    const first = pts[0], last = pts[pts.length-1]
    const chord = first.distanceTo(last)
    const chordDir = chord > 1e-6 ? last.clone().sub(first).normalize() : null
    const maxDev = chordDir
      ? Math.max(...pts.map(p => p.clone().sub(first).cross(chordDir).length()))
      : 0
    const straightTol = Math.max(0.02, chord * 0.01)
    if (chordDir && maxDev < straightTol) {
      return { kind: 'straight', length: chord }
    }

    // Try a circle fit through 3 well-spread samples (first / ~1/3 / ~2/3).
    const iMid = Math.max(1, Math.floor(pts.length/3))
    const iTwoThirds = Math.min(pts.length-2, Math.floor(pts.length*2/3))
    const fit = circumcenter3(pts[0], pts[iMid], pts[iTwoThirds])
    if (fit) {
      const tol = Math.max(0.05, fit.radius * 0.02)
      const fits = pts.every(p => Math.abs(p.distanceTo(fit.center) - fit.radius) < tol)
      if (fits) return { kind: 'circular', radius: fit.radius, diameter: fit.radius*2, center: fit.center }
    }
    return { kind: 'curve', length: segLen }
  }

  // Redraws the point-mode markers (P1 dot, live hover dot, dashed connector
  // + running distance label) on the shared preview overlay canvas — same
  // canvas fillet3d's markers use (never active at the same time as Measure).
  function clearMeasureOverlay() {
    const vp = viewport3dRef.current; if (!vp) return
    const oc = vp.getExtrudePreviewCanvas(); if (!oc) return
    const ctx = oc.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,oc.width,oc.height)
  }

  function drawMeasureOverlay(vp, p1, hover) {
    const oc = vp.getExtrudePreviewCanvas(); if (!oc) return
    const ctx = oc.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,oc.width,oc.height)
    const SCALE = 2
    const color = '#4FC3F7'
    const toScreen = p => vp.worldToScreen(p[0]*SCALE, p[1]*SCALE, p[2]*SCALE)

    const drawDot = (pt) => {
      const s = toScreen(pt); if (!s) return null
      ctx.save(); ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI*2); ctx.fill()
      ctx.restore()
      return s
    }

    const p1Screen = p1 ? drawDot(p1.point) : null
    if (hover?.kind === 'point') {
      const hoverScreen = drawDot(hover.point)
      if (p1Screen && hoverScreen) {
        ctx.save()
        ctx.strokeStyle = color
        ctx.setLineDash([5,4])
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(p1Screen.x, p1Screen.y)
        ctx.lineTo(hoverScreen.x, hoverScreen.y)
        ctx.stroke()
        ctx.restore()
        const d = Math.hypot(
          hover.point[0]-p1.point[0], hover.point[1]-p1.point[1], hover.point[2]-p1.point[2])
        ctx.save()
        ctx.fillStyle = color
        ctx.font = 'bold 12px monospace'
        ctx.textAlign = 'center'
        ctx.shadowColor = color; ctx.shadowBlur = 6
        ctx.fillText(`${d.toFixed(2)} mm`, (p1Screen.x+hoverScreen.x)/2, (p1Screen.y+hoverScreen.y)/2 - 8)
        ctx.restore()
      }
    }
  }

  // Mouse move while the Measure tool is active — edges take priority (same
  // dedicated raycastSolidEdges pass fillet3d uses); if the ray misses every
  // edge, fall back to a plain point-on-face hit via raycastSolidFace.
  function handleMeasureHover(e) {
    if (tool !== 'measure') return
    const vp = viewport3dRef.current; if (!vp) return
    const edgeHit = vp.raycastSolidEdges(e.clientX, e.clientY)
    if (edgeHit && edgeHit.edgeId != null) {
      setMeasureHover({ kind:'edge', ...edgeHit })
      return
    }
    const faceHit = vp.raycastSolidFace(e.clientX, e.clientY)
    setMeasureHover(faceHit ? { kind:'point', ...faceHit } : null)
  }

  function handleMeasureClick(e) {
    if (tool !== 'measure' || !measureHover) return
    const vp = viewport3dRef.current; if (!vp) return

    if (measureHover.kind === 'edge') {
      const { solidId, edgeId } = measureHover
      const geo = classifyEdgeGeometry(vp, solidId, edgeId)
      if (!geo) return
      setMeasureResult({ ...geo, solidId, edgeId })
      setMeasureP1(null)
      setMeasureHandlePos({ x: e.clientX + 20, y: e.clientY - 20 })
      vp.setSelectedEdges([{ solidId, edgeId }])
      return
    }

    // Point mode: first click starts P1 (also clears any previous result, so
    // starting a fresh pick doesn't require Esc first); second click computes
    // the distance and settles back to "ready for a new pair" (P1 cleared).
    if (!measureP1) {
      setMeasureP1({ solidId: measureHover.solidId, point: measureHover.point })
      setMeasureResult(null)
      setMeasureHandlePos({ x: e.clientX + 20, y: e.clientY - 20 })
      vp.clearEdgeHighlight()
      return
    }
    const [x1,y1,z1] = measureP1.point, [x2,y2,z2] = measureHover.point
    setMeasureResult({
      kind: 'distance', distance: Math.hypot(x2-x1, y2-y1, z2-z1),
      dx: Math.abs(x2-x1), dy: Math.abs(y2-y1), dz: Math.abs(z2-z1),
    })
    setMeasureHandlePos({ x: e.clientX + 20, y: e.clientY - 20 })
    setMeasureP1(null)
  }

  // ── Mirror (3D feature) state machine ─────────────────────────────────────
  // Step 1: click a feature row in the Feature Tree to pick mirror3dSourceFeatureId.
  // Step 2: click a work plane or solid face — commits immediately (see
  //   commitMirror3D), no third input step needed unlike fillet3d/extrude.
  const [mirror3dSourceFeatureId, setMirror3dSourceFeatureId] = useState(null)

  function activateMirror3DTool() {
    resetSelection()
    resetDrawState()
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
    }
    setTool('mirror3d')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setMirror3dSourceFeatureId(null)
    viewport3dRef.current?.clearSolidHighlight()
    viewport3dRef.current?.restoreSavedView()
  }

  function resetMirror3D() {
    setMirror3dSourceFeatureId(null)
    viewport3dRef.current?.clearSolidHighlight()
  }

  // ── Join (3D boolean union) state machine ─────────────────────────────────
  // Step 1: toggle 2+ eligible feature rows in the Feature Tree into joinSel.
  // Step 2: accept via Enter, right-click, or Tab — commits immediately, no
  //   3D-viewport interaction needed at all (unlike Mirror3D's plane pick).
  const [joinSel, setJoinSel] = useState([])   // [featureId, ...] accumulated picks

  function activateJoin3DTool() {
    resetSelection()
    resetDrawState()
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
    }
    setTool('join3d')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setJoinSel([])
    viewport3dRef.current?.restoreSavedView()
  }

  function resetJoin3D() {
    setJoinSel([])
  }

  function handleToggleJoinMember(featId) {
    if (tool !== 'join3d') return
    setJoinSel(prev => prev.includes(featId) ? prev.filter(id => id !== featId) : [...prev, featId])
  }

  // Keeps every currently-selected join member glowing in the 3D view, live
  // as the selection changes — mirrors how selected fillet edges/mirror
  // sources are highlighted elsewhere. Also clears on leaving the tool
  // (the effect re-runs with an empty solidIds list otherwise, since
  // joinSel itself doesn't get cleared until resetJoin3D — this explicit
  // tool!=='join3d' branch is what actually removes the glow on tool-switch).
  useEffect(() => {
    if (tool !== 'join3d') { viewport3dRef.current?.clearJoinHighlight(); return }
    const solidIds = joinSel.map(id => features.find(f => f.id === id)?.solidId).filter(Boolean)
    viewport3dRef.current?.highlightJoinMembers(solidIds)
  }, [joinSel, tool])

  // Boolean-unions every selected member into one new solid. Members are
  // removed from `solids` (not rendered independently anymore) but their
  // FEATURE entries stay — just locked via joinedInto — carrying everything
  // needed to rebuild them fresh if the Join is later deleted (see
  // rebuildFeatureSolid). No "live" tracking needed afterward: members can't
  // be edited while locked, so nothing can go stale the way a Mirror source can.
  async function commitJoin() {
    const selIds = joinSel
    resetJoin3D()
    if (selIds.length < 2) return
    const memberFeats = selIds.map(id => features.find(f => f.id === id)).filter(Boolean)
    const memberSolids = memberFeats.map(f => solids.find(s => s.id === f.solidId)).filter(Boolean)
    if (memberSolids.length < 2) return
    try {
      const newSolidId = Date.now()
      const members = memberSolids.map(s => ({
        solidId: s.id, base: buildBaseWorkerParams(s), ops: buildSolidOpsForWorker(s, features),
      }))
      const meshData = await cadEngine.joinShapes({ solidId: newSolidId, members })
      const group = replicadMeshToThree(meshData, memberSolids[0].color, newSolidId)

      const joinFeatId = `join-${newSolidId}`
      setSolids(prev => [
        ...prev.filter(s => !memberSolids.some(m => m.id === s.id)),
        { id: newSolidId, group, operation: 'join', memberSolidIds: memberSolids.map(s => s.id), color: memberSolids[0].color },
      ])
      setFeatures(prev => [
        ...prev.map(f => memberFeats.some(m => m.id === f.id) ? { ...f, joinedInto: joinFeatId } : f),
        { id: joinFeatId, type: 'extrude', name: nextJoinName(), operation: 'join',
          solidId: newSolidId, memberFeatureIds: selIds, memberSolidIds: memberSolids.map(s => s.id),
          color: memberSolids[0].color },
      ])
    } catch (err) {
      console.error('Join failed:', err)
      setCadError(`Join failed: ${err.message || String(err)}`)
      setTimeout(() => setCadError(null), 6000)
    }
  }

  // ── Loft (multi-profile lofted solid) state machine ───────────────────────
  // Step 1: pick a work plane or face — becomes Profile 1's plane, and fixes
  //   the shared normal/uAxis basis every later profile reuses (only the
  //   offset along that normal differs — see buildLoftFacePlane).
  // Step 2..N: sketch a closed profile, "Finish Sketch" (the same trigger
  //   every other sketch flow already uses) stores it into loftState.profiles
  //   at loftState.currentIdx and shows the step popup (Previous/Next/Finish
  //   Loft) instead of committing — loft never auto-commits on Finish Sketch.
  // Next/Previous re-enter the sketch on an adjacent profile's plane, restoring
  // that profile's own saved sketch via enterSketch's existing initialGeometry
  // param (same mechanism a normal extrude edit already uses) and injecting
  // the profile immediately behind it as a dimmed, snappable ghost.
  // loftState.basis = {origin, normal, uAxis} — THREE.Vector3, SCENE (px) units.
  const [loftState, setLoftState] = useState(null)
  const [loftEditingFeatureId, setLoftEditingFeatureId] = useState(null)

  function activateLoft3DTool() {
    resetSelection()
    resetDrawState()
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
    }
    setTool('loft3d')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setLoftState(null)
    setLoftEditingFeatureId(null)
    viewport3dRef.current?.restoreSavedView()
  }

  function resetLoft3D() {
    setLoftState(null)
    setLoftEditingFeatureId(null)
  }

  // Step 1 commit — picking the plane/face fixes the shared basis and goes
  // straight into Profile 1's sketch, no separate "accept" step (matches
  // Mirror3D's own single-click plane pick).
  async function startLoftProfile1(pick) {
    const basis = pick.kind === 'face'
      ? { origin: pick.facePlane.origin.clone(), normal: pick.facePlane.normal.clone(), uAxis: pick.facePlane.uAxis.clone(), vAxis: pick.facePlane.vAxis.clone() }
      : workPlaneToFacePlaneBasisPx(pick.planeId)
    setLoftState({ basis, ruled: false, profiles: [], currentIdx: 0, currentOffsetMm: 0, distanceInput: '20' })
    const plane = buildLoftFacePlane(basis, 0)
    // Await the camera tween BEFORE opening the sketch — snapToFace's Promise
    // resolves when the ~420ms animation finishes. The camera position itself
    // is what's being interpolated frame-by-frame during that window (not
    // just a visual nicety — screenToWorld raycasts FROM the live camera
    // object), so drawing while it's still mid-tween raycasts from a camera
    // that hasn't reached the straight-on view yet, producing a click point
    // that doesn't match what's on screen. Entering the sketch only after
    // the tween settles removes that window entirely, rather than requiring
    // the user to intuit "wait a beat before drawing."
    await viewport3dRef.current?.snapToFace(plane)
    enterSketch(plane)
  }

  // Appends `profile`'s own sketch geometry into the live working arrays,
  // tagged ghostRef so the sketch draw loop dims it and handleFinishSketch's
  // loft branch excludes it from the NEW profile's own detection — reuses
  // the existing circles/lines state (and therefore getGeoSnap, which already
  // takes those arrays directly) instead of a parallel snap system.
  function injectLoftGhost(profile) {
    if (!profile) return
    setLines(prev => [...prev, ...profile.sketchLines.map(l => ({ ...l, ghostRef: true }))])
    setCircles(prev => [...prev, ...profile.sketchCircles.map(c => ({ ...c, ghostRef: true }))])
    setArcs(prev => [...prev, ...profile.sketchArcs.map(a => ({ ...a, ghostRef: true }))])
    setSplines(prev => [...prev, ...profile.sketchSplines.map(s => ({ ...s, ghostRef: true }))])
  }

  async function loftNextProfile() {
    const st = loftState
    if (!st) return
    const nextIdx = st.currentIdx + 1
    const existingNext = st.profiles[nextIdx]   // re-visiting an already-sketched profile (edit flow)
    const nextOffsetMm = existingNext ? existingNext.offsetMm : st.currentOffsetMm + (parseFloat(st.distanceInput) || 20)
    const ghostProfile = st.profiles[st.currentIdx]
    setLoftState(prev => ({ ...prev, currentIdx: nextIdx, currentOffsetMm: nextOffsetMm }))
    const plane = buildLoftFacePlane(st.basis, nextOffsetMm)
    // Await the camera settling before opening the sketch — see startLoftProfile1.
    await viewport3dRef.current?.snapToFace(plane)
    enterSketch(
      plane, null,
      existingNext ? { lines: existingNext.sketchLines, circles: existingNext.sketchCircles, arcs: existingNext.sketchArcs, splines: existingNext.sketchSplines } : null
    )
    injectLoftGhost(ghostProfile)
  }

  async function loftPreviousProfile() {
    const st = loftState
    if (!st || st.currentIdx === 0) return
    const prevIdx = st.currentIdx - 1
    const prevProfile = st.profiles[prevIdx]
    if (!prevProfile) return
    const ghostProfile = st.profiles[prevIdx - 1]
    setLoftState(prev => ({ ...prev, currentIdx: prevIdx, currentOffsetMm: prevProfile.offsetMm }))
    const plane = buildLoftFacePlane(st.basis, prevProfile.offsetMm)
    await viewport3dRef.current?.snapToFace(plane)
    enterSketch(
      plane, null,
      { lines: prevProfile.sketchLines, circles: prevProfile.sketchCircles, arcs: prevProfile.sketchArcs, splines: prevProfile.sketchSplines }
    )
    injectLoftGhost(ghostProfile)
  }

  // Rebuilds a loft feature's shared plane basis (THREE.Vector3, scene px)
  // from its stored plain-array fields (mm) — shared by handleEditLoft and
  // startLoftFromProfile so there's one source of truth for this conversion.
  function featureLoftBasisPx(feat) {
    const normal = new THREE.Vector3(...feat.normal)
    const uAxis  = new THREE.Vector3(...feat.uAxis)
    return {
      origin: new THREE.Vector3(mmToPx(feat.origin[0]), mmToPx(feat.origin[1]), mmToPx(feat.origin[2])),
      normal, uAxis,
      // Older/malformed data without a stored vAxis falls back to the cross
      // product — correct for XY/YZ, only wrong for XZ (see
      // workPlaneToFacePlaneBasisPx) — better than crashing on a missing field.
      vAxis: feat.vAxis ? new THREE.Vector3(...feat.vAxis) : new THREE.Vector3().crossVectors(normal, uAxis).normalize(),
    }
  }

  // Reopens an existing loft feature for editing at Profile 1, same
  // Next/Previous stepping as creation — "Finish Loft" re-commits in place
  // (see commitLoft's editingId branch) instead of creating a new solid.
  function handleEditLoft(featureId) {
    const feat = features.find(f => f.id === featureId)
    if (!feat || feat.operation !== 'loft') return
    resetSelection(); resetDrawState()
    setTool('loft3d')
    const basis = featureLoftBasisPx(feat)
    setLoftState({ basis, ruled: !!feat.ruled, profiles: feat.profiles, currentIdx: 0, currentOffsetMm: feat.profiles[0].offsetMm, distanceInput: '20' })
    setLoftEditingFeatureId(featureId)
    const p0 = feat.profiles[0]
    const plane = buildLoftFacePlane(basis, p0.offsetMm)
    viewport3dRef.current?.snapToFace(plane).then(() => {
      enterSketch(plane, null,
        { lines: p0.sketchLines, circles: p0.sketchCircles, arcs: p0.sketchArcs, splines: p0.sketchSplines })
    })
  }

  // Finish Loft — builds the solid through every stored profile. Guards
  // against fewer than 2 (OCC's loftWith needs at least 2 sections, same
  // guard cadWorker.js's buildLoft itself has, mirrored here so the error
  // surfaces immediately instead of round-tripping to the worker first).
  async function commitLoft() {
    const st = loftState
    if (!st) return
    const profiles = st.profiles.filter(Boolean)
    if (profiles.length < 2) {
      setCadError('Need at least 2 profiles to loft.')
      setTimeout(() => setCadError(null), 5000)
      return
    }
    const editingId = loftEditingFeatureId
    const basis = st.basis
    const ruled = !!st.ruled
    resetLoft3D()
    setTool('select')
    setSketchMode(false); setActivePlane(null); setActiveSketchId(null)
    setLines([]); setCircles([]); setArcs([]); setSplines([])

    const normal = [basis.normal.x, basis.normal.y, basis.normal.z]
    const origin = [pxToMm(basis.origin.x), pxToMm(basis.origin.y), pxToMm(basis.origin.z)]
    const uAxis  = [basis.uAxis.x, basis.uAxis.y, basis.uAxis.z]
    // vAxis isn't needed by the worker (buildLoft only uses normal+uAxis),
    // but must be stored so handleEditLoft can rebuild the exact same basis —
    // re-deriving it via cross(normal,uAxis) on edit wouldn't match for a
    // loft that started on the XZ work plane (see workPlaneToFacePlaneBasisPx).
    const vAxis  = [basis.vAxis.x, basis.vAxis.y, basis.vAxis.z]

    try {
      const solidId = editingId ? features.find(f => f.id === editingId)?.solidId : Date.now()
      const meshData = await cadEngine.loft({
        solidId, normal, origin, uAxis, ruled,
        profiles: profiles.map(p => ({ pts: p.pts, circle: p.circle, offsetMm: p.offsetMm })),
      })
      const color = (editingId && solids.find(s => s.id === solidId)?.color) || extrudeColor
      const group = replicadMeshToThree(meshData, color, solidId)
      const solidData = { id: solidId, group, operation: 'loft', color, normal, origin, uAxis, vAxis, profiles, ruled }

      setSolids(prev => editingId ? prev.map(s => s.id === solidId ? solidData : s) : [...prev, solidData])
      if (editingId) {
        setFeatures(prev => prev.map(f => f.id === editingId ? { ...f, normal, origin, uAxis, vAxis, profiles, ruled } : f))
      } else {
        setFeatures(prev => [...prev, {
          id: `loft-${solidId}`, type: 'extrude', operation: 'loft', name: nextLoftName(),
          solidId, normal, origin, uAxis, vAxis, profiles, ruled, color,
        }])
      }
      await rebuildDependentMirrors(solidData)
    } catch (err) {
      console.error('Loft failed:', err)
      setCadError(`Loft failed: ${err.message || String(err)}`)
      setTimeout(() => setCadError(null), 6000)
    }
  }

  function handlePickMirror3DSource(featId) {
    if (tool !== 'mirror3d' || mirror3dSourceFeatureId) return
    const feat = features.find(f => f.id === featId)
    if (!feat) return
    setMirror3dSourceFeatureId(featId)
    if (feat.operation === 'cutout') {
      // A cutout is often a small detail on a much larger body — highlight
      // just the cutout's own profile (at its entry plane) instead of
      // glowing the whole solid, same reasoning as commitMirrorCutout's
      // reflection math needing the source's own plane basis.
      const toWorld = feat.facePlane
        ? p => feat.facePlane.sketchToWorld(p.x, p.y)
        : p => sketchToWorld(p.x, p.y, feat.planeId)
      viewport3dRef.current?.highlightCutoutFace(feat.profilePts.map(toWorld))
    } else {
      viewport3dRef.current?.highlightSolid(feat.solidId)
    }
  }

  // Step 2 commit — picking the plane/face immediately mirrors, no third
  // input step. `pick` is {kind:'face', facePlane} or {kind:'workplane', planeId}.
  // Dispatches on the SOURCE feature's operation per the confirmed behavior:
  // cutout -> mirrored onto the same solid; extrude/revolve -> separate new solid.
  async function commitMirror3D(pick) {
    const sourceFeat = features.find(f => f.id === mirror3dSourceFeatureId)
    setMirror3dSourceFeatureId(null)
    viewport3dRef.current?.clearSolidHighlight()
    setTool('select')
    if (!sourceFeat) return
    try {
      if (sourceFeat.operation === 'cutout') {
        await commitMirrorCutout(sourceFeat, pick)
      } else {
        await commitMirrorSolid(sourceFeat, pick)
      }
    } catch (err) {
      console.error('Mirror failed:', err)
      setCadError(`Mirror failed: ${err.message || String(err)}`)
      setTimeout(() => setCadError(null), 6000)
    }
  }

  // Mirroring a CUTOUT stays on the SAME solid — rebuildSolidChain's replay
  // loop only understands cutout PARAMS (re-derived fresh every rebuild), not
  // a cached shape an OCC mirror() could substitute in, so this reflects the
  // cutout's own definition (plane + profile points, + revolve axis if any)
  // across the picked mirror plane client-side, and adds the result as an
  // ordinary new cutout feature — no worker mirror call needed at all.
  // `pick` is the RAW picked plane: {kind:'workplane', planeId} or
  // {kind:'face', facePlane: <real FacePlane instance>}.
  async function commitMirrorCutout(cutFeat, pick) {
    const baseSolid = solids.find(s => s.id === cutFeat.solidId)
    if (!baseSolid) throw new Error('Target solid not found')

    const { O, n } = pick.kind === 'face'
      ? { O: pick.facePlane.origin, n: pick.facePlane.normal }
      : { O: new THREE.Vector3(0, 0, 0), n: planeIdBasis(pick.planeId).normal }

    // Unify work-plane and face-plane sources into one FacePlane-shaped
    // object so the rest of this function doesn't need two code paths.
    const sourceBasis = cutFeat.facePlane || (() => {
      const b = planeIdBasis(cutFeat.planeId)
      return new FacePlane(b.origin, b.normal, b.uAxis, b.vAxis)
    })()

    const mirroredNormal = reflectDir(sourceBasis.normal, n)
    const mirroredUAxis  = reflectDir(sourceBasis.uAxis, n)
    const mirroredOrigin = reflectPoint(sourceBasis.origin, O, n)
    // Re-derive (not reflect) vAxis — reflecting normal/uAxis independently
    // then crossing them keeps the frame orthonormal; the mirror is
    // orientation-reversing by nature, which is correct here, not a bug.
    const mirroredVAxis = new THREE.Vector3().crossVectors(mirroredNormal, mirroredUAxis).normalize()
    const mirroredFacePlane = new FacePlane(mirroredOrigin, mirroredNormal, mirroredUAxis, mirroredVAxis)

    const reflectPt2D = (p) => {
      const world = sourceBasis.sketchToWorld(p.x, p.y)
      return mirroredFacePlane.worldToSketch(reflectPoint(world, O, n))
    }

    // Plain points only — arcs/splines' curveSegments metadata isn't carried
    // over (reflecting an arc/spline's true-curve definition into a NEW 2D
    // plane needs its own angle/tangent transform, not just point reflection).
    // Falls back to the polygonized approximation, same accepted fidelity
    // trade-off this app already makes for other mixed profiles.
    const mirroredPts = cutFeat.profilePts.map(reflectPt2D)
    if (cutFeat.profilePts.circleMeta) {
      const cm = cutFeat.profilePts.circleMeta
      const c2 = reflectPt2D({ x: cm.cx, y: cm.cy })
      mirroredPts.circleMeta = { cx: c2.x, cy: c2.y, r: cm.r }
    }
    let mirroredAxis = null
    if (cutFeat.revolveAxis) {
      const a = cutFeat.revolveAxis
      const p1 = reflectPt2D({ x: a.x1, y: a.y1 })
      const p2 = reflectPt2D({ x: a.x2, y: a.y2 })
      mirroredAxis = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
    }

    const newFeat = {
      id: `cutout-${baseSolid.id}-${Date.now()}`,
      type: 'extrude', name: nextExtrudeName(), operation: 'cutout',
      solidId: baseSolid.id, sourceFeatureId: cutFeat.id,
      planeId: 'face', facePlane: mirroredFacePlane,
      profilePts: mirroredPts,
      depthMm: cutFeat.depthMm, cutDepthMm: cutFeat.cutDepthMm, cutDirection: cutFeat.cutDirection,
      extentMode: cutFeat.extentMode, color: cutFeat.color,
      revolveAxis: mirroredAxis, angleDeg: cutFeat.angleDeg, revolveReverse: cutFeat.revolveReverse,
    }

    // Same pattern as committing any other brand-new cutout (see commitExtrude):
    // apply this ONE cut directly against the target's current shapeStore-cached
    // shape, rather than rebuildSolidChain's full replay — replaying would read
    // `features` from this closure, which is stale until the setFeatures below
    // actually lands.
    const cutParams = buildCutWorkerParams(newFeat)
    const baseParams = buildBaseWorkerParams(baseSolid)
    const meshData = await cadEngine.subtract({ baseSolidId: baseSolid.id, cut: cutParams, base: baseParams })
    const group = replicadMeshToThree(meshData, baseSolid.color, baseSolid.id)
    const updatedSolid = { ...baseSolid, group }
    setSolids(prev => prev.map(s => s.id === baseSolid.id ? updatedSolid : s))
    setFeatures(prev => [...prev, newFeat])
    await rebuildDependentMirrors(updatedSolid)
  }

  // Mirroring an EXTRUDE/REVOLVE produces a completely separate new solid —
  // not fused with the source (a future "Union (Join)" tool handles merging
  // bodies explicitly). Stores sourceSolidId/mirrorPlane so it can be kept
  // live via rebuildDependentMirrors whenever the source changes.
  async function commitMirrorSolid(sourceFeat, pick) {
    const sourceSolid = solids.find(s => s.id === sourceFeat.solidId)
    if (!sourceSolid) throw new Error('Source solid not found')

    const planeParams = pick.kind === 'face'
      ? {
          kind: 'face',
          normal: [pick.facePlane.normal.x, pick.facePlane.normal.y, pick.facePlane.normal.z],
          origin: [pxToMm(pick.facePlane.origin.x), pxToMm(pick.facePlane.origin.y), pxToMm(pick.facePlane.origin.z)],
          uAxis:  [pick.facePlane.uAxis.x, pick.facePlane.uAxis.y, pick.facePlane.uAxis.z],
        }
      : { kind: 'workplane', planeId: pick.planeId }

    const base = buildBaseWorkerParams(sourceSolid)
    const ops = buildSolidOpsForWorker(sourceSolid, features)

    const newSolidId = Date.now()
    const meshData = await cadEngine.mirrorShape({ solidId: newSolidId, base, ops, plane: planeParams })
    const group = replicadMeshToThree(meshData, sourceSolid.color, newSolidId)

    setSolids(prev => [...prev, {
      id: newSolidId, group, operation: 'mirror',
      sourceSolidId: sourceSolid.id, mirrorPlane: planeParams,
      color: sourceSolid.color, planeId: null, facePlane: null,
    }])
    setFeatures(prev => [...prev, {
      id: `mirror-${newSolidId}`, type: 'extrude', name: nextMirrorName(),
      solidId: newSolidId, operation: 'mirror',
      sourceSolidId: sourceSolid.id, sourceFeatureId: sourceFeat.id,
      mirrorPlane: planeParams, color: sourceSolid.color,
    }])
    // No rebuildDependentMirrors call here — a freshly-created mirror solid
    // cannot yet have anything depending on it.
  }

  // Re-triggers rebuild of every mirror-solid whose source is `solid`. Takes
  // the solid object directly (not just an id) so callers pass the FRESHLY
  // updated object they just built — reading `solids` state here would be
  // stale until the setSolids call that triggered this actually lands
  // (React batches state updates). Scoped ONE level deep only — a mirror's
  // own source can never itself be a mirror (enforced by excluding
  // operation==='mirror' rows from Feature-Tree pick eligibility), so no
  // recursion guard is needed.
  async function rebuildDependentMirrors(solid) {
    const dependents = features.filter(f => f.operation === 'mirror' && f.sourceSolidId === solid.id)
    if (dependents.length === 0) return
    const base = buildBaseWorkerParams(solid)
    const ops = buildSolidOpsForWorker(solid, features)
    for (const mirrorFeat of dependents) {
      try {
        const meshData = await cadEngine.mirrorShape({ solidId: mirrorFeat.solidId, base, ops, plane: mirrorFeat.mirrorPlane })
        const group = replicadMeshToThree(meshData, mirrorFeat.color, mirrorFeat.solidId)
        setSolids(prev => prev.map(s => s.id === mirrorFeat.solidId ? { ...s, group } : s))
      } catch (err) {
        console.error('Dependent mirror rebuild failed:', err)
      }
    }
  }

  // Rebuilds ONE feature's own solid from scratch, purely from its stored
  // params — used only when un-joining (a member's solid was removed from
  // `solids` while locked, so this is how it comes back). Dispatches on the
  // feature's own operation, same as buildBaseWorkerParams/rebuildBaseMesh's
  // extrude-vs-revolve dispatch does elsewhere, plus a 'mirror' case matching
  // commitMirrorSolid's own call shape.
  // A type:'extrude' feature (extrude/revolve operation) already carries
  // every field buildBaseWorkerParams/rebuildSolidChain need from a `solid`
  // object — shared by rebuildFeatureSolid and rebuildJoinBaseMesh below.
  function featureToTempSolid(feat) {
    return {
      id: feat.solidId, operation: feat.operation, profilePts: feat.profilePts,
      depthMm: feat.depthMm, direction: feat.direction, planeId: feat.planeId, facePlane: feat.facePlane,
      revolveAxis: feat.revolveAxis, angleDeg: feat.angleDeg, revolveReverse: feat.revolveReverse,
      // Loft has none of the above (no single profilePts/depthMm/planeId) —
      // its own basis + ordered profile list instead, same fields
      // buildBaseWorkerParams' loft branch reads off a `solid` object.
      normal: feat.normal, origin: feat.origin, uAxis: feat.uAxis, vAxis: feat.vAxis, profiles: feat.profiles, ruled: feat.ruled,
    }
  }

  async function rebuildFeatureSolid(feat) {
    if (feat.operation === 'mirror') {
      const sourceSolid = solids.find(s => s.id === feat.sourceSolidId)
      if (!sourceSolid) throw new Error('Mirror source solid not found')
      const base = buildBaseWorkerParams(sourceSolid)
      const ops = buildSolidOpsForWorker(sourceSolid, features)
      return cadEngine.mirrorShape({ solidId: feat.solidId, base, ops, plane: feat.mirrorPlane })
    }
    // rebuildSolidChain also transparently replays this member's OWN
    // cutouts/fillets — untouched by the join, still in `features` keyed to
    // feat.solidId the whole time.
    return rebuildSolidChain(featureToTempSolid(feat))
  }

  // Re-fuses a join solid's base from its members' own stored feature params
  // — needed when something on TOP of the join (a fillet/cutout) gets edited,
  // which goes through rebuildSolidChain and needs to rebuild the base clean
  // first. Member solids no longer exist in `solids` while locked, so this
  // reconstructs each member's base/ops from its FEATURE entry instead (same
  // per-member params rebuildFeatureSolid's extrude/revolve case builds).
  // A mirror member has no extrude-style base/ops of its own — passes
  // base:null/ops:[], relying on that member's shapeStore entry already
  // being warm (true unless the worker restarted since it was joined).
  async function rebuildJoinBaseMesh(joinSolid) {
    const joinFeat = features.find(f => f.solidId === joinSolid.id && f.operation === 'join')
    if (!joinFeat) throw new Error('Join feature not found for solid')
    const memberFeats = (joinFeat.memberFeatureIds || []).map(id => features.find(f => f.id === id)).filter(Boolean)
    const members = memberFeats.map(mf => {
      if (mf.operation === 'mirror') return { solidId: mf.solidId, base: null, ops: [] }
      const tempSolid = featureToTempSolid(mf)
      return { solidId: mf.solidId, base: buildBaseWorkerParams(tempSolid), ops: buildSolidOpsForWorker(tempSolid, features) }
    })
    const meshData = await cadEngine.joinShapes({ solidId: joinSolid.id, members })
    return { meshData, baseWorkerParams: null }
  }

  // Clears only the 2D dot-marker canvas — NOT the 3D edge highlights (hover
  // and selected are each independently managed: hover self-clears inside
  // raycastSolidEdges on every call, selected is driven by its own effect
  // below). Calling vp.clearEdgeHighlight() from here would wipe the
  // persistent orange selection highlight every time the mouse leaves an edge.
  function clearFillet3DMarker() {
    const vp = viewport3dRef.current; if (!vp) return
    const oc = vp.getExtrudePreviewCanvas(); if (!oc) return
    const ctx = oc.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,oc.width,oc.height)
  }

  function resetFillet3D() {
    setFillet3dSel([])
    setFillet3dHover(null)
    setFillet3dAccepted(false)
    setFillet3dHandlePos(null)
    setEditingFeatureId(null)
    clearFillet3DMarker()
    viewport3dRef.current?.clearEdgeHighlight()
  }

  // Markers at every selected edge point (filled dot, purple) plus the
  // current hover point (outline dot, skipped once it's already selected) —
  // a simple 2D hint, not a true rounded-edge preview, which would need a
  // real OCC recompute per keystroke the way the extrude/revolve ghosts avoid.
  // Radius-preview circles only show once accepted (drawn at every selected
  // point, so the size preview applies to the whole set).
  function drawFillet3DMarkers(vp, selPoints, hoverPoint, radiusMm, accepted) {
    const oc = vp.getExtrudePreviewCanvas(); if (!oc) return
    const ctx = oc.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,oc.width,oc.height)
    const SCALE = 2
    const color = '#9c6ade'
    const toScreen = p => vp.worldToScreen(p[0]*SCALE, p[1]*SCALE, p[2]*SCALE)

    for (const point of selPoints) {
      const screenPt = toScreen(point); if (!screenPt) continue
      ctx.save()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(screenPt.x, screenPt.y, 5, 0, Math.PI*2)
      ctx.fill()
      ctx.restore()

      if (accepted && radiusMm > 0) {
        const p0 = vp.worldToScreen(0,0,0)
        const p1 = vp.worldToScreen(SCALE,0,0)
        const screenPxPerMm = (p0 && p1) ? Math.hypot(p1.x-p0.x, p1.y-p0.y) : 2
        ctx.save()
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.5
        ctx.setLineDash([4,3])
        ctx.beginPath()
        ctx.arc(screenPt.x, screenPt.y, radiusMm*screenPxPerMm, 0, Math.PI*2)
        ctx.stroke()
        ctx.restore()
      }
    }

    if (hoverPoint) {
      const screenPt = toScreen(hoverPoint)
      if (screenPt) {
        ctx.save()
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(screenPt.x, screenPt.y, 4, 0, Math.PI*2)
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  // Mouse move over the 3D view while still picking edges — raycast against
  // solid edges and update the hover highlight (marker/3D-highlight redraw
  // happens via the effect below, keyed on this state).
  function handleFillet3DHover(e) {
    if (tool !== 'fillet3d' || fillet3dAccepted) return
    const vp = viewport3dRef.current; if (!vp) return
    const hit = vp.raycastSolidEdges(e.clientX, e.clientY)
    setFillet3dHover(hit)
  }

  // Click while hovering a highlighted edge — toggle it in/out of the
  // selection set (same toggle idiom as mirrorSel/moveCopySel/etc: click an
  // already-selected edge again to deselect it).
  function handleFillet3DClick(e) {
    if (tool !== 'fillet3d' || fillet3dAccepted || !fillet3dHover) return false
    const hit = fillet3dHover
    setFillet3dSel(prev => {
      const already = prev.findIndex(s => s.solidId===hit.solidId && s.edgeId===hit.edgeId)
      return already>=0 ? prev.filter((_,i)=>i!==already) : [...prev, hit]
    })
    setFillet3dHandlePos({ x: e.clientX + 20, y: e.clientY - 20 })
    return true
  }

  // Keeps the 2D dot markers + radius-preview circles in sync with the
  // selection/hover/radius input.
  useEffect(() => {
    const vp = viewport3dRef.current
    if (!vp || tool !== 'fillet3d') return
    const selPoints = fillet3dSel.map(e => e.point)
    const hoverPoint = (!fillet3dAccepted && fillet3dHover &&
      !fillet3dSel.some(e => e.solidId===fillet3dHover.solidId && e.edgeId===fillet3dHover.edgeId))
      ? fillet3dHover.point : null
    drawFillet3DMarkers(vp, selPoints, hoverPoint, parseFloat(fillet3dRadiusInput)||0, fillet3dAccepted)
    return () => clearFillet3DMarker()
  }, [tool, fillet3dSel, fillet3dHover, fillet3dRadiusInput, fillet3dAccepted])

  // Keeps the 3D edge highlight (persistent orange) in sync with the selection set.
  useEffect(() => {
    viewport3dRef.current?.setSelectedEdges(fillet3dSel.map(({solidId, edgeId}) => ({solidId, edgeId})))
  }, [fillet3dSel])

  // Leaving the fillet tool for any other tool clears all state and highlights.
  useEffect(() => {
    if (tool !== 'fillet3d') {
      setFillet3dHover(null); setFillet3dSel([]); setFillet3dAccepted(false); setFillet3dHandlePos(null)
      clearFillet3DMarker()
      viewport3dRef.current?.clearEdgeHighlight()
    }
  }, [tool])

  // Keeps Measure's point-mode markers (P1 dot, live hover dot + connector)
  // in sync — mirrors fillet3d's marker-sync effect above. Edge-mode's
  // highlight is handled separately by setSelectedEdges (in handleMeasureClick)
  // plus Viewport3D's own hover-highlight draw loop, so nothing extra needed
  // here for that case (measureP1 stays null while an edge result is shown,
  // so this draws nothing on top of it).
  useEffect(() => {
    const vp = viewport3dRef.current
    if (!vp || tool !== 'measure') return
    drawMeasureOverlay(vp, measureP1, measureHover)
  }, [tool, measureP1, measureHover])

  // Leaving Measure for any other tool clears all state and highlights.
  useEffect(() => {
    if (tool !== 'measure') resetMeasure()
  }, [tool])

  // Re-open the radius popup for an existing fillet, at its original edges —
  // no re-picking needed since solidId/edgePoints are already stored. Commit
  // goes through the same rebuild-chain path as editing a cutout.
  function handleEditFilletRadius(featureId) {
    const feat = features.find(f => f.id === featureId)
    if (!feat || feat.type !== 'fillet') return
    resetSelection(); resetDrawState()
    setTool('fillet3d')
    setEditingFeatureId(featureId)
    setFillet3dSel(feat.edgePoints.map((point,i) => ({ solidId: feat.solidId, edgeId: feat.edgeIds?.[i] ?? null, point })))
    setFillet3dAccepted(true)
    setFillet3dRadiusInput(String(feat.radius))
    const vp = viewport3dRef.current
    const SCALE = 2
    const firstPt = feat.edgePoints[0]
    const screenPt = firstPt && vp?.worldToScreen(firstPt[0]*SCALE, firstPt[1]*SCALE, firstPt[2]*SCALE)
    setFillet3dHandlePos(screenPt ? { x: screenPt.x+20, y: screenPt.y-20 } : { x: window.innerWidth/2, y: window.innerHeight/2 })
  }

  async function commitFillet3D() {
    if (fillet3dSel.length === 0) return
    const solidId = fillet3dSel[0].solidId   // one solid per session — see plan
    const points = fillet3dSel.map(e => e.point)
    const edgeIds = fillet3dSel.map(e => e.edgeId)
    const radius = parseFloat(fillet3dRadiusInput) || 1
    const targetSolid = solids.find(s => s.id === solidId)
    if (!targetSolid) { resetFillet3D(); return }
    const editingId = editingFeatureId
    resetFillet3D()
    try {
      const meshData = editingId
        ? await rebuildSolidChain(targetSolid, { overrideId: editingId, overrideFilletRadius: radius })
        : await cadEngine.fillet3d({ solidId, edgePoints: points, radius, base: buildBaseWorkerParams(targetSolid) })
      const group = replicadMeshToThree(meshData, targetSolid.color, solidId)
      const updatedSolid = { ...targetSolid, group }
      setSolids(prev => prev.map(s => s.id === solidId ? updatedSolid : s))
      if (editingId) {
        setFeatures(prev => prev.map(f => f.id === editingId ? { ...f, radius } : f))
      } else {
        setFeatures(prev => [...prev, {
          id: `fillet-${solidId}-${Date.now()}`, type: 'fillet', name: nextFilletName(),
          solidId, edgePoints: points, edgeIds, radius, color: targetSolid.color,
        }])
      }
      await rebuildDependentMirrors(updatedSolid)
    } catch (err) {
      console.error('Fillet failed:', err)
      setCadError(`Fillet failed: ${err.message || String(err)} — try a smaller radius or different edges.`)
      setTimeout(() => setCadError(null), 6000)
    }
  }

  // ── Extrude click→move→click state machine ───────────────────────────────
  // Phase 1 (idle):   extrudeTool set, extrudeState null — show "click to extrude" on profile
  // Phase 2 (armed):  first click on profile → extrudeState.armed=true, mouse moves freely
  // Phase 3 (commit): second click → commitExtrude() → OCC builds real solid

  const [extrudeHandlePos, setExtrudeHandlePos] = useState(null)
  const extrudeMouseRef = useRef(null)   // latest mouse client coords while armed
  const previewSolidRef = useRef(null)

  // Called every mouse move — tracks position for arrow + canvas preview, and
  // drives the depth live from cursor distance along the extrude direction —
  // Fusion-style hover-to-set-depth. Applies to plain extrude and to cutout's
  // Value Extent. Through-all has no depth to hover-set (fixed huge value,
  // see commitExtrude's cutDepthMm) but One Way's SIDE still needs to follow
  // the mouse — a through-all cut now respects direction (only removes
  // material on the chosen side, see cutDirection in commitExtrude), so
  // there has to be a way to flip it. Revolve's angle stays popup-only.
  function handleExtrudeDragMove(e) {
    if (!extrudeState?.armed) return
    extrudeMouseRef.current = { x: e.clientX, y: e.clientY }
    setSolids(prev => prev.filter(s => s.id !== '__preview__'))
    previewSolidRef.current = null

    if (extrudeState.revolveAxis) return
    const p = extrudeAnimParamsRef.current
    const vp = viewport3dRef.current
    if (!p || !vp) return
    // Fresh from the current camera, same as the rAF loop — see
    // computeExtrudeDirScreen's comment for why these can't be cached.
    const { dir, centScreen } = computeExtrudeDirScreen(vp, p.planeId, p.facePlane, p.centroid)
    if (!centScreen) return
    const vpRect = vp.getDomElement?.()?.parentElement?.getBoundingClientRect?.()
    if (!vpRect) return
    const mx = e.clientX - vpRect.left, my = e.clientY - vpRect.top
    const proj = (mx - centScreen.x) * dir.dx + (my - centScreen.y) * dir.dy

    const isThroughAll = extrudeTool === 'cutout' && extrudeState.extentMode === 'through'
    if (isThroughAll) {
      setExtrudeState(prev => {
        if (!prev?.armed) return prev
        const nextDir = prev.direction === 'both' ? 'both' : (proj >= 0 ? 'front' : 'back')
        if (prev.direction === nextDir) return prev
        return { ...prev, direction: nextDir }
      })
      return
    }

    const screenPxPerMm = getScreenPxPerMm(vp, p.planeId, p.facePlane)
    if (!screenPxPerMm) return
    let mm = Math.abs(proj) / screenPxPerMm
    if (gridSnap) mm = Math.round(mm / gridSizeMm) * gridSizeMm
    mm = Math.max(gridSnap ? gridSizeMm : 0.1, mm)
    const mmStr = String(Math.round(mm * 100) / 100)

    setExtrudeState(prev => {
      if (!prev?.armed) return prev
      const nextDir = prev.direction === 'both' ? 'both' : (proj >= 0 ? 'front' : 'back')
      if (prev.depthInput === mmStr && prev.direction === nextDir) return prev
      return { ...prev, depthInput: mmStr, direction: nextDir }
    })
  }

  // Revolve preview: a cheap 2D animation, not a real OCC recompute (that would
  // need a full worker round-trip on every keystroke). Profile points and axis
  // are converted to true 3D world points (via vp.sketchToWorld), rotated
  // around the axis with THREE's applyAxisAngle (Rodrigues' rotation, exact —
  // no OCC needed for this since we're not building a real solid, just
  // showing where its silhouette would sweep), then projected back to screen
  // each frame. Runs on its own rAF loop driven by a useEffect keyed on the
  // revolve inputs, independent of mouse moves (revolve's angle/direction come
  // from the popup, not a drag).
  const revolveAnimRef = useRef(null)
  function cancelRevolveAnim() {
    if (revolveAnimRef.current) { cancelAnimationFrame(revolveAnimRef.current); revolveAnimRef.current = null }
  }

  function drawRevolveGhost(vp, profilePts, axis, planeId, facePlane, thetaDeg, angleDeg, reverse, color) {
    const oc = vp.getExtrudePreviewCanvas(); if (!oc) return
    const ctx = oc.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,oc.width,oc.height)

    const w1 = vp.sketchToWorld(axis.x1, axis.y1, planeId, facePlane)
    const w2 = vp.sketchToWorld(axis.x2, axis.y2, planeId, facePlane)
    const axisOrigin = new THREE.Vector3(w1.x, w1.y, w1.z)
    const axisDir = new THREE.Vector3(w2.x-w1.x, w2.y-w1.y, w2.z-w1.z).normalize()
    if (axisDir.lengthSq() < 1e-9) return

    const worldPts = profilePts.map(p => {
      const w = vp.sketchToWorld(p.x, p.y, planeId, facePlane)
      return new THREE.Vector3(w.x, w.y, w.z)
    })
    const rotate = (v, angRad) => v.clone().sub(axisOrigin).applyAxisAngle(axisDir, angRad).add(axisOrigin)
    const toScreen = (v) => vp.worldToScreen(v.x, v.y, v.z)

    const theta = THREE.MathUtils.degToRad(thetaDeg)
    const basePts  = worldPts.map(toScreen)
    const sweptPts = worldPts.map(v => toScreen(rotate(v, theta)))
    if (basePts.some(p=>!p) || sweptPts.some(p=>!p)) return

    const strokeColor = color || '#3a7bd5'

    // Reference (original) profile — faint dashed outline
    ctx.save()
    ctx.strokeStyle = strokeColor; ctx.globalAlpha = 0.35; ctx.lineWidth = 1
    ctx.setLineDash([4,3])
    ctx.beginPath()
    ctx.moveTo(basePts[0].x, basePts[0].y)
    basePts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y))
    ctx.closePath(); ctx.stroke()
    ctx.restore()

    // Per-vertex sweep trail — traces the arc each vertex follows from 0..theta,
    // sampled at a capped stride so dense circle profiles (~60 pts) stay cheap.
    const TRAIL_STEPS = 20
    const stride = Math.max(1, Math.floor(worldPts.length / 24))
    ctx.save()
    ctx.strokeStyle = strokeColor; ctx.globalAlpha = 0.4; ctx.lineWidth = 1; ctx.setLineDash([])
    for (let i=0; i<worldPts.length; i+=stride) {
      const v = worldPts[i]
      ctx.beginPath()
      for (let s=0; s<=TRAIL_STEPS; s++) {
        const sp = toScreen(rotate(v, (s/TRAIL_STEPS)*theta))
        if (!sp) continue
        if (s===0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y)
      }
      ctx.stroke()
    }
    ctx.restore()

    // Swept (current-angle) profile — filled ghost
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(sweptPts[0].x, sweptPts[0].y)
    sweptPts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y))
    ctx.closePath()
    ctx.globalAlpha = 0.18; ctx.fillStyle = strokeColor; ctx.fill()
    ctx.globalAlpha = 1;    ctx.strokeStyle = strokeColor; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.restore()

    // Axis + direction/angle label
    const a1 = toScreen(axisOrigin), a2 = toScreen(new THREE.Vector3(w2.x,w2.y,w2.z))
    if (a1 && a2) {
      const midX=(a1.x+a2.x)/2, midY=(a1.y+a2.y)/2
      ctx.save()
      ctx.fillStyle = strokeColor
      ctx.font = 'bold 13px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`${reverse ? '↻' : '↺'} ${angleDeg}°`, midX, midY - 16)
      ctx.restore()
    }
  }

  // Ping-pongs thetaDeg between 0 and ±angleDeg (sign per CW/CCW) so the
  // sweep direction reads clearly at a glance, looping while the popup is open.
  function startRevolveAnim(vp, profilePts, axis, planeId, facePlane, angleDeg, reverse, color) {
    cancelRevolveAnim()
    const sign = reverse ? -1 : 1
    const duration = 1400
    let startTime = null
    function frame(now) {
      if (startTime === null) startTime = now
      const elapsed = (now - startTime) % (duration*2)
      const t = elapsed < duration ? elapsed/duration : (2 - elapsed/duration)
      const eased = t*t*(3-2*t)   // smoothstep
      drawRevolveGhost(vp, profilePts, axis, planeId, facePlane, sign*eased*angleDeg, angleDeg, reverse, color)
      revolveAnimRef.current = requestAnimationFrame(frame)
    }
    revolveAnimRef.current = requestAnimationFrame(frame)
  }

  useEffect(() => {
    const axis = extrudeState?.revolveAxis
    const vp = viewport3dRef.current
    const prof = extrudeState?.profiles?.[extrudeState.pickedIdx]
    if (!axis || !vp || !prof) { cancelRevolveAnim(); return }
    const angleDeg = Math.min(360, Math.max(1, parseFloat(extrudeState.depthInput) || 360))
    startRevolveAnim(vp, prof, axis, extrudeState.planeId, extrudeState.facePlane||null,
      angleDeg, !!extrudeState.revolveReverse, extrudeTool === 'cutout' ? '#e05a4e' : extrudeColor)
    return () => cancelRevolveAnim()
  }, [extrudeState?.revolveAxis, extrudeState?.profiles, extrudeState?.pickedIdx,
      extrudeState?.planeId, extrudeState?.facePlane, extrudeState?.depthInput, extrudeState?.revolveReverse, extrudeTool])

  // Linear extrude/cutout preview: same "breathing" ping-pong treatment as the
  // revolve ghost, but scaling the extrude depth (0 → full depthMm → 0) instead
  // of a sweep angle. The animation clock (extrudeAnimRef) runs continuously
  // once armed and is decoupled from the draw params (extrudeAnimParamsRef) —
  // params update on every mouse move / popup input via the effect below, but
  // the clock itself never restarts, so dragging to set depth doesn't reset
  // the animation to a stutter on every mousemove.
  const extrudeAnimRef = useRef(null)
  const extrudeAnimParamsRef = useRef(null)
  function cancelExtrudeAnim() {
    if (extrudeAnimRef.current) { cancelAnimationFrame(extrudeAnimRef.current); extrudeAnimRef.current = null }
    extrudeAnimParamsRef.current = null
  }
  function startExtrudeAnimLoop() {
    cancelExtrudeAnim()
    const duration = 1400
    let startTime = null
    function frame(now) {
      if (startTime === null) startTime = now
      const p = extrudeAnimParamsRef.current
      if (p) {
        // dir/centScreen recomputed fresh every frame from the CURRENT
        // camera (see computeExtrudeDirScreen) — they're screen projections,
        // not sketch-space values, so they can't be cached across frames
        // without going stale the moment the camera moves independently of
        // extrudeState (orbiting, or a still-settling view tween).
        const { dir, centScreen } = computeExtrudeDirScreen(p.vp, p.planeId, p.facePlane, p.centroid)
        if (centScreen) {
          // Both plain extrude and cutout's Value Extent now follow the mouse
          // live (handleExtrudeDragMove) — a breathing pulse on top of that
          // would fight the cursor and make the preview drift from where the
          // mouse actually is, so it's held at full depth (eased=1). Only
          // cutout's Through All has no depth to hover-set (fixed ∞ visual
          // length), so it keeps the idle breathing pulse as a live indicator.
          let eased = 1
          if (p.opType === 'cutout' && !isFinite(p.depthMm)) {
            const elapsed = (now - startTime) % (duration*2)
            const t = elapsed < duration ? elapsed/duration : (2 - elapsed/duration)
            eased = t*t*(3-2*t)   // smoothstep
          }
          drawExtrudePreview(p.vp, p.profilePts, p.planeId, dir, centScreen,
            p.depthMm, p.direction, p.opType, p.color, p.facePlane, eased)
        }
      }
      extrudeAnimRef.current = requestAnimationFrame(frame)
    }
    extrudeAnimRef.current = requestAnimationFrame(frame)
  }

  // Effect A — clock lifecycle only. Deliberately NOT keyed on depthInput/direction/
  // etc. so those changes don't restart (and re-stutter) the ping-pong clock.
  useEffect(() => {
    if (!extrudeState?.armed || extrudeState?.revolveAxis) { cancelExtrudeAnim(); return }
    startExtrudeAnimLoop()
    return () => cancelExtrudeAnim()
  }, [extrudeState?.armed, !!extrudeState?.revolveAxis])

  // Effect B — recompute draw params whenever the relevant inputs change (mouse-driven
  // depth, direction/extent-mode buttons, direct depth-box typing) and push them into
  // the ref the running clock reads each frame. No restart, no direct draw call needed
  // anywhere else in the file — every setExtrudeState() that touches these fields
  // automatically keeps the ghost preview in sync.
  useEffect(() => {
    const vp = viewport3dRef.current
    const st = extrudeState
    if (!st?.armed || st?.revolveAxis || !vp || !st.centroid) return
    const prof = st.profiles?.[st.pickedIdx]
    if (!prof) return
    const planeId = st.planeId
    const facePlane = st.facePlane || null
    const isCutout = extrudeTool === 'cutout'
    const isThroughAll = isCutout && st.extentMode === 'through'
    const depthMm = isThroughAll ? Infinity : (parseFloat(st.depthInput) || 20)
    // dir/centScreen are deliberately NOT computed/cached here — they're
    // camera-projections (planeExtrudeDirection/sketchToScreen) recomputed
    // fresh every animation frame in startExtrudeAnimLoop's frame(), and
    // fresh on every mousemove in handleExtrudeDragMove, via
    // computeExtrudeDirScreen — see that function's comment for why.
    extrudeAnimParamsRef.current = {
      vp, profilePts: prof, planeId, facePlane, centroid: st.centroid, depthMm,
      direction: st.direction || 'front', opType: extrudeTool,
      color: isCutout ? '#e05a4e' : extrudeColor,
    }
  }, [extrudeState?.armed, extrudeState?.revolveAxis, extrudeState?.planeId, extrudeState?.facePlane,
      extrudeState?.profiles, extrudeState?.pickedIdx, extrudeState?.centroid,
      extrudeState?.extentMode, extrudeState?.depthInput, extrudeState?.direction, extrudeTool, extrudeColor])

  // Recomputes the screen-space extrude-normal direction + the profile
  // centroid's screen position FRESH from the current camera. These are
  // camera-dependent (planeExtrudeDirection/sketchToScreen both project
  // through vp's current camera), so they must never be cached across
  // frames/mousemoves — caching them in extrudeAnimParamsRef (as an earlier
  // version of this code did) went stale as soon as the camera moved
  // (orbit, or a still-settling tween) without the mouse also moving, since
  // nothing else would trigger a recompute. That's exactly what made a
  // through-all cutout's One Way arrow render "not normal" to the profile
  // until the direction buttons were toggled (forcing React state — and
  // therefore a recompute — even though the camera, not the direction, was
  // the actual stale value).
  // No isCutout-based negation here: buildExtrude in cadWorker.js only
  // special-cases 'front' direction for a CUTOUT on a FACE ("Replicad face
  // plane normal points OUTWARD; 'front' cut means INWARD") — but that's an
  // OCC-side offset convention, not a screen-direction flip, and a plain
  // (non-cutout) face extrude grows outward exactly like a work-plane one.
  function computeExtrudeDirScreen(vp, planeId, facePlane, centroidSketch) {
    const dir = vp.planeExtrudeDirection(planeId, facePlane) || { dx:0, dy:-1 }
    const centScreen = vp.sketchToScreen(centroidSketch.x, centroidSketch.y, planeId, facePlane)
    return { dir, centScreen }
  }

  // Screen pixels per 1mm along a plane/face's normal, at the current camera
  // zoom — same projection trick drawExtrudePreview uses internally for its
  // own arrow length, extracted here so handleExtrudeDragMove's hover-follow
  // can convert a screen-space mouse offset into mm.
  function getScreenPxPerMm(vp, planeId, facePlane) {
    const SCALE = 2
    const p0 = vp.worldToScreen(0, 0, 0)
    let pv
    if (facePlane && facePlane.normal) {
      const n = facePlane.normal
      pv = [n.x * SCALE, n.y * SCALE, n.z * SCALE]
    } else {
      const planeVecs = { XY:[0,0,SCALE], XZ:[0,SCALE,0], YZ:[SCALE,0,0] }
      pv = planeVecs[planeId] || [0,SCALE,0]
    }
    const p1 = vp.worldToScreen(pv[0], pv[1], pv[2])
    return (p0 && p1) ? Math.hypot(p1.x-p0.x, p1.y-p0.y) : null
  }

  // Draw the extrude/cutout preview on the overlay canvas.
  // Extrudes show a wireframe + arrows; cutouts show arrows only.
  // Pass depthMm=Infinity for a through-all cutout (arrow gets a fixed visual length + ∞ label).
  // animPhase (0..1) scales the depth for the breathing ghost animation — 1 = full depth.
  function drawExtrudePreview(vp, profilePts, planeId, dir, centScreen, depthMm, direction, opType, color, facePlane=null, animPhase=1) {
    const oc = vp.getExtrudePreviewCanvas(); if (!oc) return
    const ctx = oc.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,oc.width,oc.height)

    const isCutout     = opType === 'cutout'
    const isThroughAll = isCutout && !isFinite(depthMm)

    // Project each profile point to screen coords
    const screenPts = profilePts.map(p => {
      const s = vp.sketchToScreen(p.x, p.y, planeId, facePlane)
      return s || { x:0, y:0 }
    })

    // Screen px per mm (for arrow length on value-extent and extrude)
    const rect = vp.getDomElement()?.parentElement?.getBoundingClientRect()
    const canvasH = rect?.height || 800
    const SCALE = 2
    const p0 = vp.worldToScreen(0, 0, 0)
    let pv
    if (facePlane && facePlane.normal) {
      const n = facePlane.normal
      pv = [n.x * SCALE, n.y * SCALE, n.z * SCALE]
    } else {
      const planeVecs = { XY:[0,0,SCALE], XZ:[0,SCALE,0], YZ:[SCALE,0,0] }
      pv = planeVecs[planeId] || [0,SCALE,0]
    }
    const p1 = vp.worldToScreen(pv[0], pv[1], pv[2])
    const screenPxPerMm = (p0 && p1)
      ? Math.hypot(p1.x-p0.x, p1.y-p0.y)
      : canvasH / 300

    // Through-all arrow gets a fixed 90px visual length; value/extrude scales with depth
    const offsetLen = (isThroughAll ? 90 : depthMm * screenPxPerMm) * animPhase

    let capPts, basePts, isBoth = false

    // 'front' builds the solid on the +normal side (buildExtrude in
    // cadWorker.js: profile sits at the plane, extrude() grows along
    // +normal) — so the cap (far face) must be drawn toward +dir, not -dir.
    // Previously backwards: the ghost preview's cap/arrow pointed opposite
    // to where the committed solid actually appears, for every plane (this
    // is plane-agnostic — a separate bug from the XZ-specific normal-sign
    // fix in planeExtrudeDirection).
    if (direction === 'front') {
      capPts  = screenPts.map(p => ({ x: p.x + dir.dx*offsetLen, y: p.y + dir.dy*offsetLen }))
      basePts = screenPts
    } else if (direction === 'back') {
      capPts  = screenPts.map(p => ({ x: p.x - dir.dx*offsetLen, y: p.y - dir.dy*offsetLen }))
      basePts = screenPts
    } else {
      const half = offsetLen / 2
      basePts = screenPts.map(p => ({ x: p.x - dir.dx*half, y: p.y - dir.dy*half }))
      capPts  = screenPts.map(p => ({ x: p.x + dir.dx*half, y: p.y + dir.dy*half }))
      isBoth = true
    }

    // Vector-arcade neon palette — brighter/more saturated than the flat UI
    // accent colors so the glow reads clearly against the dark viewport.
    const strokeColor = isCutout ? '#FF3B5C' : (color || '#3ad6ff')

    const facePath = (pts) => (c) => {
      c.beginPath()
      c.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => c.lineTo(p.x, p.y))
      c.closePath()
    }

    // ── Wireframe faces + lateral edges (extrudes only) ──────────────────────
    if (!isCutout) {
      if (isBoth) {
        glowFill(ctx, facePath(basePts), strokeColor, 0.06)
        glowStroke(ctx, facePath(basePts), strokeColor, 1.25)
      }
      glowFill(ctx, facePath(capPts), strokeColor, 0.1)
      glowStroke(ctx, facePath(capPts), strokeColor, 1.75)
      if (isBoth) {
        // Plain (non-glow) strokes, batched into ONE path — these lateral
        // connectors are drawn once per profile POINT, and a tessellated
        // circle has ~60+ of them (vs. 4 for a rectangle). Using glowStroke
        // per-segment here meant ~120 shadow-blurred stroke() calls every
        // animation frame for a circle, which floods the canvas with
        // overlapping blur until it visually saturates to a solid blown-out
        // mass — the "screen goes black/blue" bug. The main cap/base outlines
        // above are cheap regardless of point count (2 draws total), so they
        // keep the glow; these secondary guide lines don't need it.
        ctx.save()
        ctx.strokeStyle = strokeColor
        ctx.lineWidth = 1
        ctx.setLineDash([5,4])
        ctx.beginPath()
        basePts.forEach((bp, i) => {
          const cp = capPts[i]; if (!cp) return
          ctx.moveTo(bp.x, bp.y); ctx.lineTo(cp.x, cp.y)
        })
        ctx.stroke()
        ctx.restore()
      }
    } else {
      // Cutout: dashed scan-line outline only, no fill — reads as "material
      // about to be removed" rather than "material being added."
      ctx.setLineDash([4,3])
      glowStroke(ctx, facePath(capPts), strokeColor, 1.5)
      ctx.setLineDash([])
    }

    // ── Direction arrow(s) ────────────────────────────────────────────────────
    const capCx = capPts.reduce((s,p)=>s+p.x,0)/capPts.length
    const capCy = capPts.reduce((s,p)=>s+p.y,0)/capPts.length
    const mainLabel = isThroughAll ? '∞' : `${depthMm}mm`

    const drawArrow = (fromX, fromY, toX, toY, label) => {
      glowStroke(ctx, (c)=>{c.beginPath();c.moveTo(fromX,fromY);c.lineTo(toX,toY)}, strokeColor, 2)
      const a = Math.atan2(toY-fromY, toX-fromX)
      ctx.save(); ctx.translate(toX, toY); ctx.rotate(a)
      ctx.shadowColor = strokeColor; ctx.shadowBlur = 8
      ctx.fillStyle = strokeColor
      ctx.beginPath(); ctx.moveTo(11,0); ctx.lineTo(-6,-6); ctx.lineTo(-6,6); ctx.closePath(); ctx.fill()
      ctx.restore()
      if (label) {
        ctx.save()
        ctx.shadowColor = strokeColor; ctx.shadowBlur = 6
        ctx.fillStyle = strokeColor; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left'
        ctx.fillText(label, toX+14, toY+4)
        ctx.restore()
      }
    }

    if (isBoth) {
      const baseCx = basePts.reduce((s,p)=>s+p.x,0)/basePts.length
      const baseCy = basePts.reduce((s,p)=>s+p.y,0)/basePts.length
      drawArrow(centScreen.x, centScreen.y, capCx, capCy, mainLabel)
      drawArrow(centScreen.x, centScreen.y, baseCx, baseCy, isThroughAll ? '∞' : null)
    } else {
      drawArrow(centScreen.x, centScreen.y, capCx, capCy, mainLabel)
    }
  }

  // First click on profile centroid — arm the tool
  function handleExtrudeClick(worldPt) {
    if (!extrudeTool) return false
    if (cachedProfiles.length === 0) return false

    // Phase 3: already armed → second click = commit
    if (extrudeState?.armed) {
      // Only commit if click is not on the popup (popup has its own buttons)
      setSolids(prev => prev.filter(s => s.id!=='__preview__'))
      previewSolidRef.current = null
      const vp = viewport3dRef.current
      const oc = vp?.getExtrudePreviewCanvas()
      if (oc) { const ctx=oc.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,oc.width,oc.height) }
      commitExtrude()
      return true
    }

    // Phase 2: not yet armed → pick nearest profile and arm
    let best = null
    if (cachedProfiles.length === 1) {
      best = cachedProfiles[0]
    } else {
      const vp = viewport3dRef.current; if (!vp) return false
      const mountEl = vp.getDomElement()?.parentElement
      const rect = mountEl?.getBoundingClientRect() || {left:0,top:0}
      const clickX = lastClickClientRef.current.x - rect.left
      const clickY = lastClickClientRef.current.y - rect.top
      let bestDist = Infinity
      cachedProfiles.forEach(prof => {
        const sp = vp.sketchToScreen(prof.centroid.x, prof.centroid.y, prof.planeId)
        if (!sp) return
        const d = Math.hypot(sp.x-clickX, sp.y-clickY)
        if (d < bestDist) { bestDist=d; best=prof }
      })
    }
    if (!best) return false

    setExtrudeState({
      profiles: [best.pts],
      planeId:  best.planeId,
      facePlane: best.facePlane || null,
      pickedIdx: 0,
      depthInput: '20',
      armed: true,
      direction: extrudeTool === 'cutout' ? 'front' : 'both',
      extentMode: 'through',   // cutout: 'through' | 'value'; ignored for extrude
      centroid: best.centroid,
    })
    return true
  }

  // No-op — kept for compat
  function handleExtrudeHandleMouseDown(e) {}
  function handleExtrudeDragEnd(e) {}

  // Use a ref so handleExtrudeDepthKey always sees current extrudeState
  const extrudeStateRef = useRef(null)
  useEffect(() => { extrudeStateRef.current = extrudeState }, [extrudeState])

  function handleExtrudeDepthKey(e) {
    if (!extrudeStateRef.current) return
    if (e.key === 'Enter') {
      const vp = viewport3dRef.current
      const oc = vp?.getExtrudePreviewCanvas()
      if (oc) { const ctx=oc.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,oc.width,oc.height) }
      setSolids(prev => prev.filter(s => s.id!=='__preview__'))
      commitExtrude()
    } else if (e.key === 'Escape') {
      const vp = viewport3dRef.current
      const oc = vp?.getExtrudePreviewCanvas()
      if (oc) { const ctx=oc.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,oc.width,oc.height) }
      setSolids(prev => prev.filter(s => s.id!=='__preview__'))
      setExtrudeState(null)
      setExtrudeTool(null)
      setLines([]); setCircles([]); setArcs([]); setSplines([])
    }
  }

  // Rebuilds solidId completely from its own clean base shape, replaying every
  // cutout/fillet feature that targets it in feature-array order (their
  // natural chronological order) — the "rebuild + replay" pattern used
  // throughout this app's editing model, now shared by cutout AND fillet
  // edit/delete so the two interleave correctly regardless of which was
  // applied first. `overrideId` + `overrideCut`/`overrideFilletRadius`
  // substitutes new params for ONE feature being edited; `skipId` omits one
  // being deleted. Returns the final meshData.
  async function rebuildSolidChain(baseSolid, { overrideId=null, overrideCut=null, overrideFilletRadius=null, skipId=null } = {}) {
    let { meshData, baseWorkerParams } = baseSolid.operation === 'join'
      ? await rebuildJoinBaseMesh(baseSolid)
      : await rebuildBaseMesh(baseSolid)
    const ops = features.filter(f => f.solidId === baseSolid.id && (f.operation === 'cutout' || f.type === 'fillet'))
    for (const opFeat of ops) {
      if (opFeat.id === skipId) continue
      if (opFeat.type === 'fillet') {
        const radius = opFeat.id === overrideId ? overrideFilletRadius : opFeat.radius
        meshData = await cadEngine.fillet3d({ solidId: baseSolid.id, edgePoints: opFeat.edgePoints, radius, base: baseWorkerParams })
      } else {
        const cutParams = opFeat.id === overrideId ? overrideCut : buildCutWorkerParams(opFeat)
        meshData = await cadEngine.subtract({ baseSolidId: baseSolid.id, cut: cutParams, base: baseWorkerParams })
      }
    }
    return meshData
  }

  async function commitExtrude(overrideState=null) {
    const state = overrideState || extrudeStateRef.current || extrudeState
    if (!state) return
    const { profiles, planeId, pickedIdx, depthInput, direction='both', extentMode='through', textGroup=null, revolveAxis=null, revolveReverse=false,
            sketchLines:savedLines=[], sketchCircles:savedCircles=[], sketchArcs:savedArcs=[], sketchSplines:savedSplines=[] } = state
    const depthMm = parseFloat(depthInput) || 20
    const angleDeg = revolveAxis ? Math.min(360, Math.max(1, depthMm)) : null
    const isCutout = extrudeTool === 'cutout'
    const color = isCutout ? '#e05a4e' : extrudeColor
    const pts = profiles[pickedIdx]
    const cached = cachedProfiles.find(p => p.pts === pts)
    const facePlane = state.facePlane || cached?.facePlane || null

    // Cutout: through-all uses a huge depth to guarantee punch-through; value uses user depth.
    // Direction is respected either way — a one-way through-all cut only removes
    // material on the chosen side of the plane, same as buildExtrude's normal
    // front/back/both handling (cutExtentRangeMm mirrors this exactly), it just
    // uses a depth big enough to guarantee it reaches the far end of the solid.
    const cutDepthMm  = (isCutout && extentMode === 'through') ? 10000 : depthMm
    const cutDirection = direction

    // Capture all state before clearing (setExtrudeState(null) makes extrudeState stale)
    const editingId = editingFeatureId
    hiddenEditSolidRef.current = null   // committed — new solid replaces the hidden one
    setExtrudeState(null)
    setExtrudeTool(null)
    setExtrudeHandlePos(null)
    setEditingFeatureId(null)
    // Clear integrated sketch canvas (geometry now baked into the solid)
    setLines([]); setCircles([]); setArcs([]); setSplines([])

    const editingFeat = editingId ? features.find(f => f.id === editingId) : null
    const sketchGeom = { sketchLines: savedLines, sketchCircles: savedCircles, sketchArcs: savedArcs, sketchSplines: savedSplines }

    try {
      const workerParams = {
        pts,
        depthMm,
        planeId,
        direction,   // captured above — not read from extrudeState after null
        circle: pts.circleMeta || null,  // true circle → real curve, not a polygon prism
        ...(facePlane ? {
          normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
          origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
          uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
          vAxis:  [facePlane.vAxis.x,  facePlane.vAxis.y,  facePlane.vAxis.z],
        } : {}),
      }

      const lastSketch = [...features].reverse().find(f=>f.type==='sketch')

      if (isCutout) {
        // Revolve-cutout: same axis-detection as a plain revolve (see
        // handleFinishSketch), just subtracted from the target solid(s)
        // instead of added as a new one. No depth/direction concept — the
        // swept volume is fully defined by the profile, axis, and angle.
        const cut = revolveAxis
          ? {
              pts, planeId, axis: revolveAxis, angleDeg, reverse: revolveReverse,
              circle: pts.circleMeta || null,
              ...(facePlane ? {
                normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
                origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
                uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
              } : {}),
            }
          : {
              pts, depthMm: cutDepthMm, planeId, direction: cutDirection,
              circle: pts.circleMeta || null,
              ...(facePlane ? {
                normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
                origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
                uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
              } : {}),
            }

        if (editingId && editingFeat?.groupId) {
          // Editing a grouped (multi-body) cutout — apply the new sketch/extent
          // to every solid the group originally spanned. Membership stays fixed
          // (we don't re-detect overlap here): nudging a depth or sketch should
          // keep affecting the same bodies it did before, not silently change
          // which ones are included.
          const groupId = editingFeat.groupId
          const groupMembers = features.filter(f => f.groupId === groupId)
          const updatedById = new Map()
          for (const member of groupMembers) {
            const baseSolid = solids.find(s => s.id === member.solidId)
            if (!baseSolid) continue
            // `member` IS the cutout feature for this solid within the group being edited.
            const meshData = await rebuildSolidChain(baseSolid, { overrideId: member.id, overrideCut: cut })
            const group = replicadMeshToThree(meshData, baseSolid.color, baseSolid.id)
            const updatedSolid = { ...baseSolid, group }
            setSolids(prev => prev.map(s => s.id === baseSolid.id ? updatedSolid : s))
            updatedById.set(member.id, {
              ...member, depthMm, cutDepthMm, cutDirection, extentMode, profilePts: pts, facePlane,
              revolveAxis, angleDeg, revolveReverse, ...sketchGeom,
            })
            await rebuildDependentMirrors(updatedSolid)
          }
          setFeatures(prev => prev.map(f => updatedById.get(f.id) || f))

        } else if (!editingId) {
          // Brand new cutout: find every solid body the cut's actual volume
          // overlaps (not just the one whose face was sketched on), so cutting
          // through two stacked extrusions affects both — whether it's a
          // through-all cut or a value-extent one deep enough to reach the
          // second body.
          // Cheap 3D overlap test using the already-rendered geometry: build the
          // cut's own bounding box, then check which solids' bounding boxes it
          // intersects. OCC does the real, precise boolean cut below — this is
          // only a candidate filter so we don't create no-op cutout features
          // for bodies the cut never touches.
          let cutBox
          if (revolveAxis) {
            // Swept-volume box, sampled across the sweep angle (see revolveSweepBoxPx).
            cutBox = revolveSweepBoxPx(pts, revolveAxis, angleDeg, revolveReverse, planeId, facePlane)
          } else {
            // XZ's world normal is -Y, not +Y — see the matching comment on
            // Viewport3D.jsx's planeExtrudeDirection (same bug class fixed there).
            const worldNormals = { XY:[0,0,1], XZ:[0,-1,0], YZ:[1,0,0] }
            const [nx, ny, nz] = facePlane
              ? [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z]
              : (worldNormals[planeId] || [0,0,1])
            const normalVec = new THREE.Vector3(nx, ny, nz)
            const worldPts = pts.map(p => {
              const w = facePlane ? facePlane.sketchToWorld(p.x, p.y) : sketchToWorld(p.x, p.y, planeId)
              return new THREE.Vector3(w.x, w.y, w.z)
            })
            // Profile footprint extended by its ACTUAL depth/direction span — see cutExtentRangeMm.
            const [minMm, maxMm] = cutExtentRangeMm(cutDepthMm, cutDirection, planeId)
            cutBox = new THREE.Box3().setFromPoints(worldPts)
            const boxAtMin = cutBox.clone().translate(normalVec.clone().multiplyScalar(mmToPx(minMm)))
            const boxAtMax = cutBox.clone().translate(normalVec.clone().multiplyScalar(mmToPx(maxMm)))
            cutBox.union(boxAtMin).union(boxAtMax)
          }

          const candidates = solids.filter(s => s.operation !== 'cutout' && s.group)
          const affected = candidates.filter(s =>
            cutBox.intersectsBox(new THREE.Box3().setFromObject(s.group)))
          if (affected.length === 0) throw new Error('No base solid to cut from')

          const groupId = `cutgroup-${Date.now()}`
          const newFeats = []
          for (const target of affected) {
            const targetBaseParams = buildBaseWorkerParams(target)
            const meshData = await cadEngine.subtract({ baseSolidId: target.id, cut, base: targetBaseParams })
            const group = replicadMeshToThree(meshData, target.color, target.id)
            const updatedSolid = { ...target, group }
            setSolids(prev => prev.map(s => s.id === target.id ? updatedSolid : s))
            newFeats.push({
              id: `cutout-${target.id}-${Date.now()}`,
              type: 'extrude', name: nextExtrudeName(), groupId,
              solidId: target.id, sketchId: lastSketch?.id || null,
              depthMm, cutDepthMm, cutDirection, extentMode, color, operation: 'cutout', planeId, profilePts: pts, facePlane,
              revolveAxis, angleDeg, revolveReverse, ...sketchGeom,
            })
            await rebuildDependentMirrors(updatedSolid)
          }
          setFeatures(prev => [...prev, ...newFeats])

        } else {
          // Editing an existing, non-grouped (single-body) cutout.
          const baseSolid = solids.find(s => s.id === editingFeat.solidId)
          if (!baseSolid) throw new Error('No base solid to cut from')

          // Re-editing: the worker's shapeStore for this solidId currently holds
          // the OLD compounded result, so a plain subtract here would stack the
          // new cut on top of the old one instead of replacing it. Rebuild the
          // base clean and replay every cutout/fillet on it in order,
          // substituting the new profile/extent for the one being edited.
          const meshData = await rebuildSolidChain(baseSolid, { overrideId: editingId, overrideCut: cut })
          const group = replicadMeshToThree(meshData, baseSolid.color, baseSolid.id)
          const updatedSolid = { ...baseSolid, group }
          setSolids(prev => prev.map(s =>
            s.id === baseSolid.id ? updatedSolid : s
          ))
          const cutoutFeat = {
            id: editingId, type: 'extrude', name: editingFeat?.name || nextExtrudeName(),
            solidId: baseSolid.id, sketchId: lastSketch?.id || null,
            depthMm, cutDepthMm, cutDirection, extentMode, color, operation: 'cutout', planeId, profilePts: pts, facePlane,
            revolveAxis, angleDeg, revolveReverse, ...sketchGeom,
          }
          setFeatures(prev => prev.map(f => f.id === editingId ? cutoutFeat : f))
          await rebuildDependentMirrors(updatedSolid)
        }

      } else if (revolveAxis) {
        // Revolve: build the solid via cadEngine.revolve using the axis line
        // detected in the sketch (see handleFinishSketch) plus the angle from
        // the popup. A revolve is always exactly one solid — no grouping
        // needed the way multi-letter text or multi-body cutouts are.
        const solidId = editingFeat?.solidId || Date.now()
        const revolveParams = {
          pts, planeId, direction, axis: revolveAxis, angleDeg, reverse: revolveReverse,
          circle: pts.circleMeta || null,
          ...(facePlane ? {
            normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
            origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
            uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
          } : {}),
        }
        const meshData = await cadEngine.revolve({ ...revolveParams, solidId })
        const group = replicadMeshToThree(meshData, color, solidId)
        const solid = { id:solidId, group, planeId, operation:'revolve', profilePts:pts, color, facePlane, revolveAxis, angleDeg, revolveReverse }
        setSolids(prev => [...prev.filter(s => s.id !== solidId), solid])
        const revolveFeat = {
          id: editingId || `revolve-${solidId}`,
          type: 'extrude', name: editingFeat?.name || nextExtrudeName(),
          solidId, sketchId: lastSketch?.id || null,
          angleDeg, color, operation: 'revolve', planeId, profilePts: pts, facePlane, revolveAxis, revolveReverse,
          ...sketchGeom,
        }
        if (editingId) {
          setFeatures(prev => prev.map(f => f.id === editingId ? revolveFeat : f))
        } else {
          setFeatures(prev => [...prev, revolveFeat])
        }
        await rebuildDependentMirrors(solid)

      } else if (textGroup) {
        // Whole-word text extrude: one solid per letter (each already carries
        // its own .holes from detectProfiles/resolveTextHoles), grouped under
        // one groupId so the feature tree shows one row. Re-editing the sketch
        // (editingFeat has a groupId) re-detects from scratch — the letters
        // may be entirely different now — so remove the old members first.
        const groupId = editingFeat?.groupId || `textgroup-${Date.now()}`
        if (editingFeat?.groupId) {
          const oldMembers = features.filter(f => f.groupId === editingFeat.groupId)
          const oldSolidIds = new Set(oldMembers.map(f => f.solidId))
          setSolids(prev => prev.filter(s => !oldSolidIds.has(s.id)))
        }

        const newFeats = []
        let letterIdx = -1
        for (const letterPts of textGroup) {
          letterIdx++
          const solidId = Date.now() + Math.random()
          const letterWorkerParams = {
            pts: letterPts, depthMm, planeId, direction,
            ...(facePlane ? {
              normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
              origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
              uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
              vAxis:  [facePlane.vAxis.x,  facePlane.vAxis.y,  facePlane.vAxis.z],
            } : {}),
          }
          let meshData
          try {
            meshData = await cadEngine.extrude({ ...letterWorkerParams, solidId })
          } catch (e) {
            console.error(`[textGroup] letter ${letterIdx} extrude failed, pts:`, letterPts.length, e)
            throw e
          }
          setSolids(prev => [...prev, {
            id: solidId, group: replicadMeshToThree(meshData, color, solidId), planeId, operation:'extrude',
            direction, depth: mmToPx(depthMm), depthMm, profilePts: letterPts, color, facePlane,
          }])
          // Punch each hole (the counter in O/A/8/etc.) all the way through the
          // letter regardless of its own extrude direction — generous depth,
          // symmetric direction, guarantees full penetration either way.
          let holeIdx = -1
          for (const holePts of (letterPts.holes || [])) {
            holeIdx++
            const holeCut = {
              pts: holePts, depthMm: depthMm*4+10, planeId, direction: 'both',
              ...(facePlane ? {
                normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
                origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
                uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
              } : {}),
            }
            try {
              meshData = await cadEngine.subtract({ baseSolidId: solidId, cut: holeCut, base: letterWorkerParams })
            } catch (e) {
              console.error(`[textGroup] letter ${letterIdx} hole ${holeIdx} cut failed, holePts:`, holePts.length, e)
              throw e
            }
            const group = replicadMeshToThree(meshData, color, solidId)
            setSolids(prev => prev.map(s => s.id === solidId ? { ...s, group } : s))
          }
          newFeats.push({
            id: `extrude-${solidId}`, type:'extrude', name: nextExtrudeName(), groupId,
            solidId, sketchId: lastSketch?.id || null,
            depthMm, direction, extentMode, color, operation:'extrude', planeId,
            profilePts: letterPts, facePlane, ...sketchGeom,
          })
        }

        if (editingFeat?.groupId) {
          setFeatures(prev => [...prev.filter(f => f.groupId !== editingFeat.groupId), ...newFeats])
        } else {
          setFeatures(prev => [...prev, ...newFeats])
        }

      } else if (editingId && editingFeat?.groupId) {
        // Extent-only edit (gear icon) of an existing grouped text extrude —
        // reapply the new depth/direction to every letter the group already
        // has, keeping each letter's own profile/holes fixed (no re-detection;
        // matches the grouped-cutout extent-edit behavior).
        const groupId = editingFeat.groupId
        const groupMembers = features.filter(f => f.groupId === groupId)
        const updatedById = new Map()
        for (const member of groupMembers) {
          const letterPts = member.profilePts
          const letterWorkerParams = {
            pts: letterPts, depthMm, planeId: member.planeId, direction,
            ...(member.facePlane ? {
              normal: [member.facePlane.normal.x, member.facePlane.normal.y, member.facePlane.normal.z],
              origin: [pxToMm(member.facePlane.origin.x), pxToMm(member.facePlane.origin.y), pxToMm(member.facePlane.origin.z)],
              uAxis:  [member.facePlane.uAxis.x,  member.facePlane.uAxis.y,  member.facePlane.uAxis.z],
              vAxis:  [member.facePlane.vAxis.x,  member.facePlane.vAxis.y,  member.facePlane.vAxis.z],
            } : {}),
          }
          let meshData = await cadEngine.extrude({ ...letterWorkerParams, solidId: member.solidId })
          for (const holePts of (letterPts.holes || [])) {
            const holeCut = {
              pts: holePts, depthMm: depthMm*4+10, planeId: member.planeId, direction: 'both',
              ...(member.facePlane ? {
                normal: [member.facePlane.normal.x, member.facePlane.normal.y, member.facePlane.normal.z],
                origin: [pxToMm(member.facePlane.origin.x), pxToMm(member.facePlane.origin.y), pxToMm(member.facePlane.origin.z)],
                uAxis:  [member.facePlane.uAxis.x,  member.facePlane.uAxis.y,  member.facePlane.uAxis.z],
              } : {}),
            }
            meshData = await cadEngine.subtract({ baseSolidId: member.solidId, cut: holeCut, base: letterWorkerParams })
          }
          const group = replicadMeshToThree(meshData, member.color, member.solidId)
          setSolids(prev => prev.map(s => s.id === member.solidId ? { ...s, group, direction, depth: mmToPx(depthMm), depthMm } : s))
          updatedById.set(member.id, { ...member, depthMm, direction, extentMode })
        }
        setFeatures(prev => prev.map(f => updatedById.get(f.id) || f))

      } else {
        // Run geometry in worker (OpenCascade WASM); solidId lets worker cache this shape
        const solidId = editingFeat?.solidId || Date.now()
        const meshData = await cadEngine.extrude({ ...workerParams, solidId })
        const group = replicadMeshToThree(meshData, color, solidId)
        const solid = { id:solidId, group, planeId, operation:'extrude', direction,
          depth:mmToPx(depthMm), depthMm, profilePts:pts, color, facePlane }
        // filter+push: old solid was removed when entering edit mode, map would find nothing
        setSolids(prev => [...prev.filter(s => s.id !== solidId), solid])
        const extrudeFeat = {
          id:        editingId || `extrude-${solidId}`,
          type:      'extrude',
          name:      editingFeat?.name || nextExtrudeName(),
          solidId,
          sketchId:  lastSketch?.id || null,
          depthMm,
          direction,
          extentMode,
          color,
          operation: 'extrude',
          planeId,
          profilePts: pts,
          facePlane,
          ...sketchGeom,
        }
        if (editingId) {
          setFeatures(prev => prev.map(f => f.id === editingId ? extrudeFeat : f))
        } else {
          setFeatures(prev => [...prev, extrudeFeat])
        }
        await rebuildDependentMirrors(solid)
      }

      commit(snapshot())

    } catch(err) {
      console.error('CAD operation failed:', err)
      if (isCutout) {
        // Show error banner — do NOT create a confusing red solid for failed cutouts
        setCadError(`Cutout failed: ${err.message || String(err)}`)
        setTimeout(() => setCadError(null), 8000)
        return
      }
      if (revolveAxis) {
        // Same reasoning as cutout — the linear-extrude fallback below would
        // silently build the wrong shape (a flat extrusion, not a revolve).
        setCadError(`Revolve failed: ${err.message || String(err)}`)
        setTimeout(() => setCadError(null), 8000)
        return
      }
      // Normal extrude: fall back to Three.js ExtrudeGeometry
      const group = buildSolid(pts, mmToPx(depthMm), planeId, color, facePlane)
      const solidId = editingFeat?.solidId || Date.now()
      const fbSolid = { id:solidId, group, planeId, operation:'extrude', direction,
        depth:mmToPx(depthMm), depthMm, profilePts:pts, color, facePlane }
      setSolids(prev => [...prev.filter(s => s.id !== solidId), fbSolid])
      const lastSketch2 = [...features].reverse().find(f=>f.type==='sketch')
      const fallbackFeat = {
        id: editingId || `extrude-${solidId}`, type:'extrude',
        name: editingFeat?.name || nextExtrudeName(),
        solidId, sketchId:lastSketch2?.id||null, depthMm, direction, extentMode, color,
        operation:'extrude', planeId, profilePts:pts, facePlane, ...sketchGeom,
      }
      if (editingId) {
        setFeatures(prev => prev.map(f => f.id === editingId ? fallbackFeat : f))
      } else {
        setFeatures(prev => [...prev, fallbackFeat])
      }
      commit(snapshot())
    }
  }

  // Re-enter an existing sketch for editing
  function handleEditSketch(featureId) {
    const feat = features.find(f=>f.id===featureId)
    if (!feat) return

    if (feat.type === 'extrude') {
      // Re-enter integrated sketch→extrude/cutout flow, replacing this feature on commit.
      // 'revolve' isn't a real toolbar button (auto-detected via the axis line),
      // so extrudeTool should only ever be 'extrude' or 'cutout'.
      const op = feat.operation || 'extrude'
      resetSelection(); resetDrawState()
      setExtrudeTool(op === 'revolve' ? 'extrude' : op); setExtrudeState(null); setExtrudeHandlePos(null)
      setCachedProfiles([])
      setEditingFeatureId(featureId)

      // Hide the solid being edited — park it in a ref so cancel can restore it.
      // Skip this for cutouts: feat.solidId there is the *base* solid (cutouts don't
      // own their own solid), so removing it would leave the commit step with no
      // base to cut from. The base solid stays visible (still showing its prior cuts)
      // while the profile is re-sketched.
      if (op !== 'cutout') {
        // A grouped (multi-letter text) feature has several solids — hide all
        // of them, not just this one, so re-sketching doesn't leave stale old
        // letters floating alongside the fresh sketch.
        const groupMembers = feat.groupId
          ? features.filter(f => f.groupId === feat.groupId)
          : [feat]
        const targetSolids = groupMembers
          .map(f => solids.find(s => s.id === f.solidId))
          .filter(Boolean)
        if (targetSolids.length) {
          hiddenEditSolidRef.current = targetSolids
          const idsToHide = new Set(targetSolids.map(s => s.id))
          setSolids(prev => prev.filter(s => !idsToHide.has(s.id)))
        }
      }

      const plane = feat.facePlane || feat.planeId
      enterSketch(plane, null, {
        lines:   feat.sketchLines   || [],
        circles: feat.sketchCircles || [],
        arcs:    feat.sketchArcs    || [],
        splines: feat.sketchSplines || [],
      })
      if (feat.facePlane) viewport3dRef.current?.snapToFace(feat.facePlane)
      else viewport3dRef.current?.snapToPlane(feat.planeId)
      return
    }

    // Standalone sketch
    const plane = feat.facePlane || feat.planeId
    enterSketch(plane, featureId)
    if (feat.facePlane) {
      viewport3dRef.current?.snapToFace(feat.facePlane)
    } else {
      viewport3dRef.current?.snapToPlane(feat.planeId)
    }
  }

  // Edit extrusion/cutout extent from the feature tree's gear icon — jumps directly
  // into the same interactive Step 3 (Set Depth) flow used at creation time, complete
  // with the live 3D arrows and extent/direction popup, since the profile itself isn't
  // changing (only depth/direction/extent-mode). Commits via the normal commitExtrude()
  // path (click in the viewport, or Enter/↵ in the popup) which already knows how to
  // handle both plain extrudes and cutouts.
  function handleEditExtent(featureId) {
    const feat = features.find(f=>f.id===featureId)
    if (!feat || feat.type !== 'extrude') return
    const op = feat.operation || 'extrude'
    const pts = feat.profilePts
    const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length
    const cy = pts.reduce((s,p)=>s+p.y,0)/pts.length
    const centroid = { x: cx, y: cy }

    // 'revolve' isn't a real toolbar button (it's auto-detected via the axis
    // line, not a separate tool) — extrudeTool should only ever be 'extrude'
    // or 'cutout', matching the two actual buttons.
    resetSelection(); resetDrawState()
    setExtrudeTool(op === 'revolve' ? 'extrude' : op)
    setEditingFeatureId(featureId)
    setExtrudeHandlePos(null)
    setCachedProfiles([{ planeId: feat.planeId, facePlane: feat.facePlane || null, pts, centroid }])

    // Hide the solid being edited — for cutouts, feat.solidId is the *base* solid
    // (still needed intact at commit time to re-cut from), so leave it visible.
    // A grouped (multi-letter text) feature has several solids — hide them all.
    if (op !== 'cutout') {
      const groupMembers = feat.groupId
        ? features.filter(f => f.groupId === feat.groupId)
        : [feat]
      const targetSolids = groupMembers
        .map(f => solids.find(s => s.id === f.solidId))
        .filter(Boolean)
      if (targetSolids.length) {
        hiddenEditSolidRef.current = targetSolids
        const idsToHide = new Set(targetSolids.map(s => s.id))
        setSolids(prev => prev.filter(s => !idsToHide.has(s.id)))
      }
    }

    const isCutoutFeat = op === 'cutout'
    const isRevolveFeat = op === 'revolve' || (isCutoutFeat && !!feat.revolveAxis)
    setExtrudeState({
      profiles:      [pts],
      planeId:       feat.planeId,
      facePlane:     feat.facePlane || null,
      pickedIdx:     0,
      revolveAxis:   isRevolveFeat ? feat.revolveAxis : null,
      revolveReverse: isRevolveFeat ? (feat.revolveReverse || false) : false,
      depthInput:    isRevolveFeat ? String(feat.angleDeg ?? 360) : String(feat.depthMm || 20),
      direction:     isCutoutFeat ? (feat.cutDirection || feat.direction || 'front') : (feat.direction || 'both'),
      // Fall back to inferring from cutDepthMm for cutouts saved before extentMode was persisted.
      extentMode:    feat.extentMode || (isCutoutFeat && feat.cutDepthMm >= 10000 ? 'through' : 'value'),
      armed:         true,
      centroid,
      sketchPlane:   feat.facePlane || feat.planeId,
      sketchLines:   feat.sketchLines   || [],
      sketchCircles: feat.sketchCircles || [],
      sketchArcs:    feat.sketchArcs    || [],
      sketchSplines: feat.sketchSplines || [],
    })

    viewport3dRef.current?.restoreSavedView()
  }

  // Legacy: depth-only edit (kept for undo compat)
  async function handleEditExtrudeDepth(featureId, newDepthMm) {
    const feat = features.find(f=>f.id===featureId)
    if (!feat) return
    const color = feat.color

    try {
      const workerParams = {
        pts: feat.profilePts,
        depthMm: newDepthMm,
        planeId: feat.planeId,
        circle: feat.profilePts.circleMeta || null,
        ...(feat.facePlane ? {
          normal: [feat.facePlane.normal.x, feat.facePlane.normal.y, feat.facePlane.normal.z],
          origin: [pxToMm(feat.facePlane.origin.x), pxToMm(feat.facePlane.origin.y), pxToMm(feat.facePlane.origin.z)],
          uAxis:  [feat.facePlane.uAxis.x,  feat.facePlane.uAxis.y,  feat.facePlane.uAxis.z],
          vAxis:  [feat.facePlane.vAxis.x,  feat.facePlane.vAxis.y,  feat.facePlane.vAxis.z],
        } : {}),
      }
      const meshData = await cadEngine.extrude(workerParams)
      const group = replicadMeshToThree(meshData, color, feat.solidId)
      setSolids(prev => prev.map(s =>
        s.id===feat.solidId ? {...s, depth:mmToPx(newDepthMm), depthMm:newDepthMm, group} : s
      ))
    } catch(err) {
      const group = buildSolid(feat.profilePts, mmToPx(newDepthMm), feat.planeId, color, feat.facePlane)
      setSolids(prev => prev.map(s =>
        s.id===feat.solidId ? {...s, depth:mmToPx(newDepthMm), depthMm:newDepthMm, group} : s
      ))
    }
    setFeatures(prev => prev.map(f =>
      f.id===featureId ? {...f, depthMm:newDepthMm} : f
    ))
  }

  // Toggle sketch visibility
  function handleToggleSketchVisible(featureId) {
    setFeatures(prev => prev.map(f =>
      f.id===featureId ? {...f, visible:!f.visible} : f
    ))
  }

  // Delete a feature
  async function handleDeleteFeature(featureId) {
    const feat = features.find(f => f.id === featureId)
    if (!feat) return

    if (feat.operation === 'join') {
      // Un-join: restore each member to its own independent, editable solid,
      // and auto-delete anything built on top of the joined result since —
      // confirmed with the user — a fillet/cutout/mirror targeting the fused
      // body doesn't have a well-defined meaning once it's un-merged. One
      // level deep only, same pragmatic depth limit as Mirror3D's own cascade.
      const dependentIds = features.filter(f => f.solidId === feat.solidId && f.id !== feat.id).map(f => f.id)
      const memberFeats = (feat.memberFeatureIds || []).map(id => features.find(f => f.id === id)).filter(Boolean)

      const restored = []
      for (const mf of memberFeats) {
        try {
          const meshData = await rebuildFeatureSolid(mf)
          const group = replicadMeshToThree(meshData, mf.color, mf.solidId)
          restored.push({ id: mf.solidId, group, operation: mf.operation, color: mf.color,
            planeId: mf.planeId, facePlane: mf.facePlane, profilePts: mf.profilePts,
            depthMm: mf.depthMm, direction: mf.direction,
            revolveAxis: mf.revolveAxis, angleDeg: mf.angleDeg, revolveReverse: mf.revolveReverse,
            sourceSolidId: mf.sourceSolidId, mirrorPlane: mf.mirrorPlane,
            normal: mf.normal, origin: mf.origin, uAxis: mf.uAxis, vAxis: mf.vAxis, profiles: mf.profiles, ruled: mf.ruled })
        } catch (err) {
          console.error('Un-join restore failed for', mf.id, err)
          setCadError(`Un-join failed to restore "${mf.name}": ${err.message || String(err)}`)
          setTimeout(() => setCadError(null), 6000)
        }
      }

      setSolids(prev => [...prev.filter(s => s.id !== feat.solidId), ...restored])
      setFeatures(prev => prev
        .filter(f => f.id !== featureId && !dependentIds.includes(f.id))
        .map(f => memberFeats.some(m => m.id === f.id) ? { ...f, joinedInto: undefined } : f))
      return
    }

    if (feat.operation === 'cutout') {
      // A grouped (multi-body) cutout deletes every member together — they're
      // one logical cut that happened to span several solids.
      const idsToDelete = feat.groupId
        ? features.filter(f => f.groupId === feat.groupId).map(f => f.id)
        : [featureId]

      for (const idToDelete of idsToDelete) {
        const thisFeat = features.find(f => f.id === idToDelete)
        const baseSolid = thisFeat && solids.find(s => s.id === thisFeat.solidId)
        if (!baseSolid) continue
        try {
          // Rebuild the base solid clean, replaying every other cutout/fillet
          // on it in order (skip the one being deleted — group members each
          // belong to a different solid, so at most one id applies here).
          const meshData = await rebuildSolidChain(baseSolid, { skipId: idToDelete })
          const group = replicadMeshToThree(meshData, baseSolid.color, baseSolid.id)
          setSolids(prev => prev.map(s => s.id === baseSolid.id ? { ...s, group } : s))
        } catch (err) {
          console.error('Cutout delete restore failed:', err)
        }
      }
      setFeatures(prev => prev.filter(f => !idsToDelete.includes(f.id)))
      return
    }

    if (feat.type === 'fillet') {
      const baseSolid = solids.find(s => s.id === feat.solidId)
      if (baseSolid) {
        try {
          const meshData = await rebuildSolidChain(baseSolid, { skipId: featureId })
          const group = replicadMeshToThree(meshData, baseSolid.color, baseSolid.id)
          setSolids(prev => prev.map(s => s.id === baseSolid.id ? { ...s, group } : s))
        } catch (err) {
          console.error('Fillet delete restore failed:', err)
        }
      }
      setFeatures(prev => prev.filter(f => f.id !== featureId))
      return
    }

    if (feat.type === 'extrude') {
      // A grouped (multi-letter text) extrude deletes every member together —
      // they're one logical "word" that happened to become several solids.
      if (feat.groupId) {
        const memberIds = features.filter(f => f.groupId === feat.groupId).map(f => f.id)
        const memberSolidIds = new Set(
          features.filter(f => f.groupId === feat.groupId).map(f => f.solidId)
        )
        setSolids(prev => prev.filter(s => !memberSolidIds.has(s.id)))
        setFeatures(prev => prev.filter(f => !memberIds.includes(f.id)))
        return
      }
      setSolids(prev => prev.filter(s => s.id !== feat.solidId))
    }
    setFeatures(prev => prev.filter(f => f.id !== featureId))
  }

  // Rename a feature
  function handleRenameFeature(featureId, newName) {
    setFeatures(prev => prev.map(f =>
      f.id===featureId ? {...f, name:newName} : f
    ))
  }

  // Export every top-level solid — each with its own cutouts already applied —
  // fused into ONE continuous body and saved as a single STL, for 3D printing.
  // This only fuses at export time; live editing keeps solids independent
  // (see project-scope-vision memory: multi-body assembly union was explicitly
  // ruled out as too complex for this tool's editing model).
  async function handleExportSTL() {
    if (solids.length === 0) {
      setCadError('Nothing to export — add at least one solid first.')
      setTimeout(() => setCadError(null), 5000)
      return
    }
    try {
      // Ordered ops (cutout + fillet interleaved, in feature-array order) —
      // only used by the worker's cold-rebuild fallback when a solid isn't
      // already cached in shapeStore (e.g. right after a fresh page load);
      // the common case just reuses the live cached shape directly.
      const solidsForExport = solids.map(solid => {
        const base = buildBaseWorkerParams(solid)
        const ops = features
          .filter(f => f.solidId === solid.id && (f.operation === 'cutout' || f.type === 'fillet'))
          .map(f => f.type === 'fillet'
            ? { type: 'fillet', radius: f.radius, edgePoints: f.edgePoints }
            : { type: 'cut', params: buildCutWorkerParams(f) })
        return { solidId: solid.id, base, ops }
      })

      const { stlBlob } = await cadEngine.exportSTL({ solids: solidsForExport })
      const url = URL.createObjectURL(stlBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'model.stl'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('STL export failed:', err)
      setCadError(`STL export failed: ${err.message || String(err)}`)
      setTimeout(() => setCadError(null), 8000)
    }
  }

  function handleMouseDown(e){
    if (e.button===1){e.preventDefault();isPanningRef.current=true;lastPanPosRef.current={x:e.clientX,y:e.clientY}}
    if (e.button===0){
      const worldPos=screenToWorld(e.clientX,e.clientY)
      const sx=e.clientX,sy=e.clientY   // screen coords for drag tracking

      // Select tool: check handle hit first, then start drag-window
      if (tool==='select'){
        const curLines   = selectLiveGeom?.lines   || lines
        const curCircles = selectLiveGeom?.circles || circles
        const curArcs    = selectLiveGeom?.arcs    || arcs
        const curSplines = selectLiveGeom?.splines || splines
        const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)
        if (bbox&&selection.length>0){
          const handles=getBBoxHandles(bbox)
          const hit=hitTestHandles(worldPos,handles,12/viewTransform.scale)
          if (hit){
            // Drag always starts on handle hit — anchor set by 3x3 grid widget separately
            selectDragHandleRef.current=hit
            selectDragStartRef.current=worldPos
            selectDragStartScreenRef.current={x:sx,y:sy}
            // Auto-set anchor to opposite of dragged handle
            const oppositeMap={tl:'br',tc:'bc',tr:'bl',ml:'mr',mc:'mc',mr:'ml',bl:'tr',bc:'tc',br:'tl'}
            setSelectDimAnchor(oppositeMap[hit]||'mc')
            selectBBoxRef.current=bbox
            selectSnapshotRef.current={lines,circles,arcs,splines}
            return
          }
        }
        // Start drag-window for select tool too
        dragStartRef.current={x:sx,y:sy}
        return
      }

      if (inSelPhase()){
        dragStartRef.current={x:sx,y:sy}
      }
    }
  }

  function handleMouseUp(e){
    if (e.button===1) isPanningRef.current=false
    if (e.button===0){
      // Commit handle drag
      if (tool==='select'&&selectDragHandleRef.current){
        if (!selectLiveGeom){
          selectDragHandleRef.current=null
          selectDragStartRef.current=null
          selectDragStartScreenRef.current=null
          return
        }
        commit(snapshot())
        setLines(selectLiveGeom.lines)
        setCircles(selectLiveGeom.circles)
        setArcs(selectLiveGeom.arcs)
        setSplines(selectLiveGeom.splines)
        setSelectLiveGeom(null)
        selectDragHandleRef.current=null
        selectDragStartRef.current=null
        selectDragStartScreenRef.current=null
        selectSnapshotRef.current=null
        selectBBoxRef.current=null
        wasDragRef.current=true
        return
      }
      if (dragStartRef.current){
        if (dragRectRef.current){
          if (tool==='select'){
            // Select tool drag window — builds selection
            const rect=dragRectRef.current
            const minX=Math.min(rect.x1,rect.x2),maxX=Math.max(rect.x1,rect.x2)
            const minY=Math.min(rect.y1,rect.y2),maxY=Math.max(rect.y1,rect.y2)
            const ptIn=(x,y)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY
            const hits=[]
            linesRef.current.forEach((l,idx)=>{if(ptIn(l.x1,l.y1)||ptIn(l.x2,l.y2))hits.push({kind:'line',idx})})
            circlesRef.current.forEach((c,idx)=>{if(ptIn(c.cx-c.r,c.cy)||ptIn(c.cx+c.r,c.cy)||ptIn(c.cx,c.cy-c.r)||ptIn(c.cx,c.cy+c.r))hits.push({kind:'circle',idx})})
            arcsRef.current.forEach((arc,idx)=>{if(ptIn(arc.cx,arc.cy))hits.push({kind:'arc',idx})})
            splinesRef.current.forEach((sp,idx)=>{if(sp.points.some(p=>ptIn(p.x,p.y)))hits.push({kind:'spline',idx})})
            setSelection(hits)
            wasDragRef.current=true
          } else {
            executeDragSelect(dragRectRef.current)
            wasDragRef.current=true
          }
        }
        dragStartRef.current=null
        dragRectRef.current=null
        setDragSelectRect(null)
      }
    }
  }

  function snapToGrid(pt){
    if (!gridSnap) return pt
    const gPx=mmToPx(gridSizeMm)
    return {x:Math.round(pt.x/gPx)*gPx, y:Math.round(pt.y/gPx)*gPx}
  }

  function handleClick(e){
    if (wasDragRef.current){wasDragRef.current=false;return}
    lastClickClientRef.current = {x: e.clientX, y: e.clientY}

    const rawWorld=screenToWorld(e.clientX,e.clientY)
    const raw=gridSnap?snapToGrid(rawWorld):rawWorld

    // ── Extrude / Cutout tool: only intercept outside sketch mode ──
    // Step 2 (sketch mode): clicks belong to sketch tools, not extrude handler
    if (extrudeTool && !sketchMode) {
      handleExtrudeClick(raw)
      return
    }

    if (tool==='fillet3d') {
      handleFillet3DClick(e)
      return
    }

    if (tool==='measure') {
      handleMeasureClick(e)
      return
    }

    if (tool==='trace'){
      setTraceInsertPt(raw);setTraceOpen(true);return
    }
    if (tool==='text'){
      setTextInsertPt(raw);setTextOpen(true);return
    }

    // ── Axis tool: 2-click line marking the revolve axis. Deliberately simple
    // (no tangent/perpendicular/dimension-lock) but still uses computeEnd —
    // the same H/V angle snap + alignment tracking the Line tool gets — so the
    // committed line always matches what the rubber-band preview showed.
    // Only one axis per sketch: placing a new one replaces the old.
    if (tool==='axis'){
      if (!startPoint){
        const geo=getGeoSnap(raw,snapLines,circles,arcs,null,false,splines,intersectionPts)
        setStartPoint(geo?{x:geo.x,y:geo.y}:raw)
        return
      }
      const comp=computeEnd(startPoint,raw,trackedPts)
      const endPt={x:comp.x,y:comp.y}
      if (Math.hypot(endPt.x-startPoint.x,endPt.y-startPoint.y)<2){ setStartPoint(null); return }
      commit(snapshot())
      setLines(p=>[
        ...p.filter(l=>l.style!=='axis'),
        {x1:startPoint.x,y1:startPoint.y,x2:endPt.x,y2:endPt.y,style:'axis',...planeTag()},
      ])
      setStartPoint(null)
      return
    }

    if (tool==='select'){
      const curLines   = selectLiveGeom?.lines   || lines
      const curCircles = selectLiveGeom?.circles || circles
      const curArcs    = selectLiveGeom?.arcs    || arcs
      const curSplines = selectLiveGeom?.splines || splines
      const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)

      // Hit-test 3x3 anchor grid widget — must match draw code exactly (cell=14/sc, spacing=cell*1.6)
      if (bbox&&selection.length>0){
        const sc=viewTransform.scale
        const gx=(bbox.x1+bbox.x2)/2
        const gy=bbox.y1-80/sc
        const cell=14/sc
        const hitR=cell*1.0   // generous hit radius around each dot
        const gridIds=[['tl','tc','tr'],['ml','mc','mr'],['bl','bc','br']]
        for (let ri=0;ri<3;ri++) for (let ci=0;ci<3;ci++){
          const px=gx+(ci-1)*cell*1.6,py=gy+(ri-1)*cell*1.6
          if (Math.hypot(raw.x-px,raw.y-py)<hitR){
            setSelectDimAnchor(gridIds[ri][ci])
            return
          }
        }
      }

      if (bbox){
        const handles=getBBoxHandles(bbox)
        if (hitTestHandles(raw,handles,12/viewTransform.scale)) return
      }
      if (selectHover){
        if (e.shiftKey){
          const already=selection.findIndex(s=>s.kind===selectHover.kind&&s.idx===selectHover.idx)
          if (already>=0) setSelection(p=>p.filter((_,i)=>i!==already))
          else setSelection(p=>[...p,selectHover])
        } else {
          const sole=selection.length===1&&selection[0].kind===selectHover.kind&&selection[0].idx===selectHover.idx
          setSelection(sole?[]:[selectHover])
          setSelectDimField(null);setSelectDimPending({});setSelectDimAnchor('mc')
        }
      } else if (!e.shiftKey){
        setSelection([])
      }
      return
    }

    if (tool==='dim'){
      const snap=getGeoSnap(raw,snapLines,circles,arcs,null,false,splines,intersectionPts)
      const pt=snap?{x:snap.x,y:snap.y}:raw

      // Circle / arc: one click places dim
      if (dimToolPreview?.kind==='diameter'){
        const p=dimToolPreview
        commit(snapshot())
        setDims(d=>[...d,{kind:'diameter',cx:p.cx,cy:p.cy,r:p.r,angle:p.angle,text:''}])
        resetDim();return
      }
      if (dimToolPreview?.kind==='radius'){
        const p=dimToolPreview
        commit(snapshot())
        setDims(d=>[...d,{kind:'radius',cx:p.cx,cy:p.cy,r:p.r,angle:p.angle,text:''}])
        resetDim();return
      }
      // Linear: click 1=p1, 2=p2, 3=offset
      if (dimToolStep===0){
        setDimToolPts([pt]);setDimToolStep(1)
      } else if (dimToolStep===1){
        setDimToolPts([dimToolPts[0],pt]);setDimToolStep(2)
      } else if (dimToolStep===2&&dimToolPreview){
        commit(snapshot())
        setDims(d=>[...d,{...dimToolPreview,text:''}])
        resetDim()
      }
      return
    }

    if (tool==='join'){
      if (!joinFirstPt){
        // First click — pick the free endpoint to move
        if (joinHover) setJoinFirstPt(joinHover)
      } else {
        // Second click — move free endpoint to snap/click position
        const snap=getGeoSnap(raw,snapLines,circles,arcs,{x:joinFirstPt.x,y:joinFirstPt.y},false,splines,intersectionPts)
        const targetPt=snap?{x:snap.x,y:snap.y}:raw
        commit(snapshot())
        if (joinFirstPt.kind==='line'){
          setLines(p=>p.map((l,i)=>{
            if(i!==joinFirstPt.lineIdx) return l
            if(joinFirstPt.end==='x1y1') return {...l,x1:targetPt.x,y1:targetPt.y}
            return {...l,x2:targetPt.x,y2:targetPt.y}
          }))
        } else if (joinFirstPt.kind==='spline'){
          setSplines(p=>p.map((sp,i)=>{
            if(i!==joinFirstPt.splineIdx) return sp
            const pts=[...sp.points]
            if(joinFirstPt.end==='first') pts[0]={x:targetPt.x,y:targetPt.y}
            else pts[pts.length-1]={x:targetPt.x,y:targetPt.y}
            return {...sp,points:pts}
          }))
        }
        setJoinFirstPt(null)  // ready for next join, stay in join tool
      }
      return
    }

    if (tool==='trim'){
      if (e.detail > 1) return
      // deletewhole — no intersections, delete entire entity
      if (trimPreview?.deletewhole){
        commit(snapshot())
        if (trimPreview.kind==='line')   setLines(p=>p.filter((_,i)=>i!==trimPreview.idx))
        if (trimPreview.kind==='circle') setCircles(p=>p.filter((_,i)=>i!==trimPreview.idx))
        if (trimPreview.kind==='arc')    setArcs(p=>p.filter((_,i)=>i!==trimPreview.idx))
        if (trimPreview.kind==='spline') setSplines(p=>p.filter((_,i)=>i!==trimPreview.idx))
        setTrimPreview(null);return
      }
      // Normal trim — Ignore second click of a double-click — prevents trim executing twice
      if (trimPreview){
        if (trimPreview.kind==='spline'){
          if (trimPreview.highlightPts&&trimPreview.highlightPts.length>=2){
            // Proper region trim
            commit(snapshot())
            setSplines(performSplineTrim(trimPreview,splines))
          } else {
            // No intersections — delete whole spline
            commit(snapshot());setSplines(p=>p.filter((_,i)=>i!==trimPreview.idx))
          }
        } else {
          commit(snapshot());const r=performTrim(trimPreview,lines,circles,arcs);setLines(r.lines);setCircles(r.circles);setArcs(r.arcs)
        }
      }
      return
    }
    if (tool==='delete'){
      if (deletePreview){
        commit(snapshot())
        if (deletePreview.kind==='line') setLines(p=>p.filter((_,i)=>i!==deletePreview.idx))
        if (deletePreview.kind==='circle') setCircles(p=>p.filter((_,i)=>i!==deletePreview.idx))
        if (deletePreview.kind==='arc') setArcs(p=>p.filter((_,i)=>i!==deletePreview.idx))
        if (deletePreview.kind==='spline') setSplines(p=>p.filter((_,i)=>i!==deletePreview.idx))
        if (deletePreview.kind==='dim') setDims(p=>p.filter((_,i)=>i!==deletePreview.idx))
      }
      return
    }

    if (tool==='spline'){
      if (e.detail > 1) return  // ignore second click of double-click — handled by handleDoubleClick
      const geo=getGeoSnap(raw,snapLines,circles,arcs,splinePoints.length?splinePoints[splinePoints.length-1]:null,false,splines,intersectionPts)
      const pt=geo&&geo.type!=='tan'&&geo.type!=='oncircle'?{x:geo.x,y:geo.y}:raw
      const newPts=[...splinePoints,pt]
      splinePointsRef.current=newPts
      setSplinePoints(newPts)
      return
    }

    if (tool==='extend'){
      if (extendPreview){
        commit(snapshot())
        setLines(p=>p.map((l,i)=>i===extendPreview.idx?extendPreview.newLine:l))
      }
      return
    }

    if (tool==='offset'){
      if (!offsetEntity){
        // First click — lock the hovered entity
        const hit=nearestOffsetEntity(raw,lines,circles,arcs,splines)
        if (hit) setOffsetEntity(hit)
      } else {
        // Second click — place the offset
        if (!offsetPreview) return
        commit(snapshot())
        // Same plane/facePlane tagging every other commit needs — see the
        // matching comment on the Mirror tool's commit, same bug class.
        const ofPt = planeTag()
        if (offsetPreview.kind==='line')   setLines(p=>[...p,{x1:offsetPreview.x1,y1:offsetPreview.y1,x2:offsetPreview.x2,y2:offsetPreview.y2,...(offsetPreview.style?{style:offsetPreview.style}:{}),...ofPt}])
        if (offsetPreview.kind==='circle') setCircles(p=>[...p,{cx:offsetPreview.cx,cy:offsetPreview.cy,r:offsetPreview.r,...(offsetPreview.style?{style:offsetPreview.style}:{}),...ofPt}])
        if (offsetPreview.kind==='arc')    setArcs(p=>[...p,{cx:offsetPreview.cx,cy:offsetPreview.cy,r:offsetPreview.r,startAngle:offsetPreview.startAngle,endAngle:offsetPreview.endAngle,...(offsetPreview.style?{style:offsetPreview.style}:{}),...ofPt}])
        if (offsetPreview.kind==='spline') setSplines(p=>[...p,{points:offsetPreview.points,closed:offsetPreview.closed,polyline:offsetPreview.polyline,...(offsetPreview.style?{style:offsetPreview.style}:{}),...ofPt}])
        resetOffset()
      }
      return
    }

    if (tool==='mirror'){
      if (!mirrorAccepted){
        const hit=nearestMirrorEntity(raw,lines,circles,arcs,splines);if(!hit)return
        const already=mirrorSel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
        if (already>=0) setMirrorSel(p=>p.filter((_,i)=>i!==already))
        else setMirrorSel(p=>[...p,hit])
      } else {
        if (!mirrorP1){
          const geo=getGeoSnap(raw,snapLines,circles,arcs,null,false,splines,intersectionPts)
          const pt=geo&&geo.type!=='tan'&&geo.type!=='oncircle'?{x:geo.x,y:geo.y}:raw
          setMirrorP1(pt)
          // Seed tracking from first mirror point
          setTrackedPts([]);trackedPtsRef.current=[]
        } else {
          if (!mirrorPreview) return
          const hSnap=getGeoSnap(raw,snapLines,circles,arcs,mirrorP1,false,splines,intersectionPts)
          let endPt
          if (hSnap&&hSnap.type!=='tan'&&hSnap.type!=='oncircle'){
            endPt={x:hSnap.x,y:hSnap.y}
          } else {
            const{snapped}=applyTracking(raw,trackedPts)
            const angled=getAngleSnap(mirrorP1,snapped)
            endPt={x:angled.x,y:angled.y}
          }
          const finalMirror=buildMirror(mirrorSel,lines,circles,arcs,splines,mirrorP1.x,mirrorP1.y,endPt.x,endPt.y)
          // Mirrored entities need the same plane/facePlane tag as everything
          // else committed in this sketch — without it they silently default
          // to XY (via the pervasive `entity.plane || 'XY'` fallback used for
          // rendering), so on any non-XY or face-plane sketch they're invisible
          // (filtered out of the current plane's render pass) even though
          // hit-testing/snapping still finds them (those read the raw arrays,
          // no plane filter). Same bug class fixed once before for text import.
          const pt = planeTag()
          commit(snapshot())
          setLines(p=>[...p,...finalMirror.newLines.map(l=>({...l,...pt}))])
          setCircles(p=>[...p,...finalMirror.newCircles.map(c=>({...c,...pt}))])
          setArcs(p=>[...p,...finalMirror.newArcs.map(a=>({...a,...pt}))])
          setSplines(p=>[...p,...finalMirror.newSplines.map(sp=>({...sp,...pt}))])
          resetMirror()
        }
      }
      return
    }

    if (tool==='center'){
      const hit=nearestMirrorEntity(raw,lines,circles,arcs,splines);if(!hit)return
      const already=centerSel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
      if (already>=0) setCenterSel(p=>p.filter((_,i)=>i!==already))
      else setCenterSel(p=>[...p,hit])
      return
    }

    if (tool==='movecopy'){
      if (!moveCopyAccepted){
        const hit=nearestMoveCopyEntity(raw,lines,circles,arcs,splines);if(!hit)return
        const already=moveCopySel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
        if (already>=0) setMoveCopySel(p=>p.filter((_,i)=>i!==already))
        else setMoveCopySel(p=>[...p,hit])
      } else if (!startPoint){
        const geo=getGeoSnap(raw,snapLines,circles,arcs,null,false,splines,intersectionPts)
        setStartPoint(geo?{x:geo.x,y:geo.y}:raw)
        setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
        setTrackedPts([]);trackedPtsRef.current=[]
      } else {
        const end=computeEnd(startPoint,raw,trackedPts)
        const dx=end.x-startPoint.x,dy=end.y-startPoint.y
        const count=Math.max(1,parseInt(moveCopyCountInput)||1)
        commit(snapshot())
        const copies=buildCopies(moveCopySel,lines,circles,arcs,splines,dx,dy,count)
        // Same plane/facePlane tagging every other commit needs — see the
        // matching comment on the Mirror tool's commit, same bug class.
        const mcPt = planeTag()
        const mcLines=copies.newLines.map(l=>({...l,...mcPt}))
        const mcCircles=copies.newCircles.map(c=>({...c,...mcPt}))
        const mcArcs=copies.newArcs.map(a=>({...a,...mcPt}))
        const mcSplines=copies.newSplines.map(sp=>({...sp,...mcPt}))
        if (moveCopyMode==='move'){const pruned=removeSelected(moveCopySel,lines,circles,arcs,splines);setLines([...pruned.lines,...mcLines]);setCircles([...pruned.circles,...mcCircles]);setArcs([...pruned.arcs,...mcArcs]);setSplines([...pruned.splines,...mcSplines])}
        else{setLines(p=>[...p,...mcLines]);setCircles(p=>[...p,...mcCircles]);setArcs(p=>[...p,...mcArcs]);setSplines(p=>[...p,...mcSplines])}
        resetMoveCopy();resetDrawState()
      }
      return
    }

    if (tool==='rotatecopy'){
      if (!rotateCopyAccepted){
        const hit=nearestRotateCopyEntity(raw,lines,circles,arcs,splines);if(!hit)return
        const already=rotateCopySel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
        if (already>=0) setRotateCopySel(p=>p.filter((_,i)=>i!==already))
        else setRotateCopySel(p=>[...p,hit])
      } else if (!startPoint){
        const geo=getGeoSnap(raw,snapLines,circles,arcs,null,false,splines,intersectionPts)
        setStartPoint(geo?{x:geo.x,y:geo.y}:raw)
        setAngleInput('');setAngleLocked(false);setTrackedPts([]);trackedPtsRef.current=[]
      } else {
        const dx=raw.x-startPoint.x,dy=raw.y-startPoint.y
        let angleDeg=angleLocked?(parseFloat(angleInput)||0):(Math.atan2(dy,dx)*180/Math.PI)
        if (!angleLocked&&angleDeg<0) angleDeg+=360
        const count=Math.max(1,parseInt(rotateCopyCountInput)||1)
        commit(snapshot())
        const copies=buildRotatedCopies(rotateCopySel,lines,circles,arcs,splines,startPoint.x,startPoint.y,angleDeg,count)
        // Same plane/facePlane tagging every other commit needs — see the
        // matching comment on the Mirror tool's commit, same bug class.
        const rcPt = planeTag()
        const rcLines=copies.newLines.map(l=>({...l,...rcPt}))
        const rcCircles=copies.newCircles.map(c=>({...c,...rcPt}))
        const rcArcs=copies.newArcs.map(a=>({...a,...rcPt}))
        const rcSplines=copies.newSplines.map(sp=>({...sp,...rcPt}))
        if (rotateCopyMode==='rotate'){const pruned=removeSelected(rotateCopySel,lines,circles,arcs,splines);setLines([...pruned.lines,...rcLines]);setCircles([...pruned.circles,...rcCircles]);setArcs([...pruned.arcs,...rcArcs]);setSplines([...pruned.splines,...rcSplines])}
        else{setLines(p=>[...p,...rcLines]);setCircles(p=>[...p,...rcCircles]);setArcs(p=>[...p,...rcArcs]);setSplines(p=>[...p,...rcSplines])}
        resetRotateCopy();resetDrawState()
      }
      return
    }

    if (tool==='resize'){
      if (!resizeAccepted){
        const hit=nearestScaleEntity(raw,lines,circles,arcs,splines);if(!hit)return
        const already=resizeSel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
        if (already>=0) setResizeSel(p=>p.filter((_,i)=>i!==already))
        else setResizeSel(p=>[...p,hit])
      } else {
        const s=parseFloat(resizeScaleInput);if(!s||s<=0)return
        const geo=getGeoSnap(raw,snapLines,circles,arcs,null,false,splines,intersectionPts)
        const anchor=geo?{x:geo.x,y:geo.y}:raw
        commit(snapshot())
        const scaled=buildScaled(resizeSel,lines,circles,arcs,splines,anchor.x,anchor.y,s)
        const pruned=removeSelected(resizeSel,lines,circles,arcs,splines)
        // Same plane/facePlane tagging every other commit needs — see the
        // matching comment on the Mirror tool's commit, same bug class.
        const rsPt = planeTag()
        setLines([...pruned.lines,...scaled.newLines.map(l=>({...l,...rsPt}))])
        setCircles([...pruned.circles,...scaled.newCircles.map(c=>({...c,...rsPt}))])
        setArcs([...pruned.arcs,...scaled.newArcs.map(a=>({...a,...rsPt}))])
        setSplines([...pruned.splines,...scaled.newSplines.map(sp=>({...sp,...rsPt}))])
        resetResize()
      }
      return
    }

    if (tool==='fillet'){
      if (!filletAccepted){
        const hit=nearestFilletLine(raw,lines)
        if (!hit) return
        const already=filletSel.findIndex(s=>s.idx===hit.idx)
        if (already>=0) setFilletSel(p=>p.filter((_,i)=>i!==already))
        else if (filletSel.length<2) setFilletSel(p=>[...p,hit])
      } else {
        // Click applies the fillet (same as Enter)
        if (!filletPreview||filletPreview.tooLarge) return
        const{newL1,newL2,arc}=filletPreview
        // Carry style from source lines through fillet
        const s1=lines[filletSel[0].idx]?.style
        const s2=lines[filletSel[1].idx]?.style
        commit(snapshot())
        // Same plane/facePlane tagging every other commit needs — see the
        // matching comment on the Mirror tool's commit, same bug class.
        // trimLine()/the new arc in filletMath.js drop it just like style did
        // (hence the existing manual style patch-back below).
        const flPt = planeTag()
        setLines(p=>[...p.filter((_,i)=>!filletSel.some(s=>s.idx===i)),
          {...newL1,...(s1?{style:s1}:{}),...flPt},
          {...newL2,...(s2?{style:s2}:{}),...flPt}])
        setArcs(p=>[...p,{...arc,...flPt}])
        resetFillet()
      }
      return
    }

    if (tool==='line'){
      if (!startPoint&&!deferredTangent){
        if (pKeyDown) {
          // PERP: start at foot on nearest line, store its index to exclude later
          const hit=findNearestLineForPerp(raw,lines,null)
          const pt=hit?hit.foot:raw
          setPerpSourceLineIdx(hit?hit.idx:null)
          setStartPoint({x:pt.x,y:pt.y})
          setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
          setTrackedPts([]);trackedPtsRef.current=[]
          return
        }
        const geo=getGeoSnap(raw,snapLines,circles,arcs,null,tKeyDown,splines,intersectionPts)
        if (geo?.type==='tan'){
          const circData=geo.circleIdx!==undefined?{...circles[geo.circleIdx],circleIdx:geo.circleIdx}:{cx:geo.cx,cy:geo.cy,r:geo.r,arcIdx:geo.arcIdx}
          setDeferredTangent(circData);setStartPoint({x:geo.x,y:geo.y})
        } else setStartPoint(geo?{x:geo.x,y:geo.y}:raw)
        setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
        setTrackedPts([]);trackedPtsRef.current=[]
      } else if (deferredTangent){
        const dc=deferredTangent,geo=getGeoSnap(raw,snapLines,circles,arcs,null,tKeyDown,splines,intersectionPts)
        if (geo?.type==='tan'&&geo.circleIdx!==undefined&&dc.circleIdx!==undefined&&geo.circleIdx!==dc.circleIdx){
          const pairs=getExternalTangentPairs(dc,circles[geo.circleIdx])
          const best=pairs.length?pairs.reduce((a,b)=>Math.hypot(a.t1.x-startPoint.x,a.t1.y-startPoint.y)<Math.hypot(b.t1.x-startPoint.x,b.t1.y-startPoint.y)?a:b):null
          if(best){commit(snapshot());setLines(p=>[...p,{x1:best.t1.x,y1:best.t1.y,x2:best.t2.x,y2:best.t2.y,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])}
        } else {
          const endPt=(geo&&geo.type!=='tan')?{x:geo.x,y:geo.y}:raw
          const tanPts=getTanPtsOnCircle(endPt.x,endPt.y,dc.cx,dc.cy,dc.r)
          const best=nearestPt(tanPts,startPoint)
          if(best){commit(snapshot());setLines(p=>[...p,{x1:best.x,y1:best.y,x2:endPt.x,y2:endPt.y,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])}
        }
        resetDrawState()
      } else {
        if (pKeyDown) {
          let endPt
          if (perpSourceLineIdx!==null && lines[perpSourceLineIdx]) {
            // FROM mode: direction locked perpendicular to source line
            const sl=lines[perpSourceLineIdx]
            const dx=sl.x2-sl.x1, dy=sl.y2-sl.y1, len=Math.hypot(dx,dy)
            if (len>1e-10) {
              const px=-dy/len, py=dx/len
              const t=(raw.x-startPoint.x)*px+(raw.y-startPoint.y)*py
              endPt={x:startPoint.x+t*px, y:startPoint.y+t*py}
            } else { endPt=raw }
          } else {
            // TO mode: snap to perp foot on nearest line
            const hit=findNearestLineForPerp(raw,lines,perpSourceLineIdx)
            endPt=hit
              ? calcPerpFoot(startPoint.x,startPoint.y,hit.line.x1,hit.line.y1,hit.line.x2,hit.line.y2,true)
              : raw
          }
          commit(snapshot());setLines(p=>[...p,{x1:startPoint.x,y1:startPoint.y,x2:endPt.x,y2:endPt.y,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])
          resetDrawState()
          return
        }
        const geo=getGeoSnap(raw,snapLines,circles,arcs,startPoint,tKeyDown,splines,intersectionPts)
        if (geo?.type==='tan'){
          const c=geo.circleIdx!==undefined?circles[geo.circleIdx]:{cx:geo.cx,cy:geo.cy,r:geo.r}
          const tanPts=getTanPtsOnCircle(startPoint.x,startPoint.y,c.cx,c.cy,c.r)
          const best=nearestPt(tanPts,raw)
          if(best){commit(snapshot());setLines(p=>[...p,{x1:startPoint.x,y1:startPoint.y,x2:best.x,y2:best.y,...planeTag()}])}
        } else {
          const end=computeEnd(startPoint,raw,trackedPts)
          commit(snapshot());setLines(p=>[...p,{x1:startPoint.x,y1:startPoint.y,x2:end.x,y2:end.y,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])
        }
        resetDrawState()
      }
    } else if (tool==='circle'){
      if (!circleCenter){
        const geo=getGeoSnap(raw,snapLines,circles,arcs,null,false,splines,intersectionPts)
        setCircleCenter(geo?{x:geo.x,y:geo.y}:raw)
        setDimInput('');setDimLocked(false);setTrackedPts([]);trackedPtsRef.current=[]
      } else {
        let r
        if (dimLocked){
          r=mmToPx(parseFloat(dimInput)||1)
        } else {
          const geo=getGeoSnap(raw,snapLines,circles,arcs,circleCenter,tKeyDown,splines,intersectionPts)
          if (tKeyDown&&geo?.type==='tan'){
            // Tangent to circle/arc
            const tc=geo.circleIdx!==undefined?circles[geo.circleIdx]:{cx:geo.cx,cy:geo.cy,r:geo.r}
            const d=Math.hypot(circleCenter.x-tc.cx,circleCenter.y-tc.cy)
            r=Math.max(1,Math.abs(d-tc.r))
          } else if (tKeyDown){
            // Tangent to nearest line — perp distance from centre to line
            const ld=12/zoomRef.scale
            let bestLineDist=ld+1,bestLine=null
            lines.forEach(l=>{
              const dx=l.x2-l.x1,dy=l.y2-l.y1,len=Math.hypot(dx,dy)
              if(len<1e-10)return
              const d=Math.abs((raw.x-l.x1)*dy-(raw.y-l.y1)*dx)/len
              if(d<bestLineDist){bestLineDist=d;bestLine=l}
            })
            if(bestLine){
              const{x1,y1,x2,y2}=bestLine
              const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)
              r=Math.max(1,Math.abs((circleCenter.x-x1)*dy-(circleCenter.y-y1)*dx)/len)
            } else {
              const edgePt=geo&&geo.type!=='tan'?{x:geo.x,y:geo.y}:raw
              r=Math.max(1,Math.hypot(edgePt.x-circleCenter.x,edgePt.y-circleCenter.y))
            }
          } else {
            const edgePt=geo&&geo.type!=='tan'?{x:geo.x,y:geo.y}:raw
            r=Math.max(1,Math.hypot(edgePt.x-circleCenter.x,edgePt.y-circleCenter.y))
          }
        }
        commit(snapshot());setCircles(p=>[...p,{cx:circleCenter.x,cy:circleCenter.y,r,...(drawStyle?{style:drawStyle}:{}),...planeTag()}]);resetDrawState()
      }
    }
  }

  function finishSpline(pts){
    if (!pts||pts.length<2) return
    commit(snapshot())
    setSplines(p=>[...p,{points:pts,closed:splineClosed,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])
    resetSpline()
  }

  function handleDoubleClick(e){
    if (tool!=='spline') return
    e.preventDefault()
    // Get current points directly from ref to avoid StrictMode double-call issue
    const pts=splinePointsRef?.current||splinePoints
    const trimmed=pts.length>1?pts.slice(0,-1):pts
    if (trimmed.length>=2){
      commit(snapshot())
      setSplines(p=>[...p,{points:trimmed,closed:splineClosed,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])
    }
    resetSpline()
  }

  function handleContextMenu(e){
    e.preventDefault()
    if (tool==='spline'&&splinePoints.length>=2){finishSpline(splinePoints);return}
    if (tool==='mirror'&&!mirrorAccepted&&mirrorSel.length>0) setMirrorAccepted(true)
    if (tool==='movecopy'&&!moveCopyAccepted&&moveCopySel.length>0) setMoveCopyAccepted(true)
    if (tool==='rotatecopy'&&!rotateCopyAccepted&&rotateCopySel.length>0) setRotateCopyAccepted(true)
    if (tool==='resize'&&!resizeAccepted&&resizeSel.length>0) setResizeAccepted(true)
    if (tool==='fillet'&&!filletAccepted&&filletSel.length===2) setFilletAccepted(true)
    if (tool==='center'&&centerSel.length>0) commitCenter()
    if (tool==='join3d'&&joinSel.length>=2) commitJoin()
  }

  function handleMouseMove(e){
    // Middle mouse pan is now handled by OrbitControls inside Viewport3D.
    // We just need world coordinates for tool logic.
    const sx=e.clientX,sy=e.clientY

    // Fillet: raycasts solid edges directly (no sketch-plane projection involved)
    if (tool==='fillet3d') { handleFillet3DHover(e); return }
    if (tool==='measure') { handleMeasureHover(e); return }

    const worldPos=screenToWorld(sx,sy)

    // Handle drag for select tool
    if (tool==='select'&&selectDragHandleRef.current&&selectDragStartRef.current&&(e.buttons&1)){
      const xform=computeHandleTransform(selectDragHandleRef.current,selectBBoxRef.current,selectDragStartRef.current,worldPos)
      const snap=selectSnapshotRef.current
      const result=applySelectionTransform(selection,snap.lines,snap.circles,snap.arcs,snap.splines,xform.anchor,xform.sx,xform.sy,xform.dx,xform.dy)
      setSelectLiveGeom(result)
      setMousePos(worldPos)
      return
    }

    // Drag window select tracking
    if (dragStartRef.current&&(e.buttons&1)){
      const dx=sx-dragStartRef.current.x,dy=sy-dragStartRef.current.y
      if (Math.hypot(dx,dy)>8){
        const p1=screenToWorld(dragStartRef.current.x,dragStartRef.current.y)
        const p2=screenToWorld(sx,sy)
        const r={x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y}
        dragRectRef.current=r
        setDragSelectRect(r)
      }
    }

    // Apply grid snap to mouse position during drawing
    const snappedWorld=(gridSnap&&(tool==='line'||tool==='circle'||tool==='spline'||tool==='dim'||tool==='axis'))
      ? snapToGrid(worldPos)
      : worldPos
    setMousePos(snappedWorld);updateTracking(snappedWorld)
  }

  function handleKeyDown(e){
    if ((e.key==='t'||e.key==='T')&&!e.ctrlKey&&!e.shiftKey&&(tool==='line'||tool==='circle')){setTKeyDown(p=>!p);return}
    if ((e.key==='p'||e.key==='P')&&!e.ctrlKey&&!e.shiftKey&&tool==='line'){setPKeyDown(p=>!p);return}
    if ((e.key==='d'||e.key==='D')&&!e.ctrlKey&&!e.shiftKey){
      if (tool==='select'&&selection.length>0){
        // Toggle construction on selected entities
        const newStyle=(lines[selection.find(s=>s.kind==='line')?.idx]?.style==='construction')?null:'construction'
        commit(snapshot())
        setLines(p=>p.map((l,i)=>selection.some(s=>s.kind==='line'&&s.idx===i)?{...l,style:newStyle||undefined}:l))
        setCircles(p=>p.map((c,i)=>selection.some(s=>s.kind==='circle'&&s.idx===i)?{...c,style:newStyle||undefined}:c))
        setArcs(p=>p.map((a,i)=>selection.some(s=>s.kind==='arc'&&s.idx===i)?{...a,style:newStyle||undefined}:a))
        setSplines(p=>p.map((sp,i)=>selection.some(s=>s.kind==='spline'&&s.idx===i)?{...sp,style:newStyle||undefined}:sp))
        return
      }
      else {setDrawStyle(p=>p==='construction'?null:'construction');return}
      }
    if ((e.key==='o'||e.key==='O')&&!e.ctrlKey&&!e.shiftKey&&tool==='select'&&selection.length>0){
      // Center the selection's bounding box on the sketch origin — a
      // prerequisite for accurate plane-mirroring later (mirroring only
      // produces a clean, gapless result if the profile's centerline
      // actually lands on the mirror plane's line, i.e. sketch (0,0)).
      const bbox = selectionBBox(selection, lines, circles, arcs, splines)
      if (bbox) {
        const cx = (bbox.x1+bbox.x2)/2, cy = (bbox.y1+bbox.y2)/2
        commit(snapshot())
        const result = applySelectionTransform(selection, lines, circles, arcs, splines, {x:0,y:0}, 1, 1, -cx, -cy)
        setLines(result.lines); setCircles(result.circles); setArcs(result.arcs); setSplines(result.splines)
      }
      return
    }
    if (e.ctrlKey&&e.key==='z'){e.preventDefault();undo(snapshot(),restore);return}
    if (e.ctrlKey&&e.key==='y'){e.preventDefault();redo(snapshot(),restore);return}
    if (e.ctrlKey&&e.key==='s'){e.preventDefault();saveJSON(lines,circles,arcs,splines,dims);return}
    if ((e.key==='f'||e.key==='F')&&!e.ctrlKey){zoomToFit();return}
    // Escape in sketch mode: cancel whatever 2D tool is mid-interaction only
    // (an in-progress line/circle/offset/etc.) — it no longer exits the sketch
    // or cancels the feature. That's now the dedicated Cancel button next to
    // Finish Sketch (see cancelFeature), so Escape is safe to hit repeatedly
    // while drawing without losing the whole Cut/Extrude/Loft in progress.
    if (e.key==='Escape'&&sketchMode){
      resetDrawState();resetSpline();resetOffset();resetMirror();resetCenter();resetMoveCopy()
      resetRotateCopy();resetResize();resetFillet();resetText();resetSelection()
      resetJoin();resetDim()
      return
    }
    if (e.key==='Escape'&&extrudeTool){
      // Cancel from step 3 (depth) — restore any hidden solid
      if (hiddenEditSolidRef.current) {
        setSolids(prev => [...prev, ...hiddenEditSolidRef.current])
        hiddenEditSolidRef.current = null
      }
      setExtrudeState(null); setExtrudeTool(null); setEditingFeatureId(null)
      setLines([]); setCircles([]); setArcs([]); setSplines([])
      return
    }
    if (extrudeState) { handleExtrudeDepthKey(e); return }

    // Step 1 (face/plane pick) of extrude/cutout: Tab steps the green
    // bottom-edge preview around the hovered face's boundary instead of only
    // following the cursor — for edges the mouse can't easily get near. See
    // Viewport3D.jsx's cycleFaceBottomEdge; Shift+Tab goes the other way.
    if (e.key==='Tab' && extrudeTool && !extrudeState && !sketchMode) {
      e.preventDefault()
      viewport3dRef.current?.cycleFaceBottomEdge(e.shiftKey ? -1 : 1)
      return
    }

    if ((e.key==='Enter'||e.key==='Tab')&&tool==='fillet3d'&&!fillet3dAccepted&&fillet3dSel.length>0){
      // Promote from "still picking edges" to "radius popup" — mirrors the
      // 2D Fillet tool's Tab-to-accept, generalized from exactly 2 to 1+.
      e.preventDefault()
      setFillet3dAccepted(true)
      return
    }
    if (e.key==='Escape'&&tool==='fillet3d'){
      // Cancel the current selection first (back to picking phase, or clear
      // out of the radius popup); a second Escape (nothing selected) leaves
      // the tool entirely.
      if (fillet3dAccepted || fillet3dSel.length>0) { resetFillet3D(); return }
      resetFillet3D(); setTool('select'); return
    }
    if (e.key==='Escape'&&tool==='mirror3d'){
      // First Escape backs step 2 (plane pick) out to step 1 (still picking
      // a source feature); a second Escape (nothing picked yet) leaves the tool.
      if (mirror3dSourceFeatureId) { resetMirror3D(); return }
      resetMirror3D(); setTool('select'); return
    }
    if (e.key==='Escape'&&tool==='measure'){
      // First Escape clears the current result or a pending first point;
      // a second Escape (nothing pending) leaves the tool.
      if (measureP1 || measureResult) { resetMeasure(); return }
      resetMeasure(); setTool('select'); return
    }
    if ((e.key==='Enter'||e.key==='Tab')&&tool==='join3d'&&joinSel.length>=2){
      e.preventDefault()
      commitJoin()
      return
    }
    if (e.key==='Escape'&&tool==='join3d'){
      if (joinSel.length>0) { resetJoin3D(); return }
      resetJoin3D(); setTool('select'); return
    }
    if (e.key==='Escape'&&!sketchMode&&(tool==='loft3d'||loftState)){
      // enterSketch() always resets `tool` to 'line' (the default 2D drawing
      // tool) once a profile sketch starts, so tool==='loft3d' only holds at
      // step 1 (still picking Profile 1's plane) — loftState is what stays
      // true for the rest of the session (between-profiles popup included),
      // hence checking both. First Escape backs out of an in-progress loft;
      // a second Escape (nothing picked yet) leaves the tool. Escape while
      // actively sketching a profile is handled by the sketchMode branch
      // above, which reuses handleFinishSketch — same as clicking Finish Sketch.
      if (loftState) { resetLoft3D(); return }
      resetLoft3D(); setTool('select'); return
    }

    if (tool==='trim'||tool==='delete'||tool==='extend'||tool==='trace'||tool==='text'||tool==='select'||tool==='join'){if(e.key==='Escape'){resetText();resetSelection();resetJoin();resetDim();setTool('line');return}}

    if (tool==='select'&&selection.length>0){
      // Delete selected entities
      if (e.key==='Delete'&&!selectDimField){
        commit(snapshot())
        setLines(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='line'&&s.idx===i)))
        setCircles(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='circle'&&s.idx===i)))
        setArcs(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='arc'&&s.idx===i)))
        setSplines(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='spline'&&s.idx===i)))
        setDims(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='dim'&&s.idx===i)))
        resetSelection();return
      }

      // Tab: cycle field, save current input to pending dict, restore any previous value
      if (e.key==='Tab'){
        e.preventDefault()
        // Save current typed value to pending before moving
        if (selectDimField && selectDimInput) {
          setSelectDimPending(p=>({...p,[selectDimField]:selectDimInput}))
        }
        // Determine field list
        let fields=[]
        if (selection.length===1){
          const e0=selection[0]
          if (e0.kind==='line') fields=['length','angle']
          else if (e0.kind==='circle') fields=['radius']
          else if (e0.kind==='arc') fields=['radius','angle']
        } else {
          fields=['width','height']
        }
        if (!fields.length) return
        const idx=fields.indexOf(selectDimField)
        const nextField=fields[(idx+1)%fields.length]
        setSelectDimField(nextField)
        // Restore any previously typed value for this field
        setSelectDimInput(p=>{
          // We use a functional update so we read from pending via closure below
          return ''
        })
        // Restore pending value for next field after state settles
        setTimeout(()=>{
          setSelectDimPending(pending=>{
            setSelectDimInput(pending[nextField]||'')
            return pending
          })
        },0)
        return
      }

      // Typing when a field is active
      if (selectDimField){
        if (e.key==='Backspace'){
          e.preventDefault()
          setSelectDimInput(p=>{
            const n=p.slice(0,-1)
            setSelectDimPending(pd=>({...pd,[selectDimField]:n}))
            return n
          })
          return
        }
        if (/^[0-9.]$/.test(e.key)){
          setSelectDimInput(p=>{
            const n=p+e.key
            setSelectDimPending(pd=>({...pd,[selectDimField]:n}))
            return n
          })
          return
        }
        if (e.key==='Enter'||e.key==='Return'){
          e.preventDefault()
          // Save current input to pending first
          const finalPending = selectDimField
            ? {...selectDimPending,[selectDimField]:selectDimInput}
            : selectDimPending
          // Apply all pending values in one commit
          commit(snapshot())
          if (selection.length===1){
            const ent=selection[0]
            if (ent.kind==='line'){
              const l=lines[ent.idx]
              const dx=l.x2-l.x1,dy=l.y2-l.y1
              const oldLen=Math.hypot(dx,dy)
              let newLen=oldLen,newAngleRad=Math.atan2(dy,dx)
              if (finalPending.length&&parseFloat(finalPending.length)>0)
                newLen=mmToPx(parseFloat(finalPending.length))
              if (finalPending.angle&&parseFloat(finalPending.angle)>=0)
                newAngleRad=(360-parseFloat(finalPending.angle))*Math.PI/180
              const nx=Math.cos(newAngleRad),ny=Math.sin(newAngleRad)
              // Determine fixed point from anchor handle
              const bbox2=selectionBBox(selection,lines,circles,arcs,splines)
              const handles2=bbox2?getBBoxHandles(bbox2):null
              const anchorPt=handles2?handles2[selectDimAnchor]||handles2['mc']:null
              if (!anchorPt||selectDimAnchor==='mc'){
                // Anchor = midpoint
                const mx=(l.x1+l.x2)/2,my=(l.y1+l.y2)/2
                setLines(p=>p.map((ln,i)=>i===ent.idx?{...ln,x1:mx-nx*newLen/2,y1:my-ny*newLen/2,x2:mx+nx*newLen/2,y2:my+ny*newLen/2}:ln))
              } else {
                // Find which endpoint is closest to anchor handle — that end stays fixed
                const d1=Math.hypot(l.x1-anchorPt.x,l.y1-anchorPt.y)
                const d2=Math.hypot(l.x2-anchorPt.x,l.y2-anchorPt.y)
                if (d1<=d2){
                  // x1,y1 stays fixed — x2,y2 moves
                  setLines(p=>p.map((ln,i)=>i===ent.idx?{...ln,x2:l.x1+nx*newLen,y2:l.y1+ny*newLen}:ln))
                } else {
                  // x2,y2 stays fixed — x1,y1 moves
                  setLines(p=>p.map((ln,i)=>i===ent.idx?{...ln,x1:l.x2-nx*newLen,y1:l.y2-ny*newLen}:ln))
                }
              }
            } else if (ent.kind==='circle'&&finalPending.radius&&parseFloat(finalPending.radius)>0){
              const c=circles[ent.idx]
              const newR=mmToPx(parseFloat(finalPending.radius))
              const bbox2=selectionBBox(selection,lines,circles,arcs,splines)
              const handles2=bbox2?getBBoxHandles(bbox2):null
              const anchorPt=handles2?handles2[selectDimAnchor]||handles2['mc']:null
              if (!anchorPt||selectDimAnchor==='mc'){
                // Centre stays fixed
                setCircles(p=>p.map((ci,i)=>i===ent.idx?{...ci,r:newR}:ci))
              } else {
                // Anchor point stays fixed — shift centre
                // The anchor handle is on the circle's bbox edge
                // New centre = anchor + offset scaled to new radius
                const ocx=c.cx,ocy=c.cy,or=c.r
                const fromAnchorX=ocx-anchorPt.x,fromAnchorY=ocy-anchorPt.y
                const dist=Math.hypot(fromAnchorX,fromAnchorY)||1
                const newCx=anchorPt.x+(fromAnchorX/dist)*newR
                const newCy=anchorPt.y+(fromAnchorY/dist)*newR
                setCircles(p=>p.map((ci,i)=>i===ent.idx?{...ci,cx:newCx,cy:newCy,r:newR}:ci))
              }
            } else if (ent.kind==='arc'&&(finalPending.radius||finalPending.angle)){
              const a=arcs[ent.idx]
              let r=a.r,span=norm2pi(a.endAngle-a.startAngle)
              if (finalPending.radius&&parseFloat(finalPending.radius)>0) r=mmToPx(parseFloat(finalPending.radius))
              if (finalPending.angle&&parseFloat(finalPending.angle)>0) span=parseFloat(finalPending.angle)*Math.PI/180
              if (finalPending.radius&&parseFloat(finalPending.radius)>0){
                const bbox2=selectionBBox(selection,lines,circles,arcs,splines)
                const handles2=bbox2?getBBoxHandles(bbox2):null
                const anchorPt=handles2?handles2[selectDimAnchor]||handles2['mc']:null
                if (anchorPt&&selectDimAnchor!=='mc'){
                  const fromAnchorX=a.cx-anchorPt.x,fromAnchorY=a.cy-anchorPt.y
                  const dist=Math.hypot(fromAnchorX,fromAnchorY)||1
                  const newCx=anchorPt.x+(fromAnchorX/dist)*r
                  const newCy=anchorPt.y+(fromAnchorY/dist)*r
                  const mid=(a.startAngle+a.endAngle)/2
                  setArcs(p=>p.map((ar,i)=>i===ent.idx?{...ar,cx:newCx,cy:newCy,r,startAngle:mid-span/2,endAngle:mid+span/2}:ar))
                } else {
                  const mid=(a.startAngle+a.endAngle)/2
                  setArcs(p=>p.map((ar,i)=>i===ent.idx?{...ar,r,startAngle:mid-span/2,endAngle:mid+span/2}:ar))
                }
              } else {
                const mid=(a.startAngle+a.endAngle)/2
                setArcs(p=>p.map((ar,i)=>i===ent.idx?{...ar,r,startAngle:mid-span/2,endAngle:mid+span/2}:ar))
              }
            }
          } else {
            // Multi-select: apply W and/or H independently
            const bbox2=selectionBBox(selection,lines,circles,arcs,splines)
            if (bbox2){
              // Determine anchor world point from anchor handle id
              const handles=getBBoxHandles(bbox2)
              const anchorH=handles[selectDimAnchor]||handles['mc']
              let sx=1,sy=1
              if (finalPending.width&&parseFloat(finalPending.width)>0)
                sx=mmToPx(parseFloat(finalPending.width))/bbox2.w
              if (finalPending.height&&parseFloat(finalPending.height)>0)
                sy=mmToPx(parseFloat(finalPending.height))/bbox2.h
              const result=applySelectionTransform(selection,lines,circles,arcs,splines,{x:anchorH.x,y:anchorH.y},sx,sy,0,0)
              setLines(result.lines);setCircles(result.circles);setArcs(result.arcs);setSplines(result.splines)
            }
          }
          setSelectDimField(null);setSelectDimPending({});setSelectDimAnchor('mc')
          setSelectDimInput('')
          return
        }
        if (e.key==='Escape'){setSelectDimField(null);setSelectDimPending({});setSelectDimInput('');return}
      }
    }

    if (tool==='spline'){
      if (e.key==='Escape'){resetSpline();return}
      if (e.key==='c'||e.key==='C'){setSplineClosed(p=>!p);return}
      if ((e.key==='Enter'||e.key==='Return')&&splinePoints.length>=2){
        e.preventDefault();finishSpline(splinePoints);return
      }
      return
    }

    if (tool==='offset'){
      if (e.key==='Escape'){resetOffset();return}
      if (offsetEntity){
        if (e.key==='Tab'){e.preventDefault();if(offsetDistInput&&parseFloat(offsetDistInput)>0)setOffsetDistLocked(p=>!p);return}
        if (e.key==='Backspace'){setOffsetDistInput(p=>p.slice(0,-1));setOffsetDistLocked(false);return}
        if (/^[0-9.]$/.test(e.key)){setOffsetDistLocked(false);setOffsetDistInput(p=>p+e.key);return}
      }
      return
    }

    if (tool==='mirror'){
      if (e.key==='Escape'){resetMirror();return}
      if (e.key==='Tab'){e.preventDefault();if(!mirrorAccepted&&mirrorSel.length>0)setMirrorAccepted(true);return}
      return
    }

    if (tool==='center'){
      if (e.key==='Escape'){resetCenter();return}
      if (e.key==='Tab'){e.preventDefault();commitCenter();return}
      return
    }

    if (tool==='movecopy'){
      if (e.key==='Escape'){resetMoveCopy();resetDrawState();return}
      if (!startPoint){
        if ((e.key==='m'||e.key==='M')&&!e.ctrlKey){setMoveCopyMode('move');return}
        if ((e.key==='c'||e.key==='C')&&!e.ctrlKey){setMoveCopyMode('copy');return}
        if (e.key==='Tab'){e.preventDefault();if(!moveCopyAccepted&&moveCopySel.length>0)setMoveCopyAccepted(true);return}
        if (moveCopyMode==='copy'&&moveCopyAccepted){
          if (e.key==='Backspace'){setMoveCopyCountInput(p=>p.length>1?p.slice(0,-1):'1');return}
          if (/^[0-9]$/.test(e.key)){setMoveCopyCountInput(p=>{const next=p==='1'?e.key:p+e.key;const n=parseInt(next)||1;return String(Math.min(100,n));});return}
        }
        return
      }
      if (e.key==='Tab'){e.preventDefault();if(focusField==='dim'){if(dimInput&&parseFloat(dimInput)>0)setDimLocked(true);setFocusField('angle')}else{if(angleInput&&parseFloat(angleInput)>=0)setAngleLocked(true);setFocusField('dim')};return}
      if (e.key==='Backspace'){if(focusField==='angle'){setAngleInput(p=>p.slice(0,-1));setAngleLocked(false)}else{setDimInput(p=>p.slice(0,-1));setDimLocked(false)};return}
      if (/^[0-9.]$/.test(e.key)){if(focusField==='angle'){setAngleLocked(false);setAngleInput(p=>p+e.key)}else{setDimLocked(false);setDimInput(p=>p+e.key)}}
      return
    }

    if (tool==='rotatecopy'){
      if (e.key==='Escape'){resetRotateCopy();resetDrawState();return}
      if (!startPoint){
        if ((e.key==='r'||e.key==='R')&&!e.ctrlKey){setRotateCopyMode('rotate');return}
        if ((e.key==='c'||e.key==='C')&&!e.ctrlKey){setRotateCopyMode('copy');return}
        if (e.key==='Tab'){e.preventDefault();if(!rotateCopyAccepted&&rotateCopySel.length>0)setRotateCopyAccepted(true);return}
        if (rotateCopyMode==='copy'&&rotateCopyAccepted){
          if (e.key==='Backspace'){setRotateCopyCountInput(p=>p.length>1?p.slice(0,-1):'1');return}
          if (/^[0-9]$/.test(e.key)){setRotateCopyCountInput(p=>{const next=p==='1'?e.key:p+e.key;const n=parseInt(next)||1;return String(Math.min(100,n));});return}
        }
        return
      }
      if (e.key==='Tab'){e.preventDefault();if(angleInput)setAngleLocked(true);return}
      if (e.key==='Backspace'){setAngleInput(p=>p.slice(0,-1));setAngleLocked(false);return}
      if (/^[0-9.-]$/.test(e.key)){setAngleLocked(false);setAngleInput(p=>p===''&&e.key==='-'?'-':p+e.key)}
      return
    }

    if (tool==='resize'){
      if (e.key==='Escape'){resetResize();return}
      if (!resizeAccepted){
        if (e.key==='Tab'){e.preventDefault();if(resizeSel.length>0)setResizeAccepted(true);return}
        return
      }
      // Accepted — type scale factor
      if (e.key==='Backspace'){setResizeScaleInput(p=>p.slice(0,-1));return}
      if (/^[0-9.]$/.test(e.key)){setResizeScaleInput(p=>p+e.key);return}
      return
    }

    if (tool==='fillet'){
      if (e.key==='Escape'){resetFillet();return}
      if (!filletAccepted){
        if (e.key==='Tab'){e.preventDefault();if(filletSel.length===2)setFilletAccepted(true);return}
        return
      }
      // Accepted — type radius then Enter/click to apply
      if (e.key==='Enter'){
        e.preventDefault()
        if (!filletPreview||filletPreview.tooLarge) return
        const{newL1,newL2,arc}=filletPreview
        // Carry style from source lines through fillet
        const s1=lines[filletSel[0].idx]?.style
        const s2=lines[filletSel[1].idx]?.style
        commit(snapshot())
        // Same plane/facePlane tagging every other commit needs — see the
        // matching comment on the Mirror tool's commit, same bug class.
        // trimLine()/the new arc in filletMath.js drop it just like style did
        // (hence the existing manual style patch-back below).
        const flPt = planeTag()
        setLines(p=>[...p.filter((_,i)=>!filletSel.some(s=>s.idx===i)),
          {...newL1,...(s1?{style:s1}:{}),...flPt},
          {...newL2,...(s2?{style:s2}:{}),...flPt}])
        setArcs(p=>[...p,{...arc,...flPt}])
        resetFillet()
        return
      }
      if (e.key==='Backspace'){setFilletRadiusInput(p=>p.slice(0,-1));return}
      if (/^[0-9.]$/.test(e.key)){setFilletRadiusInput(p=>p+e.key);return}
      return
    }

    if (!startPoint&&!circleCenter&&!deferredTangent) return
    if (e.key==='Escape'){resetDrawState();return}
    if (e.key==='Tab'){
      e.preventDefault()
      if (tool==='line'){
        if (focusField==='dim'){if(dimInput&&parseFloat(dimInput)>0)setDimLocked(true);setFocusField('angle')}
        else{if(angleInput&&parseFloat(angleInput)>=0)setAngleLocked(true);setFocusField('dim')}
      } else {if(dimInput&&parseFloat(dimInput)>0)setDimLocked(true)}
      return
    }
    if (e.key==='Backspace'){
      if(focusField==='angle'&&tool==='line'){setAngleInput(p=>p.slice(0,-1));setAngleLocked(false)}
      else{setDimInput(p=>p.slice(0,-1));setDimLocked(false)}
      return
    }
    if (/^[0-9.]$/.test(e.key)){
      if(focusField==='angle'&&tool==='line'){setAngleLocked(false);setAngleInput(p=>p+e.key)}
      else{setDimLocked(false);setDimInput(p=>p+e.key)}
    }
  }

  const drawing=startPoint||circleCenter||deferredTangent

  // ── Status bar prompt builder ─────────────────────────────────────────────
  // Returns { step, total, color, action, hints:[{k,l}] }
  // k = key label (shown as badge), l = description (shown as plain text after)
  const getStatusPrompt = () => {
    const C = {
      select:'#64B5F6', line:'#64B5F6', circle:'#2196F3', spline:'#FFB74D',
      mirror:'#CE93D8', center:'#9CCC65', movecopy:'#FFB74D', rotatecopy:'#80DEEA',
      resize:'#F48FB1', fillet:'#80CBC4', offset:'#A5D6A7',
      dim:'#F48FB1',    trim:'#FFAB91',   extend:'#80DEEA',
      delete:'#EF9A9A', join:'#26C6DA',   text:'#FFB74D',  trace:'#B0BEC5',
    }
    const c = C[tool] || '#aaa'
    const K = (k,l='') => ({k,l})

    // All the 2D-tool branches below only make sense while actually
    // sketching — `tool` (the 2D drawing-tool selection) doesn't get reset
    // when leaving sketch mode, so without this guard a stale tool==='line'
    // (etc.) would keep showing sketch prompts like "Click first point ·
    // tangent/perpendicular" in the plain 3D viewer.
    if (sketchMode) {
    if (tool==='select') {
      if (selectDimField) return { step:3, total:3, color:c,
        action:`✏ ${selectDimField}: ${selectDimInput||'_'}`,
        hints:[K('Tab','next field'), K('Enter','apply'), K('Esc')] }
      if (selection.length>0) return { step:2, total:3, color:c,
        action:`${selection.length} selected`,
        hints:[K('Tab','edit dims'), K('D','construction'), K('O','center origin'), K('Del','delete')] }
      return { step:1, total:3, color:c,
        action:'Click to select',
        hints:[K('Shift+click','add'), K('drag','window')] }
    }

    if (tool==='line') {
      if (drawing) {
        if (deferredTangent) return { step:null, total:null, color:'#F48FB1',
          action:'TAN — click end point',
          hints:[K('T','toggle off'), K('Esc')] }
        return { step:null, total:null, color:c,
          action:`${dimLocked?'🔒 ':''}${dimInput||'—'} mm  ·  ${angleLocked?'🔒 ':''}${angleInput||'—'}°`,
          hints:[K('Tab','toggle field'), K('Enter','lock'), K('T','tangent'), K('Esc')] }
      }
      return { step:null, total:null, color:c,
        action:'Click first point',
        hints:[K('T','tangent'), K('P','perpendicular')] }
    }

    if (tool==='circle') {
      if (circleCenter) return { step:2, total:2, color:c,
        action:`${dimLocked?'🔒 R ':'R '}${dimInput||'—'} mm`,
        hints:[K('type + Enter','exact radius'), K('T','tangent'), K('Esc')] }
      return { step:1, total:2, color:c,
        action:'Click centre point',
        hints:[] }
    }

    if (tool==='spline') {
      if (splinePoints.length===0) return { step:1, total:3, color:c,
        action:'Click first point',
        hints:[K('Esc','cancel')] }
      return { step:2, total:3, color:c,
        action:`${splinePoints.length} pts placed`,
        hints:[K('C',splineClosed?'closed':'open'), K('dbl-click','finish'), K('Esc')] }
    }

    if (tool==='offset') {
      if (!offsetEntity) return { step:1, total:3, color:c,
        action: offsetHover ? `Click to select ${offsetHover.kind}` : 'Hover entity to select',
        hints:[] }
      const d = offsetDistLocked ? parseFloat(offsetDistInput)||0
        : (mousePos ? pxToMm(distToEntity(mousePos,
            offsetEntity.kind==='line'?lines[offsetEntity.idx]:
            offsetEntity.kind==='circle'?circles[offsetEntity.idx]:
            offsetEntity.kind==='arc'?arcs[offsetEntity.idx]:splines[offsetEntity.idx],
            offsetEntity.kind)) : 0)
      return { step:'2+3', total:3, color:c,
        action:`Move to side · ${d.toFixed(1)} mm`,
        hints: offsetDistLocked
          ? [K('Tab','unlock dist'), K('click','place'), K('Esc')]
          : [K('type + Enter','lock dist'), K('click','place'), K('Esc')] }
    }

    if (tool==='dim') {
      if (dimToolStep===0) return { step:1, total:3, color:c,
        action:'Hover arc/circle or click pt 1',
        hints:[] }
      if (dimToolStep===1) return { step:2, total:3, color:c,
        action:'Click second point',
        hints:[K('Esc')] }
      return { step:3, total:3, color:c,
        action:'Click to place dim line',
        hints:[K('Esc')] }
    }

    if (tool==='mirror') {
      if (!mirrorAccepted) {
        if (mirrorSel.length===0) return { step:1, total:4, color:c,
          action:'Click or drag to select',
          hints:[K('Tab','accept')] }
        return { step:2, total:4, color:c,
          action:`${mirrorSel.length} selected`,
          hints:[K('Tab','accept'), K('Esc')] }
      }
      if (!mirrorP1) return { step:3, total:4, color:c,
        action:'Click mirror line pt 1',
        hints:[K('Esc')] }
      return { step:4, total:4, color:c,
        action:'Click mirror line pt 2',
        hints:[K('Esc')] }
    }

    if (tool==='center') {
      if (centerSel.length===0) return { step:1, total:2, color:c,
        action:'Click or drag to select',
        hints:[K('Esc')] }
      return { step:2, total:2, color:c,
        action:`${centerSel.length} selected`,
        hints:[K('Tab / right-click','center on origin'), K('click','toggle'), K('drag','add'), K('Esc')] }
    }

    if (tool==='movecopy') {
      const count = Math.max(1, parseInt(moveCopyCountInput)||1)
      const modeLabel = moveCopyMode==='move' ? 'MOVE' : `COPY ×${count}`
      if (!moveCopyAccepted) {
        if (moveCopySel.length===0) return { step:1, total:5, color:c,
          action:'Click or drag to select',
          hints:[K('M','move'), K('C','copy'), K('Tab','accept')] }
        return { step:2, total:5, color:c,
          action:`${moveCopySel.length} selected  [${modeLabel}]`,
          hints:[K('C','switch to copy'), K('Tab','accept'), K('Esc')] }
      }
      if (!startPoint) return { step: moveCopyMode==='copy' ? '3+4' : '4', total:5, color:c,
        action:`Click base point  [${modeLabel}]`,
        hints: moveCopyMode==='copy'
          ? [K('C #','change count'), K('Esc')]
          : [K('C','switch to copy'), K('Esc')] }
      return { step:5, total:5, color:c,
        action:`${dimLocked?'🔒':''}${dimInput||'—'} mm  ·  ${angleLocked?'🔒':''}${angleInput||'—'}°`,
        hints:[K('Tab','next field'), K('Esc')] }
    }

    if (tool==='rotatecopy') {
      const count = Math.max(1, parseInt(rotateCopyCountInput)||1)
      const modeLabel = rotateCopyMode==='rotate' ? 'ROTATE' : `COPY ×${count}`
      if (!rotateCopyAccepted) {
        if (rotateCopySel.length===0) return { step:1, total:5, color:c,
          action:'Click or drag to select',
          hints:[K('R','rotate'), K('C','copy'), K('Tab','accept')] }
        return { step:2, total:5, color:c,
          action:`${rotateCopySel.length} selected  [${modeLabel}]`,
          hints:[K('C','switch to copy'), K('Tab','accept'), K('Esc')] }
      }
      if (!startPoint) return { step: rotateCopyMode==='copy' ? '3+4' : '4', total:5, color:c,
        action:`Click centre point  [${modeLabel}]`,
        hints: rotateCopyMode==='copy'
          ? [K('C #','change count'), K('Esc')]
          : [K('C','switch to copy'), K('Esc')] }
      return { step:5, total:5, color:c,
        action:`${angleLocked?'🔒 ':''}${angleInput||'—'}°`,
        hints:[K('Tab','lock angle'), K('Esc')] }
    }

    if (tool==='resize') {
      if (!resizeAccepted) {
        if (resizeSel.length===0) return { step:1, total:3, color:c,
          action:'Click or drag to select',
          hints:[K('Tab','accept')] }
        return { step:2, total:3, color:c,
          action:`${resizeSel.length} selected`,
          hints:[K('Tab','accept'), K('Esc')] }
      }
      const s = parseFloat(resizeScaleInput)
      return { step:3, total:3, color:c,
        action:'⇲ Scale: '+(resizeScaleInput||'—')+(s>0?'  ('+(s<1?'shrink':'grow')+')':''),
        hints:[K('type','scale factor'), K('click','anchor point'), K('Esc')] }
    }

    if (tool==='fillet') {
      if (!filletAccepted) {
        if (filletSel.length===0) return { step:1, total:3, color:c,
          action:'Click first line',
          hints:[] }
        if (filletSel.length===1) return { step:2, total:3, color:c,
          action:'Click second line',
          hints:[K('Esc')] }
        return { step:2, total:3, color:c,
          action:'2 lines selected',
          hints:[K('Tab','accept'), K('Esc')] }
      }
      if (filletPreview?.tooLarge) return { step:3, total:3, color:'#EF9A9A',
        action:`R ${filletRadiusInput} mm — too large`,
        hints:[K('type','smaller radius')] }
      return { step:3, total:3, color:c,
        action: filletRadiusInput ? `R ${filletRadiusInput} mm` : 'Type fillet radius',
        hints:[K('Enter','apply')] }
    }

    if (tool==='trim') return { step:null, total:null, color:c,
      action: trimPreview?.kind==='spline'&&!trimPreview.highlightPts
        ? 'No intersections' : 'Hover segment to preview',
      hints:[K('click','trim'), K('Esc','exit')] }

    if (tool==='extend') return { step:null, total:null, color:c,
      action: extendPreview ? 'Click to extend' : 'Hover near endpoint',
      hints:[K('click','extend'), K('Esc','exit')] }

    if (tool==='delete') return { step:null, total:null, color:c,
      action:'Hover entity to preview',
      hints:[K('click','delete'), K('Esc','exit')] }

    if (tool==='join') return { step:null, total:null, color:c,
      action: joinFirstPt ? 'Click target point to connect' : 'Click an endpoint to move',
      hints:[K('Esc','cancel')] }

    if (tool==='text') return { step:null, total:null, color:c,
      action:'Click for text start point',
      hints:[] }

    if (tool==='trace') return { step:null, total:null, color:c,
      action:'Click for image insert point',
      hints:[] }

    return { step:null, total:null, color: getPlaneColor(activePlane),
      action:`Sketching on ${getPlaneLabel(activePlane)}  ${getPlaneAxes(activePlane).h}  ${getPlaneAxes(activePlane).v}`,
      hints:[K('Esc','finish sketch')] }
    }

    if (extrudeTool && !extrudeState) return { step:1, total:2,
      color: extrudeTool==='cutout'?'#e05a4e':'#3a7bd5',
      action: cachedProfiles.length > 0
        ? `Click anywhere to ${extrudeTool} — ${cachedProfiles.length} profile${cachedProfiles.length!==1?'s':''} found`
        : `No closed profiles found — draw a closed shape first`,
      hints:[K('Esc','cancel')] }

    if (extrudeTool && extrudeState) return { step:2, total:2,
      color: extrudeTool==='cutout'?'#e05a4e':'#3a7bd5',
      action:`Depth:`,
      hints:[K('Enter','apply'), K('Esc','cancel')] }

    return { step:null, total:null, color:'#666', action:'', hints:[] }
  }

    const toolConfig=[
    ['select',     IconSelect,     'Select / Info',  '#64B5F6'],
    ['line',       IconLine,       'Line',           '#2196F3'],
    ['circle',     IconCircle,     'Circle',         '#2196F3'],
    ['spline',     IconSpline,     'Spline',         '#FF6F00'],
    ['fillet',     IconFillet,     'Fillet',         '#26A69A'],
    ['text',       IconText,       'Text',           '#FF9800'],
    ['offset',     IconOffset,     'Offset',         '#4CAF50'],
    ['dim',        IconDim,        'Dimension',      '#E91E63'],
    ['axis',       IconAxis,       'Revolve Axis',   '#E0E0E0'],
    ['trace',      IconTrace,      'Trace Image',    '#607D8B'],
  ]

  const editConfig=[
    ['trim',       IconTrim,       'Trim',           '#FF5722'],
    ['delete',     IconDelete,     'Delete',         '#F44336'],
    ['extend',     IconExtend,     'Extend',         '#00ACC1'],
    ['join',       IconJoin,       'Join / Connect', '#76FF03'],
  ]

  const modifyConfig=[
    ['movecopy',   IconMoveCopy,   'Move / Copy',    '#FF9800'],
    ['rotatecopy', IconRotateCopy, 'Rotate / Copy',  '#00BCD4'],
    ['resize',     IconResize,     'Resize / Scale', '#E91E63'],
    ['mirror',     IconMirror,     'Mirror',         '#8E65F3'],
    ['center',     IconCenter,     'Centre',         '#9CCC65'],
  ]

  const btnBase={border:'none',borderRadius:5,cursor:'pointer',padding:4,display:'flex',alignItems:'center',justifyContent:'center',width:68,height:68,transition:'background 0.1s'}
  const zoomPct=Math.round(viewTransform.scale*100)

  return (
    <div style={{display:'flex',height:'100vh',outline:'none'}} tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={e=>{ handleExtrudeDragMove(e) }}
      onMouseUp={e=>{ }}
    >

      {cadError && (
        <div style={{position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',
          background:'#c0392b',color:'#fff',padding:'10px 20px',borderRadius:8,
          zIndex:9999,fontFamily:'monospace',fontSize:13,maxWidth:'80vw',
          boxShadow:'0 4px 12px rgba(0,0,0,0.5)'}}>
          {cadError}
        </div>
      )}

      {/* ══ LEFT SIDEBAR ══════════════════════════════════════════════════════ */}
      <div style={{width: sketchMode ? 72 : 112, background:'#1a1a2e',display:'flex',flexDirection:'column',
        padding:'8px 4px',gap:4,overflowY:'auto',borderRight:'1px solid #2a2a4a',
        transition:'background 0.3s, width 0.2s'}}>

        {sketchMode ? (
          /* ── SKETCH sidebar: all 2D draw tools ── */
          <>
            {toolConfig.map(([t,Icon,title,activeColor])=>(
              <button key={t}
                onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetCenter();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
                title={title}
                style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                  outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
                <Icon active={tool===t}/>
              </button>
            ))}
          </>
        ) : (
          /* ── 3D sidebar: solid operation placeholders ── */
          <>
            {[
              {id:'extrude',  label:'EXTRUDE', color:'#FBDA2D'},
              {id:'cutout',   label:'CUTOUT',  color:'#53D3E4'},
              {id:'fillet3d', label:'FILLET',  color:'#A470F2'},
              {id:'mirror3d', label:'MIRROR',  color:'#8E65F3'},
              {id:'join3d',   label:'JOIN',    color:'#FFEE88'},
              {id:'loft3d',   label:'LOFT',    color:'#33D5EC'},
            ].map(({id,label,color})=>{
              const isActive = id==='fillet3d' ? tool==='fillet3d' : id==='mirror3d' ? tool==='mirror3d' : id==='join3d' ? tool==='join3d' : id==='loft3d' ? (tool==='loft3d' || !!loftState) : extrudeTool===id
              return (
              <button key={id}
                title={label}
                onClick={()=>{
                  if (id==='extrude'||id==='cutout') activateExtrudeTool(id)
                  else if (id==='fillet3d') activateFillet3DTool()
                  else if (id==='mirror3d') activateMirror3DTool()
                  else if (id==='join3d') activateJoin3DTool()
                  else if (id==='loft3d') activateLoft3DTool()
                }}
                style={{...btnBase, flexDirection:'column', gap:2,
                  width:102, height:102,
                  background: isActive ? color+'33' : 'transparent',
                  outline: isActive ? `2px solid ${color}` : `1px dashed ${color}55`,
                  outlineOffset:'-2px',
                }}>
                {SOLID_ICON_COMPONENTS[id] ? (
                  (() => { const Icon = SOLID_ICON_COMPONENTS[id]; return <Icon color={color}/> })()
                ) : (
                  /* Placeholder icon — no vector icon for this one yet */
                  <svg width="70" height="70" viewBox="0 0 70 70" fill="none">
                    <rect x="7.5" y="7.5" width="55" height="55" rx="7.5"
                      stroke={color} strokeWidth="3" fill={color+'11'} strokeDasharray="7.5 5"/>
                    <text x="35" y="42.5" textAnchor="middle"
                      style={{fontSize:17.5, fontFamily:'monospace', fill:color, letterSpacing:0}}>
                      {label.slice(0,3)}
                    </text>
                  </svg>
                )}
                <span style={{fontSize:10,fontFamily:'monospace',color,letterSpacing:'0.04em'}}>
                  {label}
                </span>
              </button>
              )
            })}

            <div style={{flex:1}}/>

            {/* MEASURE — click an edge for its length/diameter, or two points
                for the distance between them. Esc clears the current result. */}
            <button title="Measure" onClick={activateMeasureTool}
              style={{...btnBase, flexDirection:'column', gap:2,
                width:102, height:102,
                background: tool==='measure' ? '#4FC3F733' : 'transparent',
                outline: tool==='measure' ? '2px solid #4FC3F7' : '1px dashed #4FC3F755',
                outlineOffset:'-2px',
              }}>
              <IconMeasure3D color="#4FC3F7"/>
              <span style={{fontSize:10,fontFamily:'monospace',color:'#4FC3F7',letterSpacing:'0.04em'}}>
                MEASURE
              </span>
            </button>
          </>
        )}
      </div>

      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>

        {/* ══ TOP TOOLBAR ═══════════════════════════════════════════════════ */}
        <div style={{background:'#1a1a2e',display:'flex',alignItems:'center',
          padding:'0 8px',gap:4,flexShrink:0,
          borderBottom:`2px solid ${sketchMode ? getPlaneColor(activePlane) : '#2a2a4a'}`,
          flexWrap:'wrap', transition:'border-color 0.3s'}}>

          {sketchMode ? (
            /* ── SKETCH top toolbar ── */
            <>
              {/* Back indicator */}
              <div style={{display:'flex',alignItems:'center',gap:6,marginRight:4}}>
                <div style={{
                  display:'flex',flexDirection:'column',alignItems:'center',
                  padding:'4px 10px',borderRadius:5,gap:1,
                  background: getPlaneColor(activePlane)+'22',
                  border:`2px solid ${getPlaneColor(activePlane)}`,
                  minWidth:56,
                }}>
                  <span style={{fontSize:13,fontFamily:'monospace',fontWeight:'bold',
                    color:getPlaneColor(activePlane),letterSpacing:'0.1em'}}>{getPlaneLabel(activePlane)}</span>
                  <span style={{fontSize:8,fontFamily:'monospace',color:getPlaneColor(activePlane)+'bb'}}>
                    {getPlaneAxes(activePlane).h}&nbsp;{getPlaneAxes(activePlane).v}
                  </span>
                </div>
              </div>

              <div style={{width:1,height:48,background:'#2a2a4a',margin:'0 4px'}}/>

              {/* Edit tools */}
              <span style={{color:'#555',fontFamily:'monospace',fontSize:9,
                textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>Edit</span>
              {editConfig.map(([t,Icon,title,activeColor])=>(
                <button key={t}
                  onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetCenter();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
                  title={title}
                  style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                    outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
                  <Icon active={tool===t}/>
                </button>
              ))}

              {/* Include From Face — only meaningful when sketching on an
                  actual solid face (a FacePlane), which is the only case
                  with a boundary to copy; hidden on plain work-plane
                  sketches (XY/XZ/YZ, activePlane is a string there). */}
              {activePlane && typeof activePlane === 'object' && (
                <>
                  <div style={{width:1,height:48,background:'#2a2a4a',margin:'0 4px'}}/>
                  <span style={{color:'#555',fontFamily:'monospace',fontSize:9,
                    textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>Face</span>
                  <button
                    onClick={includeFaceGeometry}
                    title="Include From Face — copy this face's boundary into the sketch"
                    disabled={!faceRefSegments.length}
                    style={{...btnBase,background:'transparent',
                      outline:'1px dashed #4FC3F755',outlineOffset:'-2px',
                      opacity:faceRefSegments.length?1:0.4,
                      cursor:faceRefSegments.length?'pointer':'not-allowed'}}>
                    <IconIncludeFace active={false}/>
                  </button>
                </>
              )}

              <div style={{width:1,height:48,background:'#2a2a4a',margin:'0 4px'}}/>

              {/* Modify tools */}
              <span style={{color:'#555',fontFamily:'monospace',fontSize:9,
                textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>Modify</span>
              {modifyConfig.map(([t,Icon,title,activeColor])=>(
                <button key={t}
                  onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetCenter();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
                  title={title}
                  style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                    outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
                  <Icon active={tool===t}/>
                </button>
              ))}

              <div style={{flex:1}}/>

              {/* CANCEL FEATURE — only for Cut/Extrude/Loft, which have a whole
                  in-progress feature to abandon (a plain standalone sketch
                  doesn't). Placed left of Finish so the two can't be confused. */}
              {(extrudeTool || loftState) && (
                <button
                  title="Cancel — abandons this Cut/Extrude/Loft entirely"
                  onClick={cancelFeature}
                  style={{...btnBase,background:'#3a1a1a',outline:'2px solid #e05a4e',
                    outlineOffset:'-2px',flexDirection:'column',gap:2,
                    width:'auto',padding:'0 18px'}}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <line x1="4" y1="4" x2="16" y2="16" stroke="#e05a4e" strokeWidth="2.5" strokeLinecap="round"/>
                    <line x1="16" y1="4" x2="4" y2="16" stroke="#e05a4e" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                  <span style={{fontSize:8,fontFamily:'monospace',color:'#e05a4e',
                    letterSpacing:'0.05em',whiteSpace:'nowrap'}}>CANCEL</span>
                </button>
              )}

              {/* FINISH SKETCH — right-aligned */}
              <button
                title="Finish Sketch"
                onClick={handleFinishSketch}
                style={{...btnBase,background:'#1a3a2a',outline:'2px solid #69F0AE',
                  outlineOffset:'-2px',flexDirection:'column',gap:2,
                  width:'auto',padding:'0 18px'}}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <polyline points="3,10 8,15 17,5" stroke="#69F0AE" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                <span style={{fontSize:8,fontFamily:'monospace',color:'#69F0AE',
                  letterSpacing:'0.05em',whiteSpace:'nowrap'}}>FINISH</span>
              </button>
            </>
          ) : (
            /* ── 3D top toolbar ── */
            <>
              {/* View presets */}
              <span style={{color:'#555',fontFamily:'monospace',fontSize:9,
                textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>View</span>
              {[
                {id:'top',   label:'TOP',  title:'Top view (XY)',  fn:()=>viewport3dRef.current?.snapToPlane('XY')},
                {id:'front', label:'FRONT',title:'Front view (XZ)', fn:()=>viewport3dRef.current?.snapToPlane('XZ')},
                {id:'side',  label:'SIDE', title:'Side view (YZ)',  fn:()=>viewport3dRef.current?.snapToPlane('YZ')},
                {id:'iso',   label:'ISO',  title:'Isometric view',  fn:()=>viewport3dRef.current?.snapToIsometric()},
              ].map(({id,label,title,fn})=>(
                <button key={label} title={title} onClick={fn}
                  style={{...btnBase,background:'transparent',
                    outline:'1px solid #2a2a4a',outlineOffset:'-2px',
                    flexDirection:'column',gap:2,width:'auto',padding:'0 10px',height:70}}>
                  <div style={viewOpIconStyle(id)}/>
                  <span style={{fontSize:9,fontFamily:'monospace',color:'#6688aa',
                    letterSpacing:'0.06em'}}>{label}</span>
                </button>
              ))}
              <div style={{width:1,height:44,background:'#2a2a4a',margin:'0 6px'}}/>
              <button key="fit" title="Zoom to fit (F)" onClick={zoomToFit}
                style={{...btnBase,background:'transparent',
                  outline:'1px solid #2a2a4a',outlineOffset:'-2px',
                  flexDirection:'column',gap:2,width:'auto',padding:'0 10px',height:70}}>
                <IconFitView/>
                <span style={{fontSize:9,fontFamily:'monospace',color:'#6688aa',
                  letterSpacing:'0.06em'}}>FIT</span>
              </button>

              <div style={{flex:1}}/>
            </>
          )}

          {/* Guide — always visible */}
          <button
            onClick={()=>setGuideOpen(p=>!p)}
            title="Toggle Guide Panel"
            style={{...btnBase,
              background:guideOpen?'#f7fb0422':'transparent',
              outline:guideOpen?'2px solid #f7fb04':'none',
              outlineOffset:'-2px'}}>
            <IconGuide active={guideOpen}/>
          </button>
        </div>
        {/* ── Viewport3D + Guide side by side ── */}
        <div style={{flex:1,display:'flex',minHeight:0,position:'relative',
          outline: sketchMode ? `3px solid ${getPlaneColor(activePlane)}` : 'none',
          outlineOffset: '-3px',
        }}>
          <div style={{flex:1,overflow:'hidden',minWidth:0}}>
          <Viewport3D
            ref={viewport3dRef}
            width={canvasSize.w}
            height={canvasSize.h}
            lines={lines} circles={circles} arcs={arcs} splines={splines}
            solids={solids}
            features={features}
            activeSketchId={activeSketchId}
            cursor={
              extrudeTool ? 'crosshair' :
              tool==='select'?(selectDragHandleRef.current?'grabbing':selectHover?'pointer':'default'):
              'crosshair'
            }
            onScaleChange={handleScaleChange}
            onPlaneClick={handlePlaneClick}
            onFaceClick={handleFaceClick}
            sketchArmed={((!!extrudeTool && !extrudeState) && !sketchMode) || (tool==='mirror3d' && !!mirror3dSourceFeatureId) || (tool==='loft3d' && !loftState)}
            extrudeArmed={!!extrudeState}
            showWorkPlanes={!sketchMode && tool!=='fillet3d' && tool!=='measure'}
            activePlane={activePlane}
            sketchMode={sketchMode}
            extrudeTool={extrudeTool}
            filletActive={tool==='fillet3d'}
            measureActive={tool==='measure'}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
          />
          </div>
          {guideOpen && <GuidePanel tool={tool} toolState={{
            // selection-phase tools
            mirrorSel, mirrorAccepted, mirrorP1,
            moveCopySel, moveCopyAccepted, moveCopyMode,
            rotateCopySel, rotateCopyAccepted, rotateCopyMode,
            resizeSel, resizeAccepted,
            filletSel, filletAccepted, filletRadiusInput,
            // draw tools
            startPoint, circleCenter, splinePoints,
            // single-action tools
            offsetEntity, offsetDistLocked, offsetPreview,
            trimPreview, extendPreview, deletePreview,
            joinFirstPt,
            // dim tool
            dimToolStep,
            // select
            selection, selectDimField,
          }}/>}

          {/* ── SmartStep bar: overlays bottom of viewport during Extrude/Cutout ── */}
          <SmartStepBar
            op={extrudeTool}
            currentStep={
              extrudeState  ? 3 :
              sketchMode    ? 2 : 1
            }
            color={extrudeTool === 'cutout' ? '#e05a4e' : '#3a7bd5'}
            onStepBack={step => {
              if (step === 2) {
                // Back from Set Depth → restore sketch on same plane
                const saved = extrudeStateRef.current || extrudeState
                const plane = saved?.sketchPlane
                if (plane) {
                  setExtrudeState(null)
                  setExtrudeHandlePos(null)
                  enterSketch(plane, null, {
                    lines:   saved.sketchLines   || [],
                    circles: saved.sketchCircles || [],
                    arcs:    saved.sketchArcs    || [],
                    splines: saved.sketchSplines || [],
                  })
                  if (typeof plane === 'string') viewport3dRef.current?.snapToPlane(plane)
                  else viewport3dRef.current?.snapToFace(plane)
                }
              } else if (step === 1) {
                // Back from Draw Profile → cancel sketch, return to plane pick
                setSketchMode(false)
                setActivePlane(null)
                setActiveSketchId(null)
                activePlaneRef.current = null
                setExtrudeState(null)
                setExtrudeHandlePos(null)
                setLines([]); setCircles([]); setArcs([]); setSplines([])
                viewport3dRef.current?.restoreSavedView()
              }
            }}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Mirror3D ── */}
          <SmartStepBar
            op={tool==='mirror3d' ? 'MIRROR' : null}
            steps={[{ id:1, label:'Pick Feature' }, { id:2, label:'Pick Plane' }]}
            currentStep={mirror3dSourceFeatureId ? 2 : 1}
            color="#8E65F3"
            onStepBack={step => {
              if (step === 1) resetMirror3D()   // back to step 1 — stays in the tool
            }}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Join3D ── */}
          <SmartStepBar
            op={tool==='join3d' ? 'JOIN' : null}
            steps={[{ id:1, label:'Select Features' }]}
            currentStep={1}
            color="#FFEE88"
            hint={joinSel.length>0
              ? `${joinSel.length} selected · Enter/Tab/right-click to join`
              : 'Select 2+ features in the tree'}
            onStepBack={()=>{}}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Loft ── */}
          <SmartStepBar
            op={(tool==='loft3d' || loftState) ? 'LOFT' : null}
            steps={[{ id:1, label:'Pick Start Plane' }, { id:2, label:'Sketch Profiles' }]}
            currentStep={loftState ? 2 : 1}
            color="#33D5EC"
            hint={loftState
              ? `Profile ${loftState.currentIdx+1} of ${Math.max(loftState.profiles.length, loftState.currentIdx+1)}${sketchMode ? ' · sketching' : ''}`
              : 'Click a work plane or face'}
            onStepBack={step => {
              if (step === 1) resetLoft3D()
            }}
          />
        </div>
        <div style={{height:52,background:'#16162a',display:'flex',alignItems:'center',padding:'0 8px',gap:4,flexShrink:0,borderTop:'2px solid #2a2a4a'}}>
          {/* Undo/Redo/Save/Load/PDF/DXF only mean anything for the 2D sketch
              buffer (snapshot()/saveJSON() below only capture lines/circles/
              arcs/splines/dims, not the solid feature tree) — showing them
              outside sketch mode would silently do nothing (or worse, look
              like it undid/saved a solid operation when it didn't). Fit moved
              to the 3D top toolbar's View row (see zoomToFit, now solids-aware). */}
          {sketchMode && (
            <>
              <button onClick={()=>undo(snapshot(),restore)} title="Undo (Ctrl+Z)" disabled={!canUndo}
                style={{...btnBase,opacity:canUndo?1:0.3,background:'transparent',border:'none',cursor:canUndo?'pointer':'default'}}>
                <IconUndo active={canUndo}/>
              </button>
              <button onClick={()=>redo(snapshot(),restore)} title="Redo (Ctrl+Y)" disabled={!canRedo}
                style={{...btnBase,opacity:canRedo?1:0.3,background:'transparent',border:'none',cursor:canRedo?'pointer':'default'}}>
                <IconRedo active={canRedo}/>
              </button>
              <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
              <button onClick={()=>saveJSON(lines,circles,arcs,splines,dims)} title="Save (Ctrl+S)" style={{...btnBase,background:'transparent',border:'none'}}>
                <IconSave/>
              </button>
              <button onClick={()=>loadFileRef.current.click()} title="Load drawing" style={{...btnBase,background:'transparent',border:'none'}}>
                <IconLoad/>
              </button>
              <button onClick={()=>setPageSetupOpen(true)} title="Page Setup & Export PDF" style={{...btnBase,background:'transparent',border:'none'}}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="2" width="13" height="18" rx="1.5" stroke="#aaa" strokeWidth="1.5"/><line x1="6" y1="7" x2="13" y2="7" stroke="#aaa" strokeWidth="1.2"/><line x1="6" y1="10" x2="13" y2="10" stroke="#aaa" strokeWidth="1.2"/><line x1="6" y1="13" x2="11" y2="13" stroke="#aaa" strokeWidth="1.2"/><rect x="12" y="13" width="7" height="7" rx="1" fill="#E53935"/><text x="13.5" y="19" fontSize="5" fill="white" fontFamily="monospace">PDF</text></svg>
              </button>
              <label title="Import DXF file" style={{...btnBase,background:'transparent',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect x="3" y="2" width="11" height="15" rx="1" stroke="#aaa" strokeWidth="1.5"/>
                  <path d="M10 2v5h4" stroke="#aaa" strokeWidth="1.2" fill="none"/>
                  <text x="3.5" y="19" fontSize="5" fill="#4CAF50" fontFamily="monospace" fontWeight="bold">DXF</text>
                  <path d="M16 13l3 3-3 3" stroke="#4CAF50" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                </svg>
                <input type="file" accept=".dxf" style={{display:'none'}} onChange={async e=>{
                  const file=e.target.files?.[0];if(!file)return
                  try{
                    const text=await file.text()
                    const result=parseDXF(text,2)
                    commit(snapshot())
                    setLines(p=>[...p,...result.lines])
                    setCircles(p=>[...p,...result.circles])
                    setArcs(p=>[...p,...result.arcs])
                    setSplines(p=>[...p,...result.splines])
                    const total=result.lines.length+result.circles.length+result.arcs.length+result.splines.length
                    setLoadError(null)
                    alert(`DXF imported: ${total} entities (${result.lines.length} lines, ${result.circles.length} circles, ${result.arcs.length} arcs, ${result.splines.length} polylines)`)
                  }catch(err){
                    setLoadError('DXF import failed: '+err.message)
                  }
                  e.target.value=''
                }}/>
              </label>
              <button onClick={()=>exportDXF(lines,circles,arcs,splines)} title="Export DXF" style={{...btnBase,background:'transparent',border:'none'}}>
                <IconDXF/>
              </button>
              <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
            </>
          )}
          <button onClick={handleExportSTL} title="Export STL (for 3D printing — fuses all bodies into one)"
            style={{...btnBase,background:'transparent',border:'none'}}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 2l8 4.5v9L11 20l-8-4.5v-9L11 2z" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M3 6.5L11 11l8-4.5M11 11v9" stroke="#aaa" strokeWidth="1.2"/>
              <text x="4.5" y="19.5" fontSize="5" fill="#4CAF50" fontFamily="monospace" fontWeight="bold">STL</text>
            </svg>
          </button>
          <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
          {/* Grid toggle — stays visible in 3D mode too: gridSnap/gridSizeMm
              also drive the extrude/cutout hover-follow depth snapping. */}
          <button
            onClick={()=>setGridVisible(p=>!p)}
            title={gridVisible?'Hide grid':'Show grid'}
            style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
              background:gridVisible?'#3949AB44':'#1a1a2e',
              border:`2px solid ${gridVisible?'#5C6BC0':'#3a3a5a'}`,
              color:gridVisible?'#9FA8DA':'#666',
              borderRadius:5,padding:'3px 8px',cursor:'pointer',gap:1}}>
            <span style={{fontSize:14,lineHeight:1}}>⊞</span>
            <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em'}}>GRID</span>
          </button>
          {/* Grid size */}
          <select
            value={gridSizeMm}
            onChange={e=>setGridSizeMm(Number(e.target.value))}
            title="Grid size"
            style={{background:'#1a1a2e',border:'2px solid #3a3a5a',color:'#9FA8DA',
              borderRadius:5,padding:'4px 6px',fontFamily:'monospace',fontSize:11,cursor:'pointer',height:36}}>
            {[0.5,1,2,5,10,25,50].map(v=><option key={v} value={v}>{v}mm</option>)}
          </select>
          {/* Snap toggle */}
          <button
            onClick={()=>setGridSnap(p=>!p)}
            title={gridSnap?'Snap to grid ON':'Snap to grid OFF'}
            style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
              background:gridSnap?'#00695C44':'#1a1a2e',
              border:`2px solid ${gridSnap?'#26A69A':'#3a3a5a'}`,
              color:gridSnap?'#80CBC4':'#666',
              borderRadius:5,padding:'3px 8px',cursor:'pointer',gap:1}}>
            <span style={{fontSize:14,lineHeight:1}}>⊠</span>
            <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em'}}>SNAP</span>
          </button>
          {sketchMode && (
            <>
              <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
              {/* Line style buttons — meaningless outside a sketch */}
              {[
                {s:null,        label:'FIRM',    title:'Normal line',        color:'#aaa',    line:'——'},
                {s:'construction',label:'CONST', title:'Construction (D) — reference geometry, excluded from the extruded/cut solid',   color:'#9E9E9E', line:'···'},
              ].map(({s,label,title,color,line})=>(
                <button key={s||'normal'} onClick={()=>setDrawStyle(s)} title={title}
                  style={{
                    display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                    background: drawStyle===s?color+'33':'#1a1a2e',
                    border:`2px solid ${drawStyle===s?color:'#3a3a5a'}`,
                    color: drawStyle===s?color:'#666',
                    borderRadius:5,padding:'3px 8px',cursor:'pointer',gap:1,
                  }}>
                  <span style={{fontSize:11,fontFamily:'monospace',letterSpacing:'0.1em',lineHeight:1}}>{line}</span>
                  <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em'}}>{label}</span>
                </button>
              ))}
            </>
          )}
          <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
          {(()=>{
            const p = getStatusPrompt()
            if (!p) return <div style={{flex:1}}/>
            return (
              <div style={{flex:1,display:'flex',alignItems:'center',gap:8,overflow:'hidden',minWidth:0}}>
                {/* Step badge — hidden for extrude/cutout (SmartStep bar handles it) */}
                {p.step!==null && p.total!==null && !extrudeTool && (
                  <div style={{
                    flexShrink:0,
                    background: p.color+'22',
                    border:`1px solid ${p.color}66`,
                    borderRadius:4,
                    padding:'2px 7px',
                    fontFamily:'monospace',
                    fontSize:10,
                    fontWeight:'bold',
                    color: p.color,
                    letterSpacing:'0.05em',
                    whiteSpace:'nowrap',
                  }}>
                    {typeof p.step==='string'?p.step:`${p.step}/${p.total}`}
                  </div>
                )}
                {/* Action text */}
                <span style={{
                  flexShrink:0,
                  fontFamily:'monospace',
                  fontSize:13,
                  fontWeight:'bold',
                  color: p.color,
                  whiteSpace:'nowrap',
                }}>
                  {p.action}
                </span>
                {/* Inline depth input — shown when profile is picked */}
                {extrudeState && (
                  <input
                    autoFocus
                    value={extrudeState.depthInput}
                    onChange={e=>setExtrudeState(prev=>({...prev,depthInput:e.target.value}))}
                    onKeyDown={e=>{ e.stopPropagation(); handleExtrudeDepthKey(e) }}
                    style={{
                      width:70, background:'#1e1e38',
                      border:`1.5px solid ${extrudeTool==='cutout'?'#e05a4e':'#3a7bd5'}`,
                      borderRadius:4, color:'#dce8ff',
                      fontFamily:'monospace', fontSize:13,
                      padding:'3px 8px', outline:'none',
                    }}
                  />
                )}
                {extrudeState && (
                  <span style={{color:'#6688aa',fontFamily:'monospace',fontSize:12,flexShrink:0}}>mm</span>
                )}
                {/* Direction toggle — front / both / back */}
                {extrudeState && (
                  <div style={{display:'flex',gap:2,flexShrink:0}}>
                    {['front','both','back'].map(dir => (
                      <button key={dir}
                        title={dir==='both'?'Symmetric (both sides)':dir==='front'?'Front only':'Back only'}
                        onClick={()=>setExtrudeState(prev=>({...prev,direction:dir}))}
                        style={{
                          padding:'2px 6px', fontSize:10, fontFamily:'monospace',
                          background: extrudeState.direction===dir ? '#3a7bd5' : '#1e1e38',
                          color: extrudeState.direction===dir ? '#fff' : '#6688aa',
                          border:`1px solid ${extrudeState.direction===dir?'#3a7bd5':'#333'}`,
                          borderRadius:3, cursor:'pointer',
                        }}
                      >
                        {dir==='front'?'▶':dir==='both'?'◀▶':'◀'}
                      </button>
                    ))}
                  </div>
                )}
                {/* Key badges */}
                {p.hints && p.hints.length>0 && <>
                  <span style={{color:'#2a2a4a',fontSize:11,flexShrink:0}}>·</span>
                  <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'nowrap',overflow:'hidden'}}>
                    {p.hints.map(({k,l},i)=>(
                      <span key={i} style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                        <span style={{
                          display:'inline-flex',alignItems:'center',justifyContent:'center',
                          fontFamily:'monospace',fontSize:11,fontWeight:500,
                          padding:'2px 7px',
                          borderRadius:4,
                          background:'#333',
                          border:'1px solid #888',
                          color:'#fff',
                          whiteSpace:'nowrap',
                        }}>{k}</span>
                        {l && <span style={{
                          fontFamily:'monospace',fontSize:10,color:'#999',whiteSpace:'nowrap',
                        }}>{l}</span>}
                      </span>
                    ))}
                  </div>
                </>}
              </div>
            )
          })()}
          {/* viewTransform.scale is the 2D sketch pan/zoom — meaningless
              while orbiting the 3D camera, which uses a separate orthographic
              frustum with no equivalent "zoom %" readout yet. */}
          {sketchMode && (
            <div style={{color:'#777',fontFamily:'monospace',fontSize:11,paddingLeft:8,borderLeft:'1px solid #2a2a4a'}}>{zoomPct}%</div>
          )}
          {/* OCC ready indicator */}
          <div style={{
            marginLeft:8, paddingLeft:8, borderLeft:'1px solid #2a2a4a',
            fontFamily:'monospace', fontSize:10,
            color: occReady ? '#4caf50' : occLoading ? '#ff9800' : '#e05a4e',
            display:'flex', alignItems:'center', gap:4,
          }}>
            <div style={{
              width:6, height:6, borderRadius:'50%',
              background: occReady ? '#4caf50' : occLoading ? '#ff9800' : '#e05a4e',
              animation: occLoading ? 'pulse 1s infinite' : 'none',
            }}/>
            {occReady ? 'OCC' : occLoading ? 'Loading OCC...' : 'OCC Error'}
          </div>
        </div>
      </div>

      {/* ── Extrude popup (solid creation only) ─────────────────────────── */}
      {extrudeState?.armed && extrudeHandlePos && (extrudeTool !== 'cutout' || extrudeState.revolveAxis) && (
        <div style={{
          position: 'fixed',
          left: extrudeHandlePos.x + 20,
          top:  extrudeHandlePos.y - 20,
          zIndex: 1000,
          background: '#000',
          border: `1.5px solid ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'}`,
          borderRadius: 2,
          padding: '10px 14px',
          minWidth: 180,
          boxShadow: `0 0 14px ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'}77, 0 0 3px ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'} inset`,
          fontFamily: 'monospace',
        }}>
          {extrudeState.revolveAxis ? (
            <>
              {/* Revolve (extrude or cutout): sweep-angle input + a CW/CCW
                  toggle. The axis (already drawn/selected in the sketch) plus
                  a degrees value and sweep direction fully defines a solid —
                  or cut volume — of revolution. */}
              <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
                {[
                  {k:false, label:'CCW'},
                  {k:true,  label:'CW'},
                ].map(({k,label}) => (
                  <button key={label}
                    onClick={()=>setExtrudeState(prev=>({...prev, revolveReverse:k}))}
                    title={label==='CW' ? 'Clockwise' : 'Counterclockwise'}
                    style={{
                      flex:1, padding:'4px 0', fontSize:12, cursor:'pointer',
                      background: extrudeState.revolveReverse===k ? (extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff') : '#050505',
                      color: extrudeState.revolveReverse===k ? '#000' : (extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'),
                      border:`1px solid ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'}`,
                      borderRadius: 2, fontFamily:'monospace', fontWeight:'bold', letterSpacing:'0.05em',
                      textShadow: extrudeState.revolveReverse===k ? 'none' : `0 0 4px ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'}`,
                    }}
                  >{label}</button>
                ))}
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div style={{
                  flex:1, background:'#000', border:`1px solid ${extrudeTool==='cutout' ? '#FF3B5C55' : '#3ad6ff55'}`,
                  borderRadius:2, padding:'4px 8px',
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                }}>
                  <input
                    autoFocus
                    value={extrudeState.depthInput}
                    onChange={e=>{
                      const val = e.target.value
                      setExtrudeState(prev=>({...prev,depthInput:val}))
                      // Ghost preview restarts automatically via the useEffect
                      // keyed on extrudeState.depthInput — no manual redraw needed.
                    }}
                    onKeyDown={e=>{ e.stopPropagation(); handleExtrudeDepthKey(e) }}
                    style={{
                      background:'none', border:'none', outline:'none',
                      color: extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff',
                      textShadow: `0 0 5px ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'}`,
                      fontFamily:'monospace', fontSize:16,
                      fontWeight:'bold', width:70,
                    }}
                  />
                  <span style={{color:'#556', fontSize:12}}>°</span>
                </div>
                <button
                  onClick={()=>{
                    const vp = viewport3dRef.current
                    const oc = vp?.getOverlayCanvas()
                    if (oc) { const ctx=oc.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,oc.width,oc.height) }
                    const pc = vp?.getExtrudePreviewCanvas()
                    if (pc) { const ctx=pc.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,pc.width,pc.height) }
                    commitExtrude()
                  }}
                  style={{
                    padding:'4px 10px', background: extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff', color:'#000',
                    border:'none', borderRadius:2, cursor:'pointer',
                    fontFamily:'monospace', fontSize:12, fontWeight:'bold',
                    boxShadow: `0 0 6px ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'}`,
                  }}
                >↵</button>
              </div>
              <div style={{color:'#556', fontSize:10, marginTop:6, textAlign:'center', letterSpacing:'0.04em'}}>
                {extrudeTool==='cutout' ? 'Revolve cutout angle' : 'Revolve angle'} · ↵ to accept · Esc to cancel
              </div>
            </>
          ) : (
            <>
              {/* Extent mode — One Way (direction/sign follows which side of the
                  plane the mouse is hovering, see handleExtrudeDragMove) vs
                  Symmetric (grows equally both ways, side ignored). */}
              <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
                {[
                  {k:'oneway', icon:'▶',  label:'One Way — depth follows the mouse; hover either side of the plane to flip direction'},
                  {k:'both',   icon:'◀▶', label:'Symmetric — grows equally on both sides'},
                ].map(({k,icon,label}) => {
                  const active = k==='both' ? extrudeState.direction==='both' : extrudeState.direction!=='both'
                  return (
                    <button key={k}
                      onClick={()=>setExtrudeState(prev=>({...prev, direction: k==='both' ? 'both' : 'front'}))}
                      title={label}
                      style={{
                        flex:1, padding:'4px 0', fontSize:13, cursor:'pointer',
                        background: active ? '#3ad6ff' : '#050505',
                        color: active ? '#000' : '#3ad6ff',
                        border:'1px solid #3ad6ff',
                        borderRadius: 2,
                        textShadow: active ? 'none' : '0 0 4px #3ad6ff',
                      }}
                    >{icon}</button>
                  )
                })}
              </div>
              {/* Distance display + input */}
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div style={{
                  flex:1, background:'#000', border:'1px solid #3ad6ff55',
                  borderRadius:2, padding:'4px 8px',
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                }}>
                  <input
                    autoFocus
                    value={extrudeState.depthInput}
                    onChange={e=>setExtrudeState(prev=>({...prev,depthInput:e.target.value}))}
                    onKeyDown={e=>{ e.stopPropagation(); handleExtrudeDepthKey(e) }}
                    style={{
                      background:'none', border:'none', outline:'none',
                      color:'#3ad6ff', textShadow:'0 0 5px #3ad6ff',
                      fontFamily:'monospace', fontSize:16,
                      fontWeight:'bold', width:70,
                    }}
                  />
                  <span style={{color:'#556', fontSize:12}}>mm</span>
                </div>
                <button
                  onClick={()=>{
                    const vp = viewport3dRef.current
                    const oc = vp?.getOverlayCanvas()
                    if (oc) { const ctx=oc.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,oc.width,oc.height) }
                    setSolids(prev=>prev.filter(s=>s.id!=='__preview__'))
                    commitExtrude()
                  }}
                  style={{
                    padding:'4px 10px', background:'#3ad6ff', color:'#000',
                    border:'none', borderRadius:2, cursor:'pointer',
                    fontFamily:'monospace', fontSize:12, fontWeight:'bold',
                    boxShadow:'0 0 6px #3ad6ff',
                  }}
                >↵</button>
              </div>
              <div style={{color:'#556', fontSize:10, marginTop:6, textAlign:'center', letterSpacing:'0.04em'}}>
                Move mouse to set depth{gridSnap ? ` (snap ${gridSizeMm}mm)` : ''} · type or ↵ to accept · Esc to cancel
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Cutout popup (extent mode + direction + optional depth) ──────── */}
      {extrudeState?.armed && extrudeHandlePos && extrudeTool === 'cutout' && !extrudeState.revolveAxis && (
        <div style={{
          position: 'fixed',
          left: extrudeHandlePos.x + 20,
          top:  extrudeHandlePos.y - 20,
          zIndex: 1000,
          background: '#000',
          border: '1.5px solid #FF3B5C',
          borderRadius: 2,
          padding: '10px 14px',
          boxShadow: '0 0 14px #FF3B5C77, 0 0 3px #FF3B5C inset',
          fontFamily: 'monospace',
        }}>
          <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:8}}>

            {/* Left column: extent mode buttons */}
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              {[
                {k:'through', icon:'→|',  label:'Through All'},
                {k:'value',   icon:'→‖', label:'Value Extent'},
              ].map(({k,icon,label}) => {
                const active = extrudeState.extentMode === k
                return (
                  <button key={k} title={label}
                    onClick={()=>setExtrudeState(prev=>({...prev, extentMode:k}))}
                    style={{
                      padding:'6px 12px', cursor:'pointer', fontSize:15,
                      background: active ? '#FF3B5C' : '#050505',
                      color: active ? '#000' : '#FF3B5C',
                      border:'1px solid #FF3B5C',
                      borderRadius:2, fontFamily:'monospace',
                      textShadow: active ? 'none' : '0 0 4px #FF3B5C',
                    }}
                  >{icon}</button>
                )
              })}
            </div>

            {/* Right column: direction + depth */}
            <div style={{display:'flex', flexDirection:'column', gap:6}}>

              {/* Extent mode — One Way (direction/sign follows which side of
                  the plane the mouse is hovering) vs Symmetric (grows equally
                  both ways, side ignored) — same concept as the extrude popup. */}
              <div style={{display:'flex', gap:4}}>
                {[
                  {k:'oneway', icon:'▶',  label:'One Way — depth follows the mouse; hover either side of the plane to flip direction'},
                  {k:'both',   icon:'◀▶', label:'Symmetric — grows equally on both sides'},
                ].map(({k,icon,label}) => {
                  const active = k==='both' ? extrudeState.direction==='both' : extrudeState.direction!=='both'
                  return (
                    <button key={k}
                      onClick={()=>setExtrudeState(prev=>({...prev, direction: k==='both' ? 'both' : 'front'}))}
                      title={label}
                      style={{
                        flex:1, padding:'4px 0', fontSize:13, cursor:'pointer',
                        background: active ? '#FF3B5C' : '#050505',
                        color: active ? '#000' : '#FF3B5C',
                        border:'1px solid #FF3B5C',
                        borderRadius:2,
                        textShadow: active ? 'none' : '0 0 4px #FF3B5C',
                      }}
                    >{icon}</button>
                  )
                })}
              </div>

              {/* Depth input (disabled for through-all) */}
              <div style={{display:'flex', gap:6, alignItems:'center'}}>
                <div style={{
                  flex:1, background:'#000',
                  border:`1px solid ${extrudeState.extentMode==='through'?'#3a1520':'#FF3B5C55'}`,
                  borderRadius:2, padding:'4px 8px',
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  opacity: extrudeState.extentMode==='through' ? 0.35 : 1,
                }}>
                  <input
                    autoFocus={extrudeState.extentMode==='value'}
                    value={extrudeState.extentMode==='through' ? '∞' : extrudeState.depthInput}
                    readOnly={extrudeState.extentMode==='through'}
                    onChange={e=> extrudeState.extentMode!=='through' && setExtrudeState(prev=>({...prev,depthInput:e.target.value}))}
                    onKeyDown={e=>{ e.stopPropagation(); if(extrudeState.extentMode!=='through') handleExtrudeDepthKey(e) }}
                    style={{
                      background:'none', border:'none', outline:'none',
                      color: extrudeState.extentMode==='through' ? '#553' : '#FF3B5C',
                      textShadow: extrudeState.extentMode==='through' ? 'none' : '0 0 5px #FF3B5C',
                      fontFamily:'monospace', fontSize:16, fontWeight:'bold', width:70,
                    }}
                  />
                  <span style={{color:'#556', fontSize:12}}>mm</span>
                </div>
                <button
                  onClick={()=>{
                    const vp = viewport3dRef.current
                    const oc = vp?.getOverlayCanvas()
                    if (oc) { const ctx=oc.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,oc.width,oc.height) }
                    setSolids(prev=>prev.filter(s=>s.id!=='__preview__'))
                    commitExtrude()
                  }}
                  style={{
                    padding:'4px 10px', background:'#FF3B5C', color:'#000',
                    border:'none', borderRadius:2, cursor:'pointer',
                    fontFamily:'monospace', fontSize:12, fontWeight:'bold',
                    boxShadow:'0 0 6px #FF3B5C',
                  }}
                >↵</button>
              </div>

            </div>
          </div>
          <div style={{color:'#556', fontSize:10, marginTop:6, textAlign:'center', letterSpacing:'0.04em'}}>
            {extrudeState.extentMode==='through'
              ? 'Cuts through entire solid'
              : `Move mouse to set depth${gridSnap ? ` (snap ${gridSizeMm}mm)` : ''} · type or ↵ to accept`} · Esc to cancel
          </div>
        </div>
      )}

      {/* ── Loft: persistent top banner ──────────────────────────────────────
          Shown the whole time a loft is in progress (from the moment Profile
          1's plane is picked until Finish/cancel), anchored to the TOP of the
          viewport — not tied to the profile's screen position like the old
          popup was, so it's always in the same, discoverable spot regardless
          of where/how big the sketch is. While actively sketching, it's just
          the "Loft Profile N" label; once a profile is finished (Finish
          Sketch, same trigger every sketch flow uses), it also shows the
          distance-to-next input and Previous/Next/Finish controls. */}
      {loftState && (
        <div style={{
          position: 'absolute',
          top: 70, left: sketchMode ? 72 : 112, right: 0,
          zIndex: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
          padding: '8px 16px',
          background: 'rgba(15,20,40,0.95)',
          borderBottom: '1.5px solid #33D5EC',
          fontFamily: 'monospace',
          pointerEvents: 'all',
        }}>
          <div style={{color:'#33D5EC', fontSize:13, fontWeight:'bold', letterSpacing:'0.04em'}}>
            LOFT · PROFILE {loftState.currentIdx+1}
          </div>

          {sketchMode ? (
            <div style={{color:'#6688aa', fontSize:11}}>
              Sketch a closed profile, then Finish Sketch
            </div>
          ) : (
            <>
              <div style={{display:'flex', gap:6, alignItems:'center'}}>
                <span style={{color:'#6688aa', fontSize:11}}>Distance to next</span>
                <div style={{
                  background:'#0a0e1a', border:'1px solid #2a3a5a', borderRadius:4,
                  padding:'2px 8px', display:'flex', alignItems:'center', gap:4,
                }}>
                  <input
                    autoFocus
                    value={loftState.distanceInput}
                    onChange={e=>setLoftState(prev=>({...prev, distanceInput:e.target.value}))}
                    onKeyDown={e=>{
                      e.stopPropagation()
                      if (e.key==='Enter') loftNextProfile()
                      else if (e.key==='Escape') resetLoft3D()
                    }}
                    style={{
                      background:'none', border:'none', outline:'none',
                      color:'#dce8ff', fontFamily:'monospace', fontSize:13, fontWeight:'bold', width:46,
                    }}
                  />
                  <span style={{color:'#6688aa', fontSize:11}}>mm</span>
                </div>
              </div>
              <div style={{display:'flex', gap:6}}>
                <button
                  onClick={loftPreviousProfile}
                  disabled={loftState.currentIdx===0}
                  title="Previous profile"
                  style={{
                    padding:'4px 10px', fontSize:12, fontFamily:'monospace', fontWeight:'bold',
                    background:'#1e1e38', color: loftState.currentIdx===0 ? '#334455' : '#6688aa',
                    border:'1px solid #2a3a5a', borderRadius:4,
                    cursor: loftState.currentIdx===0 ? 'default' : 'pointer',
                  }}
                >◀ Prev</button>
                <button
                  onClick={loftNextProfile}
                  title="Next profile"
                  style={{
                    padding:'4px 10px', fontSize:12, fontFamily:'monospace', fontWeight:'bold',
                    background:'#33D5EC', color:'#0a0e1a', border:'none', borderRadius:4, cursor:'pointer',
                  }}
                >Next ▶</button>
                <button
                  onClick={commitLoft}
                  disabled={loftState.profiles.filter(Boolean).length < 2}
                  title="Finish loft"
                  style={{
                    padding:'4px 10px', fontSize:12, fontFamily:'monospace', fontWeight:'bold',
                    background: loftState.profiles.filter(Boolean).length < 2 ? '#1e1e38' : '#4caf50',
                    color: loftState.profiles.filter(Boolean).length < 2 ? '#334455' : '#fff',
                    border:'none', borderRadius:4,
                    cursor: loftState.profiles.filter(Boolean).length < 2 ? 'default' : 'pointer',
                  }}
                >✓ Finish</button>
              </div>
              <div style={{color:'#445566', fontSize:10}}>
                {loftState.profiles.filter(Boolean).length < 2 ? 'Need 2+ profiles to finish' : 'Esc to cancel'}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Fillet: "still picking edges" hint (shown before Enter/Tab accepts) ── */}
      {tool==='fillet3d' && !fillet3dAccepted && fillet3dSel.length>0 && fillet3dHandlePos && (
        <div style={{
          position: 'fixed',
          left: fillet3dHandlePos.x,
          top:  fillet3dHandlePos.y,
          zIndex: 1000,
          background: 'rgba(15,20,40,0.95)',
          border: '1.5px solid #9c6ade',
          borderRadius: 8,
          padding: '6px 12px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#dce8ff',
          whiteSpace: 'nowrap',
        }}>
          {fillet3dSel.length} edge{fillet3dSel.length!==1?'s':''} selected · ↵ to set radius · Esc to clear
        </div>
      )}

      {/* ── Fillet popup (radius only — edges already picked) ─────────────── */}
      {fillet3dAccepted && fillet3dHandlePos && (
        <div style={{
          position: 'fixed',
          left: fillet3dHandlePos.x,
          top:  fillet3dHandlePos.y,
          zIndex: 1000,
          background: 'rgba(15,20,40,0.95)',
          border: '1.5px solid #9c6ade',
          borderRadius: 8,
          padding: '10px 14px',
          minWidth: 180,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          fontFamily: 'monospace',
        }}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <div style={{
              flex:1, background:'#0a0e1a', border:'1px solid #2a3a5a',
              borderRadius:4, padding:'4px 8px',
              display:'flex', alignItems:'center', justifyContent:'space-between',
            }}>
              <input
                autoFocus
                value={fillet3dRadiusInput}
                onChange={e=>setFillet3dRadiusInput(e.target.value)}
                onKeyDown={e=>{
                  e.stopPropagation()
                  if (e.key==='Enter') commitFillet3D()
                  else if (e.key==='Escape') resetFillet3D()
                }}
                style={{
                  background:'none', border:'none', outline:'none',
                  color:'#dce8ff', fontFamily:'monospace', fontSize:16,
                  fontWeight:'bold', width:70,
                }}
              />
              <span style={{color:'#6688aa', fontSize:12}}>mm</span>
            </div>
            <button
              onClick={()=>commitFillet3D()}
              style={{
                padding:'4px 10px', background:'#9c6ade', color:'#fff',
                border:'none', borderRadius:4, cursor:'pointer',
                fontFamily:'monospace', fontSize:12, fontWeight:'bold',
              }}
            >↵</button>
          </div>
          <div style={{color:'#445566', fontSize:10, marginTop:6, textAlign:'center'}}>
            Fillet radius{fillet3dSel.length>1 ? ` · ${fillet3dSel.length} edges` : ''} · ↵ to accept · Esc to cancel
          </div>
        </div>
      )}

      {/* ── Measure: "click second point" hint (pending distance pick) ───── */}
      {tool==='measure' && measureP1 && !measureResult && measureHandlePos && (
        <div style={{
          position: 'fixed',
          left: measureHandlePos.x,
          top:  measureHandlePos.y,
          zIndex: 1000,
          background: 'rgba(15,20,40,0.95)',
          border: '1.5px solid #4FC3F7',
          borderRadius: 8,
          padding: '6px 12px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#dce8ff',
          whiteSpace: 'nowrap',
        }}>
          Click second point · Esc to cancel
        </div>
      )}

      {/* ── Measure result popup ──────────────────────────────────────────── */}
      {tool==='measure' && measureResult && measureHandlePos && (
        <div style={{
          position: 'fixed',
          left: measureHandlePos.x,
          top:  measureHandlePos.y,
          zIndex: 1000,
          background: 'rgba(15,20,40,0.95)',
          border: '1.5px solid #4FC3F7',
          borderRadius: 8,
          padding: '10px 14px',
          minWidth: 170,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          fontFamily: 'monospace',
        }}>
          {measureResult.kind === 'straight' && (
            <div style={{color:'#dce8ff', fontSize:16, fontWeight:'bold'}}>
              Length: {measureResult.length.toFixed(2)} mm
            </div>
          )}
          {measureResult.kind === 'circular' && (
            <>
              <div style={{color:'#dce8ff', fontSize:16, fontWeight:'bold'}}>
                ⌀ {measureResult.diameter.toFixed(2)} mm
              </div>
              <div style={{color:'#6688aa', fontSize:11, marginTop:2}}>
                R {measureResult.radius.toFixed(2)} mm
              </div>
            </>
          )}
          {measureResult.kind === 'curve' && (
            <div style={{color:'#dce8ff', fontSize:16, fontWeight:'bold'}}>
              Length: {measureResult.length.toFixed(2)} mm{' '}
              <span style={{fontSize:10, color:'#6688aa', fontWeight:'normal'}}>(curve)</span>
            </div>
          )}
          {measureResult.kind === 'distance' && (
            <>
              <div style={{color:'#dce8ff', fontSize:16, fontWeight:'bold'}}>
                Distance: {measureResult.distance.toFixed(2)} mm
              </div>
              <div style={{color:'#6688aa', fontSize:10, marginTop:2}}>
                ΔX {measureResult.dx.toFixed(2)} · ΔY {measureResult.dy.toFixed(2)} · ΔZ {measureResult.dz.toFixed(2)}
              </div>
            </>
          )}
          <div style={{color:'#445566', fontSize:10, marginTop:6, textAlign:'center'}}>
            Esc to clear · click new geometry to remeasure
          </div>
        </div>
      )}

      {/* ══ RIGHT FEATURE TREE ══════════════════════════════════════════════ */}
      <FeatureTree
        features={features}
        activeSketchId={activeSketchId}
        sketchMode={sketchMode}
        onEditSketch={handleEditSketch}
        onToggleVisible={handleToggleSketchVisible}
        onDelete={handleDeleteFeature}
        onRename={handleRenameFeature}
        onEditDepth={handleEditExtrudeDepth}
        onEditExtent={handleEditExtent}
        onEditFilletRadius={handleEditFilletRadius}
        mirrorPickActive={tool==='mirror3d' && !mirror3dSourceFeatureId}
        onPickMirrorSource={handlePickMirror3DSource}
        joinPickActive={tool==='join3d'}
        joinSel={joinSel}
        onToggleJoinMember={handleToggleJoinMember}
        onEditLoft={handleEditLoft}
      />

      {/* Hidden file input */}
      <input ref={loadFileRef} type="file" accept=".json" style={{display:'none'}}
        onChange={async e=>{
          const file=e.target.files[0];e.target.value=''
          if (!file) return
          try {
            const data=await loadJSON(file)
            if (data.dims) setDims(data.dims)
            commit(snapshot())
            setLines(data.lines);setCircles(data.circles);setArcs(data.arcs);setSplines(data.splines||[])
            resetDrawState()
          } catch(err) {setLoadError(err.message);setTimeout(()=>setLoadError(null),3000)}
        }}
      />
      {loadError&&<div style={{position:'fixed',top:10,left:'50%',transform:'translateX(-50%)',background:'#b71c1c',color:'white',padding:'6px 16px',borderRadius:4,fontFamily:'monospace',fontSize:12,pointerEvents:'none'}}>⚠ {loadError}</div>}
      {tKeyDown&&(tool==='line'||tool==='circle')&&<div style={{position:'fixed',top:10,right:10,background:'#E91E6399',color:'white',padding:'3px 10px',borderRadius:4,fontFamily:'monospace',fontSize:11,fontWeight:'bold',pointerEvents:'none'}}>TAN</div>}
      {pKeyDown&&tool==='line'&&<div style={{position:'fixed',top:10,right:60,background:'#00BCD499',color:'white',padding:'3px 10px',borderRadius:4,fontFamily:'monospace',fontSize:11,fontWeight:'bold',pointerEvents:'none'}}>PERP</div>}


      {traceOpen&&traceInsertPt&&(
        <TracerPanel
          insertPt={traceInsertPt}
          onImport={({lines:iLines,circles:iCircles,arcs:iArcs})=>{
            // Same planeTag() fix as TextPanel's onImport below — without it,
            // traced geometry has no plane/facePlane info and silently
            // defaults to XY everywhere it's consumed, so tracing while
            // sketching on XZ/YZ/a face would draw fine (the overlay ignores
            // plane) but get excluded from detectProfiles at Finish Sketch —
            // a "no profile found" with no obvious cause.
            const tag = planeTag()
            commit(snapshot())
            setLines(p=>[...p,...iLines.map(l=>({...l,...tag}))])
            setCircles(p=>[...p,...iCircles.map(c=>({...c,...tag}))])
            setArcs(p=>[...p,...iArcs.map(a=>({...a,...tag}))])
            resetTrace();setTool('select')
          }}
          onClose={()=>{resetTrace();setTool('select')}}
        />
      )}

      {pageSetupOpen&&(
        <PageSetupPanel
          lines={lines} circles={circles} arcs={arcs} splines={splines} dims={dims}
          pxToMm={pxToMm} mmToPx={mmToPx}
          pageConfig={pageConfig} setPageConfig={setPageConfig}
          onClose={()=>setPageSetupOpen(false)}
        />
      )}
      {textOpen&&(
        <TextPanel
          insertPt={textInsertPt}
          mmToPx={mmToPx}
          onImport={newSplines=>{
            // planeTag() was previously missing here — text imported while
            // sketching on a named plane other than XY, or on a face, had no
            // plane/facePlane info at all (silently defaulted to XY elsewhere).
            // textId ties all contours from one Import click together so the
            // extrude tool can treat a whole word as one selectable group and
            // correctly nest hole contours (the counter in O/A/8/etc.) under
            // their own letter, not some other letter's.
            const textId = `text-${Date.now()}`
            commit(snapshot())
            setSplines(p=>[...p, ...newSplines.map(sp=>({...sp, textId, ...planeTag()}))])
            resetText();setTool('line')
          }}
          onClose={()=>{resetText();setTool('line')}}
        />
      )}
    </div>
  )
}

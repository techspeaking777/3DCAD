import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as THREE from 'three'
import viewOpIconSheet from './assets/view-op-icons.png'
import Viewport3D from './Viewport3D.jsx'
import { planeColor, planeAxisLabels, sketchToWorld, worldToSketch } from './SketchPlane.js'
import { FacePlane, fitCircleLeastSquares, fitArcToRun, distToLine } from './FacePlane.js'
import { pxToMm, mmToPx, ALIGN_SNAP_DIST, ACQUIRE_DIST, SELECT_DIST, LINE_SNAP_DIST, SNAP_DIST, norm2pi, zoomRef, trackingDist } from './constants.js'
import { angleOnArc, computeAllIntersections, circleCircleIntersect } from './geometry/intersections.js'
import { getGeoSnap, getAllSnapPoints, checkAngle, checkAngleTight, getAngleSnap, applyTracking, computeLiveAngle, getTanPtsOnCircle, getExternalTangentPairs, nearestPt, nearestOnSegment } from './geometry/snap.js'
import { computeTrimPreview, performTrim, computeDeletePreview, distToSeg } from './tools/trimDelete.js'
import { nearestOffsetEntity, computeOffsetPreview, distToEntity } from './tools/offsetMath.js'
import { nearestMirrorEntity, buildMirror } from './tools/mirrorMath.js'
import { nearestMoveCopyEntity, buildCopies, removeSelected } from './tools/moveCopyMath.js'
import { nearestRotateCopyEntity, rotatePoint, buildRotatedCopies } from './tools/rotateCopyMath.js'
import { nearestScaleEntity, buildScaled } from './tools/scaleMath.js'
import { nearestFilletLine, computeFillet } from './tools/filletMath.js'
import { computeExtendPreview } from './tools/extendMath.js'
import { sampleSpline, nearestSpline, computeSplineTrimPreview, performSplineTrim, distToSpline } from './tools/splineMath.js'
import { selectionBBox, entityBBox, getBBoxHandles, hitTestHandles, computeHandleTransform, applySelectionTransform } from './tools/selectMath.js'
import { drawLineIndicator, drawHVIndicator, drawTracks, drawLabel, drawPreviewLine, perpLabelOffset } from './draw/drawHelpers.js'
import { useHistory } from './tools/history.js'
import { saveJSON, loadJSON, exportDXF, parseDXF, saveProjectAs, canPickSaveLocation, exportFaceDXF as writeFaceDXF, saveBlobAs, saveProjectFileAs, loadProjectFile } from './tools/saveLoad.js'
import { detectProfiles, buildSolid, pickProfile } from './tools/extrudeMath.js'
import { cadEngine } from './cadEngine.js'
import { replicadMeshToThree } from './cadMesh.js'
import TracerPanel from './tools/TracerPanel.jsx'
import TextPanel from './tools/TextPanel.jsx'
import PageSetupPanel from './tools/PageSetupPanel.jsx'
import GuidePanel from './tools/GuidePanel.jsx'
import SaveAsPanel from './tools/SaveAsPanel.jsx'
import SplashScreen from './SplashScreen.jsx'
import LineSnapPanel from './tools/LineSnapPanel.jsx'
import CircleSnapPanel from './tools/CircleSnapPanel.jsx'
import SplineSnapPanel from './tools/SplineSnapPanel.jsx'
import CopyModePanel from './tools/CopyModePanel.jsx'
import ResizeScalePanel from './tools/ResizeScalePanel.jsx'
import MirrorPanel from './tools/MirrorPanel.jsx'
import CenterPanel from './tools/CenterPanel.jsx'
import FilletRadiusPanel from './tools/FilletRadiusPanel.jsx'
import OffsetDistPanel from './tools/OffsetDistPanel.jsx'
import SelectDimPanel from './tools/SelectDimPanel.jsx'
import { useDraggablePanel, DragHandle } from './tools/useDraggablePanel.jsx'
import {
  IconLine, IconCircle, IconTrim, IconDelete, IconExtend, IconOffset,
  IconMirror, IconCenter, IconMoveCopy, IconRotateCopy, IconResize, IconFillet, IconTrace, IconGuide,
  IconUndo, IconRedo, IconFitView, IconReframe, IconNew, IconSave, IconLoad, IconDXF, IconSpline, IconText, IconSelect, IconJoin, IconDim, IconAxis,
  IconIncludeEdge,
  IconExtrude3D, IconCutout3D, IconFillet3D, IconMirror3D, IconLoft3D, IconJoin3D, IconMeasure3D, IconMoveCopy3D,
} from './draw/ToolIcons.jsx'
import { glowStroke, glowFill } from './draw/vectorTheme.js'

// Vector-arcade icons for the six 3D solid-op sidebar tools (see
// draw/ToolIcons.jsx's "3D-ENVIRONMENT VECTOR ICONS" section) — replaces
// the old solid-icons.png raster sprite sheet.
const SOLID_ICON_COMPONENTS = {
  extrude: IconExtrude3D, cutout: IconCutout3D, fillet3d: IconFillet3D,
  mirror3d: IconMirror3D, loft3d: IconLoft3D, join3d: IconJoin3D, movecopy3d: IconMoveCopy3D,
  // Reuses the additive Loft icon's shape, rendered in Cutout's color (see
  // the button color below) — same "one glyph, color signals cut variant"
  // convention Extrude/Cutout already lean on, no separate icon needed.
  loftcutout: IconLoft3D,
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
  // Loft cutout (see commitLoft's isLoftCutout branch) — profiles/normal/
  // origin/uAxis are already plain mm/unit-vector arrays on the feature
  // (same shape buildBaseWorkerParams' own loft branch reads off a `solid`
  // object), so no facePlaneParams wrapping needed — the loft basis IS the
  // plane.
  if (cutFeat.profiles) {
    return {
      profiles: cutFeat.profiles.map(p => ({ pts: p.pts, circle: p.circle, offsetMm: p.offsetMm })),
      normal: cutFeat.normal, origin: cutFeat.origin, uAxis: cutFeat.uAxis, ruled: !!cutFeat.ruled,
    }
  }
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
  // An imported STEP body's "recipe" is just its own file text — replayable
  // via cadWorker.js's buildBase(stepText branch)/importStep handler
  // exactly like every other base type, unlike join/mirror above (which
  // genuinely have no cold-rebuild path and rely on a warm shapeStore).
  if (solid.operation === 'import') return { stepText: solid.stepText }
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
//
// basis.normal is the SWEEP direction — for a loft cutout this is negated
// (see startLoftProfile1) so profiles step INTO the material, and that's
// also what offsets each profile's origin here. But FacePlane.normal feeds
// getCameraView(), which positions the camera at origin + normal*distance —
// if that were the (negated, into-material) sweep normal, the camera would
// snap to the FAR side of the profile from the viewer, looking back through
// the material. Same up vector (vAxis), but forward flips, which flips the
// camera's local right axis too — every click renders mirrored left-right
// from where the mouse actually is. basis.viewNormal is always the true
// outward-facing normal, kept separate from the sweep direction for exactly
// this reason — use it for the FacePlane's own orientation, falling back to
// basis.normal for older basis objects that predate this split.
function buildLoftFacePlane(basis, offsetMm) {
  const origin = basis.origin.clone().addScaledVector(basis.normal, mmToPx(offsetMm))
  return new FacePlane(origin, basis.viewNormal || basis.normal, basis.uAxis, basis.vAxis)
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
    // Loft's base params are shaped like {profiles,normal,origin,uAxis,ruled}
    // (see buildBaseWorkerParams' loft branch) — routing those through
    // cadEngine.extrude() would hand a pts/depthMm-shaped worker handler a
    // profiles array it doesn't understand. cadWorker.js's own buildBase()
    // already discriminates on params.profiles for exactly this reason; this
    // mirrors that same convention.
    : solid.operation === 'loft'
    ? await cadEngine.loft({ solidId: solid.id, ...baseWorkerParams })
    // An imported STEP body: baseWorkerParams is just {stepText} here (see
    // buildBaseWorkerParams' import branch) — re-running the same import
    // reproduces the identical shape, same as replaying any other recipe.
    : solid.operation === 'import'
    ? await cadEngine.importStep({ solidId: solid.id, ...baseWorkerParams })
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

// Cheap bounding-box estimate for a loft cutout's swept volume — same
// candidate-filter role as revolveSweepBoxPx above, just for a stack of
// profiles at increasing offsets along the shared loft normal instead of a
// revolve sweep. Each profile's own plane origin is derived the same way
// buildLoftFacePlane derives it (basis origin pushed out along the normal by
// that profile's offsetMm), and points project into world space the same way
// FacePlane.sketchToWorld does (uAxis for x, -vAxis for Y-down sketch y).
function loftSweepBoxPx(profiles, basis) {
  const allPts = []
  profiles.filter(Boolean).forEach(p => {
    const planeOrigin = basis.origin.clone().addScaledVector(basis.normal, mmToPx(p.offsetMm || 0))
    p.pts.forEach(pt => {
      allPts.push(new THREE.Vector3()
        .copy(planeOrigin)
        .addScaledVector(basis.uAxis, pt.x)
        .addScaledVector(basis.vAxis, -pt.y))
    })
  })
  return new THREE.Box3().setFromPoints(allPts)
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

// Live numeric input, anchored (via the parent action button's own
// position:relative wrapper in SmartStepBar — see the `popover` field on an
// action) directly above whichever button currently represents "commit".
// Shared between Mirror3D/Extrude's offset-plane and Move/Copy's drag
// distance so every tool's live-numeric UI reads identically, not just
// their SmartStepBar buttons. `label`/`unit` default to the original
// offset-plane wording so existing call sites don't need to change.
// Deliberately has no onKeyDown of its own — Enter is handled by each
// caller's own handleKeyDown block, relying on the keydown bubbling up
// naturally, so adding a local handler here would risk double-committing.
function OffsetDistancePopover({ color, value, onChange, label='OFFSET', unit='mm' }) {
  return (
    <div style={{
      position:'absolute', bottom:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)',
      zIndex:200, background:'rgba(12,12,26,0.97)', border:`2px solid ${color}`,
      borderRadius:8, padding:'10px 16px', display:'flex', alignItems:'center', gap:10, whiteSpace:'nowrap',
    }}>
      <span style={{fontFamily:'monospace',fontSize:11,fontWeight:'bold',color,letterSpacing:'0.08em'}}>{label}</span>
      <input
        type="number"
        autoFocus
        value={value}
        onChange={e=>onChange(e.target.value)}
        style={{width:70,textAlign:'center',fontFamily:'monospace',fontSize:14,fontWeight:'bold',
          background:'#0d0d1a',color:'#fff',border:`2px solid ${color}`,borderRadius:6,padding:'4px 6px'}}
      />
      <span style={{fontFamily:'monospace',fontSize:11,color:'#888'}}>{unit}</span>
    </div>
  )
}

function SmartStepBar({ op, currentStep, color, onStepBack, steps = EXTRUDE_STEPS, hint = null, action = null }) {
  if (!op) return null
  // `action` accepts either a single {label,enabled,onClick} (every existing
  // call site) or an array of them, for tools that need more than one
  // independent button in the bar at once (e.g. Extrude's "Hide/Show Planes"
  // alongside its own "+ Offset Plane" toggle — two genuinely unrelated
  // concerns, unlike Mirror's single action slot which only ever needs to
  // morph between one button's states).
  const actions = action ? (Array.isArray(action) ? action : [action]) : []

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

      {/* Optional visible confirm button — the clickable equivalent of
          whatever Enter/Tab/right-click already does, so open-ended
          selection-count steps (Join3D, Export STL) don't require knowing
          a hidden keyboard gesture. The keyboard shortcuts keep working.
          Each action can also carry a `popover` node (e.g. Mirror/Extrude's
          live offset-distance input) — wrapping the button in its own
          position:relative box and anchoring the popover with pure CSS
          (bottom:100%, centered) means it visually reads as belonging to
          that exact button with no ref/getBoundingClientRect bookkeeping,
          and it stays correctly placed even if the bar's layout shifts. */}
      {actions.map((a, i) => {
        // `active` is a separate concept from `enabled`: it's for a set of
        // mutually-exclusive toggle buttons (e.g. Move/Copy) where BOTH
        // stay clickable but only one should look "on" at a time — using
        // `enabled` alone for that (as the single old Move/Copy toggle
        // button did, flipping its own label between "Move"/"Copy") reads
        // as ambiguous: is the label naming the current mode, or the mode
        // clicking it switches TO? Two separate buttons with one clearly
        // highlighted removes that ambiguity. Omitting `active` keeps the
        // original always-filled look for every other existing call site.
        const isGhost = a.active === false
        return (
        <div key={i} style={{ position: 'relative', marginRight: 16 }}>
          <button
            onClick={a.onClick}
            disabled={!a.enabled}
            style={{
              padding:'5px 14px', borderRadius: 20,
              border: isGhost ? `1.5px solid ${color}88` : 'none',
              background: isGhost ? 'transparent' : (a.enabled ? color : '#2a2a4a'),
              color: isGhost ? color : (a.enabled ? '#0d0d1a' : '#666'),
              fontFamily:'monospace', fontWeight:'bold', fontSize: 11,
              cursor: a.enabled ? 'pointer' : 'default',
            }}>
            {a.label}
          </button>
          {a.popover}
        </div>
        )
      })}

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

// Per-operation accent color — reuses each tool's own established toolbar
// color (see ToolIcons.jsx's Icon*3D default `color` props) so a tree row
// reads as the same "thing" as its toolbar button rather than a separately
// invented palette. Revolve has no toolbar button of its own (triggered via
// the Axis tool inside a sketch), so it shares Extrude's gold.
function featureOpColor(feat) {
  if (feat.type === 'sketch') return '#4FC3F7'
  if (feat.type === 'fillet') return '#A470F2'
  const op = feat.operation || 'extrude'
  return {
    extrude: '#FBDA2D', revolve: '#FBDA2D', cutout: '#53D3E4',
    mirror: '#8E65F3', loft: '#FBDA2D', join: '#FFEE88', import: '#66BB6A',
  }[op] || '#FBDA2D'
}

// Small single-color line glyphs for the tree — the toolbar's own Icon*3D
// badges (ToolIcons.jsx) are full illustrations with glow/shadow filters
// meant for 70px buttons; shrunk to a 13px row icon they'd just be noise.
// These are deliberately minimal so they stay legible at that size.
function RowIcon({ kind, color, size=13 }) {
  const p = { fill:'none', stroke:color, strokeWidth:1.4, strokeLinecap:'round', strokeLinejoin:'round' }
  const shapes = {
    sketch:  <><rect x="2" y="2" width="9" height="9" {...p}/><line x1="2" y1="2" x2="11" y2="11" {...p}/></>,
    extrude: <path d="M6.5 11V3M3 6.5L6.5 3l3.5 3.5" {...p}/>,
    cutout:  <path d="M6.5 2v8M3 6.5L6.5 10l3.5-3.5" {...p}/>,
    revolve: <><path d="M10.5 6.5a4 4 0 1 1-1.3-2.95" {...p}/><path d="M10.8 2.2l.3 2.4-2.4-.4" {...p}/></>,
    fillet:  <path d="M2 10q0-8 8-8" {...p}/>,
    mirror:  <><line x1="6.5" y1="1" x2="6.5" y2="12" strokeDasharray="1.5 1.5" {...p}/><path d="M4.5 4L2.5 5.5 4.5 7" {...p}/><path d="M8.5 4l2 1.5-2 1.5" {...p}/></>,
    join:    <><circle cx="5" cy="6.5" r="3.5" {...p}/><circle cx="8" cy="6.5" r="3.5" {...p}/></>,
    loft:    <><rect x="4" y="1.5" width="5" height="2.5" {...p}/><rect x="1.5" y="8" width="10" height="2.5" {...p}/><line x1="4.5" y1="4" x2="2.5" y2="8" {...p}/><line x1="8.5" y1="4" x2="9.5" y2="8" {...p}/></>,
    import:  <><path d="M6.5 1v6M4 4.5l2.5 2.5L9 4.5" {...p}/><path d="M2 9.5h9" {...p}/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 13 13" style={{flexShrink:0}}>{shapes[kind]}</svg>
}

// Tiny padlock for locked (joined-away) rows — standalone so it never fights
// the type-specific RowIcon above for space or color.
function LockGlyph({ color='#8899aa' }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" style={{flexShrink:0}}>
      <rect x="1.5" y="4.5" width="7" height="5" rx="1" fill="none" stroke={color} strokeWidth="1.2"/>
      <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" fill="none" stroke={color} strokeWidth="1.2"/>
    </svg>
  )
}

// "Edit sketch/profile" action icon — was the same ⚙ as "edit extent", making
// the two indistinguishable whenever a row shows both buttons (e.g. a
// cutout has separate profile-edit and extent-edit actions side by side).
function PencilGlyph({ color='#7fa8cc' }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" style={{flexShrink:0}}>
      <path d="M1.5 9.5l.6-2.4 5-5 1.8 1.8-5 5-2.4.6z" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M6 3.1l1.8 1.8" stroke={color} strokeWidth="1.2"/>
    </svg>
  )
}

// "Edit extent/radius/angle" action icon — a dimension caliper, used for any
// action that adjusts a single numeric magnitude (extrude/cutout extent,
// fillet radius), kept visually distinct from PencilGlyph above.
function RulerGlyph({ color='#7fa8cc' }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" style={{flexShrink:0}}>
      <line x1="1.5" y1="1" x2="1.5" y2="10" stroke={color} strokeWidth="1.2"/>
      <line x1="9.5" y1="1" x2="9.5" y2="10" stroke={color} strokeWidth="1.2"/>
      <path d="M1.5 5.5h8M3 4l-1.5 1.5L3 7M8 4l1.5 1.5L8 7" fill="none" stroke={color} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// "Extrude this sketch" row action — a block with an arrow pushing up out of
// it, echoing the ▶/◀▶ direction icons used in the Set Depth popup.
function ExtrudeGlyph({ color='#7fa8cc' }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" style={{flexShrink:0}}>
      <rect x="1.5" y="5.5" width="8" height="4" fill="none" stroke={color} strokeWidth="1.1"/>
      <path d="M5.5 4.5V1M3.5 3l2-2 2 2" fill="none" stroke={color} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// "Cutout this sketch" row action — a block with a hole punched through it.
function CutoutGlyph({ color='#7fa8cc' }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" style={{flexShrink:0}}>
      <rect x="1" y="1" width="9" height="9" fill="none" stroke={color} strokeWidth="1.1"/>
      <rect x="3.5" y="3.5" width="4" height="4" fill="none" stroke={color} strokeWidth="1.1" strokeDasharray="1.2 1"/>
    </svg>
  )
}

function FeatureTree({ features, activeSketchId, sketchMode, onEditSketch, onToggleVisible, onDelete, onRename, onEditDepth, onEditExtent, onEditFilletRadius, onEditLoft, hiddenSolidIds, onToggleBodyVisible, onConvertSketch, hasSolids }) {
  const [editingName, setEditingName] = useState(null)
  const [editDepthId, setEditDepthId] = useState(null)
  const [depthVal, setDepthVal]       = useState('')

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
      width: 220, minWidth: 220, background: '#1a1a2e',
      borderLeft: '1px solid #2a2a4a', display: 'flex', flexDirection: 'column',
      fontFamily: 'monospace', fontSize: 12, overflowY: 'auto',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', background: '#141428', color: '#dce8ff',
        fontSize: 11, fontWeight: 'bold', letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #2a2a4a', flexShrink: 0,
      }}>
        <span>FEATURE TREE</span>
        <span style={{color:'#5a6b85', fontWeight:'normal'}}>
          {displayFeatures.length} item{displayFeatures.length!==1?'s':''}
        </span>
      </div>

      {/* Empty state */}
      {displayFeatures.length === 0 && (
        <div style={{margin:12, padding:'20px 12px', color:'#5a6b85', textAlign:'center',
          fontSize:11, letterSpacing:'0.04em', border:'1px dashed #2a2a4a', borderRadius:4}}>
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
          // A loft-cutout is stored as an ordinary operation:'cutout' feature
          // (see commitLoft's isLoftCutout branch) so it replays through the
          // same cutout machinery everywhere else, but it carries `profiles`
          // instead of `profilePts`/`planeId` — needs its own UI branches
          // wherever the tree assumed every cutout has the plain shape.
          const isLoftCutout = isExtrude && feat.operation === 'cutout' && !!feat.profiles
          const isLocked = !!feat.joinedInto
          // Only rows that own an independent solid can be hidden — a cutout
          // or fillet modifies an EXISTING body in place rather than creating
          // one, so there's nothing separate to hide.
          // Locked (joined-away) rows are excluded too: their own solid was
          // consumed into the Join's new body, so only the Join row's eye
          // icon does anything meaningful now. Mirror-operation rows are NOT
          // excluded from being joinable/mirrorable-again — rebuildJoinBaseMesh
          // already knows how to rebuild a mirror member from its source, and
          // blocking it just made "join a mirrored part to its original" — an
          // ordinary CAD operation — impossible.
          const isBodyOwner = isExtrude && !isLocked &&
            ['extrude','revolve','loft','mirror','join','import'].includes(feat.operation || 'extrude')
          const isBodyHidden = isBodyOwner && hiddenSolidIds?.includes(feat.solidId)
          const editingDepth = editDepthId === feat.id

          const rowKind = isSketch ? 'sketch' : isFillet ? 'fillet' : isMirror ? 'mirror'
            : isJoin ? 'join' : isLoft ? 'loft' : feat.operation === 'cutout' ? 'cutout'
            : feat.operation === 'revolve' ? 'revolve' : feat.operation === 'import' ? 'import' : 'extrude'
          const rowColor = featureOpColor(feat)

          const itemBg = isActiveSketch ? '#4FC3F722' : 'transparent'
          const borderLeft = `3px solid ${isActiveSketch ? '#4FC3F7' : rowColor + '55'}`

          return (
            <div key={feat.id}
              title={isLocked ? `Part of ${features.find(f=>f.id===feat.joinedInto)?.name || 'a Join'} — delete the join to edit` : undefined}
              style={{
              borderLeft, background: itemBg,
              padding: '6px 10px 6px 8px',
              borderBottom: '1px solid #2a2a4a',
              opacity: isLocked ? 0.5 : 1,
              cursor: isSketch ? 'pointer' : 'default',
            }}>
              {/* Feature header row */}
              <div style={{display:'flex', alignItems:'center', gap:6}}>
                {/* Icon */}
                <span style={{display:'flex', alignItems:'center', gap:3, flexShrink:0}}>
                  <RowIcon kind={rowKind} color={rowColor}/>
                  {isLocked && <LockGlyph/>}
                </span>

                {/* Name — double-click to rename */}
                {editingName === feat.id ? (
                  <input
                    autoFocus
                    defaultValue={feat.name}
                    style={{flex:1, fontSize:11, fontFamily:'monospace',
                      background:'#0d0d1a', color:'#dce8ff',
                      border:'1px solid #4FC3F7', borderRadius:3, padding:'1px 4px'}}
                    onBlur={e=>{ onRename(feat.id, e.target.value||feat.name); setEditingName(null) }}
                    onKeyDown={e=>{
                      if(e.key==='Enter'){ onRename(feat.id,e.target.value||feat.name); setEditingName(null) }
                      if(e.key==='Escape') setEditingName(null)
                    }}
                  />
                ) : (
                  <span
                    style={{flex:1, fontSize:11, fontWeight: isActiveSketch?'bold':'normal',
                      letterSpacing:'0.02em',
                      color: isActiveSketch?'#4FC3F7':'#c7d3e6'}}
                    onDoubleClick={()=>setEditingName(feat.id)}
                  >
                    {feat.name}
                  </span>
                )}

                {/* Action buttons */}
                <div style={{display:'flex', gap:2, flexShrink:0}}>
                  {isBodyOwner && (
                    <button
                      title={isBodyHidden?'Show body':'Hide body'}
                      onClick={e=>{e.stopPropagation(); onToggleBodyVisible(feat.id)}}
                      style={{background:'none',border:'none',cursor:'pointer',
                        padding:'1px 3px', fontSize:12, opacity: isBodyHidden?0.4:1,
                        color:'#7fa8cc'}}
                    >
                      {isBodyHidden ? '○' : '◉'}
                    </button>
                  )}
                  {isSketch && (
                    <>
                      {/* Visibility toggle */}
                      <button
                        title={feat.visible?'Hide sketch':'Show sketch'}
                        onClick={e=>{e.stopPropagation(); onToggleVisible(feat.id)}}
                        style={{background:'none',border:'none',cursor:'pointer',
                          padding:'1px 3px', fontSize:12, opacity: feat.visible?1:0.4,
                          color:'#7fa8cc'}}
                      >
                        {feat.visible ? '◉' : '○'}
                      </button>
                      {/* Edit — re-enter sketch */}
                      {!sketchMode && (
                        <button
                          title="Edit sketch"
                          onClick={e=>{e.stopPropagation(); onEditSketch(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', display:'flex', alignItems:'center'}}
                        >
                          <PencilGlyph/>
                        </button>
                      )}
                      {/* Extrude / Cutout — turn this flat sketch into a solid
                          in place, without redrawing it. Only shown once the
                          sketch actually closes into a shape (a bare
                          reference-line sketch has nothing to build from);
                          Cutout only makes sense once some solid exists to
                          cut into. */}
                      {!sketchMode && detectProfiles(feat.lines||[], feat.arcs||[], feat.planeId, feat.circles||[], feat.splines||[]).length > 0 && (
                        <>
                          <button
                            title="Extrude this sketch into a solid"
                            onClick={e=>{e.stopPropagation(); onConvertSketch(feat.id, 'extrude')}}
                            style={{background:'none',border:'none',cursor:'pointer',
                              padding:'1px 3px', display:'flex', alignItems:'center'}}
                          >
                            <ExtrudeGlyph/>
                          </button>
                          {hasSolids && (
                            <button
                              title="Cut this sketch out of an existing solid"
                              onClick={e=>{e.stopPropagation(); onConvertSketch(feat.id, 'cutout')}}
                              style={{background:'none',border:'none',cursor:'pointer',
                                padding:'1px 3px', display:'flex', alignItems:'center'}}
                            >
                              <CutoutGlyph/>
                            </button>
                          )}
                        </>
                      )}
                      {/* Delete sketch */}
                      <button
                        title="Delete sketch"
                        onClick={e=>{e.stopPropagation(); onDelete(feat.id)}}
                        style={{background:'none',border:'none',cursor:'pointer',
                          padding:'1px 3px', fontSize:11, color:'#ff6b5e'}}
                      >
                        ✕
                      </button>
                    </>
                  )}
                  {isExtrude && !isLocked && (
                    <>
                      {!sketchMode && (isLoft || isLoftCutout) && (
                        <button title="Edit loft profiles"
                          onClick={e=>{e.stopPropagation(); onEditLoft(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', display:'flex', alignItems:'center'}}
                        ><PencilGlyph/></button>
                      )}
                      {!sketchMode && !isLoft && !isLoftCutout && feat.sketchLines !== undefined && (
                        <button title="Edit sketch"
                          onClick={e=>{e.stopPropagation(); onEditSketch(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', display:'flex', alignItems:'center'}}
                        ><PencilGlyph/></button>
                      )}
                      {!sketchMode && !isMirror && !isJoin && !isLoft && !isLoftCutout && (
                        <button title={feat.operation==='cutout' ? 'Edit cutout extent' : 'Edit extrusion extent'}
                          onClick={e=>{e.stopPropagation(); onEditExtent(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', display:'flex', alignItems:'center'}}
                        ><RulerGlyph/></button>
                      )}
                      <button title="Delete"
                        onClick={e=>{e.stopPropagation(); onDelete(feat.id)}}
                        style={{background:'none',border:'none',cursor:'pointer',
                          padding:'1px 3px', fontSize:11, color:'#ff6b5e'}}
                      >✕</button>
                    </>
                  )}
                  {isFillet && (
                    <>
                      {!sketchMode && (
                        <button title="Edit fillet radius"
                          onClick={e=>{e.stopPropagation(); onEditFilletRadius(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', display:'flex', alignItems:'center'}}
                        ><RulerGlyph/></button>
                      )}
                      <button title="Delete"
                        onClick={e=>{e.stopPropagation(); onDelete(feat.id)}}
                        style={{background:'none',border:'none',cursor:'pointer',
                          padding:'1px 3px', fontSize:11, color:'#ff6b5e'}}
                      >✕</button>
                    </>
                  )}
                </div>
              </div>

              {/* Sketch subtitle */}
              {isSketch && (
                <div style={{color:'#8fa0b8', fontSize:10, marginLeft:20, marginTop:2}}>
                  {feat.planeId==='face' ? 'Face plane'
                    : feat.planeId==='XY' ? 'XY · Top'
                    : feat.planeId==='XZ' ? 'XZ · Front'
                    : feat.planeId==='YZ' ? 'YZ · Side'
                    : feat.planeId}
                  {' · '}{(feat.lines||[]).length + (feat.arcs||[]).length + (feat.circles||[]).length} entities
                  {isActiveSketch && <span style={{color:'#4FC3F7',marginLeft:6}}>● editing</span>}
                </div>
              )}

              {/* Mirror subtitle: colour + source feature + mirror plane */}
              {isMirror && (
                <div style={{marginLeft:20, marginTop:3}}>
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:feat.color||'#8E65F3', flexShrink:0}}/>
                    <span style={{color:'#8fa0b8', fontSize:10}}>
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
                    <span style={{color:'#8fa0b8', fontSize:10}}>
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
                      background:feat.color||'#FBDA2D', flexShrink:0}}/>
                    <span style={{color:'#8fa0b8', fontSize:10}}>
                      loft · {(feat.profiles||[]).length} profiles
                    </span>
                  </div>
                </div>
              )}

              {/* Loft cutout subtitle: colour + profile count */}
              {isLoftCutout && (
                <div style={{marginLeft:20, marginTop:3}}>
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:feat.color||'#e05a4e', flexShrink:0}}/>
                    <span style={{color:'#8fa0b8', fontSize:10}}>
                      {(feat.profiles||[]).length} profiles · loft cutout
                    </span>
                  </div>
                </div>
              )}

              {/* Extrude subtitle: colour + depth + operation */}
              {isExtrude && !isMirror && !isJoin && !isLoft && !isLoftCutout && (
                <div style={{marginLeft:20, marginTop:3}}>
                  <div style={{display:'flex', alignItems:'center', gap:5}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:feat.color||'#3a7bd5', flexShrink:0}}/>
                    <span style={{color:'#8fa0b8', fontSize:10}}>
                      {feat.operation==='import'
                        ? `${Math.round((feat.stepText?.length||0)/1024)}KB`
                        : feat.operation==='cutout'
                        ? (feat.revolveAxis ? `${feat.angleDeg ?? 360}°` : feat.extentMode==='through' ? '∞ through-all' : `${feat.depthMm||'?'}mm`)
                        : feat.operation==='revolve'
                        ? `${feat.angleDeg ?? 360}°`
                        : `${feat.depthMm||'?'}mm`
                      } · {feat.operation==='cutout' && feat.revolveAxis ? 'revolve cutout' : feat.operation==='import' ? 'STEP import' : (feat.operation||'extrude')}
                      {feat.operation==='cutout' && !feat.revolveAxis && feat.cutDirection && feat.cutDirection!=='both'
                        ? ` · ${feat.cutDirection}` : ''}
                      {feat.operation!=='cutout' && feat.operation!=='revolve' && feat.direction && feat.direction!=='both'
                        ? ` · ${feat.direction}` : ''}
                      {groupSize(feat) > 1 ? ` · ${groupSize(feat)} ${feat.operation==='cutout' ? 'holes' : 'bodies'}` : ''}
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
                    <span style={{color:'#8fa0b8', fontSize:10}}>
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

const App3D = forwardRef(function App3D(props, ref) {
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
  // Offset (parallel) plane for Extrude/Cutout step 1 — same idea as
  // Mirror3D's own offset-plane pick (mirror3dOffsetMode/Base/DistInput
  // below), kept as a separate parallel implementation rather than shared
  // state/functions since Loft's offset math (buildLoftFacePlane) is
  // likewise its own independent copy — this stays additive-only with zero
  // risk to Mirror's already-shipped behavior.
  const [extrudeOffsetMode,setExtrudeOffsetMode]=useState(false)
  const [extrudeOffsetBase,setExtrudeOffsetBase]=useState(null)
  const [extrudeOffsetDistInput,setExtrudeOffsetDistInput]=useState('20')
  const extrudePanelDrag = useDraggablePanel()
  const cutoutPanelDrag = useDraggablePanel()
  const loftPanelDrag = useDraggablePanel()
  const includeEdgePanelDrag = useDraggablePanel()

  const hiddenEditSolidRef=useRef(null)   // solid parked here while its sketch is being edited
  const [extrudeColor,setExtrudeColor]=useState('#3a7bd5')
  const [colorSel, setColorSel] = useState([])   // [solidId, ...] accumulated picks, "color" tool
  const colorPanelDrag = useDraggablePanel()
  const [cachedProfiles,setCachedProfiles]=useState([])
  const sketchBeforePlaneRef=useRef(null)
  const lastClickClientRef=useRef({x:0,y:0})

  // "What do you want to do with this?" prompt shown after Finish on a bare
  // (not-via-Extrude/Cutout) sketch that closes into a valid profile — see
  // handleFinishSketch's standalone-sketch branch and chooseSketchIntent.
  // { planeId, plane, isFace, editingId } | null
  const [sketchIntentPrompt, setSketchIntentPrompt] = useState(null)
  // convertingSketchIdRef + its cleanup effect are declared right after
  // `features` below — they reference it directly, and `features` isn't
  // initialized yet at this point in the component body.

  const [cadError, setCadError] = useState(null)
  const [saveToast, setSaveToast] = useState(null)
  function flashSaved(){ setSaveToast('Saved'); setTimeout(() => setSaveToast(null), 2000) }

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

  // Minimal surface exposed to AppShell/the Drawing tab — just enough to
  // populate OrthoViewsPanel's solid picker. Deliberately NOT lifting
  // features/solids state itself out of this component: cadEngine's
  // shapeStore (keyed by solidId) already holds the live shape for every
  // entry here the instant it's built/edited, so the Drawing tab can query
  // geometry straight from cadEngine with no further plumbing once it knows
  // which solidIds exist.
  useImperativeHandle(ref, () => ({
    getSolidIds() {
      return solids
        .filter(s => s.id !== '__preview__')
        .map(s => ({
          id: s.id,
          name: features.find(f => f.solidId === s.id)?.name || `Solid ${s.id}`,
          color: s.color,
          hidden: !!s.hidden,
        }))
    },
  }), [solids, features])

  // Set right before arming an extrude/cutout that's converting an EXISTING
  // standalone Sketch feature (from either the sketchIntentPrompt or a
  // feature-tree row button) — once the new solid feature actually lands in
  // `features`, the effect below removes the now-redundant flat sketch.
  // Cleared defensively on cancel so an abandoned conversion can never
  // delete an unrelated later sketch just because `features` happened to
  // grow again.
  const convertingSketchIdRef = useRef(null)
  const prevFeaturesLengthRef = useRef(0)
  useEffect(() => {
    const grew = features.length > prevFeaturesLengthRef.current
    prevFeaturesLengthRef.current = features.length
    if (grew && convertingSketchIdRef.current) {
      const idToRemove = convertingSketchIdRef.current
      convertingSketchIdRef.current = null
      setFeatures(prev => prev.filter(f => f.id !== idToRemove))
    }
  }, [features])
  const [activeSketchId,setActiveSketchId]=useState(null)  // which sketch is being edited
  const featureCountRef=useRef({sketch:0,extrude:0,cutout:0,fillet:0,mirror:0,join:0,loft:0})       // for auto-naming
  const [treeCollapsed,setTreeCollapsed]=useState(false)

  const viewport3dRef=useRef(null)
  const [tool,setTool]=useState(null)
  // Sketch-only tools' toolbar buttons only render while sketchMode is true,
  // but `tool` itself isn't reset just because sketchMode ends (most exit
  // paths — cancelFeature, finishing a feature, etc. — only clear sketchMode/
  // activePlane, not tool). Left alone, whatever sketch tool was active stays
  // selected, and handleClick's per-tool branches don't gate on sketchMode
  // (they don't need to while genuinely mid-sketch), so a stray left-click in
  // the plain 3D viewport would still, say, start drawing a line in sketch
  // space that doesn't belong to any visible sketch. Snapping back to
  // 'select' the moment sketchMode goes false closes that off in one place
  // instead of guarding every sketch tool's click handler individually.
  const ALWAYS_AVAILABLE_TOOLS = useRef(new Set(['select','extrude','cutout','fillet3d','measure','exportfacedxf','exportstl','exportstep','color','join3d','mirror3d','loft3d'])).current
  useEffect(() => {
    if (!sketchMode && tool && !ALWAYS_AVAILABLE_TOOLS.has(tool)) setTool('select')
  }, [sketchMode])
  const [lines,setLines]=useState([])
  // Face-plane sketching: snap onto the underlying solid's own edges/corners too,
  // not just onto other sketch geometry. activePlane.refSegments (set by
  // FacePlane.js's extractFaceBoundarySegments when the face was clicked) are
  // reference-only line segments merged in for snap detection — never rendered
  // or editable as real sketch geometry.
  const faceRefSegments = (activePlane && typeof activePlane === 'object' && activePlane.refSegments) || []
  const snapLines = faceRefSegments.length ? [...lines, ...faceRefSegments] : lines
  // Same idea as faceRefSegments/snapLines above, but for face-boundary loops
  // that fit a circle (see FacePlane.js's fitCircleIfRound) — e.g. the rim of
  // a cylinder's top face — so the existing center/quadrant/tangent snap
  // logic in getGeoSnap (which only scans circles/arcs) can find them too.
  const [circles,setCircles]=useState([])
  const faceRefCircles = (activePlane && typeof activePlane === 'object' && activePlane.refCircles) || []
  const snapCircles = faceRefCircles.length ? [...circles, ...faceRefCircles] : circles
  const [arcs,setArcs]=useState([])
  const faceRefArcs = (activePlane && typeof activePlane === 'object' && activePlane.refArcs) || []
  const snapArcs = faceRefArcs.length ? [...arcs, ...faceRefArcs] : arcs
  const [splines,setSplines]=useState([])
  const [dims,setDims]=useState([])  // dimension annotations

  // Spline in-progress state
  const [splinePoints,setSplinePoints]=useState([])   // [{x,y},...] being placed
  const [splineClosed,setSplineClosed]=useState(false) // C key toggles
  const [startPoint,setStartPoint]=useState(null)
  const [circleCenter,setCircleCenter]=useState(null)
  // Tangent-to-2-circles construction (T, click circle A, click circle B, type radius, Enter/click)
  const [circleTanA,setCircleTanA]=useState(null)
  const [circleTanB,setCircleTanB]=useState(null)
  // Line/Circle/Spline toolbar flyouts render at the top level (position:fixed,
  // anchored to the active tool button's measured screen rect) instead of as a
  // child of the left sidebar — that sidebar has overflowY:'auto' for its own
  // scrolling needs, and per the CSS spec once overflow-y is constrained,
  // overflow-x can no longer stay 'visible' either, so a position:absolute
  // popover anchored inside it (left:100%, popping out to the right) gets
  // silently clipped invisible. Same root cause Retro-CAD's own flyout work
  // hit and fixed by deleting its sidebar's overflow entirely — not an option
  // here since this sidebar's scrolling is load-bearing (10 tools can exceed
  // a short window's height), hence measuring out to a fixed-position render
  // instead of just removing the clip.
  const toolBtnRefs = useRef({})
  const [flyoutAnchor,setFlyoutAnchor] = useState(null)
  useEffect(() => {
    if (sketchMode && (tool==='line'||tool==='circle'||tool==='spline'||tool==='fillet'||tool==='offset'||tool==='includeedge')) {
      const el = toolBtnRefs.current[tool]
      if (el) {
        // Scroll the button into view first — the sidebar can hold more tools
        // than fit in a short window, and measuring before the scroll settles
        // (or without scrolling at all, if the button was activated while
        // still off-screen) anchors the flyout to a stale/off-canvas rect.
        el.scrollIntoView({block:'nearest'})
        requestAnimationFrame(() => {
          const r = el.getBoundingClientRect()
          setFlyoutAnchor({top:r.top, right:r.right})
        })
        return
      }
    }
    setFlyoutAnchor(null)
  }, [tool, sketchMode])
  const [mousePos,setMousePos]=useState(null)
  // Include Edge (sketch tool): stays active across multiple picks — click any
  // edge on any solid to project it into the current sketch as a construction
  // line. Declared early (not near the rest of fillet3d's state) so it's
  // already initialized before the draw effect's dependency array below
  // references it.
  const [includeEdgeHover, setIncludeEdgeHover] = useState(null)   // {solidId, edgeId, point} | null
  const [includeEdgeSel, setIncludeEdgeSel] = useState([])         // [{solidId, edgeId}] picked so far this session
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
  const [rotateCopyPreview,setRotateCopyPreview]=useState(null)

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
  // Guide's toggle button only shows in the sketch profile environment (see
  // its render site) — GuidePanel itself has no close affordance of its own,
  // so leaving sketch mode while it's open would strand it open with no way
  // to dismiss it in the 3D environment.
  useEffect(() => { if (!sketchMode) setGuideOpen(false) }, [sketchMode])
  const [saveAsOpen,setSaveAsOpen]=useState(false)  // false | 'sketch' | 'project' — which save flow the SaveAsPanel fallback modal is for
  const [gridVisible,setGridVisible]=useState(true)
  // Extrude/Cutout step 1 (pick a work plane or face) only — work planes have
  // no depth occlusion against solids beyond the nearer-hit-wins raycast
  // resolution (see Viewport3D's handleMouseMoveInternal), so a face sitting
  // BEHIND a plane genuinely can't be picked without this: the plane really
  // is nearer at that pixel. Reset on every fresh activation rather than
  // persisting indefinitely — a stale "planes off" from a previous session
  // would otherwise silently make plane-picking impossible next time too.
  const [hidePlanesForExtrude,setHidePlanesForExtrude]=useState(false)
  const [gridSnap,setGridSnap]=useState(true)
  const [gridSizeMm,setGridSizeMm]=useState(10)
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
  const rootDivRef=useRef(null)
  const viewTransformRef=useRef({x:0,y:0,scale:1})
  const isPanningRef=useRef(false)
  const lastPanPosRef=useRef({x:0,y:0})

  // Keep viewTransformRef.scale in sync with Three.js camera zoom
  // (fired via onScaleChange callback from Viewport3D)
  useEffect(()=>{
    viewTransformRef.current=viewTransform
    zoomRef.scale=viewTransform.scale
  },[viewTransform])

  // Measures the root div itself (via ResizeObserver) rather than
  // window.innerWidth/innerHeight — when mounted inside AppShell's tab
  // layout, the available area is smaller than the full window (a tab bar
  // sits above it), so reading the window directly would overshoot by
  // whatever the shell's chrome takes up.
  useEffect(()=>{
    const el=rootDivRef.current
    if(!el) return
    const update=()=>setCanvasSize({w:el.clientWidth-56,h:el.clientHeight-52})
    update()
    const ro=new ResizeObserver(update)
    ro.observe(el)
    return ()=>ro.disconnect()
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
  const snapshot = () => ({ lines, circles, arcs, splines, dims })
  const restore = (snap) => { setLines(snap.lines); setCircles(snap.circles); setArcs(snap.arcs); setSplines(snap.splines||[]); setDims(snap.dims||[]) }

  // Separate history for the 3D feature tree — deliberately not unified with
  // the 2D sketch history above: different granularity (one committed
  // feature vs. every pixel-level edit) and different speed (async full-tree
  // rebuild through the OCC worker vs. instant array assignment). `commit`
  // here only ever needs the plain, serializable `features` array — restore
  // replays it from scratch via rebuildProjectFromFeatures (the exact same
  // path Open Project already uses), which is what lets this stay ignorant
  // of every commit function's own setSolids/rebuildDependentMirrors/
  // rebuildSolidChain internals rather than trying to hand-reverse them.
  const feat3d = useHistory()
  const [feat3dBusy, setFeat3DBusy] = useState(false)
  const restore3D = async (snap) => {
    setFeat3DBusy(true)
    try {
      const rebuilt = await rebuildProjectFromFeatures(snap)
      setFeatures(snap)
      setSolids(rebuilt)
    } catch (err) {
      setCadError('Undo/redo rebuild failed: ' + err.message)
      setTimeout(() => setCadError(null), 6000)
    } finally {
      setFeat3DBusy(false)
    }
  }

  const trackedPtsRef=useRef([])
  const splinePointsRef=useRef([])
  // Chain-line tracking: the Line tool keeps going from each placed
  // endpoint instead of stopping after one segment (see the tool==='line'
  // click handler). chainOriginRef is the chain's very first point, used to
  // detect "clicked back near where I started" and auto-close the loop;
  // chainStartLenRef is lines.length from just before the chain's first
  // segment, used by Escape to know how many trailing segments to discard.
  const chainOriginRef=useRef(null)
  const chainStartLenRef=useRef(0)
  const linesRef=useRef([])
  const circlesRef=useRef([])
  const arcsRef=useRef([])
  const splinesRef=useRef([])
  // Mirrors of snapLines/snapCircles/snapArcs (own geometry + the picked
  // face's own reference edges, see their declaration above) — updateTracking
  // is a stable useCallback([]) so it can only read fresh data through refs,
  // same reason every other working array gets a ref mirror in this file.
  // Without these it fell back to linesRef/circlesRef/arcsRef (own geometry
  // only), so a vertex that exists purely on the solid's ghost boundary could
  // be snapped to directly (getGeoSnap already used snapLines/snapCircles/
  // snapArcs) but could never become a tracked point — no horizontal/
  // vertical alignment guide ever appeared off a solid edge, only off
  // geometry you'd actually drawn yourself.
  const snapLinesRef=useRef([])
  const snapCirclesRef=useRef([])
  const snapArcsRef=useRef([])
  const loadFileRef=useRef(null)
  const loadProjectFileRef=useRef(null)
  const importStepFileRef=useRef(null)
  // Arcade attract-screen shown once per page load — "1 PLAYER"/"2 PLAYER"
  // map to New/Open Project (see SplashScreen.jsx). Dismissing via New is
  // just hiding the overlay (a fresh load is already a blank project);
  // dismissing via Open also fires the same file input the OPEN toolbar
  // button uses.
  const [showSplash, setShowSplash] = useState(true)
  // The FileSystemFileHandle from the last successful project save — lets
  // handleSaveProject silently re-write the SAME file on subsequent saves
  // instead of always re-opening the native picker and re-suggesting the
  // generic "drawing.trc" default (see saveProjectFileAs's comment). Reset
  // whenever a *different* project is loaded, so saves after Opening a file
  // don't silently overwrite the previous one.
  const projectFileHandleRef=useRef(null)
  const [loadError,setLoadError]=useState(null)
  useEffect(()=>{trackedPtsRef.current=trackedPts},[trackedPts])
  useEffect(()=>{splinePointsRef.current=splinePoints},[splinePoints])
  useEffect(()=>{linesRef.current=lines},[lines])
  useEffect(()=>{circlesRef.current=circles},[circles])
  useEffect(()=>{arcsRef.current=arcs},[arcs])
  useEffect(()=>{splinesRef.current=splines},[splines])
  useEffect(()=>{snapLinesRef.current=snapLines},[snapLines])
  useEffect(()=>{snapCirclesRef.current=snapCircles},[snapCircles])
  useEffect(()=>{snapArcsRef.current=snapArcs},[snapArcs])

  function resetDrawState(){
    setStartPoint(null);setCircleCenter(null)
    setCircleTanA(null);setCircleTanB(null)
    setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
    setTrackedPts([]);trackedPtsRef.current=[];setDeferredTangent(null);setTKeyDown(false);setPKeyDown(false);setPerpSourceLineIdx(null)
  }
  // Typing a length/distance and/or angle only locks that value in — placing
  // the actual line or move/copy still requires a canvas click (see
  // LineSnapPanel.jsx and CopyModePanel.jsx's Move distance+direction box,
  // which share this same dimInput/angleInput state). The existing Tab-key
  // single-field lock (below, in handleKeyDown) keeps working as a fallback;
  // this is the visible Lock-It-In button's handler.
  function applyDimAngleLock(){
    if (dimInput&&parseFloat(dimInput)>0) setDimLocked(true)
    if (angleInput&&parseFloat(angleInput)>=0) setAngleLocked(true)
  }
  // Circle tool: typing a radius only locks that value in — placing the
  // actual circle still requires a canvas click (see CircleSnapPanel.jsx).
  function applyCircleRadius(){
    if (dimInput&&parseFloat(dimInput)>0) setDimLocked(true)
  }
  // Save button / Ctrl+S: Chromium browsers get a native folder+filename dialog;
  // others fall back to a small filename prompt (still downloads to Downloads).
  async function handleSave(){
    if (canPickSaveLocation()) {
      const status = await saveProjectAs(lines,circles,arcs,splines,dims)
      if (status==='saved'||status==='downloaded') flashSaved()
    }
    else setSaveAsOpen('sketch')
  }

  // Whole-PROJECT save — the feature tree, not just whatever sketch happens
  // to be open (see handleSave/loadFileRef above, which stay scoped to a
  // single sketch's buffer and are only shown while sketching). This is what
  // the always-visible SAVE/OPEN toolbar buttons and Ctrl+S (outside sketch
  // mode) use.
  async function handleSaveProject(){
    if (canPickSaveLocation()) {
      try {
        const { status, handle } = await saveProjectFileAs(features, solids, 'drawing.trc', projectFileHandleRef.current, props.getSheetData?.())
        if (handle) projectFileHandleRef.current = handle
        if (status==='saved'||status==='downloaded') flashSaved()
      } catch (err) {
        setCadError('Save failed: ' + (err.message || String(err)))
        setTimeout(() => setCadError(null), 6000)
      }
    } else {
      setSaveAsOpen('project')
    }
  }

  // New Project — a full page reload rather than a soft in-memory reset.
  // Every solid lives as a replicad Shape in the cadWorker's shapeStore
  // (keyed by id), and there's no "clear all shapes" worker message —
  // resetting only React state would leave every old shape orphaned in the
  // worker, leaking for the rest of the session. A reload also guarantees a
  // truly clean slate for undo history, the worker connection, etc. — no
  // partial-reset edge cases to chase down.
  function handleNewProject(){
    if (features.length === 0 && solids.length === 0) { window.location.reload(); return }
    if (window.confirm('Start a new file? This discards everything currently on screen — save first if you want to keep it.')) {
      window.location.reload()
    }
  }

  // Clears every tool's in-progress state — used before loading a project,
  // since opening a new file replaces everything currently on screen. Chains
  // the existing per-tool reset*() helpers rather than re-deriving which
  // fields each one touches.
  function resetAllToolState(){
    resetDrawState(); resetSelection(); resetSpline(); resetOffset(); resetMirror(); resetCenter()
    resetMoveCopy(); resetRotateCopy(); resetResize(); resetFillet(); resetTrace(); resetDim(); resetJoin(); resetText(); resetIncludeEdge()
    resetMeasure(); resetMirror3D(); resetJoin3D(); resetLoft3D(); resetFillet3D(); resetExportSTL(); resetExportSTEP()
    setSketchMode(false); setActivePlane(null); setActiveSketchId(null)
    setTool('select')
    setLines([]); setCircles([]); setArcs([]); setSplines([])
    setExtrudeState(null); setExtrudeTool(null); setExtrudeHandlePos(null); setEditingFeatureId(null)
  }

  // Opens a .trc project: parses first (non-destructive), THEN clears the
  // current scene and replays every feature through cadEngine from scratch
  // via rebuildProjectFromFeatures — solids are never stored in the file
  // itself, only the feature tree that produces them. Falls back to the old
  // sketch-buffer-only format (pre-.trc save files) if the file has no
  // feature tree at all, importing it as a bare sketch with a clear notice
  // rather than a hard failure.
  async function handleOpenProject(file){
    let projectData = null, legacyData = null, parseErr = null
    try {
      projectData = await loadProjectFile(file)
    } catch (err) {
      parseErr = err
      try { legacyData = await loadJSON(file) } catch { /* neither format */ }
    }
    if (!projectData && !legacyData) {
      setLoadError(parseErr?.message || 'Could not open file')
      setTimeout(()=>setLoadError(null), 3000)
      return
    }
    resetAllToolState()
    // Opening a project reads it via a plain <input type="file"> (no
    // writable handle), and it's a DIFFERENT file from whatever was saved
    // before — clear the cached handle so the next Save prompts fresh
    // instead of silently overwriting the previous project.
    projectFileHandleRef.current = null
    if (projectData) {
      setFeatures(projectData.features)
      props.onSheetLoaded?.(projectData.sheet)
      try {
        const newSolids = await rebuildProjectFromFeatures(projectData.features)
        setSolids(newSolids)
        setLoadError(null)
      } catch (err) {
        setCadError('Project loaded but rebuild failed: ' + err.message)
        setTimeout(() => setCadError(null), 8000)
      }
    } else {
      if (legacyData.dims) setDims(legacyData.dims)
      setLines(legacyData.lines); setCircles(legacyData.circles); setArcs(legacyData.arcs); setSplines(legacyData.splines||[])
      setFeatures([]); setSolids([])
      setLoadError('Old-format file — loaded as a sketch only, no feature tree.')
      setTimeout(()=>setLoadError(null), 4000)
    }
  }

  // Imports a STEP file as a brand-new top-level solid body — same "push a
  // new solid+feature" shape as commitExtrude's plain (non-cutout) success
  // path, just with no sketch/profile involved: the whole shape comes from
  // the file itself (see cadEngine.importStep). Lands wherever the file's
  // own STEP-space coordinates place it — reposition afterward with Move/
  // Copy/Rotate/Snap Move, same as any other body. `feat.type` stays
  // 'extrude' (operation:'import' distinguishes it), matching how
  // revolve/loft/join/mirror/cutout are all 'extrude'-type variants too —
  // that's what keeps it flowing through baseFeatureForSolid and every
  // other "is this a real body" filter with no special-casing.
  async function handleImportStepFile(file) {
    const stepText = await file.text()
    const solidId = Date.now()
    const name = file.name.replace(/\.(step|stp)$/i, '')
    const color = extrudeColor
    feat3d.commit(features)
    try {
      const meshData = await cadEngine.importStep({ solidId, stepText })
      const group = replicadMeshToThree(meshData, color, solidId)
      setSolids(prev => [...prev, { id: solidId, group, operation:'import', stepText, color }])
      setFeatures(prev => [...prev, {
        id: `import-${solidId}`, type:'extrude', operation:'import',
        name, solidId, color, stepText,
      }])
    } catch (err) {
      setCadError('Import failed: ' + (err.message || String(err)))
      setTimeout(() => setCadError(null), 6000)
    }
  }

  // Solve for a circle of radius r externally tangent to both circleTanA and circleTanB.
  // Returns {best,candidates} (best = candidate nearest ref) or null if no fit / no radius yet.
  function tanCircleSolution(r, ref) {
    if (!circleTanA||!circleTanB||!(r>0)||!ref) return null
    const candidates=circleCircleIntersect(circleTanA.cx,circleTanA.cy,circleTanA.r+r,circleTanB.cx,circleTanB.cy,circleTanB.r+r)
    if (!candidates.length) return null
    return { best:nearestPt(candidates,ref), candidates }
  }

  // Approximate "what radius does the cursor imply" for the 2-tangent-circle construction.
  // There's no simple closed form (the centre depends on r too), so this averages the radius
  // each target circle would imply if the cursor were the new circle's centre — good enough
  // for a natural grow/shrink feel while the mouse moves, before an exact number is typed.
  function tanCircleGuessRadius(ref) {
    if (!circleTanA||!circleTanB||!ref) return 1
    const rA=Math.hypot(ref.x-circleTanA.cx,ref.y-circleTanA.cy)-circleTanA.r
    const rB=Math.hypot(ref.x-circleTanB.cx,ref.y-circleTanB.cy)-circleTanB.r
    return Math.max(1,(rA+rB)/2)
  }

  // Current radius for the 2-tangent-circle construction: typed value if present, else live mouse guess.
  function tanCircleCurrentRadius(ref) {
    return dimInput ? mmToPx(parseFloat(dimInput)||0) : tanCircleGuessRadius(ref)
  }

  function resetSelection(){
    setSelection([]);setSelectHover(null);setSelectLiveGeom(null)
    setSelectDimField(null);setSelectDimPending({});setSelectDimAnchor('mc')
    selectDragHandleRef.current=null;selectDragStartRef.current=null
    selectSnapshotRef.current=null;selectBBoxRef.current=null
  }
  // Style of the current Select-tool selection, for highlighting which
  // FIRM/CONST button is active in SelectDimPanel — just the first selected
  // entity's style (mixed-style selections show whichever comes first, same
  // convention the D-key toggle below already relied on).
  function getSelectionStyle(sel){
    for (const s of sel){
      if (s.kind==='line') return lines[s.idx]?.style ?? null
      if (s.kind==='circle') return circles[s.idx]?.style ?? null
      if (s.kind==='arc') return arcs[s.idx]?.style ?? null
      if (s.kind==='spline') return splines[s.idx]?.style ?? null
    }
    return null
  }
  // Shared by the D-key shortcut and SelectDimPanel's FIRM/CONST buttons —
  // sets (not toggles) every selected entity to the given style.
  function applySelectionStyle(newStyle){
    if (!(tool==='select'&&selection.length>0)) return
    commit(snapshot())
    setLines(p=>p.map((l,i)=>selection.some(s=>s.kind==='line'&&s.idx===i)?{...l,style:newStyle||undefined}:l))
    setCircles(p=>p.map((c,i)=>selection.some(s=>s.kind==='circle'&&s.idx===i)?{...c,style:newStyle||undefined}:c))
    setArcs(p=>p.map((a,i)=>selection.some(s=>s.kind==='arc'&&s.idx===i)?{...a,style:newStyle||undefined}:a))
    setSplines(p=>p.map((sp,i)=>selection.some(s=>s.kind==='spline'&&s.idx===i)?{...sp,style:newStyle||undefined}:sp))
  }
  // Shared by the blind Tab/Enter flow and the visible SelectDimPanel's Apply
  // button (see SelectDimPanel.jsx) — applies whichever dimension fields were
  // typed (Length/Angle for a line, Radius for a circle, Radius/Angle for an
  // arc, Width/Height for a multi-selection), keeping whichever bbox handle
  // is the current anchor fixed in place.
  function applySelectDims(finalPending){
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
          const ocx=c.cx,ocy=c.cy
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
  }
  function resetSpline(){
    setSplinePoints([]);setSplineClosed(false)
  }
  function resetOffset(){
    setOffsetEntity(null)
    setOffsetDistInput('')
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
    setRotateCopyHover(null);setRotateCopyPreview(null)
  }
  // Shared by the canvas "click to place" gesture (unlocked: click position
  // sets the angle via atan2) and locking the angle from CopyModePanel/Tab.
  // Once the angle is locked, the click's position carries no information
  // the commit needs (pivot + angle are already both known), so locking now
  // commits immediately instead of requiring a redundant second canvas
  // click — that click used to silently do nothing whenever it landed on
  // the still-open CopyModePanel overlay instead of the bare canvas under it.
  function commitRotateCopyPlacement(angleDeg){
    if (!startPoint) return
    const count=Math.max(1,parseInt(rotateCopyCountInput)||1)
    commit(snapshot())
    const copies=buildRotatedCopies(rotateCopySel,lines,circles,arcs,splines,startPoint.x,startPoint.y,angleDeg,count)
    const rcPt = planeTag()
    const rcLines=copies.newLines.map(l=>({...l,...rcPt}))
    const rcCircles=copies.newCircles.map(c=>({...c,...rcPt}))
    const rcArcs=copies.newArcs.map(a=>({...a,...rcPt}))
    const rcSplines=copies.newSplines.map(sp=>({...sp,...rcPt}))
    if (rotateCopyMode==='rotate'){const pruned=removeSelected(rotateCopySel,lines,circles,arcs,splines);setLines([...pruned.lines,...rcLines]);setCircles([...pruned.circles,...rcCircles]);setArcs([...pruned.arcs,...rcArcs]);setSplines([...pruned.splines,...rcSplines])}
    else{setLines(p=>[...p,...rcLines]);setCircles(p=>[...p,...rcCircles]);setArcs(p=>[...p,...rcArcs]);setSplines(p=>[...p,...rcSplines])}
    resetRotateCopy();resetDrawState()
  }
  function resetResize(){
    setResizeSel([]);setResizeAccepted(false)
    setResizeScaleInput('');setResizeHover(null)
  }
  function resetFillet(){
    setFilletSel([]);setFilletAccepted(false)
    setFilletRadiusInput('');setFilletHover(null);setFilletPreview(null)
  }
  // Shared by the blind Enter-key flow and the visible FilletRadiusPanel's
  // Apply button (see FilletRadiusPanel.jsx).
  function applyFillet(){
    if (!filletPreview||filletPreview.tooLarge) return
    const{newL1,newL2,arc}=filletPreview
    // Carry style from source lines through fillet
    const s1=lines[filletSel[0].idx]?.style
    const s2=lines[filletSel[1].idx]?.style
    commit(snapshot())
    // Same plane/facePlane tagging every other commit needs — see the
    // matching comment on the Mirror tool's commit, same bug class.
    const flPt = planeTag()
    setLines(p=>[...p.filter((_,i)=>!filletSel.some(s=>s.idx===i)),
      {...newL1,...(s1?{style:s1}:{}),...flPt},
      {...newL2,...(s2?{style:s2}:{}),...flPt}])
    setArcs(p=>[...p,{...arc,...flPt}])
    resetFillet()
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

  // Execute a drag-window select: add entities fully enclosed by rect to current
  // tool's selection — a window select in every mainstream CAD tool only picks
  // up geometry that's entirely inside the box, not anything the box merely
  // crosses. Compares each entity's own bounding box (entityBBox) against the
  // rect rather than testing individual points, so a line/circle/arc/spline
  // only counts as a hit when its full extent fits inside.
  function executeDragSelect(rect){
    const minX=Math.min(rect.x1,rect.x2),maxX=Math.max(rect.x1,rect.x2)
    const minY=Math.min(rect.y1,rect.y2),maxY=Math.max(rect.y1,rect.y2)
    const fullyIn=(kind,entity)=>{
      const b=entityBBox(kind,entity)
      return b.x1>=minX&&b.x2<=maxX&&b.y1>=minY&&b.y2<=maxY
    }
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
      if(fullyIn('line',l)) hits.push({kind:'line',idx})
    })
    circlesRef.current.forEach((c,idx)=>{
      if(c.ghostRef) return
      if(fullyIn('circle',c)) hits.push({kind:'circle',idx})
    })
    arcsRef.current.forEach((arc,idx)=>{
      if(arc.ghostRef) return
      if(fullyIn('arc',arc)) hits.push({kind:'arc',idx})
    })
    splinesRef.current.forEach((sp,idx)=>{
      if(sp.ghostRef) return
      if(fullyIn('spline',sp)) hits.push({kind:'spline',idx})
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

  // When a VERT/HORIZ alignment guide is active near a line, find exactly
  // where that guide crosses the line — otherwise the endpoint just floats
  // along the raw cursor position past the edge once tracking engages,
  // which reads as the line having "desnapped": you can drag straight
  // through the target edge without the endpoint ever landing on it.
  function intersectTrackWithLine(tp,isVertical,raw,candidateLines){
    const ld=LINE_SNAP_DIST/zoomRef.scale
    let best=null,bestDist=ld+1
    for (const l of candidateLines){
      const n=nearestOnSegment(raw.x,raw.y,l.x1,l.y1,l.x2,l.y2)
      if (n.dist<bestDist){bestDist=n.dist;best=l}
    }
    if (!best) return null
    const{x1,y1,x2,y2}=best
    if (isVertical){
      const dx=x2-x1
      if (Math.abs(dx)<1e-9) return null
      const t=(tp.x-x1)/dx
      if (t<-0.02||t>1.02) return null
      return{x:tp.x,y:y1+t*(y2-y1)}
    } else {
      const dy=y2-y1
      if (Math.abs(dy)<1e-9) return null
      const t=(tp.y-y1)/dy
      if (t<-0.02||t>1.02) return null
      return{x:x1+t*(x2-x1),y:tp.y}
    }
  }

  function computeEnd(start,raw,tracked){
    if (!dimLocked&&!angleLocked){
      const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,start,false,splines,intersectionPts)
      // 'online' is the weakest geo-snap tier (any point along an edge, not a
      // specific feature) — when an alignment track is actively engaged, let
      // it win instead, otherwise it could never apply near a solid edge:
      // the cursor is within LINE_SNAP_DIST of the edge (triggering online)
      // well before it's off the tracked vertical/horizontal line, so online
      // would always fire first and VERT/HORIZ would show but never snap.
      const ad=trackingDist(ALIGN_SNAP_DIST,zoomRef.scale)
      const activeTp=tracked.find(tp=>Math.abs(raw.y-tp.y)<ad||Math.abs(raw.x-tp.x)<ad)
      if (geo&&geo.type==='online'){
        // checkAngle uses an ANGLE tolerance (SNAP_ANGLE, widens in pixels the
        // farther geo is from start) to decide the HORIZ/VERT indicator label,
        // but activeTp above uses a small fixed-pixel DISTANCE tolerance
        // (ALIGN_SNAP_DIST) to decide whether the cursor is actually riding a
        // guide line closely enough to force the snap. A far-away online
        // point can pass the angle check (indicator shows HORIZ/VERT) while
        // failing the distance check (activeTp is null) — the label lies and
        // the endpoint never actually lands on the H/V line. `start` is
        // checked BEFORE activeTp (not as its fallback) — `tracked` can hold
        // some unrelated point the cursor merely brushed past earlier
        // (updateTracking auto-acquires anything within ACQUIRE_DIST), which
        // lingers as "active" for as long as the cursor's x OR y keeps
        // matching it (e.g. dragging straight down a vertical edge keeps any
        // earlier point at that same x "active" indefinitely). If that stale
        // point were preferred, it can hijack the wrong axis — a vertical
        // guide against a vertical edge has no crossing, silently falling
        // back to the unforced raw point while still claiming the label.
        // `start` is always the actually-relevant reference for this line, so
        // its own H/V reading against geo wins whenever it applies.
        const angleFromStart=checkAngleTight(start,geo)
        const guideTp=(angleFromStart?start:null)||activeTp
        if (guideTp){
          const isVertical=guideTp===start?angleFromStart==='vertical':Math.abs(raw.x-guideTp.x)<ad
          const hit=intersectTrackWithLine(guideTp,isVertical,raw,snapLines)
          // Snap exactly onto where the guide crosses the edge. If there's no
          // valid crossing (parallel, or the guide misses the segment), fall
          // through to plain tracking below rather than reusing the raw
          // online point — that's what caused the desnap symptom originally.
          if (hit) return{x:hit.x,y:hit.y,snapType:'online',angleSnap:checkAngle(start,hit),tracks:[]}
        }
        return{x:geo.x,y:geo.y,snapType:geo.type,angleSnap:angleFromStart,tracks:[]}
      } else if (geo&&geo.type!=='tan'){
        // Point-type snaps (endpoint/midpoint/center/quadrant) can't slide
        // like 'online' can — it's one fixed point. So "close enough to call
        // it horizontal" can't just be a label with no effect (that's the
        // exact bug above, in point form): if checkAngleTight says it's
        // genuinely close, actually snap that one axis onto start's line —
        // trading a few px of point precision for an honest indicator,
        // consistent with how the online branch above behaves. If it's not
        // close, don't show the indicator at all (no partial promises).
        const angleTight=checkAngleTight(start,geo)
        if (angleTight==='horizontal') return{x:geo.x,y:start.y,snapType:geo.type,angleSnap:angleTight,tracks:[]}
        if (angleTight==='vertical') return{x:start.x,y:geo.y,snapType:geo.type,angleSnap:angleTight,tracks:[]}
        return{x:geo.x,y:geo.y,snapType:geo.type,angleSnap:null,tracks:[]}
      }
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
    const allPts=getAllSnapPoints(snapLinesRef.current,snapCirclesRef.current,snapArcsRef.current,splinesRef.current)
    const current=trackedPtsRef.current
    for (const p of allPts){
      if (Math.hypot(pos.x-p.x,pos.y-p.y)<trackingDist(ACQUIRE_DIST,sc)){
        const already=current.some(tp=>Math.hypot(tp.x-p.x,tp.y-p.y)<2/sc)
        if (!already){const next=[...current,p];trackedPtsRef.current=next;setTrackedPts(next)}
        return
      }
    }
    // Sticky points (the current entity's own start/reference point, seeded
    // where the tool sets startPoint) never decay — they're the reason
    // VERT/HORIZ tracking exists at all near a solid edge, and ordinary
    // diagonal mouse movement drifts off one axis well before it lines up
    // on the other, so decaying them on every unaligned mousemove made
    // tracking off your own start point effectively unusable (it only
    // "came back" once the mouse happened to re-acquire a real snap point,
    // e.g. an edge's endpoint/midpoint). Only opportunistically-acquired
    // points (added by the loop above) still decay when you move away.
    const next=current.filter(tp=>{
      if (tp.sticky) return true
      const d=trackingDist(ALIGN_SNAP_DIST,sc)
      return Math.abs(pos.y-tp.y)<d||Math.abs(pos.x-tp.x)<d
    })
    if (next.length!==current.length){trackedPtsRef.current=next;setTrackedPts(next)}
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
    const distPx=offsetDistInput
      ? mmToPx(parseFloat(offsetDistInput)||0)
      : distToEntity(mousePos,entity,offsetEntity.kind)
    setOffsetPreview(computeOffsetPreview(entity,offsetEntity.kind,distPx,mousePos))
  },[tool,mousePos,offsetEntity,offsetDistInput,lines,circles,arcs,splines])

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

  // Live ghost preview once the rotate centre is picked — without this the
  // panel greys out and its hint text disappears the moment startPoint is
  // set (see CopyModePanel's `locked` prop), so the centre-point click had
  // zero visible feedback and looked like it "didn't work" even though the
  // state updated correctly underneath.
  useEffect(()=>{
    if (tool!=='rotatecopy'||!rotateCopyAccepted||!startPoint||!mousePos||!rotateCopySel.length){setRotateCopyPreview(null);return}
    const dx=mousePos.x-startPoint.x,dy=mousePos.y-startPoint.y
    let angleDeg=angleLocked?(parseFloat(angleInput)||0):(Math.atan2(dy,dx)*180/Math.PI)
    if (!angleLocked&&angleDeg<0) angleDeg+=360
    const count=Math.max(1,parseInt(rotateCopyCountInput)||1)
    setRotateCopyPreview(buildRotatedCopies(rotateCopySel,lines,circles,arcs,splines,startPoint.x,startPoint.y,angleDeg,count))
  },[tool,rotateCopyAccepted,startPoint,mousePos,rotateCopySel,angleInput,angleLocked,rotateCopyCountInput,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='mirror'||!mirrorAccepted||!mirrorP1||!mousePos||!mirrorSel.length){setMirrorPreview(null);return}
    const hSnap=getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,mirrorP1,false,splines,intersectionPts)
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
  // Prefers snapping exactly onto an endpoint or midpoint when the cursor is
  // close to one, instead of always using the raw perpendicular foot.
  function findNearestLineForPerp(mouse, lines, excludeIdx=null) {
    const snapDist = SELECT_DIST * 1.5 / zoomRef.scale
    let bestSnap=null, bestSnapDist=snapDist+1, bestSnapIdx=-1, bestSnapType=null
    lines.forEach((l,idx)=>{
      if (idx===excludeIdx) return
      const pts=[
        {x:l.x1,y:l.y1,type:'endpoint'},{x:l.x2,y:l.y2,type:'endpoint'},
        {x:(l.x1+l.x2)/2,y:(l.y1+l.y2)/2,type:'midpoint'},
      ]
      pts.forEach(p=>{
        const d=Math.hypot(mouse.x-p.x,mouse.y-p.y)
        if (d<bestSnapDist){bestSnapDist=d;bestSnap=p;bestSnapIdx=idx;bestSnapType=p.type}
      })
    })
    if (bestSnap) return { line:lines[bestSnapIdx], idx:bestSnapIdx, foot:bestSnap, isSnap:true, snapType:bestSnapType }

    const threshold = SELECT_DIST * 3 / zoomRef.scale
    let best=null, bestIdx=-1, bestDist=threshold+1
    lines.forEach((l,idx)=>{
      if (idx===excludeIdx) return   // skip source line
      const d=distToInfiniteLine(mouse.x,mouse.y,l.x1,l.y1,l.x2,l.y2)
      if (d<bestDist) { bestDist=d; best=l; bestIdx=idx }
    })
    if (!best) return null
    // Foot clamped to segment so indicator stays on the visible line
    return { line:best, idx:bestIdx, foot:calcPerpFoot(mouse.x,mouse.y,best.x1,best.y1,best.x2,best.y2,true), isSnap:false }
  }
  // Draw the perp indicator — right-angle square + PERP label (no circles, no arc symbols)
  function drawPerpIndicator(ctx, x, y, sc, labelDY=0) {
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
    ctx.fillText('PERP', s+4, -s+8+labelDY)
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
    // the same geometry used for snapping (activePlane.refSegments/refCircles/
    // refArcs, from FacePlane.js's faceHitToPlane). This was originally
    // snap-only (never rendered), but that made the reference geometry
    // invisible even though you could snap to it — draw a faint outline so
    // it's clear what's snappable. Circles/arcs are sampled into points (not
    // drawn with ctx.arc()) so they go through the same per-point
    // sketchToScreen transform the line segments already use, staying correct
    // under whatever screen transform is active rather than assuming a
    // uniform-scale circle stays a circle on screen.
    if (sketchMode && (faceRefSegments.length > 0 || faceRefCircles.length > 0 || faceRefArcs.length > 0)) {
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
        const strokeSweep = (cx, cy, r, a0, a1, steps) => {
          let started = false
          for (let i = 0; i <= steps; i++) {
            const a = a0 + (a1-a0)*i/steps
            const p = vp.sketchToScreen(cx+Math.cos(a)*r, cy+Math.sin(a)*r, 'face', activePlane)
            if (!p) { started = false; continue }
            if (!started) { ctx.beginPath(); ctx.moveTo(p.x, p.y); started = true }
            else ctx.lineTo(p.x, p.y)
          }
          if (started) ctx.stroke()
        }
        faceRefCircles.forEach(c => strokeSweep(c.cx, c.cy, c.r, 0, Math.PI*2, 48))
        faceRefArcs.forEach(a => strokeSweep(a.cx, a.cy, a.r, a.startAngle, a.endAngle,
          Math.max(6, Math.round(Math.abs(a.endAngle-a.startAngle) / (Math.PI/24)))))
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

              // ── Dock popup at the bottom of the viewport, above the
              // SmartStepBar — anchoring it to the centroid used to put it
              // right on top of the shape being extruded for small/nearby
              // profiles. A fixed, geometry-independent dock never overlaps
              // the canvas regardless of profile size or position.
              if (isSelected && cScreen) {
                const vpEl = vp.getDomElement?.()
                const vpRect = vpEl?.parentElement?.getBoundingClientRect?.()
                if (vpRect) {
                  // 200 clears the SmartStepBar (52px) plus the popup's own
                  // tallest variant (cutout, ~130px). Clamped against both
                  // vpRect and window.innerHeight — on layouts where the two
                  // disagree (e.g. viewport scaling), take whichever keeps
                  // the popup higher up, so it can never render past either.
                  setExtrudeHandlePos({
                    x: vpRect.left + vpRect.width / 2,
                    top: Math.min(vpRect.bottom - 200, window.innerHeight - 220),
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
    const {ctx,sc,scX,scY,vtx,vty}=over

    // In sketch mode: use dark colours on white background
    const sketchLineColor = sketchMode ? '#111111' : '#2196F3'
    const sketchHighlight = sketchMode ? '#0066cc' : '#64B5F6'

    // ── Grid dots (sketch mode only) ────────────────────────────────────────
    // Reference-grid dots at gridSizeMm spacing, drawn in the sketch's own
    // 2D pixel space so they line up correctly on any active plane (XY/XZ/
    // YZ/face) — unlike the 3D reference grid mesh, which only lies flat on
    // world XY and would be misaligned for other sketch planes. Gated on the
    // same gridVisible flag as the 3D grid so the GRID toolbar button
    // controls both instead of the sketch dots being permanently on.
    if (sketchMode && gridVisible) {
      const baseGridPx = mmToPx(gridSizeMm)
      if (baseGridPx > 0) {
        const xMin=(0-vtx)/scX, xMax=(canvasSize.w-vtx)/scX
        const yMin=(0-vty)/scY, yMax=(canvasSize.h-vty)/scY
        // Zoomed far out, gridSizeMm spacing would mean thousands of dots —
        // coarsen by doubling until the on-screen count is reasonable so the
        // grid stays visible (just less fine) instead of vanishing entirely.
        let gridPx = baseGridPx
        while ((xMax-xMin)/gridPx * (yMax-yMin)/gridPx > 6000) gridPx *= 2
        const x0=Math.floor(xMin/gridPx)*gridPx
        const y0=Math.floor(yMin/gridPx)*gridPx
        {
          ctx.save()
          ctx.fillStyle = 'rgba(196,196,204,0.35)'
          const r = 0.9/sc
          for (let x=x0; x<=xMax; x+=gridPx) {
            for (let y=y0; y<=yMax; y+=gridPx) {
              ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill()
            }
          }
          ctx.restore()
        }
      }
    }

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
      const dotR = 2/sc
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
      const isTanSel=(circleTanA&&circleTanA.circleIdx===idx)||(circleTanB&&circleTanB.circleIdx===idx)
      const color=isDelTarget?'#F44336':isMirSel||isCenSel||isMCSel||isRCSel||isRzSel||isTanSel?'#FF9800':isMirHov||isCenHov||isMCHov||isRCHov||isRzHov?'#FFD600':isSelHov||isSelected?'#64B5F6':null
      if (!color) return
      const lw=(isDelTarget||isMirSel||isCenSel||isMCSel||isRCSel||isRzSel||isTanSel?3:2)/sc
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
      const geo=getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,splinePoints[splinePoints.length-1],false,splines,intersectionPts)
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
      const distMm=offsetDistInput?parseFloat(offsetDistInput)||0:(offsetEntity&&mousePos?pxToMm(distToEntity(mousePos,offsetEntity.kind==='line'?drawLines[offsetEntity.idx]:offsetEntity.kind==='circle'?drawCircles[offsetEntity.idx]:offsetEntity.kind==='arc'?drawArcs[offsetEntity.idx]:drawSplines[offsetEntity.idx],offsetEntity.kind)):0)
      drawLabel(ctx,(offsetDistInput?'🔒 ':'')+distMm.toFixed(1)+' mm · click to place',mousePos.x,mousePos.y-24/sc,'#4CAF50',sc)
    }

    // ── Mirror axis + preview ──
    if (tool==='mirror'&&mirrorAccepted&&mirrorP1&&mousePos){
      ctx.save()
      const hSnap=getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,mirrorP1,false,splines,intersectionPts)
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
    if (tool==='rotatecopy'&&rotateCopyAccepted&&startPoint&&mousePos){
      ctx.save()
      ctx.strokeStyle='#00BCD4';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      ctx.beginPath();ctx.moveTo(startPoint.x,startPoint.y);ctx.lineTo(mousePos.x,mousePos.y);ctx.stroke();ctx.setLineDash([])
      ctx.save();ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc);ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#00BCD4';ctx.fill();ctx.restore()
      ctx.restore()
      if (rotateCopyPreview){
        ctx.save();ctx.strokeStyle='#80DEEA';ctx.lineWidth=1.5/sc;ctx.setLineDash([4/sc,3/sc])
        rotateCopyPreview.newLines.forEach(l=>{ctx.beginPath();ctx.moveTo(l.x1,l.y1);ctx.lineTo(l.x2,l.y2);ctx.stroke()})
        rotateCopyPreview.newCircles.forEach(c=>{ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke()})
        rotateCopyPreview.newArcs.forEach(a=>{ctx.beginPath();ctx.arc(a.cx,a.cy,a.r,a.startAngle,a.endAngle,false);ctx.stroke()})
        ;(rotateCopyPreview.newSplines||[]).forEach(sp=>{if(sp.points.length<2)return;const s2=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16);ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y);s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()})
        ctx.setLineDash([]);ctx.restore()
      }
    }
    if (tool==='mirror'&&mirrorAccepted&&!mirrorP1&&mousePos){
      const geo=getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,null,false,splines,intersectionPts)
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
        const snap=getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,{x:joinFirstPt.x,y:joinFirstPt.y},false,splines,intersectionPts)
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
    dims.forEach((dim,di)=>{
      const isDelTarget=tool==='delete'&&deletePreview?.kind==='dim'&&deletePreview.idx===di
      const dimColor=isDelTarget?'#F44336':'#ccc'
      ctx.save();ctx.strokeStyle=dimColor;ctx.fillStyle=dimColor
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
        ctx.save();ctx.translate(mx,my);ctx.scale(1/sc,1/sc);let ang=Math.atan2(uy,ux);if(ang>Math.PI/2||ang<-Math.PI/2)ang+=Math.PI;ctx.rotate(ang);ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle=dimColor;ctx.fillText(txt,0,-3);ctx.restore()
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

    // ── Dim tool live preview (rubber-band while placing) ──
    if (tool==='dim'&&dimToolPreview&&mousePos){
      ctx.save();ctx.strokeStyle='#E91E63';ctx.fillStyle='#E91E63';ctx.lineWidth=0.8/sc;ctx.setLineDash([4/sc,2/sc])
      const ARR=6/sc,FS=11/sc
      const p=dimToolPreview
      if (p.kind==='linear'){
        const dx=p.x2-p.x1,dy=p.y2-p.y1,len=Math.hypot(dx,dy)
        if(len>1){
          const ux=dx/len,uy=dy/len,nx=-uy,ny=ux,off=p.offset
          ctx.beginPath()
          ctx.moveTo(p.x1,p.y1);ctx.lineTo(p.x1+nx*(off+Math.sign(off||1)*ARR*1.5),p.y1+ny*(off+Math.sign(off||1)*ARR*1.5))
          ctx.moveTo(p.x2,p.y2);ctx.lineTo(p.x2+nx*(off+Math.sign(off||1)*ARR*1.5),p.y2+ny*(off+Math.sign(off||1)*ARR*1.5))
          ctx.moveTo(p.x1+nx*off,p.y1+ny*off);ctx.lineTo(p.x2+nx*off,p.y2+ny*off)
          ctx.stroke()
          const txt=pxToMm(len).toFixed(2)+' mm'
          const mx=(p.x1+p.x2)/2+nx*off,my=(p.y1+p.y2)/2+ny*off
          ctx.save();ctx.translate(mx,my);ctx.scale(1/sc,1/sc)
          let a=Math.atan2(uy,ux);if(a>Math.PI/2||a<-Math.PI/2) a+=Math.PI
          ctx.rotate(a);ctx.setLineDash([]);ctx.font=`${FS*sc}px sans-serif`
          ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,0,-3)
          ctx.restore()
        }
      } else if (p.kind==='diameter'){
        const cos=Math.cos(p.angle),sin=Math.sin(p.angle)
        ctx.beginPath();ctx.moveTo(p.cx-p.r*cos,p.cy-p.r*sin);ctx.lineTo(p.cx+p.r*cos,p.cy+p.r*sin);ctx.stroke()
        ctx.setLineDash([]);ctx.save();ctx.translate(p.cx,p.cy);ctx.scale(1/sc,1/sc)
        ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='bottom'
        ctx.fillText('⌀'+pxToMm(p.r*2).toFixed(2)+' mm',0,-3)
        ctx.restore()
      } else if (p.kind==='radius'){
        const ex=p.cx+p.r*Math.cos(p.angle),ey=p.cy+p.r*Math.sin(p.angle)
        ctx.beginPath();ctx.moveTo(p.cx,p.cy);ctx.lineTo(ex,ey);ctx.stroke()
        ctx.setLineDash([]);ctx.save();ctx.translate(ex,ey);ctx.scale(1/sc,1/sc)
        ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='left';ctx.textBaseline='bottom'
        ctx.fillText('R'+pxToMm(p.r).toFixed(2)+' mm',4,-3)
        ctx.restore()
      }
      // First/second clicked point dots
      if (dimToolPts.length>0){
        ctx.setLineDash([]);ctx.beginPath();ctx.arc(dimToolPts[0].x,dimToolPts[0].y,4/sc,0,Math.PI*2);ctx.fill()
      }
      if (dimToolPts.length>1){
        ctx.beginPath();ctx.arc(dimToolPts[1].x,dimToolPts[1].y,4/sc,0,Math.PI*2);ctx.fill()
      }
      ctx.restore()
    }

    if (!mousePos) return

    // ── Line tool rubber-band ──
    if (tool==='line'&&startPoint){
      // PERP mode: completely bypass tangent/snap system — the preview must
      // show the actual perpendicular-constrained endpoint the click will
      // commit (see the pKeyDown branch of the line-tool click handler),
      // not the plain snap-based preview, or the line looks unconstrained
      // right up until you click.
      if (pKeyDown){
        let endPt
        const fromMode=perpSourceLineIdx!==null && lines[perpSourceLineIdx]
        if (fromMode){
          const sl=lines[perpSourceLineIdx]
          const dx=sl.x2-sl.x1, dy=sl.y2-sl.y1, len=Math.hypot(dx,dy)
          if (len>1e-10){
            const px=-dy/len, py=dx/len
            const t=(mousePos.x-startPoint.x)*px+(mousePos.y-startPoint.y)*py
            endPt={x:startPoint.x+t*px, y:startPoint.y+t*py}
          } else endPt=mousePos
          drawPreviewLine(ctx,startPoint.x,startPoint.y,endPt.x,endPt.y,'#00BCD4',1,sc)
          ctx.save();ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc)
          ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#00BCD4';ctx.fill()
          ctx.restore()
          drawPerpIndicator(ctx,endPt.x,endPt.y,sc)
        } else {
          const hit=findNearestLineForPerp(mousePos,lines,perpSourceLineIdx)
          endPt=hit?hit.foot:mousePos
          drawPreviewLine(ctx,startPoint.x,startPoint.y,endPt.x,endPt.y,'#00BCD4',1,sc)
          ctx.save();ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc)
          ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#00BCD4';ctx.fill()
          ctx.restore()
          if (hit){
            if (hit.isSnap) drawLineIndicator(ctx,endPt.x,endPt.y,hit.snapType,sc)
            drawPerpIndicator(ctx,endPt.x,endPt.y,sc,hit.isSnap?14:0)
          }
        }
        const lenMm=pxToMm(Math.hypot(endPt.x-startPoint.x,endPt.y-startPoint.y))
        const midX=(startPoint.x+endPt.x)/2,midY=(startPoint.y+endPt.y)/2
        const dimOff=perpLabelOffset(endPt.x-startPoint.x,endPt.y-startPoint.y,16/sc)
        drawLabel(ctx,(dimLocked?'🔒 ':'')+lenMm.toFixed(1)+' mm',midX+dimOff.x,midY+dimOff.y,'#00BCD4',sc)
      } else {
      const hSnap=getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,startPoint,tKeyDown,splines,intersectionPts)
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
      const dimOff=perpLabelOffset(endPt.x-startPoint.x,endPt.y-startPoint.y,16/sc)
      // Angle label stacks a fixed screen-vertical gap above the dim label
      // rather than further out along the same perpendicular — for a
      // near-vertical line the perpendicular is nearly horizontal, and
      // pushing the angle label further along it just placed both pill
      // labels side by side with barely a gap between them. A plain vertical
      // offset keeps them stacked (never side-by-side) at any line angle.
      const angOff={x:dimOff.x,y:dimOff.y-24/sc}
      drawLabel(ctx,(dimLocked?'🔒 ':'')+(dimInput||lenMm.toFixed(1))+' mm',midX+dimOff.x,midY+dimOff.y,dimLocked?'#FF9800':focusField==='dim'?'#1565C0':'#2196F3',sc)
      if (!isTanEnd) drawLabel(ctx,(angleLocked?'🔒 ':'')+(angleInput||computeLiveAngle(startPoint,endPt).toFixed(1))+'°',midX+angOff.x,midY+angOff.y,angleLocked?'#FF9800':focusField==='angle'?'#6A1B9A':'#9C27B0',sc)
      if (isTanEnd) drawLineIndicator(ctx,endPt.x,endPt.y,'tan',sc)
      } // end !pKeyDown

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
      const geo=!dimLocked?getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,circleCenter,tKeyDown,splines,intersectionPts):null
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

    } else if (tool==='circle'&&circleTanA&&circleTanB&&mousePos){
      // Tangent-to-2-circles preview — live radius from cursor until an exact number is typed
      const r=tanCircleCurrentRadius(mousePos)
      const sol=tanCircleSolution(r,mousePos)
      if (!sol){
        drawLabel(ctx,'No fit — try a different radius',mousePos.x,mousePos.y-20/sc,'#F44336',sc)
      } else {
        const{best,candidates}=sol
        candidates.forEach(cand=>{
          if (cand===best) return
          ctx.beginPath();ctx.arc(cand.x,cand.y,r,0,Math.PI*2)
          ctx.strokeStyle='#4CAF5055';ctx.lineWidth=1/sc;ctx.setLineDash([4/sc,3/sc]);ctx.stroke();ctx.setLineDash([])
        })
        ctx.beginPath();ctx.arc(best.x,best.y,r,0,Math.PI*2)
        ctx.strokeStyle='#4CAF50';ctx.lineWidth=2/sc;ctx.setLineDash([6/sc,3/sc]);ctx.stroke();ctx.setLineDash([])
        // Tangent point markers — on the line from each target's centre to the new centre, at the target's radius
        ;[circleTanA,circleTanB].forEach(tc=>{
          const d=Math.hypot(best.x-tc.cx,best.y-tc.cy)||1
          const t={x:tc.cx+(best.x-tc.cx)*tc.r/d,y:tc.cy+(best.y-tc.cy)*tc.r/d}
          ctx.save();ctx.translate(t.x,t.y);ctx.scale(1/sc,1/sc)
          ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#4CAF50';ctx.fill()
          ctx.restore()
        })
        drawLabel(ctx,(dimInput?'R ':'R ~')+pxToMm(r).toFixed(1)+' mm · Enter or click to apply',best.x,best.y-r/sc-14/sc,'#4CAF50',sc)
      }

    // ── Idle snap indicator ──
    } else if (tool!=='trim'&&tool!=='delete'&&tool!=='offset'&&tool!=='mirror'&&tool!=='movecopy'&&tool!=='rotatecopy'&&tool!=='resize'&&tool!=='trace'){
      if (tool==='line'&&pKeyDown){
        // PERP mode idle — show perp foot on nearest line (plus the
        // endpoint/midpoint marker too, when snapped onto one of those)
        const hit=findNearestLineForPerp(mousePos,lines,null)
        if (hit){
          if (hit.isSnap) drawLineIndicator(ctx,hit.foot.x,hit.foot.y,hit.snapType,sc)
          drawPerpIndicator(ctx,hit.foot.x,hit.foot.y,sc,hit.isSnap?14:0)
        }
      } else {
      const{tracks}=applyTracking(mousePos,trackedPts)
      if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)
      const geo=getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,null,tKeyDown,splines,intersectionPts)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
      }
    }

    // Snap indicator for movecopy/rotatecopy base point
    if ((tool==='movecopy'&&moveCopyAccepted||tool==='rotatecopy'&&rotateCopyAccepted)&&!startPoint){
      const geo=getGeoSnap(mousePos,snapLines,snapCircles,snapArcs,null,false,splines,intersectionPts)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
    }

    // ── Include Edge: live preview of the hovered edge, projected into this
    // sketch, before it's actually committed as a construction line ──
    if (tool==='includeedge'&&includeEdgeHover){
      const segs=edgeToSketchSegments(includeEdgeHover.solidId,includeEdgeHover.edgeId)
      if (segs) for (const s of segs) drawPreviewLine(ctx,s.x1,s.y1,s.x2,s.y2,'#FFEB3B',1,sc)
    }

  },[lines,circles,arcs,splines,selection,selectHover,selectLiveGeom,selectDimField,selectDimPending,selectDimAnchor,splinePoints,splineClosed,startPoint,circleCenter,circleTanA,circleTanB,mousePos,dimInput,dimLocked,angleInput,angleLocked,focusField,trackedPts,tool,trimPreview,deletePreview,extendPreview,offsetEntity,offsetPreview,offsetDistInput,offsetHover,mirrorSel,mirrorAccepted,mirrorPreview,mirrorP1,mirrorHover,centerSel,centerHover,moveCopySel,moveCopyAccepted,moveCopyMode,moveCopyCountInput,moveCopyHover,rotateCopySel,rotateCopyAccepted,rotateCopyMode,rotateCopyCountInput,rotateCopyHover,rotateCopyPreview,resizeSel,resizeAccepted,resizeScaleInput,resizeHover,filletSel,filletAccepted,filletRadiusInput,filletHover,filletPreview,dragSelectRect,viewTransform,tKeyDown,pKeyDown,perpSourceLineIdx,intersectionPts,joinHover,joinFirstPt,dims,dimToolStep,dimToolPts,dimToolPreview,selectDimInput,activePlane,sketchMode,extrudeTool,cachedProfiles,extrudeState,gridVisible,gridSizeMm,includeEdgeHover])


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

  // ── Include Edge ─────────────────────────────────────────────────────────
  // Projects one solid edge (by stable solidId+edgeId identity) into the
  // current sketch plane. Curved edges come back from replicad as several
  // short tessellated segments rather than one true arc — each becomes its
  // own straight sketch-space segment, so a curved include renders as a
  // faceted polyline, not a smooth arc. Used only for the live yellow
  // preview (a quick visual cue that doesn't need to match the final
  // classified shape) — see edgeToSketchGeometry below for what actually
  // gets committed.
  // Returns an array of {x1,y1,x2,y2} in sketch space, or null if the edge
  // can no longer be found (e.g. the solid was rebuilt/deleted since).
  function edgeToSketchSegments(solidId, edgeId) {
    const vp = viewport3dRef.current; if (!vp) return null
    const poly = vp.getEdgePolyline(solidId, edgeId)
    if (!poly?.points?.length) return null
    const ap = activePlaneRef.current
    if (!ap) return null
    const toSketch = worldVec => (typeof ap === 'object' ? ap.worldToSketch(worldVec) : worldToSketch(worldVec, ap))
    const segs = []
    const { points, matrixWorld } = poly
    for (let i = 0; i + 5 < points.length; i += 6) {
      const p1 = new THREE.Vector3(points[i], points[i+1], points[i+2]).applyMatrix4(matrixWorld)
      const p2 = new THREE.Vector3(points[i+3], points[i+4], points[i+5]).applyMatrix4(matrixWorld)
      const s1 = toSketch(p1), s2 = toSketch(p2)
      segs.push({ x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y })
    }
    return segs
  }

  // Classifies one solid edge into the single sketch primitive it actually
  // is — a straight line, a full circle, or an open arc — instead of always
  // emitting a faceted polyline. Unlike a face's boundary LOOP (which chains
  // together many different OCC edges of mixed types, needing
  // FacePlane.js's segmentLoopIntoPrimitives to walk and split them apart),
  // Include Edge deals with exactly ONE OCC edge at a time — inherently a
  // single primitive already, so there's nothing to segment, just "which
  // one primitive is this." Reuses the same fit helpers FacePlane.js's face-
  // boundary classification already relies on. Returns {lines,circles,arcs}
  // (exactly one populated with one entry, unless the edge is some other
  // curve type — ellipse, spline, etc. — that fits neither cleanly, in
  // which case `lines` holds the same faceted-polyline fallback
  // edgeToSketchSegments would produce). Returns null if the edge can no
  // longer be found.
  function edgeToSketchGeometry(solidId, edgeId) {
    const vp = viewport3dRef.current; if (!vp) return null
    const poly = vp.getEdgePolyline(solidId, edgeId)
    if (!poly?.points?.length) return null
    const ap = activePlaneRef.current
    if (!ap) return null
    const toSketch = worldVec => (typeof ap === 'object' ? ap.worldToSketch(worldVec) : worldToSketch(worldVec, ap))
    const { points, matrixWorld } = poly
    // `points` is consecutive independent segment-pairs (6 floats each), not
    // a shared-vertex chain (see cadMesh.js's own comment on this format) —
    // reconstruct the ordered, deduplicated point chain by taking each
    // segment's first point, plus the very last segment's second point.
    const pts = []
    for (let i = 0; i + 5 < points.length; i += 6) {
      const p = new THREE.Vector3(points[i], points[i+1], points[i+2]).applyMatrix4(matrixWorld)
      pts.push(toSketch(p))
    }
    const lastI = points.length - 6
    if (lastI >= 0) {
      const p = new THREE.Vector3(points[lastI+3], points[lastI+4], points[lastI+5]).applyMatrix4(matrixWorld)
      pts.push(toSketch(p))
    }
    if (pts.length < 2) return null
    const empty = { lines: [], circles: [], arcs: [] }
    const fallback = () => {
      const segs = []
      for (let i = 0; i < pts.length - 1; i++) segs.push({ x1:pts[i].x, y1:pts[i].y, x2:pts[i+1].x, y2:pts[i+1].y })
      return { ...empty, lines: segs }
    }

    const first = pts[0], last = pts[pts.length-1]
    const closed = Math.hypot(last.x-first.x, last.y-first.y) < 0.5

    // Collinearity check FIRST, regardless of open/closed — a genuinely
    // round edge that happens to lie in (or near) a plane perpendicular to
    // the CURRENT sketch plane projects nearly edge-on, collapsing to a
    // thin degenerate sliver rather than a circle/ellipse. That's still a
    // "closed" loop by the first≈last test above, but fitCircleLeastSquares
    // will happily fit some wildly wrong huge circle THROUGH a near-
    // collinear point set (the classic near-degenerate-fit failure mode —
    // see FacePlane.js's own tryExtend comment on the identical issue), and
    // a same-fit self-consistency check alone doesn't catch that. Test
    // against the two most mutually distant points (not just first/last,
    // which degenerate to the same point for a closed loop) via a cheap
    // centroid-then-farthest two-pass approximation — good enough to find a
    // robust "long axis" without an O(n²) all-pairs scan.
    const centroid = pts.reduce((s,p)=>({x:s.x+p.x,y:s.y+p.y}), {x:0,y:0})
    centroid.x /= pts.length; centroid.y /= pts.length
    let pA = pts[0], dA = -1
    for (const p of pts) { const d = Math.hypot(p.x-centroid.x, p.y-centroid.y); if (d > dA) { dA = d; pA = p } }
    let pB = pts[0], dB = -1
    for (const p of pts) { const d = Math.hypot(p.x-pA.x, p.y-pA.y); if (d > dB) { dB = d; pB = p } }
    const span = Math.hypot(pB.x-pA.x, pB.y-pA.y)
    if (span < 0.5) {
      // The whole edge projects to (essentially) one point in the CURRENT
      // sketch plane — e.g. a straight edge running exactly along the
      // sketch's own depth axis, viewed end-on. There's no valid 2D
      // representation at all in that case, not even a degenerate fallback
      // polyline (every segment in it would be zero-length too) — include
      // nothing rather than leaving an invisible, permanently-stuck
      // zero-length line behind (same "stuck sliver" bug class
      // trimDelete.js's own guards exist to prevent).
      return null
    }
    {
      const tol = Math.max(0.5, span*0.01)
      if (pts.every(p => distToLine(p, pA, pB) < tol)) {
        // Genuinely straight open edge → one clean line spanning its real
        // endpoints. A "closed" loop that's collinear is a degenerate
        // projection artifact (see above), not a real closed line loop —
        // fall back to the polyline rather than guessing at a shape.
        return closed ? fallback() : { ...empty, lines: [{ x1:first.x, y1:first.y, x2:last.x, y2:last.y }] }
      }
    }

    // Circular? (closed = full circle, open = arc) — same 3% radius
    // tolerance FacePlane.js's fitCircleIfRound already uses for this exact
    // kind of tessellated-edge data.
    const fit = fitCircleLeastSquares(pts)
    if (fit && fit.r > 1e-6 && pts.every(p => Math.abs(Math.hypot(p.x-fit.cx,p.y-fit.cy)-fit.r)/fit.r < 0.03)) {
      if (closed) return { ...empty, circles: [{ cx:fit.cx, cy:fit.cy, r:fit.r }] }
      const arc = fitArcToRun(pts)
      if (arc) return { ...empty, arcs: [{ cx:arc.cx, cy:arc.cy, r:arc.r, startAngle:arc.startAngle, endAngle:arc.endAngle }] }
    }

    // Neither — an ellipse, spline, or other curve type: fall back to the
    // original faceted-polyline behavior rather than distorting it into a
    // wrong circle/line.
    return fallback()
  }

  function resetIncludeEdge() {
    setIncludeEdgeHover(null)
    setIncludeEdgeSel([])
  }

  // Mouse move while the tool is armed — raycast against every solid's edges
  // (any solid, not just the one the current sketch face belongs to) and
  // update the hover state; the sketch draw effect turns this into a live
  // preview segment. Mirrors handleFillet3DHover's early-return shape.
  function handleIncludeEdgeHover(e) {
    if (tool !== 'includeedge') return
    const vp = viewport3dRef.current; if (!vp) return
    setIncludeEdgeHover(vp.raycastSolidEdges(e.clientX, e.clientY))
  }

  // Click while hovering an edge — commit it as construction geometry (a
  // true circle/arc when the edge fits one, a single line when straight,
  // otherwise a faceted polyline — see edgeToSketchGeometry) and stay armed
  // for the next pick. Re-clicking an already-included edge is a no-op
  // (each edge only needs to be included once).
  function handleIncludeEdgeClick(e) {
    if (tool !== 'includeedge' || !includeEdgeHover) return false
    const hit = includeEdgeHover
    const already = includeEdgeSel.some(s => s.solidId===hit.solidId && s.edgeId===hit.edgeId)
    if (already) return true
    const geo = edgeToSketchGeometry(hit.solidId, hit.edgeId)
    if (!geo || (!geo.lines.length && !geo.circles.length && !geo.arcs.length)) return true
    const tag = planeTag()
    commit(snapshot())
    // includedEdge:true lets detectProfiles still treat this as a real
    // boundary segment (see its own comment) and lets its junction
    // disambiguation deprioritize it as a loop-start candidate. Style is
    // left firm (not construction) — an included edge is usually meant to
    // BE part of the new profile's actual boundary, not reference-only
    // geometry, so it should look the same as geometry drawn by hand.
    if (geo.lines.length)   setLines  (prev => [...prev, ...geo.lines  .map(s => ({ ...s, includedEdge:true, ...tag }))])
    if (geo.circles.length) setCircles(prev => [...prev, ...geo.circles.map(s => ({ ...s, includedEdge:true, ...tag }))])
    if (geo.arcs.length)    setArcs   (prev => [...prev, ...geo.arcs   .map(s => ({ ...s, includedEdge:true, ...tag }))])
    setIncludeEdgeSel(prev => [...prev, { solidId: hit.solidId, edgeId: hit.edgeId }])
    return true
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
  function nextCutoutName() {
    featureCountRef.current.cutout += 1
    return `Cutout ${featureCountRef.current.cutout}`
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

  // Mirror step 2: a plane/face pick either arms the offset-plane's base (if
  // "+ Offset Plane" mode is on and no base is picked yet — see the offset
  // distance popup) or commits immediately for every selected body. Shared by
  // handleFaceClick/handlePlaneClick below since both need identical branching.
  function handleMirror3DPlanePick(pick) {
    if (mirror3dOffsetMode) {
      if (!mirror3dOffsetBase) setMirror3dOffsetBase(pick)
      else commitMirror3DOffset()  // base already picked — any further click accepts the live distance
      return
    }
    commitMirror3DBatch(pick)
  }

  // ── Phase 2 Step 3b: Sketch on face ──────────────────────────────────────
  function handleFaceClick(facePlane) {
    if (tool==='mirror3d' && mirror3dSelectionDone) { handleMirror3DPlanePick({ kind:'face', facePlane }); return }
    // Mirror step 1 (still picking bodies) — a face click here is a stray
    // hit that slipped past sketchArmed being false; must NOT fall through
    // to enterSketch below, same reasoning as handlePlaneClick's own guard.
    if (tool==='mirror3d' && !mirror3dSelectionDone) return
    // Join (picking bodies the whole time it's active, no second step) — same
    // stray-hit guard as Mirror step 1 above.
    if (tool==='join3d') return
    if (tool==='loft3d' && !loftState) { startLoftProfile1({ kind:'face', facePlane }); return }
    if (tool==='exportfacedxf') { handleExportFaceDXFFaceClick(facePlane); return }
    if (extrudeTool && extrudeOffsetMode) { handleExtrudeOffsetPlanePick({ kind:'face', facePlane }); return }
    if (extrudeState) return  // step 3 (depth): ignore stray face clicks
    enterSketch(facePlane)
    viewport3dRef.current?.snapToFace(facePlane)
  }

  function handlePlaneClick({ id }) {
    if (tool==='mirror3d' && mirror3dSelectionDone) { handleMirror3DPlanePick({ kind:'workplane', planeId:id }); return }
    if (tool==='loft3d' && !loftState) { startLoftProfile1({ kind:'workplane', planeId:id }); return }
    if (extrudeTool && extrudeOffsetMode) { handleExtrudeOffsetPlanePick({ kind:'workplane', planeId:id }); return }
    if (extrudeState) return  // step 3 (depth): ignore stray plane clicks
    // Work planes pass through/near the model with no occlusion check against
    // solids in front of them (see WorkPlanes.js's hitTestPlanes) — clicking an
    // edge near a plane could otherwise register as a plane click too and drop
    // into sketch mode. showWorkPlanes already excludes fillet3d mode; these
    // are more second guards in case a stray click still gets through.
    if (tool==='fillet3d') return
    // Mirror step 1 (still picking bodies) — clicking a body that happens to
    // sit on/near the XY work plane (planes have no occlusion check, see
    // above) was incorrectly falling through to enterSketch, silently
    // knocking the user out of Mirror and into sketch mode — which also wiped
    // the just-set selection highlight (its own useEffect clears on tool
    // change) the instant it happened, reading as "highlights then reverts."
    if (tool==='mirror3d' && !mirror3dSelectionDone) return
    // Join (picking bodies the whole time it's active) — same guard.
    if (tool==='join3d') return
    enterSketch(id)
    viewport3dRef.current?.snapToPlane(id)
  }

  // Saves the current sketch buffer as a flat, non-solid Sketch feature —
  // the pre-prompt behavior, now also the explicit "Keep it Flat"/"Export as
  // DXF" outcome of the sketchIntentPrompt below. Split out of
  // handleFinishSketch so both call sites (the no-closed-profile fallthrough
  // and the prompt's flat/DXF buttons) share one implementation.
  function saveAsFlatSketch(editingId, planeId, plane, isFace) {
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
    setLines([]); setCircles([]); setArcs([]); setSplines([])
    setExtrudeHandlePos(null)
    viewport3dRef.current?.restoreSavedView()
  }

  // Arms an extrude/cutout straight from a known set of sketch entities —
  // re-detects the closed profile itself, so it works both for the sketch
  // currently being finished (still-live lines/circles/arcs/splines) and for
  // a previously-saved standalone Sketch feature's stored geometry. Jumps
  // straight to the Set Depth step (mirrors handleEditExtent's "gear jumps
  // to step 3" pattern) since there's no reason to re-sketch a profile that's
  // already known. `sourceSketchId`, when given, marks that Sketch feature
  // for removal once the new solid actually lands (see the
  // convertingSketchIdRef effect near the top of the component) — its
  // geometry now lives inside the new feature, so keeping both would just be
  // a stale duplicate.
  function armExtrudeFromEntities({ lines:srcLines, circles:srcCircles, arcs:srcArcs, splines:srcSplines, planeId, facePlane }, opType, sourceSketchId=null) {
    const plane = facePlane || planeId
    const profiles = detectProfiles(srcLines, srcArcs, planeId, srcCircles, srcSplines)
    if (profiles.length === 0) {
      setCadError('No closed shape found in this sketch — draw a closed loop first.')
      setTimeout(() => setCadError(null), 5000)
      return false
    }
    const pts = profiles[0]
    const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length
    const cy = pts.reduce((s,p)=>s+p.y,0)/pts.length
    const centroid = { x: cx, y: cy }

    const axisLine = srcLines.find(l => l.style === 'axis' && (l.plane||'XY') === planeId)
    if (axisLine && profileCrossesAxis(pts, axisLine)) {
      setCadError('Profile crosses the axis — a revolve needs the whole profile on one side of the axis line.')
      setTimeout(() => setCadError(null), 6000)
      return false
    }
    const revolveAxis = axisLine ? { x1:axisLine.x1, y1:axisLine.y1, x2:axisLine.x2, y2:axisLine.y2 } : null

    const stateObj = {
      profiles: [pts],
      planeId,
      facePlane: facePlane || null,
      pickedIdx: 0,
      revolveAxis,
      revolveReverse: false,
      depthInput: revolveAxis ? '360' : '20',
      direction: 'front',
      extentMode: 'through',
      armed: true,
      centroid,
      sketchPlane: plane,
      sketchLines:   [...srcLines],
      sketchCircles: [...srcCircles],
      sketchArcs:    [...srcArcs],
      sketchSplines: [...srcSplines],
    }

    if (sourceSketchId) convertingSketchIdRef.current = sourceSketchId
    setCachedProfiles([{ planeId, facePlane: facePlane||null, pts, centroid }])
    setExtrudeTool(opType)
    setEditingFeatureId(null)
    setExtrudeState(stateObj)
    viewport3dRef.current?.restoreSavedView()
    return true
  }

  // Feature tree row buttons on a Sketch feature — Extrude/Cutout it in place.
  function convertSketchFeature(featureId, opType) {
    const feat = features.find(f => f.id === featureId)
    if (!feat || feat.type !== 'sketch') return
    armExtrudeFromEntities({
      lines: feat.lines||[], circles: feat.circles||[], arcs: feat.arcs||[], splines: feat.splines||[],
      planeId: feat.planeId, facePlane: feat.facePlane || null,
    }, opType, featureId)
  }

  // Handles the four sketchIntentPrompt buttons — see handleFinishSketch's
  // standalone-sketch branch for where the prompt gets raised.
  function chooseSketchIntent(action) {
    const p = sketchIntentPrompt
    if (!p) return
    setSketchIntentPrompt(null)
    const { planeId, plane, isFace, editingId } = p
    const facePlane = isFace ? plane : null

    if (action === 'extrude' || action === 'cutout') {
      armExtrudeFromEntities({ lines, circles, arcs, splines, planeId, facePlane }, action, editingId)
      return
    }
    if (action === 'dxf') exportDXF(lines, circles, arcs, splines)
    // 'flat' and 'dxf' both end up saved as a flat sketch
    saveAsFlatSketch(editingId, planeId, plane, isFace)
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
        centroid: best.centroid,
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
        revolveAxis,
        revolveReverse: revolveAxis ? (editingFeat?.revolveReverse || false) : false,
        // depthInput doubles as the angle input (in degrees) when revolveAxis is
        // set — reuses the same field/commit path rather than a parallel one.
        depthInput:    revolveAxis
          ? String(editingFeat?.angleDeg ?? 360)
          : editingFeat ? String(editingFeat.depthMm || 20) : '20',
        direction:     editDirection || 'front',
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
    // A closed profile exists but wasn't drawn via Extrude/Cutout (that's the
    // extrudeTool branch above) — ask what they actually want instead of
    // silently filing it away as a flat reference sketch. See
    // chooseSketchIntent for the four outcomes.
    if (allProfiles.length > 0) {
      setSketchIntentPrompt({ planeId, plane, isFace, editingId })
      return
    }
    saveAsFlatSketch(editingId, planeId, plane, isFace)
  }

  // Cancel button next to Finish Sketch — abandons the whole in-progress
  // Cut/Extrude/Loft feature (not just the current 2D tool, which is what
  // Escape does now — see the sketchMode Escape handler). Only meaningful
  // while extrudeTool or loftState is set; a plain standalone sketch has no
  // "feature" to cancel, so this button isn't shown for that case.
  // Restores a solid hidden mid-edit by handleEditSketch/handleEditExtent
  // (see hiddenEditSolidRef's declaration) if one is still pending. Every
  // tool-activation function below calls this first — switching tools
  // mid-edit without going through Cancel must not silently orphan the
  // hidden solid. It used to: activateExtrudeTool just nulled the ref, and
  // every OTHER activate*Tool function didn't touch it at all, leaving the
  // solid hidden with no way back short of a page reload.
  function restoreHiddenEditSolid() {
    const hidden = hiddenEditSolidRef.current
    if (hidden) {
      // Null the ref BEFORE queuing the state update, not after — React
      // doesn't run this updater synchronously at the setSolids() call site,
      // it runs it later during its own render pass. Reading the ref again
      // inside the updater (the original code did `...hiddenEditSolidRef.
      // current`) meant it always saw whatever the ref held by the time
      // React got around to calling the updater — which was already null,
      // since the very next line nulled it — throwing "is not iterable".
      // Capturing the array into `hidden` first and closing over THAT
      // instead sidesteps the timing entirely.
      hiddenEditSolidRef.current = null
      setSolids(prev => [...prev, ...hidden])
    }
  }

  function cancelFeature() {
    resetDrawState();resetSpline();resetOffset();resetMirror();resetCenter();resetMoveCopy()
    resetRotateCopy();resetResize();resetFillet();resetText();resetSelection()
    resetJoin();resetDim()
    restoreHiddenEditSolid()
    // Abandoning a sketch->solid conversion mid-flight — don't leave this
    // armed to delete the source sketch out from under some unrelated later
    // feature (see the convertingSketchIdRef effect near the top).
    convertingSketchIdRef.current = null
    setSketchMode(false); setActivePlane(null); setActiveSketchId(null)
    activePlaneRef.current = null
    setLines([]); setCircles([]); setArcs([]); setSplines([])
    if (extrudeTool) {
      setExtrudeTool(null); setExtrudeState(null); setEditingFeatureId(null)
      setExtrudeOffsetMode(false); setExtrudeOffsetBase(null); setExtrudeOffsetDistInput('20')
      viewport3dRef.current?.hideOffsetPlanePreview()
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
    convertingSketchIdRef.current = null
    // Exit sketch mode if currently in it — step 1 needs the 3D view for plane picking
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
    }
    // A mid-drag (or otherwise still-open) loft session left armed here would
    // fight this tool for the same preview canvas and swallow clicks meant
    // for extrude (see isLoftDragArmed's handleClick branch) — same pattern
    // cancelFeature already follows for this exact scenario.
    if (loftState) resetLoft3D()
    restoreHiddenEditSolid()
    setTool(op)
    setExtrudeTool(op)
    setExtrudeState(null)
    setExtrudeHandlePos(null)
    setEditingFeatureId(null)
    setHidePlanesForExtrude(false)
    setExtrudeOffsetMode(false)
    setExtrudeOffsetBase(null)
    setExtrudeOffsetDistInput('20')
    viewport3dRef.current?.hideOffsetPlanePreview()
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
    restoreHiddenEditSolid()
    // See activateLoft3DTool's comment — restoreSavedView() must stay inside
    // this guard, not fire unconditionally, or it jumps the camera to
    // whatever unrelated view was last saved by some other snap elsewhere.
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
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
    restoreHiddenEditSolid()
    // See activateLoft3DTool's comment — restoreSavedView() must stay inside
    // this guard, not fire unconditionally, or it jumps the camera to
    // whatever unrelated view was last saved by some other snap elsewhere.
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('measure')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    resetMeasure()
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
  // `points` (the world-mm polyline, as THREE.Vector3s) is included on every
  // return so callers besides Measure — Snap Move's getEdgeSnapCandidates —
  // can derive endpoint/midpoint candidates without recomputing this same
  // matrix-transform pass.
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
      return { kind: 'straight', length: chord, points: pts }
    }

    // Try a circle fit through 3 well-spread samples (first / ~1/3 / ~2/3).
    const iMid = Math.max(1, Math.floor(pts.length/3))
    const iTwoThirds = Math.min(pts.length-2, Math.floor(pts.length*2/3))
    const fit = circumcenter3(pts[0], pts[iMid], pts[iTwoThirds])
    if (fit) {
      const tol = Math.max(0.05, fit.radius * 0.02)
      const fits = pts.every(p => Math.abs(p.distanceTo(fit.center) - fit.radius) < tol)
      if (fits) return { kind: 'circular', radius: fit.radius, diameter: fit.radius*2, center: fit.center, points: pts }
    }
    return { kind: 'curve', length: segLen, points: pts }
  }

  // Derives Snap Move's discrete snap candidates for one edge: both
  // endpoints and the midpoint always, plus the circle's own center for a
  // circular edge (e.g. a hole) — reuses classifyEdgeGeometry so a
  // straight/circular/curve edge is only ever classified in one place.
  // Returns [{point:[x,y,z]}, ...] (mm) or [] if the edge can't be read.
  function getEdgeSnapCandidates(vp, solidId, edgeId) {
    const geo = classifyEdgeGeometry(vp, solidId, edgeId)
    if (!geo?.points?.length) return []
    // A circular edge (a hole, a cylinder's rim) offers ONLY its center —
    // not competing with points on the rim itself. Every point ON a circle
    // is exactly `radius` away from its center by definition, while a
    // rim-tessellation "first/last" point sits right where the cursor is
    // (distance ~0) — nearestSnapCandidate's plain 3D-distance rule would
    // then NEVER pick the center, permanently defeating the "center point
    // to center point" case the user explicitly asked for. A full circle
    // also has no real geometric "vertex" the way a straight edge's actual
    // corners are — first/last there are just a tessellation artifact, not
    // a meaningful snap target — so center is the only candidate offered.
    if (geo.kind === 'circular') {
      return [{ point: [geo.center.x, geo.center.y, geo.center.z] }]
    }
    const pts = geo.points
    const first = pts[0], last = pts[pts.length-1]
    const mid = geo.kind === 'straight'
      ? first.clone().add(last).multiplyScalar(0.5)
      : pts[Math.floor(pts.length/2)]
    return [
      { point: [first.x, first.y, first.z] },
      { point: [last.x, last.y, last.z] },
      { point: [mid.x, mid.y, mid.z] },
    ]
  }

  // Nearest of an edge's snap candidates to a raw hit point (plain 3D
  // distance — the user is already hovering this specific edge, so its
  // closest special point is always the intended one, never a dead zone).
  function nearestSnapCandidate(candidates, hitPoint) {
    let best = null, bestD = Infinity
    for (const c of candidates) {
      const d = Math.hypot(c.point[0]-hitPoint[0], c.point[1]-hitPoint[1], c.point[2]-hitPoint[2])
      if (d < bestD) { bestD = d; best = c }
    }
    return best
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

  // ── Export Face as DXF ─────────────────────────────────────────────────────
  // No-sketch-mode tool that reuses the same sketchArmed/onFaceClick pipeline
  // Mirror3D/Loft3D use for face-picking — hovering a face shows the same
  // square face-plane indicator those tools get for free (Viewport3D.jsx's
  // animate() loop). Pulls each face's real OCC boundary (outer loop + every
  // hole, via cadWorker.js's exportFaceDXF) and writes it to a .dxf file —
  // never goes through the tessellated render mesh, so cutout holes come
  // through intact.
  //
  // Multiple faces accumulate before exporting (same click-to-toggle,
  // Enter-to-commit shape as Export STL's exportSTLSel) rather than
  // exporting on the first click. This used to auto-detect every OTHER face
  // coplanar with the one clicked (so clicking one letter of an extruded
  // word would grab the whole word) — dropped in favor of manual multi-pick
  // after real-world text (built from separate features/boolean joins)
  // turned out to land at the "same" height with enough floating-point
  // drift that no fixed tolerance reliably caught every letter without also
  // risking false positives elsewhere. Manual pick has no tolerance to get
  // wrong: the student clicks exactly the faces they want.
  const [exportFaceDXFSel, setExportFaceDXFSel] = useState([])   // [{solidId, point, key}]
  const [exportFaceDXFBusy, setExportFaceDXFBusy] = useState(false)

  function activateExportFaceDXFTool() {
    resetSelection()
    resetDrawState()
    restoreHiddenEditSolid()
    // See activateLoft3DTool's comment — restoreSavedView() must stay inside
    // this guard, not fire unconditionally, or it jumps the camera to
    // whatever unrelated view was last saved by some other snap elsewhere.
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('exportfacedxf')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setExportFaceDXFSel([])
  }

  function resetExportFaceDXFSel() {
    setExportFaceDXFSel([])
  }

  // facePlane.solidId/.point are stamped on by Viewport3D's handleClickInternal
  // (see the walk-up-to-owning-group lookup next to raycastSolidFace) — the
  // plain FacePlane class itself carries neither. Use .point (the raw click
  // point, guaranteed to be on the actual surface) rather than .origin (the
  // whole face's coplanar-vertex centroid, meant for sketch placement — on a
  // face with a hole that centroid can land inside the cut-out and miss the
  // solid's material entirely, which fails the worker's FaceFinder pick).
  // Toggles: clicking an already-picked face again removes it, same as
  // Export STL's body picker — "key" is a rounded-coordinate string since
  // points can't be compared with ===. Kept in world (Three.js, mm*SCALE)
  // units, not the worker's mm — Viewport3D's persistent highlight needs
  // world units to draw with, and commitExportFaceDXF converts once at
  // export time instead.
  function handleExportFaceDXFFaceClick(facePlane) {
    if (exportFaceDXFBusy || facePlane.solidId == null) return
    const point = { x: facePlane.point.x, y: facePlane.point.y, z: facePlane.point.z }
    const normal = { x: facePlane.normal.x, y: facePlane.normal.y, z: facePlane.normal.z }
    const key = `${facePlane.solidId}_${[point.x,point.y,point.z].map(v=>v.toFixed(1)).join('_')}`
    setExportFaceDXFSel(prev => {
      if (prev.some(s => s.key === key)) return prev.filter(s => s.key !== key)
      // Letters of a sign are very often SEPARATE, never-joined solids (base
      // plate extruded on its own, each letter its own Extrude feature) —
      // no restriction to one solid here, unlike an earlier version of this
      // that silently dropped every pick after the first one landed on a
      // different body.
      return [...prev, { solidId: facePlane.solidId, point, normal, key }]
    })
  }

  // Projects every selected face into the SAME (u,v) frame — anchored on the
  // first pick — so letters line up correctly relative to each other in one
  // flat drawing, then writes one .dxf with all of them merged in. Each pick
  // carries its own solidId since they may belong to different solids.
  async function commitExportFaceDXF() {
    if (exportFaceDXFBusy || exportFaceDXFSel.length===0) return
    setExportFaceDXFBusy(true)
    try {
      const SCALE = 2
      const picks = exportFaceDXFSel.map(s => ({
        solidId: s.solidId,
        point: [s.point.x/SCALE, s.point.y/SCALE, s.point.z/SCALE],
      }))
      const { dxfData } = await cadEngine.exportFaceDXF({ picks })
      await writeFaceDXF(dxfData.lines, dxfData.circles, dxfData.arcs, 'face.dxf')
      resetExportFaceDXFSel()
    } catch (err) {
      console.error('Export Face DXF failed:', err)
    } finally {
      setExportFaceDXFBusy(false)
    }
  }

  // ── Mirror (3D feature) state machine ─────────────────────────────────────
  // Step 1: click bodies directly in the 3D view to accumulate mirror3dSel
  //   (hover glows orange via hoverSolid, selected bodies glow light blue via
  //   the shared highlightJoinMembers) — Enter or the SmartStepBar's ✓ Next
  //   action sets mirror3dSelectionDone, advancing to step 2. currentStep is
  //   driven by that explicit flag, NOT by mirror3dSel.length>0 (unlike every
  //   other single-shot picker in this file), because multi-select needs to
  //   stay on step 1 across several clicks.
  // Step 2: click a work plane or solid face — commits immediately for EVERY
  //   selected body (see commitMirror3DBatch) — or create a live offset plane
  //   first (mirror3dOffsetMode/mirror3dOffsetBase, see the offset-plane popup).
  const [mirror3dSel, setMirror3dSel] = useState([])              // [{solidId, featureId}, ...]
  const [mirror3dHoverSolidId, setMirror3dHoverSolidId] = useState(null)
  const [mirror3dSelectionDone, setMirror3dSelectionDone] = useState(false)
  const [mirror3dOffsetMode, setMirror3dOffsetMode] = useState(false)
  const [mirror3dOffsetBase, setMirror3dOffsetBase] = useState(null)   // {kind:'workplane',planeId} | {kind:'face',facePlane} | null
  const [mirror3dOffsetDistInput, setMirror3dOffsetDistInput] = useState('20')

  // Given a solid clicked in the viewport, finds the ONE feature that owns it
  // (the extrude/revolve/loft/join/mirror row — never a cutout/fillet, which
  // modify an existing body rather than creating one) — same predicate
  // FeatureTree's own isBodyOwner already uses to decide which rows can be
  // hidden. Mirror and Join can both be picked as a Mirror3D source (mirror-
  // of-mirror, mirror-of-join) — see commitMirrorSolid/rebuildDependentMirrors.
  function baseFeatureForSolid(solidId) {
    return features.find(f => f.type==='extrude' && !f.joinedInto && f.solidId===solidId &&
      ['extrude','revolve','loft','mirror','join','import'].includes(f.operation || 'extrude'))
  }

  function activateMirror3DTool() {
    resetSelection()
    resetDrawState()
    restoreHiddenEditSolid()
    // See activateLoft3DTool's comment — restoreSavedView() must stay inside
    // this guard, not fire unconditionally, or it jumps the camera to
    // whatever unrelated view was last saved by some other snap elsewhere.
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('mirror3d')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    resetMirror3D()
  }

  function resetMirror3D() {
    setMirror3dSel([])
    setMirror3dHoverSolidId(null)
    setMirror3dSelectionDone(false)
    setMirror3dOffsetMode(false)
    setMirror3dOffsetBase(null)
    setMirror3dOffsetDistInput('20')
    viewport3dRef.current?.clearSolidHighlight()
    viewport3dRef.current?.clearJoinHighlight()
    viewport3dRef.current?.clearSolidHover()
    viewport3dRef.current?.hideOffsetPlanePreview()
  }

  // Toggles `solidId` into/out of mirror3dSel — only while still on step 1
  // and only for a solid that resolves to a valid, non-mirror body owner.
  function handleMirror3DBodyClick(e) {
    if (tool!=='mirror3d' || mirror3dSelectionDone) return
    const hit = viewport3dRef.current?.raycastSolidFace(e.clientX, e.clientY)
    if (!hit || hit.solidId==null) return
    const feat = baseFeatureForSolid(hit.solidId)
    if (!feat) return
    setMirror3dSel(prev => prev.some(s=>s.solidId===hit.solidId)
      ? prev.filter(s=>s.solidId!==hit.solidId)
      : [...prev, {solidId:hit.solidId, featureId:feat.id}])
  }

  // Live hover glow while still picking bodies — mirrors handleExportSTLClick's
  // raycast, but on mousemove instead of click, and skips solids already in
  // mirror3dSel so hover never fights the light-blue selected glow.
  function handleMirror3DHover(e) {
    const hit = viewport3dRef.current?.raycastSolidFace(e.clientX, e.clientY)
    const solidId = hit?.solidId ?? null
    setMirror3dHoverSolidId(prev => {
      if (solidId!=null && mirror3dSel.some(s=>s.solidId===solidId)) return null
      return solidId === prev ? prev : solidId
    })
  }

  // Keeps every selected body glowing light blue, live as the selection
  // changes — same effect shape as Join3D/Export STL's own highlight sync.
  useEffect(() => {
    if (tool !== 'mirror3d') { viewport3dRef.current?.clearJoinHighlight(); return }
    viewport3dRef.current?.highlightJoinMembers(mirror3dSel.map(s => s.solidId))
  }, [mirror3dSel, tool])

  // Keeps the hovered body glowing orange, live as the mouse moves.
  useEffect(() => {
    if (tool !== 'mirror3d' || mirror3dHoverSolidId==null) { viewport3dRef.current?.clearSolidHover(); return }
    viewport3dRef.current?.hoverSolid(mirror3dHoverSolidId)
  }, [mirror3dHoverSolidId, tool])

  // ── Move/Copy/Rotate (3D solid) state machine — Stage 2 adds Rotate ───────
  // Step 1: click a body directly in the 3D view (same hover/select pattern
  // as Mirror3D/Join3D — orange hover via hoverSolid, cyan selected via
  // highlightSolid). Step 2: a combined gizmo with 3 draggable axis arrows
  // AND 3 rotate rings appears at the body's center, oriented to the
  // body's own current local axes (world-aligned until it's ever been
  // rotated — see rotationToQuat/getGizmoAxisWorldDir). Grabbing a handle
  // is a plain CLICK (not a press-and-hold drag) — same "click to arm, just
  // move the mouse to preview, click again anywhere to accept" gesture
  // Extrude's depth-set and Mirror/Extrude's own offset-plane already use,
  // not a new interaction paradigm. Copy toggles whether accepting
  // duplicates the body instead of altering the original — applies equally
  // to a move or a rotate.
  const [moveCopy3dSel, setMoveCopy3dSel] = useState(null)          // solidId, or null
  const [moveCopy3dHoverSolidId, setMoveCopy3dHoverSolidId] = useState(null)
  const [moveCopy3dMode, setMoveCopy3dMode] = useState('move')      // 'move' | 'copy'
  const [moveCopy3dDragHandle, setMoveCopy3dDragHandle] = useState(null) // {kind:'move'|'rotate', axis:'x'|'y'|'z'} | null
  const [moveCopy3dDistInput, setMoveCopy3dDistInput] = useState('0')   // signed mm, kind:'move'
  const [moveCopy3dAngleInput, setMoveCopy3dAngleInput] = useState('0') // signed degrees, kind:'rotate'
  // Stage 3 — Snap Move: a third mode alongside the gizmo, entered once a
  // body is selected. No dragging at all — click a point ON the selected
  // body, then click a target point on any solid (self or other); the body
  // translates by that exact vector, no rotation, no lasting relationship
  // (a one-time move, same as a plain gizmo Move — see commitSnapMove).
  // 0=off, 1=picking the source point (must land on moveCopy3dSel),
  // 2=picking the target point (any solid).
  const [moveCopy3dSnapStep, setMoveCopy3dSnapStep] = useState(0)
  const [moveCopy3dSnapP1, setMoveCopy3dSnapP1] = useState(null)       // {solidId, point:[x,y,z]mm} | null
  const [moveCopy3dSnapHover, setMoveCopy3dSnapHover] = useState(null) // same shape, current hover candidate
  // Grab-time reference basis for the rotate drag's angle math (see
  // handleMoveCopy3DDragMove) — a plain ref, not state: write-once the
  // instant a ring is grabbed, read every mouse move after that, no
  // re-render should ever depend on it.
  const moveCopy3dRotateBasisRef = useRef(null)

  // A solid's stored transform.rotation (axis-angle, or absent = identity)
  // as a THREE.Quaternion — the one conversion point between the
  // JSON-friendly stored form and the Quaternion math everywhere else
  // (gizmo orientation, composing a new rotate delta) needs.
  function rotationToQuat(rotation) {
    if (!rotation) return new THREE.Quaternion()
    return new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(...rotation.axis).normalize(), THREE.MathUtils.degToRad(rotation.angleDeg)
    )
  }

  // Inverse of the above — every 3D rotation, however it was reached,
  // collapses to a single net axis+angle. `w` is clamped since floating
  // point can push it a hair past ±1, which would make acos() return NaN.
  function quatToAxisAngle(q) {
    const n = q.clone().normalize()
    const w = Math.min(1, Math.max(-1, n.w))
    const angle = 2 * Math.acos(w)
    const s = Math.sqrt(1 - w*w)
    const axis = s < 1e-6 ? [1,0,0] : [n.x/s, n.y/s, n.z/s]
    return { angleDeg: THREE.MathUtils.radToDeg(angle), axis }
  }

  function activateMoveCopy3DTool() {
    resetSelection()
    resetDrawState()
    restoreHiddenEditSolid()
    // See activateLoft3DTool's comment — restoreSavedView() must stay inside
    // this guard, not fire unconditionally, or it jumps the camera to
    // whatever unrelated view was last saved by some other snap elsewhere.
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('movecopy3d')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    resetMoveCopy3D()
  }

  // skipPreviewReset: passed through to hideMoveGizmo — see its own comment.
  // Only a just-succeeded commit should pass true (the old group is about
  // to be discarded anyway once setSolids/setFeatures lands); every other
  // caller (Escape/cancel, deactivating the tool, a failed commit) needs
  // the default false so the live-drag offset actually gets cleared.
  function resetMoveCopy3D({ skipPreviewReset=false } = {}) {
    setMoveCopy3dSel(null)
    setMoveCopy3dHoverSolidId(null)
    setMoveCopy3dMode('move')
    setMoveCopy3dDragHandle(null)
    setMoveCopy3dDistInput('0')
    setMoveCopy3dAngleInput('0')
    setMoveCopy3dSnapStep(0)
    setMoveCopy3dSnapP1(null)
    setMoveCopy3dSnapHover(null)
    moveCopy3dRotateBasisRef.current = null
    viewport3dRef.current?.clearSolidHighlight()
    viewport3dRef.current?.clearSolidHover()
    viewport3dRef.current?.hoverMoveGizmoAxis(null)
    viewport3dRef.current?.hideMoveGizmo(skipPreviewReset)
  }

  // Step 1 body pick — same baseFeatureForSolid eligibility Mirror3D/Join3D
  // already use (extrude/revolve/loft/mirror/join all qualify).
  function handleMoveCopy3DBodyClick(e) {
    if (tool !== 'movecopy3d' || moveCopy3dSel != null) return
    const hit = viewport3dRef.current?.raycastSolidFace(e.clientX, e.clientY)
    if (!hit || hit.solidId==null) return
    const feat = baseFeatureForSolid(hit.solidId)
    if (!feat) return
    setMoveCopy3dSel(hit.solidId)
  }

  // Live hover glow while still picking the body — mirrors handleMirror3DHover.
  function handleMoveCopy3DHover(e) {
    if (moveCopy3dSel != null) { setMoveCopy3dHoverSolidId(null); return }
    const hit = viewport3dRef.current?.raycastSolidFace(e.clientX, e.clientY)
    const solidId = hit?.solidId ?? null
    setMoveCopy3dHoverSolidId(prev => solidId === prev ? prev : solidId)
  }

  useEffect(() => {
    // No gizmo while Snap Move is engaged — that mode is pure point-to-point
    // clicking, no handle to drag, and showing the arrows/rings alongside it
    // would be confusing about which interaction is actually live.
    if (tool !== 'movecopy3d' || moveCopy3dSel == null || moveCopy3dSnapStep > 0) {
      viewport3dRef.current?.clearSolidHighlight()
      viewport3dRef.current?.hideMoveGizmo()
      return
    }
    const solid = solids.find(s => s.id === moveCopy3dSel)
    viewport3dRef.current?.highlightSolid(moveCopy3dSel)
    viewport3dRef.current?.showMoveGizmo(moveCopy3dSel, rotationToQuat(solid?.transform?.rotation))
  }, [moveCopy3dSel, tool, moveCopy3dSnapStep])

  useEffect(() => {
    if (tool !== 'movecopy3d' || moveCopy3dHoverSolidId==null) { viewport3dRef.current?.clearSolidHover(); return }
    viewport3dRef.current?.hoverSolid(moveCopy3dHoverSolidId)
  }, [moveCopy3dHoverSolidId, tool])

  // Arms whichever handle a gizmo click hit, capturing everything the drag
  // math (below) needs at the exact moment of grabbing. For a rotate ring,
  // that means the plane/reference-vector basis the live angle is measured
  // against — captured HERE (using this exact click's position) so the
  // very first computed delta is 0°, not whatever angle the mouse happens
  // to already be at.
  function armMoveCopy3DHandle(hit, e) {
    setMoveCopy3dDragHandle({ kind: hit.kind, axis: hit.axis })
    setMoveCopy3dDistInput('0')
    setMoveCopy3dAngleInput('0')
    moveCopy3dRotateBasisRef.current = null
    if (hit.kind !== 'rotate') return
    const vp = viewport3dRef.current
    const origin = vp?.getMoveGizmoOrigin?.()
    const dir = vp?.getGizmoAxisWorldDir?.(hit.axis)
    if (!origin || !dir) return
    const pivot = new THREE.Vector3(origin.x, origin.y, origin.z)
    const axisDir = new THREE.Vector3(dir.x, dir.y, dir.z).normalize()
    const hitPt = vp.raycastPlaneWorld?.(e.clientX, e.clientY, origin, dir)
    const refVec = hitPt ? new THREE.Vector3(hitPt.x-pivot.x, hitPt.y-pivot.y, hitPt.z-pivot.z) : null
    // Falls back to an arbitrary perpendicular if the initial click somehow
    // missed the rotation plane (a near-parallel ray) — rare, but atan2(0,0)
    // would otherwise report a nonsense angle instead of just starting at 0.
    const ref = (refVec && refVec.lengthSq() > 1e-6)
      ? refVec.normalize()
      : new THREE.Vector3().crossVectors(axisDir, Math.abs(axisDir.y) < 0.9 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0)).normalize()
    const perp = new THREE.Vector3().crossVectors(axisDir, ref).normalize()
    moveCopy3dRotateBasisRef.current = { pivot, axisDir, ref, perp }
  }

  // Drag-to-set-value along/around whichever handle was armed. Move keeps
  // Stage 1's screen-projection-of-a-direction math, now reading the axis's
  // CURRENT world direction via getGizmoAxisWorldDir (identity rotation =
  // the same world direction Stage 1 always used) instead of a hardcoded
  // vector — so it drags along the body's own local axis once it's been
  // rotated. Rotate raycasts the mouse into the plane perpendicular to the
  // grabbed axis (through the gizmo's pivot) and measures the signed angle
  // from the reference vector armMoveCopy3DHandle captured at grab time.
  function handleMoveCopy3DDragMove(e) {
    if (tool !== 'movecopy3d' || !moveCopy3dDragHandle || moveCopy3dSel == null) return
    const vp = viewport3dRef.current
    if (!vp) return
    const origin = vp.getMoveGizmoOrigin?.()
    if (!origin) return
    const { kind, axis } = moveCopy3dDragHandle

    if (kind === 'move') {
      const dir = vp.getGizmoAxisWorldDir?.(axis)
      if (!dir) return
      const p0 = vp.worldToScreen(origin.x, origin.y, origin.z)
      const p1 = vp.worldToScreen(origin.x+dir.x*2, origin.y+dir.y*2, origin.z+dir.z*2)
      if (!p0 || !p1) return
      const dx = p1.x-p0.x, dy = p1.y-p0.y
      const pxPerMm = Math.hypot(dx,dy)
      if (!pxPerMm) return
      const vpRect = vp.getDomElement?.()?.parentElement?.getBoundingClientRect?.()
      if (!vpRect) return
      const mx = e.clientX - vpRect.left, my = e.clientY - vpRect.top
      const proj = (mx-p0.x)*(dx/pxPerMm) + (my-p0.y)*(dy/pxPerMm)
      let mm = proj/pxPerMm
      if (gridSnap) mm = Math.round(mm/gridSizeMm)*gridSizeMm
      setMoveCopy3dDistInput(String(Math.round(mm*100)/100))
      return
    }

    const basis = moveCopy3dRotateBasisRef.current
    if (!basis) return
    const hitPt = vp.raycastPlaneWorld?.(e.clientX, e.clientY, origin, { x:basis.axisDir.x, y:basis.axisDir.y, z:basis.axisDir.z })
    if (!hitPt) return
    const v = new THREE.Vector3(hitPt.x-basis.pivot.x, hitPt.y-basis.pivot.y, hitPt.z-basis.pivot.z)
    const deg = Math.atan2(v.dot(basis.perp), v.dot(basis.ref)) * 180/Math.PI
    setMoveCopy3dAngleInput(String(Math.round(deg*10)/10))
  }

  // Live preview — moves/rotates the REAL solid (cheap: just this one
  // group's transform, see previewMoveSolid/previewRotateSolid's own
  // comments) every time the armed handle or its live value changes,
  // whether driven by mouse movement or typing directly into the popover.
  useEffect(() => {
    if (tool !== 'movecopy3d' || !moveCopy3dDragHandle) return
    const vp = viewport3dRef.current
    const { kind, axis } = moveCopy3dDragHandle
    if (kind === 'move') {
      const mm = parseFloat(moveCopy3dDistInput) || 0
      const dir = vp?.getGizmoAxisWorldDir?.(axis)
      if (dir) vp?.previewMoveSolid([dir.x*mm, dir.y*mm, dir.z*mm])
    } else {
      const deg = parseFloat(moveCopy3dAngleInput) || 0
      vp?.previewRotateSolid?.(THREE.MathUtils.degToRad(deg), axis)
    }
  }, [tool, moveCopy3dDragHandle, moveCopy3dDistInput, moveCopy3dAngleInput])

  // Gizmo-handle hover feedback — only meaningful once a body is picked but
  // before a handle is armed (once armed, setActiveGizmoAxis below already
  // owns the handle colors/visibility for the whole drag). Direct
  // Viewport3D call, no React state — same "mutate material, skip
  // re-render" convention as hoverSolid/highlightSolid.
  function handleMoveCopy3DGizmoHover(e) {
    if (tool !== 'movecopy3d' || moveCopy3dSel == null || moveCopy3dDragHandle || moveCopy3dSnapStep > 0) return
    const hit = viewport3dRef.current?.raycastMoveGizmo(e.clientX, e.clientY)
    viewport3dRef.current?.hoverMoveGizmoAxis(hit ? `${hit.kind}-${hit.axis}` : null)
  }

  // Snap Move — step 1 only accepts a point on the body being moved
  // (moveCopy3dSel), step 2 accepts any solid. Same raycastSolidEdges pass
  // Measure/Fillet3D already use; only edges contribute snap candidates
  // (vertices + circle centers) — see getEdgeSnapCandidates's own comment
  // on why bare faces aren't a candidate source.
  function handleSnapMoveHover(e) {
    if (tool !== 'movecopy3d' || moveCopy3dSnapStep === 0) return
    const vp = viewport3dRef.current; if (!vp) return
    const edgeHit = vp.raycastSolidEdges(e.clientX, e.clientY)
    if (!edgeHit || edgeHit.edgeId == null) { setMoveCopy3dSnapHover(null); return }
    if (moveCopy3dSnapStep === 1 && edgeHit.solidId !== moveCopy3dSel) { setMoveCopy3dSnapHover(null); return }
    const candidates = getEdgeSnapCandidates(vp, edgeHit.solidId, edgeHit.edgeId)
    const nearest = nearestSnapCandidate(candidates, edgeHit.point)
    setMoveCopy3dSnapHover(nearest ? { solidId: edgeHit.solidId, point: nearest.point } : null)
  }

  function handleSnapMoveClick(e) {
    if (tool !== 'movecopy3d' || moveCopy3dSnapStep === 0 || !moveCopy3dSnapHover) return
    if (moveCopy3dSnapStep === 1) {
      setMoveCopy3dSnapP1(moveCopy3dSnapHover)
      setMoveCopy3dSnapHover(null)
      setMoveCopy3dSnapStep(2)
      return
    }
    commitSnapMove()
  }

  // Dot-at-P1 + dot-at-hover + dashed connector, same shared overlay canvas
  // and drawing shape as drawMeasureOverlay/clearMeasureOverlay (never
  // active at the same time — Measure and Move/Copy are different tools) —
  // just no distance label, since the second click commits immediately
  // rather than reporting a number.
  function clearSnapMoveOverlay() {
    const vp = viewport3dRef.current; if (!vp) return
    const oc = vp.getExtrudePreviewCanvas(); if (!oc) return
    const ctx = oc.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,oc.width,oc.height)
  }

  function drawSnapMoveOverlay(vp, p1, hover) {
    const oc = vp.getExtrudePreviewCanvas(); if (!oc) return
    const ctx = oc.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,oc.width,oc.height)
    const SCALE = 2
    const color = '#FF9800'
    const toScreen = p => vp.worldToScreen(p[0]*SCALE, p[1]*SCALE, p[2]*SCALE)

    const drawDot = (pt) => {
      const s = toScreen(pt); if (!s) return null
      ctx.save(); ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI*2); ctx.fill()
      ctx.restore()
      return s
    }

    const p1Screen = p1 ? drawDot(p1.point) : null
    const hoverScreen = hover ? drawDot(hover.point) : null
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
    }
  }

  // Keeps Snap Move's point markers in sync — mirrors Measure's own
  // marker-sync effect.
  useEffect(() => {
    const vp = viewport3dRef.current
    if (!vp || tool !== 'movecopy3d' || moveCopy3dSnapStep === 0) { clearSnapMoveOverlay(); return }
    drawSnapMoveOverlay(vp, moveCopy3dSnapP1, moveCopy3dSnapHover)
  }, [tool, moveCopy3dSnapStep, moveCopy3dSnapP1, moveCopy3dSnapHover])

  // Recolors/isolates the armed handle the moment it's grabbed, and
  // restores every handle to its idle state once the drag is
  // accepted/cancelled.
  useEffect(() => {
    const h = moveCopy3dDragHandle
    viewport3dRef.current?.setActiveGizmoAxis(h ? `${h.kind}-${h.axis}` : null)
  }, [moveCopy3dDragHandle])

  // Bakes the live delta into the solid's actual geometry via the
  // transformShape worker op. Move re-targets the same solidId (shapeStore
  // is warm at its PRIOR position/rotation, so only the fresh delta is
  // sent — the cumulative total lives in transform, not in the worker
  // call). A rotate delta composes into the stored cumulative rotation as
  // Rdelta·Rold (see the Stage 2 plan's derivation) and leaves `position`
  // completely untouched — a rotate always pivots at the body's CURRENT
  // live center, so the translation component never needs to change. Copy
  // reads from the original (sourceSolidId) and writes a brand-new
  // solid+feature, inheriting the original's shape-defining fields so it
  // still rebuilds correctly on a cold reload (see featureToTempSolid).
  // Shared tail for every Move/Copy/Rotate/Snap-Move commit: given the
  // worker params for THIS delta and the resulting cumulative transform,
  // bakes it in (or duplicates onto a new body, if Copy is active) and
  // resets the tool back to "Select Body." Factored out of commitMoveCopy3D
  // so Snap Move (which computes its own position-only delta from two
  // picked points, not a gizmo handle) can commit through the exact same
  // path instead of duplicating the copy/move branching.
  async function commitMoveCopy3DTransform(solidId, workerParams, newTransform) {
    const solid = solids.find(s => s.id === solidId)
    const feat = baseFeatureForSolid(solidId)
    if (!solid || !feat) { resetMoveCopy3D(); return }
    feat3d.commit(features)
    try {
      if (moveCopy3dMode === 'copy') {
        const newSolidId = Date.now()
        const base = buildBaseWorkerParams(solid)
        const ops = buildSolidOpsForWorker(solid, features)
        const meshData = await cadEngine.transformShape({
          solidId: newSolidId, sourceSolidId: solidId, base, ops, ...workerParams,
        })
        const group = replicadMeshToThree(meshData, solid.color, newSolidId)
        const newFeatId = `${feat.id}-copy-${newSolidId}`
        setSolids(prev => [...prev, { ...solid, id: newSolidId, group, transform: newTransform }])
        setFeatures(prev => [...prev, {
          ...feat, id: newFeatId, solidId: newSolidId, name: `${feat.name} Copy`,
          transform: newTransform, joinedInto: undefined,
        }])
      } else {
        const meshData = await cadEngine.transformShape({ solidId, ...workerParams })
        const group = replicadMeshToThree(meshData, solid.color, solidId)
        setSolids(prev => prev.map(s => s.id===solidId ? { ...s, group, transform: newTransform } : s))
        setFeatures(prev => prev.map(f => f.id===feat.id ? { ...f, transform: newTransform } : f))
      }
      // Move/Snap Move (not Copy) is the only case that skips the
      // preview-position reset: its solidId gets a freshly rebuilt group
      // swapped in above, already positioned correctly, so resetting the
      // OLD group (about to be discarded) would just flash it back to its
      // start position for a frame first. Copy leaves the original's own
      // group/transform completely untouched — nothing else will ever
      // clear the live-drag offset that previewMoveSolid/previewRotateSolid
      // left on it — so it still needs the real reset.
      resetMoveCopy3D({ skipPreviewReset: moveCopy3dMode !== 'copy' })
    } catch (err) {
      setCadError('Move failed: ' + (err.message || String(err)))
      setTimeout(() => setCadError(null), 6000)
      resetMoveCopy3D()
    }
  }

  async function commitMoveCopy3D() {
    const solidId = moveCopy3dSel
    const handle = moveCopy3dDragHandle
    const solid = solids.find(s => s.id === solidId)
    const vp = viewport3dRef.current
    if (solidId==null || !handle || !solid || !vp) { resetMoveCopy3D(); return }
    const dir = vp.getGizmoAxisWorldDir(handle.axis)
    const priorPos = solid.transform?.position || [0,0,0]
    const priorRotation = solid.transform?.rotation || null

    let workerParams, newTransform
    if (handle.kind === 'move') {
      const mm = parseFloat(moveCopy3dDistInput) || 0
      const delta = [dir.x*mm, dir.y*mm, dir.z*mm]
      workerParams = { position: delta }
      newTransform = { position: [priorPos[0]+delta[0], priorPos[1]+delta[1], priorPos[2]+delta[2]], rotation: priorRotation }
    } else {
      const deg = parseFloat(moveCopy3dAngleInput) || 0
      const origin = vp.getMoveGizmoOrigin()
      const pivotMm = [pxToMm(origin.x), pxToMm(origin.y), pxToMm(origin.z)]
      workerParams = { rotation: { angleDeg: deg, axis: [dir.x, dir.y, dir.z], pivot: pivotMm } }
      const Rdelta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dir.x, dir.y, dir.z), THREE.MathUtils.degToRad(deg))
      const Rnew = Rdelta.multiply(rotationToQuat(priorRotation))
      newTransform = { position: priorPos, rotation: quatToAxisAngle(Rnew) }
    }
    await commitMoveCopy3DTransform(solidId, workerParams, newTransform)
  }

  // Snap Move commit: the delta is just the vector between the two picked
  // points (mm) — no rotation, no gizmo handle involved — so it shares
  // commitMoveCopy3DTransform's copy/move branching exactly like a plain
  // gizmo Move does.
  async function commitSnapMove() {
    const solidId = moveCopy3dSel
    const solid = solids.find(s => s.id === solidId)
    if (solidId==null || !solid || !moveCopy3dSnapP1 || !moveCopy3dSnapHover) { resetMoveCopy3D(); return }
    const p1 = moveCopy3dSnapP1.point, p2 = moveCopy3dSnapHover.point
    const delta = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]]
    const priorPos = solid.transform?.position || [0,0,0]
    const newTransform = {
      position: [priorPos[0]+delta[0], priorPos[1]+delta[1], priorPos[2]+delta[2]],
      rotation: solid.transform?.rotation || null,
    }
    await commitMoveCopy3DTransform(solidId, { position: delta }, newTransform)
  }

  // ── Join (3D boolean union) state machine ─────────────────────────────────
  // Step 1: click bodies directly in the 3D view to accumulate joinSel
  //   (same viewport click/hover pattern as Mirror/Export STL/Body Color —
  //   orange hover via hoverSolid, selected glow via the shared
  //   highlightJoinMembers). Step 2: accept via Enter, right-click, or Tab —
  //   commits immediately, no plane pick needed (unlike Mirror3D).
  const [joinSel, setJoinSel] = useState([])   // [featureId, ...] accumulated picks
  const [join3dHoverSolidId, setJoin3dHoverSolidId] = useState(null)

  function activateJoin3DTool() {
    resetSelection()
    resetDrawState()
    restoreHiddenEditSolid()
    // See activateLoft3DTool's comment — restoreSavedView() must stay inside
    // this guard, not fire unconditionally, or it jumps the camera to
    // whatever unrelated view was last saved by some other snap elsewhere.
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('join3d')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setJoinSel([])
    setJoin3dHoverSolidId(null)
  }

  function resetJoin3D() {
    setJoinSel([])
    setJoin3dHoverSolidId(null)
    viewport3dRef.current?.clearSolidHover()
  }

  // Toggles a clicked solid's owning feature into/out of joinSel — same
  // resolution baseFeatureForSolid already does for Mirror. A Feature Tree
  // row can represent a whole multi-body group (e.g. a whole-word text
  // extrude — one row, N letter solids, see groupSize() in FeatureTree)
  // collapsed down to a single unit; clicking ANY of its solids in the
  // viewport must still pull in every sibling sharing that groupId, or only
  // one letter would ever join — preserved here exactly as the old
  // Feature-Tree-row click handler did it.
  function handleJoin3DBodyClick(e) {
    if (tool !== 'join3d') return
    const hit = viewport3dRef.current?.raycastSolidFace(e.clientX, e.clientY)
    if (!hit || hit.solidId==null) return
    const feat = baseFeatureForSolid(hit.solidId)
    // A join's own result is a valid Join3D member too (join-of-join) — same
    // call baseFeatureForSolid already resolves for Mirror3D's join/mirror
    // sources, and commitJoin already builds each member's worker params via
    // the same buildBaseWorkerParams()/shapeStore-first path that already
    // handles join-produced solids correctly (see its own comment on
    // operation==='join' returning null — "no cold-rebuild fallback, relies
    // on shapeStore already being warm", which always holds for a currently-
    // rendered join result). There was no technical reason left to exclude it.
    if (!feat) return
    const ids = feat.groupId ? features.filter(f => f.groupId === feat.groupId).map(f => f.id) : [feat.id]
    setJoinSel(prev => {
      const allSelected = ids.every(id => prev.includes(id))
      return allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]
    })
  }

  // Live hover glow while still picking members — mirrors handleMirror3DHover.
  function handleJoin3DHover(e) {
    const hit = viewport3dRef.current?.raycastSolidFace(e.clientX, e.clientY)
    const solidId = hit?.solidId ?? null
    setJoin3dHoverSolidId(prev => {
      if (solidId!=null && joinSel.some(id => features.find(f=>f.id===id)?.solidId===solidId)) return null
      return solidId === prev ? prev : solidId
    })
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

  // Keeps the hovered body glowing orange, live as the mouse moves.
  useEffect(() => {
    if (tool !== 'join3d' || join3dHoverSolidId==null) { viewport3dRef.current?.clearSolidHover(); return }
    viewport3dRef.current?.hoverSolid(join3dHoverSolidId)
  }, [join3dHoverSolidId, tool])

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
    feat3d.commit(features)
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
  // 'loft' (additive, new solid) | 'loftcutout' (subtracts from whatever
  // solid(s) the lofted shape overlaps) — mirrors extrudeTool's 'extrude'/
  // 'cutout' split. Picking/sketching (startLoftProfile1/loftNextProfile/
  // loftPreviousProfile) is identical for both; only commitLoft() branches.
  const [loftTool, setLoftTool] = useState('loft')

  function activateLoft3DTool(op = 'loft') {
    resetSelection()
    resetDrawState()
    restoreHiddenEditSolid()
    // restoreSavedView() must stay INSIDE this guard, not fire unconditionally
    // after it — s.savedPos is a single global "camera before the last snap"
    // slot, overwritten by every snapToFace/snapToPlane/snapToIsometric call
    // in the app (TOP/FRONT/SIDE/ISO buttons, any prior sketch, mirror, or
    // extrude). Calling restoreSavedView() when there was no active sketch to
    // leave jumps the camera to whatever unrelated view was last saved —
    // isometric, front, or some arbitrary orbited angle — instead of leaving
    // the current view alone.
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('loft3d')
    setLoftTool(op)
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setLoftState(null)
    setLoftEditingFeatureId(null)
  }

  function resetLoft3D() {
    cancelLoftAnim()
    clearLoftPreviewCanvas()
    setLoftState(null)
    setLoftEditingFeatureId(null)
  }

  // True while the user is between "Finish Sketch" on one profile and
  // starting the next one's sketch — the window where the drag-to-position
  // ghost preview is shown. Excludes re-visiting an already-sketched later
  // profile (editing an existing loft feature via handleEditLoft) — that
  // case has a fixed, already-stored offsetMm loftNextProfile jumps straight
  // to, so showing a draggable ghost there would visually lie about where
  // accepting will actually land.
  function isLoftDragArmed() {
    return !!loftState && !sketchMode
      && !!loftState.profiles[loftState.currentIdx]
      && !loftState.profiles[loftState.currentIdx + 1]
  }

  // Loft's live drag preview shares the same overlay canvas Extrude's does
  // (getExtrudePreviewCanvas, zIndex above the sketch canvas) — must be
  // cleared explicitly on every transition out of the armed window, same as
  // every extrude transition point already does, or the last-drawn frame
  // freezes on screen covering the next sketch.
  function clearLoftPreviewCanvas() {
    const vp = viewport3dRef.current
    const oc = vp?.getExtrudePreviewCanvas()
    if (oc) { const ctx = oc.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,oc.width,oc.height) }
  }

  // Step 1 commit — picking the plane/face fixes the shared basis and goes
  // straight into Profile 1's sketch, no separate "accept" step (matches
  // Mirror3D's own single-click plane pick).
  async function startLoftProfile1(pick) {
    const basis = pick.kind === 'face'
      ? {
          origin: pick.facePlane.origin.clone(),
          // Loft Cutout: a picked face's normal points OUTWARD (away from
          // the solid) — negate it so stepping through Next Profile builds
          // INTO the material, not away from it into empty space (which
          // would never overlap the solid to cut from — see commitLoft's
          // "No base solid to cut from" failure otherwise). Additive Loft
          // keeps the outward normal — a boss sticking OUT of the face is
          // the expected direction there.
          normal: loftTool === 'loftcutout' ? pick.facePlane.normal.clone().negate() : pick.facePlane.normal.clone(),
          // Always the TRUE outward normal, regardless of loftTool — used by
          // buildLoftFacePlane for the sketch's camera/raycast orientation
          // only. The sweep normal above intentionally points into the
          // material for a cutout; the camera must still look FROM the
          // outward (viewer's) side at every profile depth, or it snaps
          // behind the material and every click renders mirrored (see
          // buildLoftFacePlane's comment).
          viewNormal: pick.facePlane.normal.clone(),
          uAxis: pick.facePlane.uAxis.clone(), vAxis: pick.facePlane.vAxis.clone(),
        }
      : (() => {
          const wb = workPlaneToFacePlaneBasisPx(pick.planeId)
          return { ...wb, viewNormal: wb.normal.clone() }
        })()
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
    clearLoftPreviewCanvas()
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
    clearLoftPreviewCanvas()
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
      // The true outward normal, stored explicitly at commit time (see
      // commitLoft) — NOT re-derived here, because whether a stored cutout
      // feature's `normal` is the (possibly negated) sweep direction depends
      // on whether it started from a face pick or a work-plane pick (see
      // startLoftProfile1), which isn't otherwise recoverable from the
      // feature alone. Falls back to `normal` unchanged for projects saved
      // before this field existed — re-editing one of those still has the
      // pre-existing mirrored-camera bug, but that's a no-worse-than-before
      // fallback rather than guessing and risking a NEW mirror on features
      // that never had the bug (work-plane-started cutouts).
      viewNormal: feat.viewNormal ? new THREE.Vector3(...feat.viewNormal) : normal.clone(),
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
    // A loft-cutout is stored as operation:'cutout' (see commitLoft), not
    // operation:'loft' — distinguished here by carrying a `profiles` field,
    // same check the Feature Tree's isLoftCutout uses.
    const isLoftCutoutFeat = feat && feat.operation === 'cutout' && !!feat.profiles
    if (!feat || !(feat.operation === 'loft' || isLoftCutoutFeat)) return
    resetSelection(); resetDrawState()
    setTool('loft3d')
    setLoftTool(isLoftCutoutFeat ? 'loftcutout' : 'loft')
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
    const isLoftCutout = loftTool === 'loftcutout'
    feat3d.commit(features)
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
    // The true outward normal (see buildLoftFacePlane/startLoftProfile1) —
    // stored so featureLoftBasisPx can restore it exactly on re-edit instead
    // of guessing whether `normal` above was negated for this feature.
    const viewNormal = [basis.viewNormal.x, basis.viewNormal.y, basis.viewNormal.z]

    // Subtracts the lofted shape from whatever solid(s) it overlaps, instead
    // of adding a new one — same "Extrude vs Cutout" split as commitExtrude,
    // just for a lofted cut shape. Target resolution mirrors commitExtrude's
    // own cutout branch (App3D.jsx ~4636-4661) exactly: re-edit reuses the
    // previously cut solid(s) (via groupId, for a cut that spanned several
    // solids), a brand-new cutout finds every solid the swept volume
    // (loftSweepBoxPx) actually overlaps.
    if (isLoftCutout) {
      const editingFeat = editingId ? features.find(f => f.id === editingId) : null
      const cutParams = {
        profiles: profiles.map(p => ({ pts: p.pts, circle: p.circle, offsetMm: p.offsetMm })),
        normal, origin, uAxis, ruled,
      }
      try {
        let targets, oldMembers = []
        if (editingFeat) {
          oldMembers = editingFeat.groupId
            ? features.filter(f => f.groupId === editingFeat.groupId)
            : [editingFeat]
          const targetIds = [...new Set(oldMembers.map(m => m.solidId))]
          targets = targetIds.map(id => solids.find(s => s.id === id)).filter(Boolean)
          if (targets.length === 0) throw new Error('No base solid to cut from')
        } else {
          const sweepBox = loftSweepBoxPx(profiles, basis)
          const candidates = solids.filter(s => s.operation !== 'cutout' && s.group)
          targets = candidates.filter(s => sweepBox.intersectsBox(new THREE.Box3().setFromObject(s.group)))
          if (targets.length === 0) throw new Error('No base solid to cut from')
        }

        const reuseId = editingId && !editingFeat.groupId && targets.length === 1
        const groupId = `loftcutgroup-${Date.now()}`
        const newFeats = []
        for (let target of targets) {
          // Re-edit: rebuild this target clean of just the OLD cut on it
          // (everything else replays as-is), then cut the fresh shape below.
          const idsToSkipHere = oldMembers.filter(m => m.solidId === target.id).map(m => m.id)
          if (idsToSkipHere.length) {
            const meshData = await rebuildSolidChain(target, { skipIds: idsToSkipHere })
            target = { ...target, group: replicadMeshToThree(meshData, target.color, target.id) }
            setSolids(prev => prev.map(s => s.id === target.id ? target : s))
          }
          const meshData = await cadEngine.subtract({ baseSolidId: target.id, cut: cutParams, base: buildBaseWorkerParams(target) })
          const group = replicadMeshToThree(meshData, target.color, target.id)
          target = { ...target, group }
          setSolids(prev => prev.map(s => s.id === target.id ? target : s))
          newFeats.push({
            id: reuseId ? editingId : `loftcutout-${target.id}-${Date.now()}-${newFeats.length}`,
            type: 'extrude', operation: 'cutout', name: editingFeat?.name || nextCutoutName(), groupId,
            solidId: target.id, normal, origin, uAxis, vAxis, viewNormal, profiles, ruled, color: '#e05a4e',
          })
          await rebuildDependentMirrors(target)
        }
        const oldMemberIds = oldMembers.map(m => m.id)
        setFeatures(prev => [...prev.filter(f => !oldMemberIds.includes(f.id)), ...newFeats])
      } catch (err) {
        console.error('Loft cutout failed:', err)
        setCadError(`Loft cutout failed: ${err.message || String(err)}`)
        setTimeout(() => setCadError(null), 6000)
      }
      return
    }

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
        setFeatures(prev => prev.map(f => f.id === editingId ? { ...f, normal, origin, uAxis, vAxis, viewNormal, profiles, ruled } : f))
      } else {
        setFeatures(prev => [...prev, {
          id: `loft-${solidId}`, type: 'extrude', operation: 'loft', name: nextLoftName(),
          solidId, normal, origin, uAxis, vAxis, viewNormal, profiles, ruled, color,
        }])
      }
      await rebuildDependentMirrors(solidData)
    } catch (err) {
      console.error('Loft failed:', err)
      setCadError(`Loft failed: ${err.message || String(err)}`)
      setTimeout(() => setCadError(null), 6000)
    }
  }

  // Step 2 commit — picking a plane/face (or confirming an offset plane, see
  // commitMirror3DOffset below) mirrors EVERY selected body in one go. `pick`
  // is {kind:'face', facePlane} or {kind:'workplane', planeId} — same shape
  // commitMirrorSolid already expects, so this is just a loop over the
  // accumulated picks, sequentially awaited (same style as
  // rebuildDependentMirrors' own loop below).
  async function commitMirror3DBatch(pick) {
    const picked = [...mirror3dSel]
    if (picked.length) feat3d.commit(features)
    resetMirror3D()
    setTool('select')
    for (const { featureId } of picked) {
      const feat = features.find(f => f.id === featureId)
      if (!feat) continue
      try {
        await commitMirrorSolid(feat, pick)
      } catch (err) {
        console.error('Mirror failed:', err)
        setCadError(`Mirror failed: ${err.message || String(err)}`)
        setTimeout(() => setCadError(null), 6000)
      }
    }
  }

  // Resolves mirror3dOffsetBase + mirror3dOffsetDistInput into a real
  // FacePlane offset along the base plane's own normal — shared by the live
  // preview effect (below) and commitMirror3DOffset, so the plane the user
  // sees is exactly the plane that gets committed.
  function mirror3dOffsetFacePlane() {
    if (!mirror3dOffsetBase) return null
    const basis = mirror3dOffsetBase.kind === 'face'
      ? mirror3dOffsetBase.facePlane
      : planeIdBasis(mirror3dOffsetBase.planeId)
    const distMm = parseFloat(mirror3dOffsetDistInput) || 0
    const origin = basis.origin.clone().addScaledVector(basis.normal, mmToPx(distMm))
    const vAxis = new THREE.Vector3().crossVectors(basis.normal, basis.uAxis).normalize()
    return new FacePlane(origin, basis.normal, basis.uAxis, vAxis)
  }

  // Commits through the exact same {kind:'face', facePlane} path a directly-
  // picked face already uses — no separate pick.kind, no worker changes.
  function commitMirror3DOffset() {
    const facePlane = mirror3dOffsetFacePlane()
    if (!facePlane) return
    commitMirror3DBatch({ kind: 'face', facePlane })
  }

  // Mirror step 2 (offset plane): moving the mouse over the viewport while a
  // base is picked live-updates the offset distance, so the plane can be
  // pushed forward/backward just by moving the cursor — same drag-to-set
  // mechanism handleExtrudeDragMove uses for "Set Depth" (project the mouse
  // offset onto the plane's own screen-space normal direction, divide by
  // screen-px-per-mm). Computed directly from basis.normal via worldToScreen
  // here rather than reusing computeExtrudeDirScreen/planeExtrudeDirection —
  // those flip XZ's normal sign for camera-orientation reasons (see
  // workPlaneToFacePlaneBasisPx's comment), which would silently invert drag
  // direction relative to what mirror3dOffsetFacePlane's own basis.normal
  // actually does. Signed, not abs()'d — the plane can go either side of
  // the base, not just outward.
  function handleMirror3DOffsetDragMove(e) {
    if (tool !== 'mirror3d' || !mirror3dOffsetBase) return
    const vp = viewport3dRef.current
    if (!vp) return
    const basis = mirror3dOffsetBase.kind === 'face' ? mirror3dOffsetBase.facePlane : planeIdBasis(mirror3dOffsetBase.planeId)
    const p0 = vp.worldToScreen(basis.origin.x, basis.origin.y, basis.origin.z)
    const p1 = vp.worldToScreen(
      basis.origin.x + basis.normal.x * 2,
      basis.origin.y + basis.normal.y * 2,
      basis.origin.z + basis.normal.z * 2,
    )
    if (!p0 || !p1) return
    const dx = p1.x - p0.x, dy = p1.y - p0.y
    const pxPerMm = Math.hypot(dx, dy)
    if (!pxPerMm) return
    const vpRect = vp.getDomElement?.()?.parentElement?.getBoundingClientRect?.()
    if (!vpRect) return
    const mx = e.clientX - vpRect.left, my = e.clientY - vpRect.top
    const proj = (mx - p0.x) * (dx / pxPerMm) + (my - p0.y) * (dy / pxPerMm)
    let mm = proj / pxPerMm
    if (gridSnap) mm = Math.round(mm / gridSizeMm) * gridSizeMm
    setMirror3dOffsetDistInput(String(Math.round(mm * 100) / 100))
  }

  // Live offset-plane preview — updates every time the base pick or the
  // distance input changes, so dragging/typing moves the translucent plane
  // in the 3D view in real time.
  useEffect(() => {
    if (tool !== 'mirror3d' || !mirror3dOffsetBase) { viewport3dRef.current?.hideOffsetPlanePreview(); return }
    const fp = mirror3dOffsetFacePlane()
    if (fp) viewport3dRef.current?.showOffsetPlanePreview({ origin: fp.origin, normal: fp.normal, uAxis: fp.uAxis, vAxis: fp.vAxis })
  }, [tool, mirror3dOffsetBase, mirror3dOffsetDistInput])

  // ── Extrude/Cutout step 1: offset (parallel) plane — same idea as Mirror's
  // offset plane just above, kept as its own parallel implementation (see
  // the extrudeOffsetMode state comment for why). ──
  function extrudeOffsetFacePlane() {
    if (!extrudeOffsetBase) return null
    const basis = extrudeOffsetBase.kind === 'face'
      ? extrudeOffsetBase.facePlane
      : planeIdBasis(extrudeOffsetBase.planeId)
    const distMm = parseFloat(extrudeOffsetDistInput) || 0
    const origin = basis.origin.clone().addScaledVector(basis.normal, mmToPx(distMm))
    const vAxis = new THREE.Vector3().crossVectors(basis.normal, basis.uAxis).normalize()
    return new FacePlane(origin, basis.normal, basis.uAxis, vAxis)
  }

  function handleExtrudeOffsetPlanePick(pick) {
    if (!extrudeOffsetBase) setExtrudeOffsetBase(pick)
    else commitExtrudeOffset()  // base already picked — any further click accepts the live distance
  }

  // Commits through the exact same enterSketch(facePlane) path a directly-
  // picked face/plane already uses (handleFaceClick/handlePlaneClick) — no
  // separate entry point, no worker changes. Resets the offset state back to
  // defaults so stepping back to step 1 later (SmartStepBar onStepBack)
  // doesn't show stale "offset mode on" UI.
  function commitExtrudeOffset() {
    const facePlane = extrudeOffsetFacePlane()
    if (!facePlane) return
    enterSketch(facePlane)
    viewport3dRef.current?.snapToFace(facePlane)
    setExtrudeOffsetMode(false)
    setExtrudeOffsetBase(null)
    viewport3dRef.current?.hideOffsetPlanePreview()
  }

  // Drag-to-set-distance — same projection math as handleMirror3DOffsetDragMove
  // just above, gated on the extrude offset state instead of Mirror's.
  function handleExtrudeOffsetDragMove(e) {
    if (!extrudeTool || !extrudeOffsetBase) return
    const vp = viewport3dRef.current
    if (!vp) return
    const basis = extrudeOffsetBase.kind === 'face' ? extrudeOffsetBase.facePlane : planeIdBasis(extrudeOffsetBase.planeId)
    const p0 = vp.worldToScreen(basis.origin.x, basis.origin.y, basis.origin.z)
    const p1 = vp.worldToScreen(
      basis.origin.x + basis.normal.x * 2,
      basis.origin.y + basis.normal.y * 2,
      basis.origin.z + basis.normal.z * 2,
    )
    if (!p0 || !p1) return
    const dx = p1.x - p0.x, dy = p1.y - p0.y
    const pxPerMm = Math.hypot(dx, dy)
    if (!pxPerMm) return
    const vpRect = vp.getDomElement?.()?.parentElement?.getBoundingClientRect?.()
    if (!vpRect) return
    const mx = e.clientX - vpRect.left, my = e.clientY - vpRect.top
    const proj = (mx - p0.x) * (dx / pxPerMm) + (my - p0.y) * (dy / pxPerMm)
    let mm = proj / pxPerMm
    if (gridSnap) mm = Math.round(mm / gridSizeMm) * gridSizeMm
    setExtrudeOffsetDistInput(String(Math.round(mm * 100) / 100))
  }

  useEffect(() => {
    if (!extrudeTool || !extrudeOffsetBase) { viewport3dRef.current?.hideOffsetPlanePreview(); return }
    const fp = extrudeOffsetFacePlane()
    if (fp) viewport3dRef.current?.showOffsetPlanePreview({ origin: fp.origin, normal: fp.normal, uAxis: fp.uAxis, vAxis: fp.vAxis })
  }, [extrudeTool, extrudeOffsetBase, extrudeOffsetDistInput])

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

    // buildBaseWorkerParams returns null for a join/mirror source (no flat
    // pts/depth/plane rebuild description exists for those) — the worker
    // falls back to reading sourceSolid.id straight out of its shapeStore in
    // that case (see cadWorker.js's mirrorShape handler), which is safe here
    // since that solid's shapeStore entry was set at its own creation time.
    const base = buildBaseWorkerParams(sourceSolid)
    const ops = buildSolidOpsForWorker(sourceSolid, features)

    const newSolidId = Date.now()
    const meshData = await cadEngine.mirrorShape({ solidId: newSolidId, sourceSolidId: sourceSolid.id, base, ops, plane: planeParams })
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
  // (React batches state updates). Mirror-of-mirror chains are now allowed
  // (see baseFeatureForSolid), so this recurses after each dependent rebuild
  // to cascade to ITS dependents in turn — always terminates without a cycle
  // guard because a mirror's sourceSolidId always points at a solid created
  // earlier, so the dependency graph can't loop back on itself.
  async function rebuildDependentMirrors(solid) {
    const dependents = features.filter(f => f.operation === 'mirror' && f.sourceSolidId === solid.id)
    if (dependents.length === 0) return
    // buildBaseWorkerParams returns null for a join/mirror source — see
    // commitMirrorSolid's comment; the worker falls back to sourceSolidId.
    const base = buildBaseWorkerParams(solid)
    const ops = buildSolidOpsForWorker(solid, features)
    for (const mirrorFeat of dependents) {
      try {
        const meshData = await cadEngine.mirrorShape({ solidId: mirrorFeat.solidId, sourceSolidId: solid.id, base, ops, plane: mirrorFeat.mirrorPlane })
        const group = replicadMeshToThree(meshData, mirrorFeat.color, mirrorFeat.solidId)
        setSolids(prev => prev.map(s => s.id === mirrorFeat.solidId ? { ...s, group } : s))
        await rebuildDependentMirrors({ id: mirrorFeat.solidId, operation: 'mirror' })
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
      // An imported STEP body's whole "recipe" — see buildBaseWorkerParams'
      // import branch.
      stepText: feat.stepText,
      // Move/Copy's baked position offset (see activateMoveCopy3DTool's own
      // comment) — orthogonal to every operation type above, so it's just
      // carried through verbatim regardless of which branch built the rest
      // of this temp solid.
      transform: feat.transform,
    }
  }

  // `feats`/`solidsLookup` default to the live component state so every
  // existing call site behaves exactly as before — pass them explicitly to
  // rebuild against a different snapshot (rebuildProjectFromFeatures does
  // this, replaying a just-loaded project before its solids exist in state).
  async function rebuildFeatureSolid(feat, feats = features, solidsLookup = solids) {
    if (feat.operation === 'mirror') {
      const sourceSolid = solidsLookup.find(s => s.id === feat.sourceSolidId)
      if (!sourceSolid) throw new Error('Mirror source solid not found')
      const base = buildBaseWorkerParams(sourceSolid)
      const ops = buildSolidOpsForWorker(sourceSolid, feats)
      let meshData = await cadEngine.mirrorShape({ solidId: feat.solidId, sourceSolidId: sourceSolid.id, base, ops, plane: feat.mirrorPlane })
      // A moved/copied mirror result — mirrorShape bypasses rebuildSolidChain
      // entirely (it's a special case right here, not routed through it), so
      // its own baked-transform bake-in has to happen right after, same as
      // rebuildSolidChain's own trailing step does for every other operation.
      if (feat.transform) meshData = await cadEngine.transformShape({ solidId: feat.solidId, position: feat.transform.position, rotation: feat.transform.rotation })
      return meshData
    }
    // rebuildSolidChain also transparently replays this member's OWN
    // cutouts/fillets — untouched by the join, still in `feats` keyed to
    // feat.solidId the whole time.
    return rebuildSolidChain(featureToTempSolid(feat), {}, feats, solidsLookup)
  }

  // Re-fuses a join solid's base from its members' own stored feature params
  // — needed when something on TOP of the join (a fillet/cutout) gets edited,
  // which goes through rebuildSolidChain and needs to rebuild the base clean
  // first. Member solids no longer exist in `solids` while locked, so this
  // reconstructs each member's base/ops from its FEATURE entry instead (same
  // per-member params rebuildFeatureSolid's extrude/revolve case builds).
  // A mirror member has no extrude-style base/ops of its own — its shapeStore
  // entry must actually exist before the join can reference it, so it's
  // proactively rebuilt via cadEngine.mirrorShape here rather than assumed
  // warm. That assumption held during live editing (the mirror was always
  // created earlier in the same session) but breaks on a cold worker — e.g.
  // right after a project load, where nothing has been built yet.
  async function rebuildJoinBaseMesh(joinSolid, feats = features, solidsLookup = solids) {
    const joinFeat = feats.find(f => f.solidId === joinSolid.id && f.operation === 'join')
    if (!joinFeat) throw new Error('Join feature not found for solid')
    // Non-mirror members first: a mirror member's source can be ANOTHER
    // member of this same join (e.g. an extrusion joined to its own mirror)
    // — it won't be in `solidsLookup` (locked/removed from `solids` the
    // whole time this join has existed), only reconstructable from its own
    // sibling member's feature entry, which the sort + rebuiltSolids below
    // make available before the mirror branch needs it.
    const memberFeats = (joinFeat.memberFeatureIds || []).map(id => feats.find(f => f.id === id)).filter(Boolean)
      .sort((a, b) => (a.operation === 'mirror') - (b.operation === 'mirror'))
    const members = []
    const rebuiltSolids = []
    for (const mf of memberFeats) {
      if (mf.operation === 'mirror') {
        const sourceSolid = solidsLookup.find(s => s.id === mf.sourceSolidId)
          || rebuiltSolids.find(s => s.id === mf.sourceSolidId)
        if (!sourceSolid) throw new Error('Mirror source solid not found (join member)')
        const base = buildBaseWorkerParams(sourceSolid)
        const ops = buildSolidOpsForWorker(sourceSolid, feats)
        await cadEngine.mirrorShape({ solidId: mf.solidId, sourceSolidId: sourceSolid.id, base, ops, plane: mf.mirrorPlane })
        members.push({ solidId: mf.solidId, base: null, ops: [] })
      } else if (mf.operation === 'join') {
        // Nested join member (join-of-join) — same "proactively rebuild,
        // don't assume warm" reasoning as the mirror branch above: a join
        // has no flat rebuild description of its own (buildBaseWorkerParams
        // returns null for it, same as mirror), so on a cold worker
        // (fresh page/project load, nothing built yet this session) its
        // shapeStore entry doesn't exist until its OWN members are fused.
        // Recurses to handle arbitrarily deep join-of-join-of-join chains.
        await rebuildJoinBaseMesh({ id: mf.solidId }, feats, solidsLookup)
        members.push({ solidId: mf.solidId, base: null, ops: [] })
      } else {
        const tempSolid = featureToTempSolid(mf)
        rebuiltSolids.push(tempSolid)
        members.push({ solidId: mf.solidId, base: buildBaseWorkerParams(tempSolid), ops: buildSolidOpsForWorker(tempSolid, feats) })
      }
    }
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
    feat3d.commit(features)
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
      // depthLocked (set when the user types into the depth box directly —
      // see its onChange) means they typed an exact value on purpose; the
      // mouse should still flip which side it's on (that's the whole point
      // of "hover either side of the plane to flip direction"), but must NOT
      // silently overwrite the number they typed the instant the mouse
      // drifts back over the canvas, which is what happened before this —
      // any typed value got clobbered by the very next mousemove.
      const nextDepth = prev.depthLocked ? prev.depthInput : mmStr
      if (prev.depthInput === nextDepth && prev.direction === nextDir) return prev
      return { ...prev, depthInput: nextDepth, direction: nextDir }
    })
  }

  // Loft's drag-to-position-next-profile preview: mirrors handleExtrudeDragMove
  // above but forward-only (v1 never needs to place an earlier profile
  // "behind" the first one) and — important — reads the SWEEP normal
  // (loftAnimParamsRef's sweepNormal, i.e. basis.normal, negated for a loft
  // cutout started from a face, see startLoftProfile1) rather than the
  // picked FacePlane's own .normal (always the true OUTWARD normal,
  // basis.viewNormal, used only for camera/sketch orientation — see
  // buildLoftFacePlane). Using the FacePlane's normal here would point the
  // drag direction backwards specifically for a loft cutout. dir is
  // recomputed fresh here (not cached in the ref) for the same reason
  // computeExtrudeDirScreen's own comment gives: it's a live-camera screen
  // projection, and caching it goes stale the moment the camera moves
  // independently of a mouse move (orbiting, or a still-settling tween).
  function handleLoftDragMove(e) {
    if (!isLoftDragArmed()) return
    const p = loftAnimParamsRef.current
    const vp = viewport3dRef.current
    if (!p || !vp) return
    const dir = vp.planeExtrudeDirection('face', { normal: p.sweepNormal })
    const centScreen = vp.sketchToScreen(p.centroid.x, p.centroid.y, 'face', p.facePlane)
    if (!centScreen) return
    const vpRect = vp.getDomElement?.()?.parentElement?.getBoundingClientRect?.()
    if (!vpRect) return
    const mx = e.clientX - vpRect.left, my = e.clientY - vpRect.top
    const proj = (mx - centScreen.x) * dir.dx + (my - centScreen.y) * dir.dy
    const screenPxPerMm = getScreenPxPerMm(vp, 'face', p.facePlane)
    // Loft (unlike a plain work-plane sketch/extrude, which uses snapToPlane's
    // hand-tuned, deliberately-non-perpendicular camera table) always enters
    // every profile's sketch via snapToFace — including a plain work-plane
    // start (see startLoftProfile1) — which CAN leave the camera looking
    // almost exactly down the sweep normal. Screen-space measurement along
    // that axis degenerates toward zero there (an orthographic camera shows
    // zero screen displacement for pure depth movement), and dividing by a
    // near-zero screenPxPerMm blows depthMm up to a nonsensical value —
    // reject anything too small to be a real on-screen measurement rather
    // than propagate it.
    if (!screenPxPerMm || screenPxPerMm < 0.05) return
    let mm = Math.max(0, proj) / screenPxPerMm   // forward-only — no front/back branch
    if (gridSnap) mm = Math.round(mm / gridSizeMm) * gridSizeMm
    mm = Math.max(gridSnap ? gridSizeMm : 0.1, mm)
    const mmStr = String(Math.round(mm * 100) / 100)
    setLoftState(prev => (!prev || prev.distanceInput === mmStr) ? prev : { ...prev, distanceInput: mmStr })
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

  // Loft's own parallel version of the extrude anim-loop pair above — kept
  // fully separate rather than folded into extrudeState's machinery, since
  // that loop already carries several hard-won staleness-bug fixes (see the
  // comments through this section) that a shared/coupled version would risk
  // reintroducing. Loft has no "through-all" analog needing an idle breathing
  // pulse, so this loop is simpler: always eased=1, always direction='front'.
  const loftAnimRef = useRef(null)
  const loftAnimParamsRef = useRef(null)
  function cancelLoftAnim() {
    if (loftAnimRef.current) { cancelAnimationFrame(loftAnimRef.current); loftAnimRef.current = null }
    loftAnimParamsRef.current = null
  }
  function startLoftAnimLoop() {
    cancelLoftAnim()
    function frame() {
      const p = loftAnimParamsRef.current
      if (p) {
        // dir/centScreen recomputed fresh every frame from the current camera,
        // same reasoning as computeExtrudeDirScreen's own comment below.
        const dir = p.vp.planeExtrudeDirection('face', { normal: p.sweepNormal })
        const centScreen = p.vp.sketchToScreen(p.centroid.x, p.centroid.y, 'face', p.facePlane)
        if (centScreen) {
          drawExtrudePreview(p.vp, p.profilePts, 'face', dir, centScreen, p.depthMm, 'front', 'loft', p.color, p.facePlane, 1)
        }
      }
      loftAnimRef.current = requestAnimationFrame(frame)
    }
    loftAnimRef.current = requestAnimationFrame(frame)
  }

  // Effect A — clock lifecycle only, mirrors extrude's Effect A above.
  useEffect(() => {
    if (!isLoftDragArmed()) { cancelLoftAnim(); return }
    // Loft always enters/re-enters a sketch via snapToFace, which looks
    // exactly perpendicular at the plane by design — great for sketching,
    // but it also leaves the screen-space direction/scale math the drag
    // preview relies on degenerate (see handleLoftDragMove's guard comment).
    // Rotating to the isometric angle the moment this step arms both fixes
    // that in the common case and matches Extrude's own preview, which is
    // never viewed perfectly straight-on either. Not awaited — the already-
    // running anim loop recomputes dir/centScreen fresh every frame from
    // whatever the camera is doing, so the ghost just follows the tween.
    viewport3dRef.current?.snapToIsometric()
    startLoftAnimLoop()
    return () => cancelLoftAnim()
  }, [!!loftState, sketchMode, loftState?.currentIdx, loftState?.profiles?.length])

  // Effect B — recompute draw params whenever the relevant inputs change
  // (mouse-driven distance, direct distance-box typing), mirrors extrude's
  // Effect B above. sweepNormal (basis.normal, not the FacePlane's own
  // .normal/viewNormal — see handleLoftDragMove's comment) is stashed as a
  // plain THREE.Vector3, not a screen-space direction — that part is still
  // recomputed fresh every frame/mousemove for the same camera-staleness
  // reason extrude's dir/centScreen are.
  useEffect(() => {
    const vp = viewport3dRef.current
    if (!isLoftDragArmed() || !vp) return
    const st = loftState
    const prof = st.profiles[st.currentIdx]
    const facePlane = buildLoftFacePlane(st.basis, st.currentOffsetMm)
    const depthMm = parseFloat(st.distanceInput) || 20
    loftAnimParamsRef.current = {
      vp, profilePts: prof.pts, facePlane, sweepNormal: st.basis.normal,
      centroid: prof.centroid, depthMm,
      color: loftTool === 'loftcutout' ? '#53D3E4' : '#FBDA2D',
    }
  }, [loftState, sketchMode, loftTool])

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
      } else if (opType === 'loft') {
        // Loft's current profile (basePts, direction is always 'front' here)
        // has no other on-screen representation while positioning the NEXT
        // profile's offset — it's not a committed feature yet (see
        // loftState.profiles, only promoted to `features` once the whole loft
        // commits), so without drawing it here it visually disappears the
        // moment its own sketch closes, leaving only the moving cap ghost
        // below. Neutral gray (not strokeColor) so it doesn't read as a
        // second copy of the moving target at the wrong position.
        glowFill(ctx, facePath(basePts), '#888888', 0.05)
        glowStroke(ctx, facePath(basePts), '#888888', 1.25)
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
      direction: 'front',
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
  async function rebuildSolidChain(baseSolid, { overrideId=null, overrideCut=null, overrideFilletRadius=null, skipId=null, skipIds=null } = {}, feats = features, solidsLookup = solids) {
    let { meshData, baseWorkerParams } = baseSolid.operation === 'join'
      ? await rebuildJoinBaseMesh(baseSolid, feats, solidsLookup)
      : await rebuildBaseMesh(baseSolid)
    const ops = feats.filter(f => f.solidId === baseSolid.id && (f.operation === 'cutout' || f.type === 'fillet'))
    // skipIds lets a caller skip several ops in ONE rebuild pass (e.g. deleting
    // or re-sketching every member of a multi-hole cutout group that shares this
    // solidId) instead of doing N separate full rebuild-and-replay passes.
    const skipSet = skipIds ? new Set(skipIds) : null
    for (const opFeat of ops) {
      if (opFeat.id === skipId || skipSet?.has(opFeat.id)) continue
      if (opFeat.type === 'fillet') {
        const radius = opFeat.id === overrideId ? overrideFilletRadius : opFeat.radius
        meshData = await cadEngine.fillet3d({ solidId: baseSolid.id, edgePoints: opFeat.edgePoints, radius, base: baseWorkerParams })
      } else {
        const cutParams = opFeat.id === overrideId ? overrideCut : buildCutWorkerParams(opFeat)
        meshData = await cadEngine.subtract({ baseSolidId: baseSolid.id, cut: cutParams, base: baseWorkerParams })
      }
    }
    // Move/Copy/Rotate's baked transform — applied last, on top of the
    // clean base plus every cutout/fillet, so it's one uniform final step
    // regardless of operation type (extrude/revolve/loft/join all reach
    // here; mirror is the one exception, handled in rebuildFeatureSolid
    // itself since it bypasses this function entirely). No rotation.pivot
    // here — this replays the feature's whole cumulative transform against
    // its pristine rebuilt shape in one shot, so the worker computes the
    // pivot itself from that shape's own bounding box (see transformShape's
    // own comment).
    if (baseSolid.transform) {
      meshData = await cadEngine.transformShape({ solidId: baseSolid.id, position: baseSolid.transform.position, rotation: baseSolid.transform.rotation })
    }
    return meshData
  }

  // Rebuilds every solid in a project from scratch, purely from a loaded
  // `features` array — the load-time counterpart to editing, which only ever
  // rebuilds ONE feature's dependency chain reactively. Walks the tree in
  // order and reuses rebuildFeatureSolid for each top-level feature (it
  // already dispatches extrude/revolve/loft through rebuildSolidChain and
  // mirror through cadEngine.mirrorShape directly); sketches, and cutout/
  // fillet features, are consumed inside that chain rather than getting a
  // standalone solid of their own. `newSolids` is built up incrementally
  // (not read from React state, which won't hold anything yet) so a later
  // mirror/join feature can find the solid it depends on — this relies on
  // `loadedFeatures` being in creation order, same as every other place in
  // this file that assumes dependencies appear earlier in the array.
  async function rebuildProjectFromFeatures(loadedFeatures) {
    const newSolids = []
    for (const feat of loadedFeatures) {
      if (feat.type === 'sketch' || feat.type === 'fillet' || feat.operation === 'cutout') continue
      if (feat.joinedInto) continue
      const meshData = await rebuildFeatureSolid(feat, loadedFeatures, newSolids)
      const group = replicadMeshToThree(meshData, feat.color, feat.solidId)
      newSolids.push({
        ...featureToTempSolid(feat),
        group, color: feat.color, hidden: !!feat.hidden,
        sourceSolidId: feat.sourceSolidId, mirrorPlane: feat.mirrorPlane,
      })
    }
    return newSolids
  }

  async function commitExtrude(overrideState=null) {
    const state = overrideState || extrudeStateRef.current || extrudeState
    if (!state) return
    const { profiles, planeId, pickedIdx, depthInput, direction='both', extentMode='through', revolveAxis=null, revolveReverse=false,
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
    feat3d.commit(features)
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
        // Builds cut params for ONE profile — revolve-cutout (axis + angle,
        // no depth/direction) or a plain linear cut. Mirrors
        // buildCutWorkerParams' own branching so the two stay in sync.
        const buildCut = p => revolveAxis
          ? {
              pts: p, planeId, axis: revolveAxis, angleDeg, reverse: revolveReverse,
              circle: p.circleMeta || null,
              ...(facePlane ? {
                normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
                origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
                uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
              } : {}),
            }
          : {
              pts: p, depthMm: cutDepthMm, planeId, direction: cutDirection,
              circle: p.circleMeta || null,
              ...(facePlane ? {
                normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
                origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
                uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
              } : {}),
            }
        // Revolve-cutouts stay single-profile — a sketch axis line implies one
        // profile in practice, and revolve is explicitly out of scope for the
        // multi-profile cutout below — any extra profiles are ignored.
        const cutProfiles = revolveAxis ? [pts] : profiles

        if (editingId && !overrideState) {
          // GEAR icon: extent-only edit (depth/direction/extentMode changed,
          // profile geometry did NOT — handleEditExtent always reaches
          // commitExtrude() via the Step-3 popup, i.e. with no explicit
          // overrideState, whether or not the feature is grouped; a pencil
          // re-sketch always passes an explicit overrideState — see
          // handleFinishSketch). Refresh every member's cut from ITS OWN
          // stored profile — never the single representative `pts`
          // handleEditExtent seeds `profiles` with — so a multi-hole group
          // keeps each hole's own position/size and only depth/direction change.
          const groupMembers = editingFeat.groupId
            ? features.filter(f => f.groupId === editingFeat.groupId)
            : [editingFeat]
          const updatedById = new Map()
          for (const member of groupMembers) {
            const baseSolid = solids.find(s => s.id === member.solidId)
            if (!baseSolid) continue
            const memberCut = buildCutWorkerParams({
              ...member, cutDepthMm, cutDirection, extentMode, revolveReverse,
              angleDeg: member.revolveAxis ? angleDeg : member.angleDeg,
            })
            const meshData = await rebuildSolidChain(baseSolid, { overrideId: member.id, overrideCut: memberCut })
            const group = replicadMeshToThree(meshData, baseSolid.color, baseSolid.id)
            const updatedSolid = { ...baseSolid, group }
            setSolids(prev => prev.map(s => s.id === baseSolid.id ? updatedSolid : s))
            updatedById.set(member.id, { ...member, depthMm, cutDepthMm, cutDirection, extentMode })
            await rebuildDependentMirrors(updatedSolid)
          }
          setFeatures(prev => prev.map(f => updatedById.get(f.id) || f))

        } else {
          // Fresh profile set: a brand new cutout, or a pencil re-sketch
          // (always an explicit overrideState) of an existing one — grouped
          // or not, at any new profile count. Both cut every profile in
          // `cutProfiles` into every affected target solid, sequentially per
          // target (the worker's own shapeStore threads each solid's running
          // result between subtract calls — same technique the per-letter
          // hole-punching loop below relies on), and (re)create one cutout
          // feature per (target, profile) pair sharing one groupId — a group
          // of exactly one member is harmless (every simple single-circle
          // cutout already works this way today).
          // Each profile's OWN bounding box (footprint extended by the cut's
          // actual depth/direction span) — kept separate per profile, never
          // unioned into one big box. A union would make target-detection too
          // coarse: a solid sitting between two holes (but touching neither)
          // would get falsely swept in just because it falls inside the outer
          // span of the whole grid. These same per-profile boxes are reused
          // below to skip a profile that doesn't actually touch a given
          // target, so a solid near ONE hole doesn't get N pointless no-op
          // cuts attempted against it.
          const worldNormals = { XY:[0,0,1], XZ:[0,-1,0], YZ:[1,0,0] }
          const [nx, ny, nz] = facePlane
            ? [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z]
            : (worldNormals[planeId] || [0,0,1])
          const normalVec = new THREE.Vector3(nx, ny, nz)
          const profileBoxes = cutProfiles.map(p => {
            if (revolveAxis) return revolveSweepBoxPx(p, revolveAxis, angleDeg, revolveReverse, planeId, facePlane)
            const worldPts = p.map(pt => {
              const w = facePlane ? facePlane.sketchToWorld(pt.x, pt.y) : sketchToWorld(pt.x, pt.y, planeId)
              return new THREE.Vector3(w.x, w.y, w.z)
            })
            const [minMm, maxMm] = cutExtentRangeMm(cutDepthMm, cutDirection, planeId)
            const profBox = new THREE.Box3().setFromPoints(worldPts)
            const box = profBox.clone()
            box.union(profBox.clone().translate(normalVec.clone().multiplyScalar(mmToPx(minMm))))
            box.union(profBox.clone().translate(normalVec.clone().multiplyScalar(mmToPx(maxMm))))
            return box
          })

          let targets, oldMembers = []
          if (editingId) {
            // Re-sketch: keep cutting the SAME target solid(s) the feature
            // originally spanned (don't re-detect overlap — matches this
            // codebase's existing "membership stays fixed" philosophy for
            // grouped-cutout edits) and remove the old members first.
            oldMembers = editingFeat.groupId
              ? features.filter(f => f.groupId === editingFeat.groupId)
              : [editingFeat]
            const targetIds = [...new Set(oldMembers.map(m => m.solidId))]
            targets = targetIds.map(id => solids.find(s => s.id === id)).filter(Boolean)
            if (targets.length === 0) throw new Error('No base solid to cut from')
          } else {
            // Brand new cutout: find every solid body the cut's actual volume
            // overlaps (not just the one whose face was sketched on), so cutting
            // through two stacked extrusions affects both — a solid only
            // counts if at least one INDIVIDUAL profile actually touches it.
            // OCC does the real, precise boolean cut below — this is only a
            // candidate filter.
            const candidates = solids.filter(s => s.operation !== 'cutout' && s.group)
            targets = candidates.filter(s => {
              const sBox = new THREE.Box3().setFromObject(s.group)
              return profileBoxes.some(pb => pb.intersectsBox(sBox))
            })
            if (targets.length === 0) throw new Error('No base solid to cut from')
          }

          // Preserve the edited feature's own id in the common case (single
          // target, single profile, wasn't already a group) — matters for
          // anything that stored a reference to this exact feature id.
          // Every other case (grouped, or the profile count changed) mints
          // fresh ids, same as the whole-word text-extrude re-edit already does.
          const reuseId = editingId && !editingFeat.groupId && targets.length === 1 && cutProfiles.length === 1

          const groupId = `cutgroup-${Date.now()}`
          const newFeats = []
          for (let target of targets) {
            // Re-sketch: rebuild this target clean of just the OLD group's
            // cuts on it (everything else — other cutouts/fillets — replays
            // as-is), THEN apply the fresh cuts below on top of that result.
            const idsToSkipHere = oldMembers.filter(m => m.solidId === target.id).map(m => m.id)
            if (idsToSkipHere.length) {
              const meshData = await rebuildSolidChain(target, { skipIds: idsToSkipHere })
              target = { ...target, group: replicadMeshToThree(meshData, target.color, target.id) }
              setSolids(prev => prev.map(s => s.id === target.id ? target : s))
            }
            const targetBox = new THREE.Box3().setFromObject(target.group)
            const targetBaseParams = buildBaseWorkerParams(target)
            for (let i = 0; i < cutProfiles.length; i++) {
              if (!profileBoxes[i].intersectsBox(targetBox)) continue
              const p = cutProfiles[i]
              const meshData = await cadEngine.subtract({ baseSolidId: target.id, cut: buildCut(p), base: targetBaseParams })
              const group = replicadMeshToThree(meshData, target.color, target.id)
              target = { ...target, group }
              setSolids(prev => prev.map(s => s.id === target.id ? target : s))
              newFeats.push({
                id: reuseId ? editingId : `cutout-${target.id}-${Date.now()}-${newFeats.length}`,
                type: 'extrude', name: editingFeat?.name || nextCutoutName(), groupId,
                solidId: target.id, sketchId: lastSketch?.id || null,
                depthMm, cutDepthMm, cutDirection, extentMode, color, operation: 'cutout', planeId, profilePts: p, facePlane,
                revolveAxis, angleDeg, revolveReverse, ...sketchGeom,
              })
            }
            await rebuildDependentMirrors(target)
          }
          const oldMemberIds = oldMembers.map(m => m.id)
          setFeatures(prev => [...prev.filter(f => !oldMemberIds.includes(f.id)), ...newFeats])
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

      } else if (editingId && !overrideState) {
        // GEAR icon: extent-only edit (depth/direction changed, profile
        // geometry did NOT — see the matching comment on the cutout branch
        // above for why `!overrideState` is the reliable signal). Refresh
        // every member (or the lone feature, if not grouped) from ITS OWN
        // stored profile/holes, keeping each solid's own shape/position and
        // only updating depth/direction.
        const groupMembers = editingFeat.groupId
          ? features.filter(f => f.groupId === editingFeat.groupId)
          : [editingFeat]
        const updatedById = new Map()
        for (const member of groupMembers) {
          const memberPts = member.profilePts
          const memberWorkerParams = {
            pts: memberPts, depthMm, planeId: member.planeId, direction,
            circle: memberPts.circleMeta || null,  // true circle → real curve, not a polygon prism
            ...(member.facePlane ? {
              normal: [member.facePlane.normal.x, member.facePlane.normal.y, member.facePlane.normal.z],
              origin: [pxToMm(member.facePlane.origin.x), pxToMm(member.facePlane.origin.y), pxToMm(member.facePlane.origin.z)],
              uAxis:  [member.facePlane.uAxis.x,  member.facePlane.uAxis.y,  member.facePlane.uAxis.z],
              vAxis:  [member.facePlane.vAxis.x,  member.facePlane.vAxis.y,  member.facePlane.vAxis.z],
            } : {}),
          }
          let meshData = await cadEngine.extrude({ ...memberWorkerParams, solidId: member.solidId })
          for (const holePts of (memberPts.holes || [])) {
            const holeCut = {
              pts: holePts, depthMm: depthMm*4+10, planeId: member.planeId, direction: 'both',
              ...(member.facePlane ? {
                normal: [member.facePlane.normal.x, member.facePlane.normal.y, member.facePlane.normal.z],
                origin: [pxToMm(member.facePlane.origin.x), pxToMm(member.facePlane.origin.y), pxToMm(member.facePlane.origin.z)],
                uAxis:  [member.facePlane.uAxis.x,  member.facePlane.uAxis.y,  member.facePlane.uAxis.z],
              } : {}),
            }
            meshData = await cadEngine.subtract({ baseSolidId: member.solidId, cut: holeCut, base: memberWorkerParams })
          }
          const group = replicadMeshToThree(meshData, member.color, member.solidId)
          // filter+push, not .map() — handleEditExtent already removed this
          // solid from state (to hide it while the popup is open, for a
          // plain extrude/revolve; cutouts leave their base solid in place),
          // so a .map() here would silently find no matching entry to update
          // and the solid would never come back until an unrelated re-sketch
          // (which uses this same filter+push pattern) happened to re-add it.
          setSolids(prev => [...prev.filter(s => s.id !== member.solidId), {
            id: member.solidId, group, planeId: member.planeId, operation: 'extrude',
            direction, depth: mmToPx(depthMm), depthMm,
            profilePts: memberPts, color: member.color, facePlane: member.facePlane,
          }])
          updatedById.set(member.id, { ...member, depthMm, direction, extentMode })
        }
        setFeatures(prev => prev.map(f => updatedById.get(f.id) || f))

      } else {
        // Fresh profile set: a brand new extrude, or a pencil re-sketch
        // (always an explicit overrideState) of an existing one — at any
        // profile count, whole-word text included (letters are just profiles
        // like any other; each already carries its own .holes from
        // detectProfiles/resolveTextHoles). Extrudes every profile into its
        // own solid and (re)creates one feature per profile sharing a single
        // groupId — a group of exactly one member is harmless (FeatureTree
        // only shows the "N bodies" suffix when > 1).
        const groupId = editingFeat?.groupId || `profilegroup-${Date.now()}`
        // Preserve the edited feature's own id/solid in the common case
        // (single profile, wasn't already a MULTI-member group) — matters for
        // anything that stored a reference to this exact feature/solid id
        // (e.g. a dependent mirror or cutout keyed by sourceSolidId). Every
        // extrude carries a groupId even when solo (see comment above), so
        // checking `!editingFeat.groupId` alone never matched an existing
        // feature — reuse was always false, which both reordered the row to
        // the end of the Feature Tree AND minted a brand-new solidId on
        // every edit, silently orphaning anything (a cutout, a fillet) that
        // targeted the old one. A solo groupId (exactly one member) counts
        // the same as no groupId at all.
        const wasSoloBody = !editingId || !editingFeat.groupId ||
          features.filter(f => f.groupId === editingFeat.groupId).length === 1
        const reuse = editingId && wasSoloBody && profiles.length === 1
        if (editingFeat?.groupId) {
          const oldMembers = features.filter(f => f.groupId === editingFeat.groupId)
          const oldSolidIds = new Set(oldMembers.map(f => f.solidId))
          setSolids(prev => prev.filter(s => !oldSolidIds.has(s.id)))
        } else if (editingId && !reuse) {
          // Was a single (non-grouped) extrude, but the re-sketch produced a
          // different profile count — its old solid gets replaced by N new ones.
          setSolids(prev => prev.filter(s => s.id !== editingFeat.solidId))
        }

        const newFeats = []
        let profIdx = -1
        for (const profPts of profiles) {
          profIdx++
          const solidId = reuse ? editingFeat.solidId : Date.now() + Math.random()
          const memberWorkerParams = {
            pts: profPts, depthMm, planeId, direction,
            circle: profPts.circleMeta || null,  // true circle → real curve, not a polygon prism
            ...(facePlane ? {
              normal: [facePlane.normal.x, facePlane.normal.y, facePlane.normal.z],
              origin: [pxToMm(facePlane.origin.x), pxToMm(facePlane.origin.y), pxToMm(facePlane.origin.z)],
              uAxis:  [facePlane.uAxis.x,  facePlane.uAxis.y,  facePlane.uAxis.z],
              vAxis:  [facePlane.vAxis.x,  facePlane.vAxis.y,  facePlane.vAxis.z],
            } : {}),
          }
          let meshData
          try {
            meshData = await cadEngine.extrude({ ...memberWorkerParams, solidId })
          } catch (e) {
            console.error(`[multi-profile extrude] profile ${profIdx} extrude failed, pts:`, profPts.length, e)
            throw e
          }
          // filter+push: a reused solidId's old entry (or nothing, for a fresh one) gets replaced
          setSolids(prev => [...prev.filter(s => s.id !== solidId), {
            id: solidId, group: replicadMeshToThree(meshData, color, solidId), planeId, operation:'extrude',
            direction, depth: mmToPx(depthMm), depthMm, profilePts: profPts, color, facePlane,
          }])
          // Punch each hole (the counter in O/A/8/etc., or any nested loop in
          // a plain profile) all the way through regardless of extrude
          // direction — generous depth, symmetric direction, guarantees full penetration.
          let holeIdx = -1
          for (const holePts of (profPts.holes || [])) {
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
              meshData = await cadEngine.subtract({ baseSolidId: solidId, cut: holeCut, base: memberWorkerParams })
            } catch (e) {
              console.error(`[multi-profile extrude] profile ${profIdx} hole ${holeIdx} cut failed, holePts:`, holePts.length, e)
              throw e
            }
            const group = replicadMeshToThree(meshData, color, solidId)
            setSolids(prev => prev.map(s => s.id === solidId ? { ...s, group } : s))
          }
          // Reusing this solidId means cadEngine.extrude() above just
          // overwrote the worker's cached shape with a bare, uncut base —
          // any separately-created Cutout/Fillet FEATURES that were already
          // baked into the old version of this solid (distinct from the
          // profile-intrinsic holes just punched above) are gone from that
          // cache now, even though their feature rows still exist in the
          // tree. Same replay this solid's rebuildSolidChain() would do,
          // inlined here since the base mesh is already in hand — avoids
          // re-extruding it a second time.
          if (reuse) {
            const depOps = features.filter(f => f.solidId === solidId && (f.operation === 'cutout' || f.type === 'fillet'))
            for (const opFeat of depOps) {
              try {
                meshData = opFeat.type === 'fillet'
                  ? await cadEngine.fillet3d({ solidId, edgePoints: opFeat.edgePoints, radius: opFeat.radius, base: memberWorkerParams })
                  : await cadEngine.subtract({ baseSolidId: solidId, cut: buildCutWorkerParams(opFeat), base: memberWorkerParams })
              } catch (e) {
                console.error(`[extrude edit] replaying dependent op ${opFeat.id} failed:`, e)
                throw e
              }
            }
            if (depOps.length > 0) {
              const group = replicadMeshToThree(meshData, color, solidId)
              setSolids(prev => prev.map(s => s.id === solidId ? { ...s, group } : s))
            }
          }
          newFeats.push({
            id: reuse ? editingId : `extrude-${solidId}`, type:'extrude', name: editingFeat?.name || nextExtrudeName(), groupId,
            solidId, sketchId: lastSketch?.id || null,
            depthMm, direction, extentMode, color, operation:'extrude', planeId,
            profilePts: profPts, facePlane, ...sketchGeom,
          })
          // Only the plain single-profile case supports dependent mirrors
          // today (matches the pre-existing behavior this branch replaces —
          // a multi-body group was never mirror-able, unchanged here).
          if (reuse) {
            await rebuildDependentMirrors({
              id: solidId, group: replicadMeshToThree(meshData, color, solidId), planeId, operation:'extrude',
              direction, depth: mmToPx(depthMm), depthMm, profilePts: profPts, color, facePlane,
            })
          }
        }

        if (reuse) {
          setFeatures(prev => prev.map(f => f.id === editingId ? newFeats[0] : f))
        } else if (editingId) {
          const oldIds = editingFeat.groupId
            ? features.filter(f => f.groupId === editingFeat.groupId).map(f => f.id)
            : [editingId]
          setFeatures(prev => [...prev.filter(f => !oldIds.includes(f.id)), ...newFeats])
        } else {
          setFeatures(prev => [...prev, ...newFeats])
        }
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
    // No restoreSavedView() here — this function never enters sketch mode or
    // snaps the camera (the profile isn't changing, only depth/direction), so
    // there's nothing to restore from. Calling it anyway would jump the
    // camera to whatever unrelated view was last saved elsewhere (see
    // activateLoft3DTool's comment for the full mechanism).
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

  // Toggle a body's visibility in the 3D view. Cutouts/fillets aren't
  // separate solids (see FeatureTree's isBodyOwner) so this only ever runs
  // for rows that own one — a plain single-solid feature, or a grouped one
  // (whole-word text extrude, multi-profile cutout) where every member
  // sharing groupId has its own solidId and must hide/show together.
  function handleToggleBodyVisible(featureId) {
    const feat = features.find(f => f.id === featureId)
    if (!feat) return
    const solidIds = feat.groupId
      ? [...new Set(features.filter(f => f.groupId === feat.groupId).map(f => f.solidId))]
      : [feat.solidId]
    const newHidden = !solids.find(s => s.id === feat.solidId)?.hidden
    setSolids(prev => prev.map(s => solidIds.includes(s.id) ? {...s, hidden:newHidden} : s))
  }
  const hiddenSolidIds = solids.filter(s => s.hidden).map(s => s.id)

  // Delete a feature
  async function handleDeleteFeature(featureId) {
    const feat = features.find(f => f.id === featureId)
    if (!feat) return
    feat3d.commit(features)

    if (feat.operation === 'join') {
      // Un-join: restore each member to its own independent, editable solid,
      // and auto-delete anything built on top of the joined result since —
      // confirmed with the user — a fillet/cutout/mirror targeting the fused
      // body doesn't have a well-defined meaning once it's un-merged. One
      // level deep only, same pragmatic depth limit as Mirror3D's own cascade.
      const dependentIds = features.filter(f => f.solidId === feat.solidId && f.id !== feat.id).map(f => f.id)
      // Non-mirror members first: a mirror member's source can be ANOTHER
      // member of this same join (e.g. joining an extrusion to its own
      // mirror) — that source won't be back in `solids` until its own turn
      // in this loop restores it, so mirrors must always go last.
      const memberFeats = (feat.memberFeatureIds || []).map(id => features.find(f => f.id === id)).filter(Boolean)
        .sort((a, b) => (a.operation === 'mirror') - (b.operation === 'mirror'))

      const restored = []
      for (const mf of memberFeats) {
        try {
          // solidsLookup includes whatever this loop has already restored,
          // not just the pre-un-join `solids` snapshot — needed for exactly
          // the same reason as the sort above.
          const meshData = await rebuildFeatureSolid(mf, features, [...solids, ...restored])
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
      // one logical cut that happened to span several solids (legacy: one
      // profile cut through N stacked bodies) or several holes in one solid
      // (multi-profile: N profiles cut into one body) — either way, group
      // members can now share a solidId, so rebuild each DISTINCT target
      // solid once, skipping every to-be-deleted member on it in one pass,
      // rather than one redundant full rebuild-and-replay per member.
      const idsToDelete = feat.groupId
        ? features.filter(f => f.groupId === feat.groupId).map(f => f.id)
        : [featureId]
      const membersToDelete = idsToDelete.map(id => features.find(f => f.id === id)).filter(Boolean)
      const targetIds = [...new Set(membersToDelete.map(m => m.solidId))]

      for (const targetId of targetIds) {
        const baseSolid = solids.find(s => s.id === targetId)
        if (!baseSolid) continue
        const skipIds = membersToDelete.filter(m => m.solidId === targetId).map(m => m.id)
        try {
          const meshData = await rebuildSolidChain(baseSolid, { skipIds })
          const group = replicadMeshToThree(meshData, baseSolid.color, baseSolid.id)
          const updatedSolid = { ...baseSolid, group }
          setSolids(prev => prev.map(s => s.id === baseSolid.id ? updatedSolid : s))
          await rebuildDependentMirrors(updatedSolid)
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
          const updatedSolid = { ...baseSolid, group }
          setSolids(prev => prev.map(s => s.id === baseSolid.id ? updatedSolid : s))
          await rebuildDependentMirrors(updatedSolid)
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

  // ── Export STL (selectable bodies) ────────────────────────────────────────
  // Click bodies directly in the 3D view to multi-select (toggle) which top-
  // level solids get included in the exported STL — reuses Join3D's cyan
  // multi-highlight (highlightJoinMembers/clearJoinHighlight are solid-
  // agnostic, just keyed by solidId, so there's no need for a parallel set of
  // Viewport3D methods). Enter commits; an empty selection exports every
  // solid, preserving the old one-click "export everything" behavior for
  // whoever doesn't care to pick.
  const [exportSTLSel, setExportSTLSel] = useState([])   // [solidId, ...] accumulated picks
  const [exportSTLBusy, setExportSTLBusy] = useState(false)

  function activateExportSTLTool() {
    resetSelection()
    resetDrawState()
    restoreHiddenEditSolid()
    // See activateLoft3DTool's comment — restoreSavedView() must stay inside
    // this guard, not fire unconditionally, or it jumps the camera to
    // whatever unrelated view was last saved by some other snap elsewhere.
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('exportstl')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setExportSTLSel([])
  }

  function resetExportSTL() {
    setExportSTLSel([])
  }

  function handleExportSTLClick(e) {
    if (tool !== 'exportstl') return
    const vp = viewport3dRef.current; if (!vp) return
    const hit = vp.raycastSolidFace(e.clientX, e.clientY)
    if (!hit || hit.solidId == null) return
    setExportSTLSel(prev =>
      prev.includes(hit.solidId) ? prev.filter(id => id !== hit.solidId) : [...prev, hit.solidId])
  }

  // Keeps every currently-selected body glowing in the 3D view, live as the
  // selection changes — same effect shape as Join3D's own highlight sync.
  useEffect(() => {
    if (tool !== 'exportstl') { viewport3dRef.current?.clearJoinHighlight(); return }
    viewport3dRef.current?.highlightJoinMembers(exportSTLSel)
  }, [exportSTLSel, tool])

  // Export the selected top-level solids — each with its own cutouts already
  // applied — fused into ONE continuous body and saved as a single STL, for
  // 3D printing. This only fuses at export time; live editing keeps solids
  // independent (see project-scope-vision memory: multi-body assembly union
  // was explicitly ruled out as too complex for this tool's editing model).
  async function commitExportSTL() {
    if (exportSTLBusy) return
    const targetIds = exportSTLSel.length > 0 ? exportSTLSel : solids.map(s => s.id)
    const targetSolids = solids.filter(s => targetIds.includes(s.id))
    if (targetSolids.length === 0) {
      setCadError('Nothing to export — add at least one solid first.')
      setTimeout(() => setCadError(null), 5000)
      return
    }
    setExportSTLBusy(true)
    try {
      // Ordered ops (cutout + fillet interleaved, in feature-array order) —
      // only used by the worker's cold-rebuild fallback when a solid isn't
      // already cached in shapeStore (e.g. right after a fresh page load);
      // the common case just reuses the live cached shape directly.
      const solidsForExport = targetSolids.map(solid => {
        const base = buildBaseWorkerParams(solid)
        const ops = features
          .filter(f => f.solidId === solid.id && (f.operation === 'cutout' || f.type === 'fillet'))
          .map(f => f.type === 'fillet'
            ? { type: 'fillet', radius: f.radius, edgePoints: f.edgePoints }
            : { type: 'cut', params: buildCutWorkerParams(f) })
        return { solidId: solid.id, base, ops }
      })

      const { stlBlob } = await cadEngine.exportSTL({ solids: solidsForExport })
      await saveBlobAs(stlBlob, 'model.stl', 'STL model', { 'model/stl': ['.stl'] })
    } catch (err) {
      console.error('STL export failed:', err)
      setCadError(`STL export failed: ${err.message || String(err)}`)
      setTimeout(() => setCadError(null), 8000)
    } finally {
      setExportSTLBusy(false)
    }
  }

  // ── Export STEP (selectable bodies) ───────────────────────────────────────
  // Exact mirror of Export STL above, just writing a real B-rep STEP file
  // instead of a triangle mesh — same body-click selection, same highlight,
  // same "empty selection = export everything" default, same multi-solid
  // fuse-at-export-time behavior (see commitExportSTEP's own comment on why
  // not a compound).
  const [exportSTEPSel, setExportSTEPSel] = useState([])
  const [exportSTEPBusy, setExportSTEPBusy] = useState(false)

  function activateExportSTEPTool() {
    resetSelection()
    resetDrawState()
    restoreHiddenEditSolid()
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('exportstep')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setExportSTEPSel([])
  }

  function resetExportSTEP() {
    setExportSTEPSel([])
  }

  function handleExportSTEPClick(e) {
    if (tool !== 'exportstep') return
    const vp = viewport3dRef.current; if (!vp) return
    const hit = vp.raycastSolidFace(e.clientX, e.clientY)
    if (!hit || hit.solidId == null) return
    setExportSTEPSel(prev =>
      prev.includes(hit.solidId) ? prev.filter(id => id !== hit.solidId) : [...prev, hit.solidId])
  }

  useEffect(() => {
    if (tool !== 'exportstep') { viewport3dRef.current?.clearJoinHighlight(); return }
    viewport3dRef.current?.highlightJoinMembers(exportSTEPSel)
  }, [exportSTEPSel, tool])

  // Multiple selected solids get welded with the same fuseTolerant Export
  // STL uses, not replicad's makeCompound — makeCompound deletes its input
  // shapes, and these come straight from the worker's live shapeStore cache;
  // compounding them would free cache entries out from under the app (see
  // cadWorker.js's exportSTL/exportSTEP handler for the full reasoning).
  // That means a multi-solid STEP still comes out as one fused body rather
  // than several separate ones — same tradeoff Export STL already made,
  // consistent with this app's own "no multi-body assembly" scope.
  async function commitExportSTEP() {
    if (exportSTEPBusy) return
    const targetIds = exportSTEPSel.length > 0 ? exportSTEPSel : solids.map(s => s.id)
    const targetSolids = solids.filter(s => targetIds.includes(s.id))
    if (targetSolids.length === 0) {
      setCadError('Nothing to export — add at least one solid first.')
      setTimeout(() => setCadError(null), 5000)
      return
    }
    setExportSTEPBusy(true)
    try {
      const solidsForExport = targetSolids.map(solid => {
        const base = buildBaseWorkerParams(solid)
        const ops = features
          .filter(f => f.solidId === solid.id && (f.operation === 'cutout' || f.type === 'fillet'))
          .map(f => f.type === 'fillet'
            ? { type: 'fillet', radius: f.radius, edgePoints: f.edgePoints }
            : { type: 'cut', params: buildCutWorkerParams(f) })
        return { solidId: solid.id, base, ops }
      })

      const { stepBlob } = await cadEngine.exportSTEP({ solids: solidsForExport })
      await saveBlobAs(stepBlob, 'model.step', 'STEP model', { 'application/step': ['.step', '.stp'] })
    } catch (err) {
      console.error('STEP export failed:', err)
      setCadError(`STEP export failed: ${err.message || String(err)}`)
      setTimeout(() => setCadError(null), 8000)
    } finally {
      setExportSTEPBusy(false)
    }
  }

  // ── Body color (selectable bodies) ────────────────────────────────────────
  // Click bodies directly in the 3D view to multi-select (toggle) which
  // solids get recolored — same click/highlight plumbing as Export STL
  // above (raycastSolidFace + highlightJoinMembers/clearJoinHighlight, both
  // solid-agnostic). Picking a swatch applies immediately to every selected
  // body: a live material update (no rebuild) plus writing the new color
  // onto both `solids` state (so a later rebuild — an edit, a fillet, a
  // mirror-dependent rebuild — keeps it) and onto the OWNING feature (the
  // extrude/revolve/mirror/join/loft that actually created the solid —
  // cutout and fillet features modify an existing solid rather than owning
  // one, so they're excluded) so a save+reload preserves it too, since
  // reload only ever reads color off the feature, never off `solids`.
  const [colorApplyColor, setColorApplyColor] = useState('#3a7bd5')

  function activateColorTool() {
    resetSelection()
    resetDrawState()
    restoreHiddenEditSolid()
    if (sketchModeRef.current) {
      setSketchMode(false)
      setActivePlane(null)
      setActiveSketchId(null)
      activePlaneRef.current = null
      viewport3dRef.current?.restoreSavedView()
    }
    setTool('color')
    setExtrudeTool(null)
    setExtrudeState(null)
    setEditingFeatureId(null)
    setColorSel([])
  }

  function resetColorTool() {
    setColorSel([])
  }

  function handleColorClick(e) {
    if (tool !== 'color') return
    const vp = viewport3dRef.current; if (!vp) return
    const hit = vp.raycastSolidFace(e.clientX, e.clientY)
    if (!hit || hit.solidId == null) return
    setColorSel(prev =>
      prev.includes(hit.solidId) ? prev.filter(id => id !== hit.solidId) : [...prev, hit.solidId])
  }

  // Keeps every currently-selected body glowing in the 3D view, live as the
  // selection changes — same effect shape as Export STL/Join3D's own sync.
  useEffect(() => {
    if (tool !== 'color') { viewport3dRef.current?.clearJoinHighlight(); return }
    viewport3dRef.current?.highlightJoinMembers(colorSel)
  }, [colorSel, tool])

  function applyColorToSelection(hexColor) {
    if (colorSel.length === 0) return
    const vp = viewport3dRef.current
    for (const solidId of colorSel) vp?.setSolidColor(solidId, hexColor)
    setSolids(prev => prev.map(s => colorSel.includes(s.id) ? { ...s, color: hexColor } : s))
    setFeatures(prev => prev.map(f =>
      colorSel.includes(f.solidId) && f.operation !== 'cutout' && f.type !== 'fillet'
        ? { ...f, color: hexColor } : f
    ))
    setColorSel([])
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
            // Select tool drag window — builds selection. Only entities fully
            // enclosed by the rect count (entityBBox comparison), matching
            // executeDragSelect's convention for the Move/Rotate/Scale tools —
            // a window select shouldn't pick up geometry the box merely crosses.
            const rect=dragRectRef.current
            const minX=Math.min(rect.x1,rect.x2),maxX=Math.max(rect.x1,rect.x2)
            const minY=Math.min(rect.y1,rect.y2),maxY=Math.max(rect.y1,rect.y2)
            const fullyIn=(kind,entity)=>{
              const b=entityBBox(kind,entity)
              return b.x1>=minX&&b.x2<=maxX&&b.y1>=minY&&b.y2<=maxY
            }
            const hits=[]
            linesRef.current.forEach((l,idx)=>{if(fullyIn('line',l))hits.push({kind:'line',idx})})
            circlesRef.current.forEach((c,idx)=>{if(fullyIn('circle',c))hits.push({kind:'circle',idx})})
            arcsRef.current.forEach((arc,idx)=>{if(fullyIn('arc',arc))hits.push({kind:'arc',idx})})
            splinesRef.current.forEach((sp,idx)=>{if(fullyIn('spline',sp))hits.push({kind:'spline',idx})})
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
    const snapped={x:Math.round(pt.x/gPx)*gPx, y:Math.round(pt.y/gPx)*gPx}
    // Unlike every other snap type, grid snap had no distance cutoff — it
    // always rounded to the nearest grid line, however far away that was.
    // Harmless at a grid size much smaller than what you're drawing, but a
    // grid size at or above the part's own size (e.g. the 10mm default on a
    // 10mm part) meant the ENTIRE part sat inside one grid cell, so every
    // point in it rounded to the same corner regardless of where the cursor
    // actually was. Same SNAP_DIST tolerance every geometric snap already uses.
    return Math.hypot(pt.x-snapped.x,pt.y-snapped.y)<SNAP_DIST/zoomRef.scale ? snapped : pt
  }

  function handleClick(e){
    if (wasDragRef.current){wasDragRef.current=false;return}
    lastClickClientRef.current = {x: e.clientX, y: e.clientY}

    const rawWorld=screenToWorld(e.clientX,e.clientY)
    // Geometric snap (endpoint/tangent/on-circle/intersection/etc.) takes
    // priority over grid snap — grid-snapping unconditionally here rounded
    // the click position away from tangent points, which essentially never
    // land exactly on a grid intersection, silently defeating Tangent
    // whenever grid snap was on (the default). excludePt is intentionally
    // generic (null, not the per-tool exclude point) — this is just a "is
    // there something to snap to nearby" pre-check; each tool's own handler
    // below re-derives the precise point with its correct excludePt.
    const nearbyGeo=getGeoSnap(rawWorld,snapLines,snapCircles,snapArcs,null,tKeyDown,splines,intersectionPts)
    const raw=(!nearbyGeo&&gridSnap)?snapToGrid(rawWorld):rawWorld

    // ── Loft: a click anywhere in the viewport while the drag-to-position
    // ghost is armed accepts the currently-shown distance, same as pressing
    // Enter in the banner's distance field. Checked before the extrude
    // branch below since both can never be armed at the same time. ──
    if (isLoftDragArmed()) {
      loftNextProfile()
      return
    }

    // Extrude/Cutout step 1, offset-plane base already picked — accept the
    // live drag distance on ANY canvas click, not just one that happens to
    // land on a plane/face (those route through handleExtrudeOffsetPlanePick
    // instead, via sketchArmed's onFaceClick/onPlaneClick). Must run before
    // the extrudeTool interceptor just below — that one unconditionally
    // returns for every step-1 click (handleExtrudeClick is a no-op with no
    // profile drawn yet), so this would never be reached after it.
    if (extrudeTool && extrudeOffsetBase) {
      commitExtrudeOffset()
      return
    }

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

    if (tool==='includeedge') {
      handleIncludeEdgeClick(e)
      return
    }

    // Face picking is handled entirely via sketchArmed + onFaceClick (see
    // handleFaceClick) — a click here means the ray missed every face, a no-op.
    if (tool==='exportfacedxf') return

    if (tool==='exportstl') {
      handleExportSTLClick(e)
      return
    }

    if (tool==='exportstep') {
      handleExportSTEPClick(e)
      return
    }

    // Mirror step 1 (still picking bodies) — step 2's plane/face pick runs
    // through sketchArmed + handleFaceClick/handlePlaneClick instead, same as
    // exportfacedxf above, so this only fires before mirror3dSelectionDone.
    if (tool==='mirror3d' && !mirror3dSelectionDone) {
      handleMirror3DBodyClick(e)
      return
    }

    // Mirror step 2, offset-plane base already picked — accept the live
    // drag distance on ANY canvas click, not just one that happens to land
    // on a plane/face/body (those route through handleMirror3DPlanePick
    // instead, via sketchArmed's onFaceClick/onPlaneClick — this covers
    // everything else: empty grid space, a body, off in space).
    if (tool==='mirror3d' && mirror3dOffsetBase) {
      commitMirror3DOffset()
      return
    }

    // Join — picks bodies the whole time it's active, same viewport-click
    // pattern as Mirror step 1/Export STL/Body Color.
    if (tool==='join3d') {
      handleJoin3DBodyClick(e)
      return
    }

    // Move/Copy step 2b: a handle is already armed — this click accepts the
    // live drag value, wherever in the canvas it lands (same "click anywhere
    // once armed accepts" convention as Mirror/Extrude's offset-plane).
    if (tool==='movecopy3d' && moveCopy3dDragHandle) {
      commitMoveCopy3D()
      return
    }
    // Snap Move: picking point 1 or point 2 — takes over clicks entirely
    // while active (the gizmo is hidden for the same reason, see the
    // showMoveGizmo effect's own comment).
    if (tool==='movecopy3d' && moveCopy3dSnapStep > 0) {
      handleSnapMoveClick(e)
      return
    }
    // Move/Copy step 2a: body picked, no handle armed yet — a click only
    // does something if it actually lands on a gizmo arrow/ring (arms that
    // handle); anything else is ignored rather than reinterpreted as
    // re-picking a different body — Escape backs out to step 1 for that.
    if (tool==='movecopy3d' && moveCopy3dSel != null) {
      const hit = viewport3dRef.current?.raycastMoveGizmo(e.clientX, e.clientY)
      if (hit) armMoveCopy3DHandle(hit, e)
      return
    }
    // Move/Copy step 1: pick the body.
    if (tool==='movecopy3d') {
      handleMoveCopy3DBodyClick(e)
      return
    }

    if (tool==='color') {
      handleColorClick(e)
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
        const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,false,splines,intersectionPts)
        const pt=geo?{x:geo.x,y:geo.y}:raw
        setStartPoint(pt)
        setTrackedPts([{...pt,sticky:true}]);trackedPtsRef.current=[{...pt,sticky:true}]
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
      const snap=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,false,splines,intersectionPts)
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
        const snap=getGeoSnap(raw,snapLines,snapCircles,snapArcs,{x:joinFirstPt.x,y:joinFirstPt.y},false,splines,intersectionPts)
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
      const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,splinePoints.length?splinePoints[splinePoints.length-1]:null,false,splines,intersectionPts)
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
          const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,false,splines,intersectionPts)
          const pt=geo&&geo.type!=='tan'&&geo.type!=='oncircle'?{x:geo.x,y:geo.y}:raw
          setMirrorP1(pt)
          // Seed tracking from first mirror point
          setTrackedPts([]);trackedPtsRef.current=[]
        } else {
          if (!mirrorPreview) return
          const hSnap=getGeoSnap(raw,snapLines,snapCircles,snapArcs,mirrorP1,false,splines,intersectionPts)
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
        const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,false,splines,intersectionPts)
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
        const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,false,splines,intersectionPts)
        setStartPoint(geo?{x:geo.x,y:geo.y}:raw)
        setAngleInput('');setAngleLocked(false);setTrackedPts([]);trackedPtsRef.current=[]
      } else {
        const dx=raw.x-startPoint.x,dy=raw.y-startPoint.y
        let angleDeg=angleLocked?(parseFloat(angleInput)||0):(Math.atan2(dy,dx)*180/Math.PI)
        if (!angleLocked&&angleDeg<0) angleDeg+=360
        commitRotateCopyPlacement(angleDeg)
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
        const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,false,splines,intersectionPts)
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
        else if (filletSel.length<2){
          setFilletSel(p=>[...p,hit])
          // No confirm step needed — picking 2 lines is enough (matches the
          // FilletRadiusPanel showing as soon as filletSel.length===2). Tab
          // still works too, but is now a no-op once this already ran.
          if (filletSel.length===1) setFilletAccepted(true)
        }
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
      if (e.detail > 1) return  // ignore 2nd click of a dblclick — handled by handleDoubleClick
      if (!startPoint&&!deferredTangent){
        chainOriginRef.current=null;chainStartLenRef.current=linesRef.current.length
        if (pKeyDown) {
          // PERP: start at foot on nearest line, store its index to exclude later
          const hit=findNearestLineForPerp(raw,lines,null)
          const pt=hit?hit.foot:raw
          setPerpSourceLineIdx(hit?hit.idx:null)
          setStartPoint({x:pt.x,y:pt.y})
          setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
          // Seed tracking with the point we just started from, marked sticky
          // so it survives updateTracking's decay (see the comment there) —
          // without this, alignment off the line's own start only "works"
          // once the mouse happens to wander back near some other snap
          // point, which then re-acquires it (the reported "works if I
          // detour past the edge's endpoint first, not otherwise" symptom).
          setTrackedPts([{x:pt.x,y:pt.y,sticky:true}]);trackedPtsRef.current=[{x:pt.x,y:pt.y,sticky:true}]
          return
        }
        const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,tKeyDown,splines,intersectionPts)
        let startPt
        if (geo?.type==='tan'){
          const circData=geo.circleIdx!==undefined?{...circles[geo.circleIdx],circleIdx:geo.circleIdx}:{cx:geo.cx,cy:geo.cy,r:geo.r,arcIdx:geo.arcIdx}
          startPt={x:geo.x,y:geo.y}
          setDeferredTangent(circData);setStartPoint(startPt)
        } else { startPt=geo?{x:geo.x,y:geo.y}:raw; setStartPoint(startPt) }
        chainOriginRef.current=startPt
        setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
        setTrackedPts([{...startPt,sticky:true}]);trackedPtsRef.current=[{...startPt,sticky:true}]
      } else if (deferredTangent){
        const dc=deferredTangent,geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,tKeyDown,splines,intersectionPts)
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
        const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,startPoint,tKeyDown,splines,intersectionPts)
        if (geo?.type==='tan'){
          const c=geo.circleIdx!==undefined?circles[geo.circleIdx]:{cx:geo.cx,cy:geo.cy,r:geo.r}
          const tanPts=getTanPtsOnCircle(startPoint.x,startPoint.y,c.cx,c.cy,c.r)
          const best=nearestPt(tanPts,raw)
          if(best){commit(snapshot());setLines(p=>[...p,{x1:startPoint.x,y1:startPoint.y,x2:best.x,y2:best.y,...planeTag()}])}
          resetDrawState()
        } else {
          const end=computeEnd(startPoint,raw,trackedPts)
          // Chain: click back near the chain's own first point (once it's
          // at least a triangle — 2 segments already placed) to close the
          // loop instead of continuing, same convention every other
          // polyline tool uses. Below that segment count, closing would
          // just double back on the one segment you have, which isn't a
          // real shape.
          const segsSoFar=linesRef.current.length-chainStartLenRef.current
          const nearOrigin=chainOriginRef.current&&segsSoFar>=2&&
            Math.hypot(end.x-chainOriginRef.current.x,end.y-chainOriginRef.current.y)<SNAP_DIST/zoomRef.scale
          const finalEnd=nearOrigin?chainOriginRef.current:end
          commit(snapshot())
          setLines(p=>[...p,{x1:startPoint.x,y1:startPoint.y,x2:finalEnd.x,y2:finalEnd.y,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])
          if (nearOrigin){
            resetDrawState()
          } else {
            // Keep going — next segment starts where this one ended.
            setStartPoint(finalEnd)
            setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
            setTrackedPts([{...finalEnd,sticky:true}]);trackedPtsRef.current=[{...finalEnd,sticky:true}]
          }
        }
      }
    } else if (tool==='circle'){
      if (circleTanA&&!circleTanB){
        // Picking second tangent target circle. circleIdx from getGeoSnap indexes
        // into snapCircles (circles + read-only face-reference circles appended
        // after, when sketching on a solid face) — restrict to geo.circleIdx<circles.length
        // so a face-ref circle (out of scope for this tool) is never a valid target.
        const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,tKeyDown,splines,intersectionPts)
        if (tKeyDown&&geo?.type==='tan'&&geo.circleIdx!==undefined&&geo.circleIdx<circles.length&&geo.circleIdx!==circleTanA.circleIdx){
          setCircleTanB({...circles[geo.circleIdx],circleIdx:geo.circleIdx})
          setDimInput('');setDimLocked(false)
        }
      } else if (circleTanA&&circleTanB){
        // Both targets locked — click commits using the typed radius, or the live cursor radius
        const r=tanCircleCurrentRadius(raw)
        const sol=tanCircleSolution(r,raw)
        if (sol){
          commit(snapshot())
          setCircles(p=>[...p,{cx:sol.best.x,cy:sol.best.y,r,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])
        }
        resetDrawState()
      } else if (!circleCenter){
        // Passing tKeyDown (was hardcoded false) so a T+click on a circle edge
        // can register as picking the first tangent target instead of a plain centre.
        const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,null,tKeyDown,splines,intersectionPts)
        if (tKeyDown&&geo?.type==='tan'&&geo.circleIdx!==undefined&&geo.circleIdx<circles.length){
          setCircleTanA({...circles[geo.circleIdx],circleIdx:geo.circleIdx})
          setDimInput('');setDimLocked(false)
        } else {
          setCircleCenter(geo?{x:geo.x,y:geo.y}:raw)
          setDimInput('');setDimLocked(false);setTrackedPts([]);trackedPtsRef.current=[]
        }
      } else {
        let r
        if (dimLocked){
          r=mmToPx(parseFloat(dimInput)||1)
        } else {
          const geo=getGeoSnap(raw,snapLines,snapCircles,snapArcs,circleCenter,tKeyDown,splines,intersectionPts)
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
    if (tool==='line'&&startPoint){
      e.preventDefault()
      const segsSoFar=linesRef.current.length-chainStartLenRef.current
      if (segsSoFar>0){
        // The 2nd click of this dblclick gesture already fired a normal
        // click just before this event — since the mouse hasn't moved,
        // that committed a near-zero-length segment onto the end of the
        // chain. Undo it so the chain ends at the point before it, not a
        // degenerate stub segment.
        const last=linesRef.current[linesRef.current.length-1]
        if (last&&Math.hypot(last.x2-last.x1,last.y2-last.y1)<2/zoomRef.scale) undo(snapshot(),restore)
      }
      resetDrawState()
      return
    }
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

  // Raw mousemove fires far faster than the screen can repaint (120Hz+ on a
  // lot of mice/trackpads) — processMouseMove recomputes snap points from
  // scratch every call, so running it unthrottled means most of that work
  // is thrown away before the next repaint ever happens, just competing with
  // actual rendering for the same thread. Coalescing to one call per
  // animation frame (using only the latest position) keeps every tool's
  // behavior identical while cutting that wasted work out.
  const pendingMoveRef=useRef(null)
  const moveRafRef=useRef(0)
  function handleMouseMove(e){
    pendingMoveRef.current={clientX:e.clientX,clientY:e.clientY,buttons:e.buttons}
    if (moveRafRef.current) return
    moveRafRef.current=requestAnimationFrame(()=>{
      moveRafRef.current=0
      const p=pendingMoveRef.current
      if (p) processMouseMove(p)
    })
  }
  function processMouseMove(e){
    // Middle mouse pan is now handled by OrbitControls inside Viewport3D.
    // We just need world coordinates for tool logic.
    const sx=e.clientX,sy=e.clientY

    // Fillet: raycasts solid edges directly (no sketch-plane projection involved)
    if (tool==='fillet3d') { handleFillet3DHover(e); return }
    if (tool==='measure') { handleMeasureHover(e); return }
    if (tool==='includeedge') { handleIncludeEdgeHover(e); return }
    // exportfacedxf's face hover is handled entirely inside Viewport3D via
    // sketchArmed (the same square face-plane indicator Mirror3D/Loft3D use).
    // Mirror step 1 (still picking bodies) — step 2 goes back to that same
    // sketchArmed face-hover indicator, so this only fires beforehand.
    if (tool==='mirror3d' && !mirror3dSelectionDone) { handleMirror3DHover(e); return }
    // Join — picks bodies the whole time it's active, same hover pattern.
    if (tool==='join3d') { handleJoin3DHover(e); return }
    // Move/Copy — same hover pattern, only while still picking the body
    // (once picked, mouse movement instead drives handleMoveCopy3DDragMove/
    // handleMoveCopy3DGizmoHover on the root div's own unthrottled
    // onMouseMove, for smooth live drag/hover).
    if (tool==='movecopy3d' && moveCopy3dSel==null) { handleMoveCopy3DHover(e); return }
    if (tool==='movecopy3d' && moveCopy3dSel!=null) { return }

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

    // Apply grid snap to mouse position during drawing — but geometric snap
    // (endpoint/tangent/on-circle/intersection/etc.) takes priority, same
    // reasoning as handleClick's raw computation: mousePos feeds the preview
    // code's own getGeoSnap check, so grid-snapping it first just rounds
    // tangent points out of reach before that check ever runs.
    let snappedWorld=worldPos
    if (tool==='line'||tool==='circle'||tool==='spline'||tool==='dim'||tool==='axis'){
      const excludePt=startPoint||circleCenter||null
      const geo=getGeoSnap(worldPos,snapLines,snapCircles,snapArcs,excludePt,tKeyDown,splines,intersectionPts)
      if (geo) snappedWorld={x:geo.x,y:geo.y}
      else if (gridSnap) snappedWorld=snapToGrid(worldPos)
    }
    setMousePos(snappedWorld);updateTracking(snappedWorld)
  }

  function handleKeyDown(e){
    if (showSplash) return
    if ((e.key==='t'||e.key==='T')&&!e.ctrlKey&&!e.shiftKey&&(tool==='line'||tool==='circle')){setTKeyDown(p=>!p);return}
    if ((e.key==='p'||e.key==='P')&&!e.ctrlKey&&!e.shiftKey&&tool==='line'){setPKeyDown(p=>!p);return}
    if ((e.key==='d'||e.key==='D')&&!e.ctrlKey&&!e.shiftKey){
      if (tool==='select'&&selection.length>0){
        applySelectionStyle(getSelectionStyle(selection)==='construction'?null:'construction')
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
    if (e.ctrlKey&&e.key==='z'){
      e.preventDefault()
      if (sketchMode) undo(snapshot(),restore)
      else if (!feat3dBusy) feat3d.undo(features,restore3D)
      return
    }
    if (e.ctrlKey&&e.key==='y'){
      e.preventDefault()
      if (sketchMode) redo(snapshot(),restore)
      else if (!feat3dBusy) feat3d.redo(features,restore3D)
      return
    }
    if (e.ctrlKey&&e.key==='s'){e.preventDefault();sketchMode?handleSave():handleSaveProject();return}
    if ((e.key==='f'||e.key==='F')&&!e.ctrlKey){zoomToFit();return}
    // Escape in sketch mode: cancel whatever 2D tool is mid-interaction only
    // (an in-progress line/circle/offset/etc.) — it no longer exits the sketch
    // or cancels the feature. That's now the dedicated Cancel button next to
    // Finish Sketch (see cancelFeature), so Escape is safe to hit repeatedly
    // while drawing without losing the whole Cut/Extrude/Loft in progress.
    if (e.key==='Escape'&&tool==='line'&&startPoint){
      // Cancel the WHOLE chain, not just the in-progress segment — each
      // placed segment already got its own undo-history entry (see the
      // click handler), so make canceling itself one more undoable commit
      // rather than trying to unwind several history entries at once
      // (useHistory's undo() closes over `past` from the last render —
      // calling it more than once in the same synchronous handler would
      // still see the pre-batch array, not a real multi-step undo). Must
      // run BEFORE the generic sketchMode Escape catch-all below, which
      // would otherwise reach resetDrawState() first and wipe startPoint
      // before this ever got a chance to see it.
      const segsSoFar=linesRef.current.length-chainStartLenRef.current
      if (segsSoFar>0){
        commit(snapshot())
        setLines(p=>p.slice(0,chainStartLenRef.current))
      }
      resetDrawState()
      return
    }
    if (e.key==='Escape'&&sketchMode){
      resetDrawState();resetSpline();resetOffset();resetMirror();resetCenter();resetMoveCopy()
      resetRotateCopy();resetResize();resetFillet();resetText();resetSelection()
      resetJoin();resetDim()
      return
    }
    if (e.key==='Enter'&&extrudeTool&&extrudeOffsetBase){
      // Confirm the live offset distance and commit — see the offset-plane
      // popup, the only other place Enter means anything for this step.
      e.preventDefault()
      commitExtrudeOffset()
      return
    }
    if (e.key==='Escape'&&extrudeTool&&extrudeOffsetMode){
      // Backs out one level at a time, same convention as Mirror3D's own
      // offset-plane Escape handling — must run before the catch-all
      // Escape+extrudeTool block just below, which would otherwise cancel
      // the whole tool first (same ordering pitfall the chain-line Escape
      // handler hit earlier).
      if (extrudeOffsetBase) { setExtrudeOffsetBase(null); return }
      setExtrudeOffsetMode(false); return
    }
    if (e.key==='Escape'&&extrudeTool){
      // Cancel from step 3 (depth) — restore any hidden solid
      restoreHiddenEditSolid()
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
    if (e.key==='Enter'&&tool==='mirror3d'&&!mirror3dSelectionDone&&mirror3dSel.length>0){
      // Finish picking bodies (same role as the SmartStepBar's ✓ Next button)
      // — advances to step 2 without touching the accumulated picks.
      e.preventDefault()
      setMirror3dSelectionDone(true)
      return
    }
    if (e.key==='Enter'&&tool==='mirror3d'&&mirror3dOffsetBase){
      // Confirm the live offset distance and commit — see the offset-plane
      // popup, which is the only other place Enter means anything for Mirror.
      e.preventDefault()
      commitMirror3DOffset()
      return
    }
    if (e.key==='Escape'&&tool==='mirror3d'){
      // Each Escape backs out exactly one level: offset base pick, then
      // offset mode itself, then step 2 back to step 1 (keeping picks), then
      // clears the picks, then finally leaves the tool.
      if (mirror3dOffsetBase) { setMirror3dOffsetBase(null); return }
      if (mirror3dOffsetMode) { setMirror3dOffsetMode(false); return }
      if (mirror3dSelectionDone) { setMirror3dSelectionDone(false); return }
      if (mirror3dSel.length>0) { setMirror3dSel([]); return }
      resetMirror3D(); setTool('select'); return
    }
    if (e.key==='Enter'&&tool==='movecopy3d'&&moveCopy3dDragHandle){
      // Confirm the live drag value and commit — same role as a plain
      // click anywhere once a handle is armed.
      e.preventDefault()
      commitMoveCopy3D()
      return
    }
    if (e.key==='Escape'&&tool==='movecopy3d'){
      // One consolidated block, deepest-first — the convention Mirror3D/
      // Fillet3D/Measure already use, NOT Extrude's split-across-two-blocks
      // approach (that one's own comment documents it as an actual ordering
      // bug hit twice already this session).
      if (moveCopy3dDragHandle) {
        const vp = viewport3dRef.current
        if (moveCopy3dDragHandle.kind === 'move') vp?.previewMoveSolid([0,0,0])
        else vp?.previewRotateSolid?.(0, moveCopy3dDragHandle.axis)
        setMoveCopy3dDragHandle(null)
        setMoveCopy3dDistInput('0')
        setMoveCopy3dAngleInput('0')
        moveCopy3dRotateBasisRef.current = null
        return
      }
      // Snap Move: step 2 backs out to step 1 (clear P1, keep picking on
      // the same body); step 1 exits Snap Move entirely back to the gizmo.
      if (moveCopy3dSnapStep === 2) { setMoveCopy3dSnapP1(null); setMoveCopy3dSnapHover(null); setMoveCopy3dSnapStep(1); return }
      if (moveCopy3dSnapStep === 1) { setMoveCopy3dSnapStep(0); setMoveCopy3dSnapHover(null); return }
      if (moveCopy3dSel != null) { setMoveCopy3dSel(null); return }
      resetMoveCopy3D(); setTool('select'); return
    }
    if (e.key==='Escape'&&tool==='measure'){
      // First Escape clears the current result or a pending first point;
      // a second Escape (nothing pending) leaves the tool.
      if (measureP1 || measureResult) { resetMeasure(); return }
      resetMeasure(); setTool('select'); return
    }
    if (e.key==='Enter'&&tool==='exportfacedxf'){
      e.preventDefault()
      commitExportFaceDXF()
      return
    }
    if (e.key==='Escape'&&tool==='exportfacedxf'){
      if (exportFaceDXFSel.length>0) { resetExportFaceDXFSel(); return }
      setTool('select'); return
    }
    if (e.key==='Enter'&&tool==='exportstl'){
      e.preventDefault()
      commitExportSTL()
      return
    }
    if (e.key==='Enter'&&tool==='exportstep'){
      e.preventDefault()
      commitExportSTEP()
      return
    }
    if (e.key==='Escape'&&tool==='exportstep'){
      if (exportSTEPSel.length>0) { resetExportSTEP(); return }
      resetExportSTEP(); setTool('select'); return
    }
    if (e.key==='Escape'&&tool==='exportstl'){
      if (exportSTLSel.length>0) { resetExportSTL(); return }
      resetExportSTL(); setTool('select'); return
    }
    if (e.key==='Escape'&&tool==='color'){
      if (colorSel.length>0) { resetColorTool(); return }
      resetColorTool(); setTool('select'); return
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

    if (tool==='includeedge'){if(e.key==='Escape'){resetIncludeEdge();setTool('line');return}}

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
          applySelectDims(finalPending)
          return
        }
        if (e.key==='Escape'){setSelectDimField(null);setSelectDimPending({});setSelectDimInput('');return}
      }
    }

    if (tool==='dim'){
      if (e.key==='Escape'){resetDim();return}
      return
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
        // Typing only sets the distance — placing still requires a canvas
        // click, since the click position is what picks which side to offset
        // toward (see OffsetDistPanel.jsx).
        if (e.key==='Backspace'){setOffsetDistInput(p=>p.slice(0,-1));return}
        if (/^[0-9.]$/.test(e.key)){setOffsetDistInput(p=>p+e.key);return}
        // Fallback for when the panel's own input isn't focused (its onKeyDown
        // handles this directly, see OffsetDistPanel.jsx's commitDistance) —
        // matches every sibling tool's Tab-to-accept pattern. Locks in the
        // live mouse-follow distance as a real number if nothing was typed.
        if (e.key==='Tab'){
          e.preventDefault()
          if (!offsetDistInput && mousePos){
            const entity=offsetEntity.kind==='line'?lines[offsetEntity.idx]:offsetEntity.kind==='circle'?circles[offsetEntity.idx]:offsetEntity.kind==='arc'?arcs[offsetEntity.idx]:splines[offsetEntity.idx]
            setOffsetDistInput(pxToMm(distToEntity(mousePos,entity,offsetEntity.kind)).toFixed(1))
          }
          return
        }
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
        applyFillet()
        return
      }
      if (e.key==='Backspace'){setFilletRadiusInput(p=>p.slice(0,-1));return}
      if (/^[0-9.]$/.test(e.key)){setFilletRadiusInput(p=>p+e.key);return}
      return
    }

    if (tool==='circle'&&circleTanA&&circleTanB){
      if (e.key==='Escape'){resetDrawState();return}
      if (e.key==='Enter'){
        e.preventDefault()
        const r=tanCircleCurrentRadius(mousePos)
        const sol=tanCircleSolution(r,mousePos)
        if (sol){
          commit(snapshot())
          setCircles(p=>[...p,{cx:sol.best.x,cy:sol.best.y,r,...(drawStyle?{style:drawStyle}:{}),...planeTag()}])
        }
        resetDrawState()
        return
      }
      if (e.key==='Backspace'){setDimInput(p=>p.slice(0,-1));return}
      if (/^[0-9.]$/.test(e.key)){setDimInput(p=>p+e.key);return}
      return
    }

    if (!startPoint&&!circleCenter&&!deferredTangent&&!circleTanA) return
    if (tool==='line'&&startPoint){
      if (e.key==='Enter'||e.key==='Return'){
        // Finish the chain where it stands — every segment placed so far
        // stays, just stop extending it. Nothing to commit here: each
        // segment was already committed as it was placed.
        e.preventDefault();resetDrawState();return
      }
    }
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
      if (circleTanA&&circleTanB) return { step:null, total:null, color:'#4CAF50',
        action:`${dimInput?'R ':'R ~'}${dimInput||(mousePos?pxToMm(tanCircleGuessRadius(mousePos)).toFixed(1):'—')} mm`,
        hints:[K('type + Enter','exact radius'), K('Esc')] }
      if (circleTanA) return { step:null, total:null, color:'#4CAF50',
        action:'TAN — click 2nd circle',
        hints:[K('Esc')] }
      if (circleCenter) return { step:2, total:2, color:c,
        action:`${dimLocked?'🔒 R ':'R '}${dimInput||'—'} mm`,
        hints:[K('type + Enter','exact radius'), K('T','tangent'), K('Esc')] }
      return { step:1, total:2, color:c,
        action:'Click centre point',
        hints:[K('T','tangent to 2 circles')] }
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
      const d = offsetDistInput ? parseFloat(offsetDistInput)||0
        : (mousePos ? pxToMm(distToEntity(mousePos,
            offsetEntity.kind==='line'?lines[offsetEntity.idx]:
            offsetEntity.kind==='circle'?circles[offsetEntity.idx]:
            offsetEntity.kind==='arc'?arcs[offsetEntity.idx]:splines[offsetEntity.idx],
            offsetEntity.kind)) : 0)
      return { step:'2+3', total:3, color:c,
        action:`Move to side · ${d.toFixed(1)} mm`,
        hints: [K('type','set dist'), K('click','place'), K('Esc')] }
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
    ['includeedge', IconIncludeEdge, 'Include Edge — click any edge on any solid to add it as a construction line', '#4FC3F7'],
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

  // Live length/angle for the LineSnapPanel's placeholder text while mid-draw
  let lineLiveLenMm=null, lineLiveAngleDeg=null
  if (tool==='line'&&startPoint&&mousePos&&!deferredTangent){
    const endPt=computeEnd(startPoint,mousePos,trackedPts)
    lineLiveLenMm=pxToMm(Math.hypot(endPt.x-startPoint.x,endPt.y-startPoint.y))
    lineLiveAngleDeg=computeLiveAngle(startPoint,endPt)
  }

  // Live radius for the CircleSnapPanel's placeholder text while mid-draw
  let circleLiveRadiusMm=null
  if (tool==='circle'&&mousePos){
    if (circleTanA&&circleTanB) circleLiveRadiusMm=pxToMm(tanCircleCurrentRadius(mousePos))
    else if (circleCenter) circleLiveRadiusMm=pxToMm(Math.hypot(mousePos.x-circleCenter.x,mousePos.y-circleCenter.y))
  }

  // Live angle for the Rotate/Copy panel's placeholder text while picking the angle
  let rotateCopyLiveAngleDeg=null
  if (tool==='rotatecopy'&&rotateCopyAccepted&&startPoint&&mousePos){
    const dx=mousePos.x-startPoint.x,dy=mousePos.y-startPoint.y
    let d=Math.atan2(dy,dx)*180/Math.PI
    if (d<0) d+=360
    rotateCopyLiveAngleDeg=d
  }

  // Live distance/direction for the Move/Copy panel's placeholder text while
  // dragging out the destination point.
  let moveCopyLiveDistMm=null, moveCopyLiveAngleDeg=null
  if (tool==='movecopy'&&moveCopyAccepted&&startPoint&&mousePos){
    const dx=mousePos.x-startPoint.x,dy=mousePos.y-startPoint.y
    moveCopyLiveDistMm=pxToMm(Math.hypot(dx,dy))
    let d=Math.atan2(dy,dx)*180/Math.PI
    if (d<0) d+=360
    moveCopyLiveAngleDeg=d
  }

  // Select-tool: real input-box panel, positioned near the current selection.
  // sketchToScreen already returns viewport-relative pixel coords (same space
  // as a position:'fixed' element), matching however the active sketch plane
  // is currently oriented in 3D — unlike the 2D app's flat viewTransform math,
  // this has to go through the camera projection since the sketch plane can
  // be tilted (a face plane), not just a screen-aligned work plane.
  let selectDimPanel=null
  if (tool==='select'&&selection.length>0&&sketchMode){
    const vp=viewport3dRef.current
    const curLines   = selectLiveGeom?.lines   || lines
    const curCircles = selectLiveGeom?.circles || circles
    const curArcs    = selectLiveGeom?.arcs    || arcs
    const curSplines = selectLiveGeom?.splines || splines
    const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)
    if (bbox&&vp){
      let fields=[],live={}
      if (selection.length===1){
        const e0=selection[0]
        if (e0.kind==='line'){
          const l=curLines[e0.idx]
          if (l){
            const len=pxToMm(Math.hypot(l.x2-l.x1,l.y2-l.y1))
            let ang=Math.atan2(-(l.y2-l.y1),l.x2-l.x1)*180/Math.PI;if(ang<0)ang+=360
            fields=[{key:'length',label:'Length',unit:'mm'},{key:'angle',label:'Angle',unit:'°'}]
            live={length:len,angle:ang}
          }
        } else if (e0.kind==='circle'){
          const c=curCircles[e0.idx]
          if (c){ fields=[{key:'radius',label:'Radius',unit:'mm'}]; live={radius:pxToMm(c.r)} }
        } else if (e0.kind==='arc'){
          const a=curArcs[e0.idx]
          if (a){
            const span=norm2pi(a.endAngle-a.startAngle)*180/Math.PI
            fields=[{key:'radius',label:'Radius',unit:'mm'},{key:'angle',label:'Angle',unit:'°'}]
            live={radius:pxToMm(a.r),angle:span}
          }
        }
      } else {
        fields=[{key:'width',label:'Width',unit:'mm'},{key:'height',label:'Height',unit:'mm'}]
        live={width:pxToMm(bbox.w),height:pxToMm(bbox.h)}
      }
      if (fields.length){
        const planeId = typeof activePlane==='string' ? activePlane : null
        const facePlane = (activePlane && typeof activePlane==='object') ? activePlane : null
        const screen=vp.sketchToScreen(bbox.x2,bbox.y1,planeId,facePlane)
        if (screen){
          selectDimPanel={left:screen.x+18, top:Math.max(8,screen.y-20), fields, live}
        }
      }
    }
  }

  const sketchIntentBtnStyle = (color) => ({
    background:color+'22', border:`2px solid ${color}`, borderRadius:8,
    color:'#fff', fontFamily:'monospace', fontWeight:'bold', fontSize:12,
    padding:'10px 12px', cursor:'pointer',
  })

  return (
    <div ref={rootDivRef} style={{display:'flex',height:'100%',outline:'none'}} tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={e=>{ handleExtrudeDragMove(e); handleLoftDragMove(e); handleMirror3DOffsetDragMove(e); handleExtrudeOffsetDragMove(e); handleMoveCopy3DDragMove(e); handleMoveCopy3DGizmoHover(e); handleSnapMoveHover(e) }}
      onMouseUp={e=>{ }}
    >

      {showSplash && (
        <SplashScreen onChoose={which => {
          setShowSplash(false)
          if (which === 'open') loadProjectFileRef.current?.click()
        }} />
      )}

      {cadError && (
        <div style={{position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',
          background:'#c0392b',color:'#fff',padding:'10px 20px',borderRadius:8,
          zIndex:9999,fontFamily:'monospace',fontSize:13,maxWidth:'80vw',
          boxShadow:'0 4px 12px rgba(0,0,0,0.5)'}}>
          {cadError}
        </div>
      )}

      {saveToast && (
        <div style={{position:'fixed',top:16,left:'50%',transform:'translateX(-50%)',
          background:'#2e7d32',color:'#fff',padding:'10px 20px',borderRadius:8,
          zIndex:9999,fontFamily:'monospace',fontSize:13,pointerEvents:'none',
          boxShadow:'0 4px 12px rgba(0,0,0,0.5)'}}>
          ✓ {saveToast}
        </div>
      )}

      {sketchIntentPrompt && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9998,
          display:'flex', alignItems:'center', justifyContent:'center'}}>
          <div style={{background:'#14142a', border:'3px solid #4FC3F7', borderRadius:14,
            padding:'20px 24px', width:260, textAlign:'center', fontFamily:'monospace',
            boxShadow:'0 8px 30px rgba(0,0,0,0.6)'}}>
            <div style={{fontSize:14, color:'#fff', fontWeight:'bold', marginBottom:4}}>Nice shape!</div>
            <div style={{fontSize:11, color:'#8fa0b8', marginBottom:16}}>What do you want to do with it?</div>
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              <button onClick={()=>chooseSketchIntent('extrude')} style={sketchIntentBtnStyle('#3a7bd5')}>Make it Solid</button>
              {solids.length>0 && (
                <button onClick={()=>chooseSketchIntent('cutout')} style={sketchIntentBtnStyle('#e05a4e')}>Cut Into Something</button>
              )}
              <button onClick={()=>chooseSketchIntent('flat')} style={sketchIntentBtnStyle('#607D8B')}>Keep it Flat</button>
              <button onClick={()=>chooseSketchIntent('dxf')} style={sketchIntentBtnStyle('#4CAF50')}>Export as DXF</button>
            </div>
          </div>
        </div>
      )}

      {selectDimPanel&&(
        <SelectDimPanel
          style={{position:'fixed',left:selectDimPanel.left,top:selectDimPanel.top}}
          toolColor="#64B5F6"
          fields={selectDimPanel.fields}
          liveValues={selectDimPanel.live}
          pending={selectDimPending}
          onChangeField={(key,val)=>setSelectDimPending(p=>({...p,[key]:val}))}
          onApply={()=>applySelectDims(selectDimPending)}
          styleOptions={[
            {s:null,          label:'FIRM',  color:'#aaa'},
            {s:'construction',label:'CONST', color:'#FF9800'},
          ]}
          currentStyle={getSelectionStyle(selection)}
          onSetStyle={applySelectionStyle}
        />
      )}

      {/* ══ LEFT SIDEBAR ══════════════════════════════════════════════════════ */}
      <div style={{width: sketchMode ? 72 : 112, background:'#1a1a2e',display:'flex',flexDirection:'column',
        padding:'8px 4px',gap:4,overflowY:'auto',borderRight:'1px solid #2a2a4a',
        transition:'background 0.3s, width 0.2s'}}>

        {sketchMode ? (
          /* ── SKETCH sidebar: all 2D draw tools ── */
          <>
            {toolConfig.map(([t,Icon,title,activeColor])=>(
              <div key={t} style={{position:'relative'}}>
                <button
                  ref={el => { toolBtnRefs.current[t] = el }}
                  onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetCenter();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim();resetIncludeEdge()}}
                  title={title}
                  style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                    outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
                  <Icon active={tool===t}/>
                </button>
              </div>
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
              {id:'loft3d',   label:'LOFT',    color:'#FBDA2D'},
              {id:'loftcutout', label:'LOFT CUT', color:'#53D3E4'},
              {id:'movecopy3d', label:'MOVE/COPY', color:'#FF9800'},
            ].map(({id,label,color})=>{
              const isActive = id==='fillet3d' ? tool==='fillet3d' : id==='mirror3d' ? tool==='mirror3d' : id==='join3d' ? tool==='join3d'
                : id==='loft3d' ? ((tool==='loft3d' || !!loftState) && loftTool!=='loftcutout')
                : id==='loftcutout' ? ((tool==='loft3d' || !!loftState) && loftTool==='loftcutout')
                : id==='movecopy3d' ? tool==='movecopy3d'
                : extrudeTool===id
              return (
              <button key={id}
                title={label}
                onClick={()=>{
                  if (id==='extrude'||id==='cutout') activateExtrudeTool(id)
                  else if (id==='fillet3d') activateFillet3DTool()
                  else if (id==='mirror3d') activateMirror3DTool()
                  else if (id==='join3d') activateJoin3DTool()
                  else if (id==='loft3d') activateLoft3DTool('loft')
                  else if (id==='loftcutout') activateLoft3DTool('loftcutout')
                  else if (id==='movecopy3d') activateMoveCopy3DTool()
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

            {/* EXPORT FACE DXF — click a solid face to export its exact OCC
                boundary (outer loop + every hole) as a .dxf file. */}
            <button title="Export Face as DXF" onClick={activateExportFaceDXFTool}
              style={{...btnBase, flexDirection:'column', gap:2,
                width:102, height:102,
                background: tool==='exportfacedxf' ? '#B47EFF33' : 'transparent',
                outline: tool==='exportfacedxf' ? '2px solid #B47EFF' : '1px dashed #B47EFF55',
                outlineOffset:'-2px',
              }}>
              <IconDXF/>
              <span style={{fontSize:10,fontFamily:'monospace',color:'#B47EFF',letterSpacing:'0.04em'}}>
                FACE DXF
              </span>
            </button>
          </>
        )}
      </div>

      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>

        {/* ══ TOP TOOLBAR ═══════════════════════════════════════════════════
            Outer row does NOT wrap — it has exactly two children: a wrapping
            content box (tool groups, which may spill onto a 2nd/3rd line when
            narrow) and a pinned action slot (Cancel/Finish/Guide) that's
            excluded from that wrap entirely via flexShrink:0 + alignItems
            'flex-start' on the parent. That keeps Finish always in the same
            top-right spot no matter how many rows the tool groups wrap
            into — it can no longer get pushed below the fold or covered by a
            sidebar tool's flyout panel. */}
        <div style={{background:'#1a1a2e',display:'flex',alignItems:'flex-start',
          padding:'0 8px',gap:4,flexShrink:0,
          borderBottom:`2px solid ${sketchMode ? getPlaneColor(activePlane) : '#2a2a4a'}`,
          transition:'border-color 0.3s'}}>

          <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap',
            rowGap:4,flex:1,minWidth:0}}>
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

              {/* Reframe — snaps the camera back to a straight-on view of the
                  active sketch plane, without touching zoom/pan. A recovery
                  button for accidental orbiting (e.g. a scroll-wheel-button
                  drag) while sketching, since there's no other way back to
                  flat short of leaving the sketch and re-entering it. */}
              <button
                title="Reframe — snap the camera back to a flat view of this sketch plane"
                onClick={()=>{
                  if (typeof activePlane === 'string') viewport3dRef.current?.snapToPlane(activePlane, {resetZoom:false})
                  else if (activePlane) viewport3dRef.current?.snapToFace(activePlane, {resetZoom:false})
                }}
                style={{...btnBase,background:'transparent',
                  outline:'1px solid #2a2a4a',outlineOffset:'-2px',
                  flexDirection:'column',gap:2,width:'auto',padding:'0 10px',height:70}}>
                <IconReframe/>
                <span style={{fontSize:9,fontFamily:'monospace',color:'#6688aa',
                  letterSpacing:'0.06em'}}>REFRAME</span>
              </button>

              <div style={{width:1,height:48,background:'#2a2a4a',margin:'0 4px'}}/>

              {/* Edit tools */}
              <span style={{color:'#555',fontFamily:'monospace',fontSize:9,
                textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>Edit</span>
              {editConfig.map(([t,Icon,title,activeColor])=>(
                <button key={t}
                  onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetCenter();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim();resetIncludeEdge()}}
                  title={title}
                  style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                    outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
                  <Icon active={tool===t}/>
                </button>
              ))}

              <div style={{width:1,height:48,background:'#2a2a4a',margin:'0 4px'}}/>

              {/* Modify tools */}
              <span style={{color:'#555',fontFamily:'monospace',fontSize:9,
                textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>Modify</span>
              {modifyConfig.map(([t,Icon,title,activeColor])=>(
                <div key={t} style={{position:'relative'}}>
                  <button
                    onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetCenter();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim();resetIncludeEdge()}}
                    title={title}
                    style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                      outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
                    <Icon active={tool===t}/>
                  </button>
                  {t==='movecopy'&&tool==='movecopy'&&(
                    <CopyModePanel
                      toolColor={activeColor}
                      primaryKey="M" primaryLabel="Move" primaryMode="move"
                      mode={moveCopyMode} count={moveCopyCountInput}
                      onSetMode={setMoveCopyMode}
                      onSetCount={n=>setMoveCopyCountInput(String(Math.max(1,Math.min(100,n))))}
                      locked={!!startPoint}
                      selCount={moveCopySel.length} accepted={moveCopyAccepted}
                      onAccept={()=>setMoveCopyAccepted(true)}
                      dimInput={dimInput} dimLocked={dimLocked}
                      onChangeDim={val=>{setDimLocked(false);setDimInput(val)}}
                      angleInput={angleInput} angleLocked={angleLocked}
                      onChangeAngle={val=>{setAngleLocked(false);setAngleInput(val)}}
                      onApplyLock={applyDimAngleLock}
                      liveDistMm={moveCopyLiveDistMm}
                      liveAngleDeg={moveCopyLiveAngleDeg}
                    />
                  )}
                  {t==='rotatecopy'&&tool==='rotatecopy'&&(
                    <CopyModePanel
                      toolColor={activeColor}
                      primaryKey="R" primaryLabel="Rotate" primaryMode="rotate"
                      mode={rotateCopyMode} count={rotateCopyCountInput}
                      onSetMode={setRotateCopyMode}
                      onSetCount={n=>setRotateCopyCountInput(String(Math.max(1,Math.min(100,n))))}
                      locked={!!startPoint}
                      selCount={rotateCopySel.length} accepted={rotateCopyAccepted}
                      onAccept={()=>setRotateCopyAccepted(true)}
                      angleInput={angleInput} angleLocked={angleLocked}
                      onChangeAngle={val=>{setAngleLocked(false);setAngleInput(val)}}
                      onApplyLock={()=>{ if(angleInput) setAngleLocked(true) }}
                      liveAngleDeg={rotateCopyLiveAngleDeg}
                    />
                  )}
                  {t==='resize'&&tool==='resize'&&(
                    <ResizeScalePanel
                      toolColor={activeColor}
                      selCount={resizeSel.length} accepted={resizeAccepted}
                      onAccept={()=>setResizeAccepted(true)}
                      scaleInput={resizeScaleInput}
                      onChangeScale={setResizeScaleInput}
                    />
                  )}
                  {t==='mirror'&&tool==='mirror'&&(
                    <MirrorPanel
                      toolColor={activeColor}
                      selCount={mirrorSel.length} accepted={mirrorAccepted}
                      onAccept={()=>setMirrorAccepted(true)}
                      hasAxisStart={!!mirrorP1}
                    />
                  )}
                  {t==='center'&&tool==='center'&&(
                    <CenterPanel
                      toolColor={activeColor}
                      selCount={centerSel.length}
                      onApply={commitCenter}
                    />
                  )}
                </div>
              ))}

            </>
          ) : (
            /* ── 3D top toolbar ── */
            <>
              {/* View presets */}
              <span style={{color:'#555',fontFamily:'monospace',fontSize:9,
                textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>View</span>
              {[
                {id:'top',   label:'TOP',  title:'Top view (XY)',  fn:()=>viewport3dRef.current?.snapToPlane('XY', {resetZoom:false})},
                {id:'front', label:'FRONT',title:'Front view (XZ)', fn:()=>viewport3dRef.current?.snapToPlane('XZ', {resetZoom:false})},
                {id:'side',  label:'SIDE', title:'Side view (YZ)',  fn:()=>viewport3dRef.current?.snapToPlane('YZ', {resetZoom:false})},
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
            </>
          )}
          </div>

          {/* Pinned action slot — flexShrink:0, outside the wrapping content
              box above and outside the outer row's wrap entirely, so Cancel/
              Finish/Guide always stay in the same top-right spot no matter
              how many rows the tool groups wrap into. */}
          <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0,height:70}}>
            {/* CANCEL FEATURE — only for Cut/Extrude/Loft, which have a whole
                in-progress feature to abandon (a plain standalone sketch
                doesn't). Placed left of Finish so the two can't be confused. */}
            {sketchMode && (extrudeTool || loftState) && (
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

            {/* FINISH SKETCH */}
            {sketchMode && (
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
            )}

            {/* Guide — sketch profile environment only, not the 3D environment */}
            {sketchMode && (
              <button
                onClick={()=>setGuideOpen(p=>!p)}
                title="Toggle Guide Panel"
                style={{...btnBase,
                  background:guideOpen?'#f7fb0422':'transparent',
                  outline:guideOpen?'2px solid #f7fb04':'none',
                  outlineOffset:'-2px'}}>
                <IconGuide active={guideOpen}/>
              </button>
            )}
          </div>
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
            sketchArmed={((!!extrudeTool && !extrudeState) && !sketchMode) || (tool==='mirror3d' && mirror3dSelectionDone) || (tool==='loft3d' && !loftState) || tool==='exportfacedxf'}
            mirrorPlanePickArmed={tool==='mirror3d' && mirror3dSelectionDone && !mirror3dOffsetBase}
            dxfPickMode={tool==='exportfacedxf'}
            dxfSelectedFaces={tool==='exportfacedxf' ? exportFaceDXFSel : []}
            extrudeArmed={!!extrudeState || (!!loftState && !sketchMode)}
            showWorkPlanes={!sketchMode && tool!=='fillet3d' && tool!=='measure' && tool!=='exportfacedxf' && tool!=='exportstl' && tool!=='exportstep' && tool!=='color' && tool!=='join3d' && tool!=='movecopy3d' && !(tool==='mirror3d' && !mirror3dSelectionDone) && !(hidePlanesForExtrude && (tool==='extrude' || tool==='cutout'))}
            activePlane={activePlane}
            sketchMode={sketchMode}
            gridVisible={gridVisible}
            gridSizeMm={gridSizeMm}
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
            offsetEntity, offsetDistInput, offsetPreview,
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
            hint={(!extrudeState && !sketchMode)
              ? (extrudeOffsetBase
                  ? 'Move the mouse or type a distance, Enter to confirm'
                  : extrudeOffsetMode
                    ? 'Click a plane or face to offset from'
                    : null)
              : null}
            action={
              (!extrudeState && !sketchMode)
                ? [
                    { label: hidePlanesForExtrude ? '◻ Show Planes' : '◻ Hide Planes', enabled:true,
                      onClick: () => setHidePlanesForExtrude(p => !p) },
                    extrudeOffsetBase
                      ? { label:'✓ Use Plane', enabled:true, onClick:commitExtrudeOffset,
                          popover: <OffsetDistancePopover color={extrudeTool === 'cutout' ? '#e05a4e' : '#3a7bd5'}
                            value={extrudeOffsetDistInput} onChange={setExtrudeOffsetDistInput}/> }
                      : { label: extrudeOffsetMode ? '✕ Cancel Offset' : '+ Offset Plane', enabled:true,
                          onClick:()=>{
                            if (extrudeOffsetMode) { setExtrudeOffsetMode(false); setExtrudeOffsetBase(null) }
                            else setExtrudeOffsetMode(true)
                          }},
                  ]
                : null
            }
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

          {/* ── SmartStep bar: overlays bottom of viewport during Export STL/STEP —
              shared between the two exactly like Loft/Loft Cutout share one bar,
              since the selection/hint/action shape is identical either way. ── */}
          <SmartStepBar
            op={tool==='exportstl' ? 'STL' : tool==='exportstep' ? 'STEP' : null}
            steps={[{ id:1, label:'Select Bodies' }]}
            currentStep={1}
            color={tool==='exportstep' ? '#4FC3F7' : '#4CAF50'}
            hint={(tool==='exportstep' ? exportSTEPSel : exportSTLSel).length>0
              ? `${(tool==='exportstep' ? exportSTEPSel : exportSTLSel).length} selected`
              : 'Click bodies to choose (none = export all)'}
            action={{label:'✓ Export', enabled:true, onClick: tool==='exportstep' ? commitExportSTEP : commitExportSTL}}
            onStepBack={()=>{}}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Export Face DXF ── */}
          <SmartStepBar
            op={tool==='exportfacedxf' ? 'DXF' : null}
            steps={[{ id:1, label:'Select Faces' }]}
            currentStep={1}
            color="#B47EFF"
            hint={exportFaceDXFSel.length>0
              ? `${exportFaceDXFSel.length} selected — click more, or Export`
              : 'Click a face to select it (click again to remove)'}
            action={{label:'✓ Export', enabled: exportFaceDXFSel.length>0, onClick:commitExportFaceDXF}}
            onStepBack={()=>{}}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Mirror3D ── */}
          <SmartStepBar
            op={tool==='mirror3d' ? 'MIRROR' : null}
            steps={[{ id:1, label:'Select Bodies' }, { id:2, label:'Pick Plane' }]}
            currentStep={mirror3dSelectionDone ? 2 : 1}
            color="#8E65F3"
            hint={!mirror3dSelectionDone
              ? (mirror3dSel.length>0 ? `${mirror3dSel.length} selected — Enter to continue` : 'Click bodies to mirror (click again to remove)')
              : mirror3dOffsetBase
                ? 'Move the mouse or type a distance, Enter to confirm'
                : mirror3dOffsetMode
                  ? 'Click a plane or face to offset from'
                  : 'Click a plane or face to mirror across — or create an offset plane'}
            action={!mirror3dSelectionDone
              ? {label:'✓ Next', enabled:mirror3dSel.length>0, onClick:()=>setMirror3dSelectionDone(true)}
              : mirror3dOffsetBase
                ? {label:'✓ Use Plane', enabled:true, onClick:commitMirror3DOffset,
                    popover: <OffsetDistancePopover color="#8E65F3" value={mirror3dOffsetDistInput} onChange={setMirror3dOffsetDistInput}/>}
                : {label: mirror3dOffsetMode ? '✕ Cancel Offset' : '+ Offset Plane', enabled:true,
                    onClick:()=>{
                      if (mirror3dOffsetMode) { setMirror3dOffsetMode(false); setMirror3dOffsetBase(null) }
                      else setMirror3dOffsetMode(true)
                    }}}
            onStepBack={step => {
              // Back to step 1 keeps the accumulated body picks — only the
              // "done" flag (and any in-progress offset pick) resets.
              if (step === 1) { setMirror3dSelectionDone(false); setMirror3dOffsetMode(false); setMirror3dOffsetBase(null) }
            }}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Join3D ── */}
          <SmartStepBar
            op={tool==='join3d' ? 'JOIN' : null}
            steps={[{ id:1, label:'Select Bodies' }]}
            currentStep={1}
            color="#FFEE88"
            hint={joinSel.length>0
              ? `${joinSel.length} selected — Enter to join`
              : 'Click bodies to join (click again to remove)'}
            action={{label:'✓ Join', enabled:joinSel.length>=2, onClick:commitJoin}}
            onStepBack={()=>{}}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Move/Copy ── */}
          <SmartStepBar
            op={tool==='movecopy3d' ? 'MOVE/COPY' : null}
            steps={[{ id:1, label:'Select Body' }, { id:2, label:
              moveCopy3dSnapStep>0 ? 'Snap Move' : moveCopy3dDragHandle?.kind==='rotate' ? 'Rotate' : 'Move' }]}
            currentStep={moveCopy3dSel!=null ? 2 : 1}
            color="#FF9800"
            hint={moveCopy3dSel==null
              ? 'Click a body to move or copy'
              : moveCopy3dSnapStep===1 ? 'Click a point on the body to move'
              : moveCopy3dSnapStep===2 ? 'Click a point on the target'
              : moveCopy3dDragHandle
                ? `Move the mouse or type ${moveCopy3dDragHandle.kind==='rotate' ? 'an angle' : 'a distance'}, click or Enter to confirm`
                : 'Click an axis arrow/ring on the gizmo, or Snap Move'}
            action={moveCopy3dSel==null ? null : [
              // Two separate always-clickable buttons, only one highlighted
              // at a time — a single toggle button that renamed itself
              // between "Move"/"Copy" read as ambiguous (does the label
              // name the current mode, or what clicking switches to?).
              { label:'Move', enabled:true, active: moveCopy3dMode!=='copy', onClick: () => setMoveCopy3dMode('move') },
              { label:'Copy', enabled:true, active: moveCopy3dMode==='copy', onClick: () => setMoveCopy3dMode('copy') },
              // Snap Move toggle — hidden mid-drag (a gizmo handle already
              // armed), since the two interactions are mutually exclusive.
              ...(moveCopy3dDragHandle ? [] : [{
                label:'⌖ Snap Move', enabled:true, active: moveCopy3dSnapStep>0,
                onClick: () => {
                  if (moveCopy3dSnapStep>0) { setMoveCopy3dSnapStep(0); setMoveCopy3dSnapP1(null); setMoveCopy3dSnapHover(null) }
                  else setMoveCopy3dSnapStep(1)
                },
              }]),
              ...(moveCopy3dDragHandle ? [{
                label:'✓ Confirm', enabled:true, onClick:commitMoveCopy3D,
                popover: moveCopy3dDragHandle.kind==='rotate'
                  ? <OffsetDistancePopover color="#FF9800" label={moveCopy3dMode==='copy' ? 'COPY' : 'ROTATE'}
                      unit="°" value={moveCopy3dAngleInput} onChange={setMoveCopy3dAngleInput}/>
                  : <OffsetDistancePopover color="#FF9800" label={moveCopy3dMode==='copy' ? 'COPY' : 'MOVE'}
                      unit="mm" value={moveCopy3dDistInput} onChange={setMoveCopy3dDistInput}/>,
              }] : []),
            ]}
            onStepBack={step => { if (step === 1) resetMoveCopy3D() }}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Loft ── */}
          <SmartStepBar
            op={(tool==='loft3d' || loftState) ? (loftTool==='loftcutout' ? 'LOFT CUTOUT' : 'LOFT') : null}
            steps={[{ id:1, label:'Pick Start Plane' }, { id:2, label:'Sketch Profiles' }]}
            currentStep={loftState ? 2 : 1}
            color={loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D'}
            hint={loftState
              ? `Profile ${loftState.currentIdx+1} of ${Math.max(loftState.profiles.length, loftState.currentIdx+1)}${sketchMode ? ' · sketching' : ''}`
              : 'Click a work plane or face'}
            onStepBack={step => {
              if (step === 1) resetLoft3D()
            }}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Fillet3D ── */}
          <SmartStepBar
            op={tool==='fillet3d' ? 'FILLET' : null}
            steps={[{ id:1, label:'Select Edges' }, { id:2, label:'Set Radius' }]}
            currentStep={fillet3dAccepted ? 2 : 1}
            color="#9c6ade"
            hint={
              fillet3dAccepted
                ? `Radius for ${fillet3dSel.length} edge${fillet3dSel.length!==1?'s':''} — Enter to apply`
                : fillet3dSel.length>0
                  ? `${fillet3dSel.length} edge${fillet3dSel.length!==1?'s':''} selected — Enter to lock`
                  : 'Click an edge to select it'
            }
            action={
              !fillet3dAccepted && fillet3dSel.length>0
                ? {label:'✓ Lock Edges', enabled:true, onClick:()=>setFillet3dAccepted(true)}
                : fillet3dAccepted
                  ? {label:'✓ Apply', enabled:true, onClick:commitFillet3D}
                  : null
            }
            onStepBack={step => { if (step===1) resetFillet3D() }}
          />

          {/* ── SmartStep bar: overlays bottom of viewport during Measure ── */}
          <SmartStepBar
            op={tool==='measure' ? 'MEASURE' : null}
            steps={[{ id:1, label:'Click Geometry' }, { id:2, label:'Click Second Point' }]}
            currentStep={measureP1 ? 2 : 1}
            color="#4FC3F7"
            hint={
              measureP1
                ? 'Click a second point for distance'
                : measureResult
                  ? (measureResult.kind==='distance' ? `Distance: ${measureResult.distance.toFixed(2)} mm`
                    : measureResult.kind==='straight'  ? `Length: ${measureResult.length.toFixed(2)} mm`
                    : measureResult.kind==='circular'  ? `⌀ ${measureResult.diameter.toFixed(2)} mm`
                    : `Length: ${measureResult.length.toFixed(2)} mm (curve)`) + ' — click new geometry to remeasure'
                  : 'Click an edge to measure it, or a point to start a distance'
            }
            onStepBack={step => { if (step===1) resetMeasure() }}
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
              <button onClick={handleSave} title="Save (Ctrl+S)" style={{...btnBase,background:'transparent',border:'none'}}>
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
          {/* 3D feature-tree Undo/Redo — separate history from the 2D sketch
              buffer above (see feat3d), so a different button pair rather
              than reusing canUndo/canRedo. Disabled while feat3dBusy: the
              restore is an async full-tree rebuild through the OCC worker,
              not an instant array assignment, so a rapid second click could
              otherwise fire against a stale features closure mid-rebuild. */}
          {!sketchMode && (
            <>
              <button onClick={()=>feat3d.undo(features,restore3D)} title="Undo (Ctrl+Z)" disabled={!feat3d.canUndo||feat3dBusy}
                style={{...btnBase,opacity:(feat3d.canUndo&&!feat3dBusy)?1:0.3,background:'transparent',border:'none',cursor:(feat3d.canUndo&&!feat3dBusy)?'pointer':'default'}}>
                <IconUndo active={feat3d.canUndo&&!feat3dBusy}/>
              </button>
              <button onClick={()=>feat3d.redo(features,restore3D)} title="Redo (Ctrl+Y)" disabled={!feat3d.canRedo||feat3dBusy}
                style={{...btnBase,opacity:(feat3d.canRedo&&!feat3dBusy)?1:0.3,background:'transparent',border:'none',cursor:(feat3d.canRedo&&!feat3dBusy)?'pointer':'default'}}>
                <IconRedo active={feat3d.canRedo&&!feat3dBusy}/>
              </button>
              <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
            </>
          )}
          {/* Body/project-level actions (STL/Color/New/Save/Open) — hidden
              while sketching: none of them commit the live sketch buffer
              first, so clicking any of these mid-sketch silently discarded
              whatever profile was in progress (STL/Color cleanly exit sketch
              mode but never save it; Project Save persists only the
              committed feature tree, not the buffer, so it looked like it
              saved current work but didn't). Gating behind !sketchMode
              matches the sketch-only Undo/Redo/Save/Load/PDF/DXF block
              above, just inverted — this row is now purely sketch tools
              while sketching, model/project tools otherwise. */}
          {!sketchMode && (
            <>
              <button onClick={activateExportSTLTool}
                title="Export STL — click bodies in the 3D view to choose which ones to export (none selected = export all)"
                style={{...btnBase, flexDirection:'column', gap:2, background: tool==='exportstl' ? '#4CAF5033' : 'transparent',
                  border: tool==='exportstl' ? '1px solid #4CAF50' : 'none'}}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M11 2l8 4.5v9L11 20l-8-4.5v-9L11 2z" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M3 6.5L11 11l8-4.5M11 11v9" stroke="#aaa" strokeWidth="1.2"/>
                  <text x="4.5" y="19.5" fontSize="5" fill="#4CAF50" fontFamily="monospace" fontWeight="bold">STL</text>
                </svg>
                <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em',color:'#888'}}>STL</span>
              </button>
              <button onClick={activateExportSTEPTool}
                title="Export STEP — click bodies in the 3D view to choose which ones to export (none selected = export all)"
                style={{...btnBase, flexDirection:'column', gap:2, background: tool==='exportstep' ? '#4FC3F733' : 'transparent',
                  border: tool==='exportstep' ? '1px solid #4FC3F7' : 'none'}}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M11 2l8 4.5v9L11 20l-8-4.5v-9L11 2z" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M3 6.5L11 11l8-4.5M11 11v9" stroke="#aaa" strokeWidth="1.2"/>
                  <text x="2.5" y="19.5" fontSize="5" fill="#4FC3F7" fontFamily="monospace" fontWeight="bold">STEP</text>
                </svg>
                <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em',color:'#888'}}>STEP</span>
              </button>
              <button onClick={activateColorTool}
                title="Body Color — click bodies in the 3D view, then pick a color to apply"
                style={{...btnBase, flexDirection:'column', gap:2, background: tool==='color' ? '#FF704333' : 'transparent',
                  border: tool==='color' ? '1px solid #FF7043' : 'none'}}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M11 2C8 6.5 6 9.5 6 12.5C6 15.5 8.2 17.5 11 17.5C13.8 17.5 16 15.5 16 12.5C16 9.5 14 6.5 11 2Z"
                    fill="#FF7043" stroke="#FF7043" strokeWidth="1"/>
                  <circle cx="9" cy="11.5" r="1.1" fill="#fff" fillOpacity="0.6"/>
                </svg>
                <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em',color:'#888'}}>COLOR</span>
              </button>
              <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
              <button onClick={handleNewProject} title="New Project" style={{...btnBase,flexDirection:'column',gap:2,background:'transparent',border:'none'}}>
                <IconNew/>
                <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em',color:'#888'}}>NEW</span>
              </button>
              <button onClick={handleSaveProject} title="Save Project (Ctrl+S)" style={{...btnBase,flexDirection:'column',gap:2,background:'transparent',border:'none'}}>
                <IconSave/>
                <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em',color:'#888'}}>SAVE</span>
              </button>
              <button onClick={()=>loadProjectFileRef.current.click()} title="Open Project" style={{...btnBase,flexDirection:'column',gap:2,background:'transparent',border:'none'}}>
                <IconLoad/>
                <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em',color:'#888'}}>OPEN</span>
              </button>
              <button onClick={()=>importStepFileRef.current.click()}
                title="Import STEP — adds the file as a new solid body, reposition it with Move/Copy afterward"
                style={{...btnBase,flexDirection:'column',gap:2,background:'transparent',border:'none'}}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M11 2l8 4.5v9L11 20l-8-4.5v-9L11 2z" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M11 6v7M8 10l3 3 3-3" stroke="#66BB6A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em',color:'#888'}}>IMPORT</span>
              </button>
              <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
            </>
          )}
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
                    onChange={e=>setExtrudeState(prev=>({...prev,depthInput:e.target.value,depthLocked:true}))}
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
                        onClick={()=>setExtrudeState(prev=>{
                          // Also write the ref synchronously — extrudeStateRef only
                          // updates via a useEffect (see its declaration), which runs
                          // AFTER this click's render commits. commitExtrude() prefers
                          // the ref, so confirming (Enter/Finish) fast enough right
                          // after this click could otherwise read the PRE-click
                          // direction and silently commit the wrong one (e.g.
                          // "Symmetric" selected but a one-sided extrude gets built).
                          const next = {...prev, direction:dir}
                          extrudeStateRef.current = next
                          return next
                        })}
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
          left: extrudeHandlePos.x,
          top: extrudeHandlePos.top,
          transform: 'translateX(-50%)',
          zIndex: 1000,
        }}>
        <div ref={extrudePanelDrag.panelRef} style={{
          background: '#000',
          border: `1.5px solid ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'}`,
          borderRadius: 2,
          padding: '10px 14px',
          minWidth: 180,
          boxShadow: `0 0 14px ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'}77, 0 0 3px ${extrudeTool==='cutout' ? '#FF3B5C' : '#3ad6ff'} inset`,
          fontFamily: 'monospace',
          ...extrudePanelDrag.panelStyle,
        }}>
          <DragHandle {...extrudePanelDrag.handleProps}>{extrudeTool==='cutout' ? 'Cutout' : 'Extrude'}</DragHandle>
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
                      onClick={()=>setExtrudeState(prev=>{
                        const next = {...prev, direction: k==='both' ? 'both' : 'front'}
                        extrudeStateRef.current = next
                        return next
                      })}
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
                    onChange={e=>setExtrudeState(prev=>({...prev,depthInput:e.target.value,depthLocked:true}))}
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
        </div>
      )}

      {/* ── Cutout popup (extent mode + direction + optional depth) ──────── */}
      {extrudeState?.armed && extrudeHandlePos && extrudeTool === 'cutout' && !extrudeState.revolveAxis && (
        <div style={{
          position: 'fixed',
          left: extrudeHandlePos.x,
          top: extrudeHandlePos.top,
          transform: 'translateX(-50%)',
          zIndex: 1000,
        }}>
        <div ref={cutoutPanelDrag.panelRef} style={{
          background: '#000',
          border: '1.5px solid #FF3B5C',
          borderRadius: 2,
          padding: '10px 14px',
          boxShadow: '0 0 14px #FF3B5C77, 0 0 3px #FF3B5C inset',
          fontFamily: 'monospace',
          ...cutoutPanelDrag.panelStyle,
        }}>
          <DragHandle {...cutoutPanelDrag.handleProps}>Cutout</DragHandle>
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
                    onClick={()=>setExtrudeState(prev=>{
                      // Same ref-lag hazard as the direction toggle above —
                      // extrudeStateRef only catches up via a useEffect, and
                      // commitExtrude() prefers the ref, so a fast confirm right
                      // after this click could read the extentMode from before it.
                      const next = {...prev, extentMode:k}
                      extrudeStateRef.current = next
                      return next
                    })}
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
                      onClick={()=>setExtrudeState(prev=>{
                        const next = {...prev, direction: k==='both' ? 'both' : 'front'}
                        extrudeStateRef.current = next
                        return next
                      })}
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
                    onChange={e=> extrudeState.extentMode!=='through' && setExtrudeState(prev=>({...prev,depthInput:e.target.value,depthLocked:true}))}
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
        </div>
      )}

      {/* ── Loft: unified between-profiles panel ─────────────────────────────
          Shown whenever a loft is mid-flight and not actively sketching —
          replaces what used to be TWO separate surfaces (a persistent top
          banner with Ruled/Prev/Finish, plus this popup showing only the
          distance-to-next input) that duplicated each other's "which profile
          am I on" display and were visible at the same time. The SmartStepBar
          already covers that display (see its Loft hint below), so this
          panel is purely controls: Ruled, Prev, Finish, and — swapping
          depending on whether the next profile already exists — either the
          distance-to-position input (isLoftDragArmed, same drag/click-
          anywhere/Enter-to-accept mechanics as before, all unchanged) or a
          plain Next button. That Next button is new: previously, stepping
          Prev back to review an already-fully-sketched profile left no way
          to move forward again — loftNextProfile() already handled that
          case correctly (reuses the existing profile's stored offset), it
          just had no button to reach it. */}
      {loftState && !sketchMode && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000,
        }}>
        <div ref={loftPanelDrag.panelRef} style={{
          background: '#000',
          border: `1.5px solid ${loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D'}`,
          borderRadius: 2,
          padding: '10px 14px',
          minWidth: 220,
          boxShadow: `0 0 14px ${loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D'}77, 0 0 3px ${loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D'} inset`,
          fontFamily: 'monospace',
          ...loftPanelDrag.panelStyle,
        }}>
          <DragHandle {...loftPanelDrag.handleProps}>
            {loftTool==='loftcutout' ? 'Loft Cutout' : 'Loft'} · Profile {loftState.currentIdx+1}
          </DragHandle>

          <label
            title="Off: smooth blended surface between profiles. On: straight faceted panels instead."
            style={{display:'flex', gap:6, alignItems:'center', cursor:'pointer', color:'#6688aa', fontSize:11, marginBottom:8}}
          >
            <input
              type="checkbox"
              checked={!!loftState.ruled}
              onChange={e=>setLoftState(prev=>({...prev, ruled:e.target.checked}))}
              style={{accentColor: loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D', cursor:'pointer'}}
            />
            Ruled
          </label>

          <div style={{display:'flex', alignItems:'center', gap:6}}>
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

            {isLoftDragArmed() ? (
              <>
                <div style={{
                  flex:1, background:'#000', border:`1px solid ${loftTool==='loftcutout' ? '#53D3E455' : '#FBDA2D55'}`,
                  borderRadius:2, padding:'4px 8px',
                  display:'flex', alignItems:'center', justifyContent:'space-between',
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
                      color: loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D',
                      textShadow: `0 0 5px ${loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D'}`,
                      fontFamily:'monospace', fontSize:16, fontWeight:'bold', width:70,
                    }}
                  />
                  <span style={{color:'#556', fontSize:12}}>mm</span>
                </div>
                <button
                  onClick={loftNextProfile}
                  title="Accept distance, sketch next profile"
                  style={{
                    padding:'4px 10px', background: loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D', color:'#000',
                    border:'none', borderRadius:2, cursor:'pointer',
                    fontFamily:'monospace', fontSize:12, fontWeight:'bold',
                    boxShadow: `0 0 6px ${loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D'}`,
                  }}
                >↵</button>
              </>
            ) : (
              <button
                onClick={loftNextProfile}
                disabled={!loftState.profiles[loftState.currentIdx]}
                title="Next profile"
                style={{
                  flex:1, padding:'4px 10px', fontSize:12, fontFamily:'monospace', fontWeight:'bold',
                  background: loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D', color:'#000',
                  border:'none', borderRadius:2, cursor:'pointer',
                  boxShadow: `0 0 6px ${loftTool==='loftcutout' ? '#53D3E4' : '#FBDA2D'}`,
                }}
              >Next ▶</button>
            )}

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

          <div style={{color:'#556', fontSize:10, marginTop:6, textAlign:'center', letterSpacing:'0.04em'}}>
            {isLoftDragArmed()
              ? `Drag or type distance to next${gridSnap ? ` (snap ${gridSizeMm}mm)` : ''} · Esc to cancel`
              : (loftState.profiles.filter(Boolean).length < 2 ? 'Need 2+ profiles to finish' : 'Esc to cancel')}
          </div>
        </div>
        </div>
      )}

      {/* ── Body Color: pick a swatch to apply to every currently-selected
          body — same floating draggable-panel convention as the Loft popup
          above. Swatches apply immediately on click (no separate "Apply"
          step) since there's nothing to preview/adjust first, unlike a
          typed distance value. ── */}
      {tool==='color' && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000,
        }}>
        <div ref={colorPanelDrag.panelRef} style={{
          background: '#000',
          border: '1.5px solid #FF7043',
          borderRadius: 2,
          padding: '10px 14px',
          minWidth: 220,
          boxShadow: '0 0 14px #FF704377, 0 0 3px #FF7043 inset',
          fontFamily: 'monospace',
          ...colorPanelDrag.panelStyle,
        }}>
          <DragHandle {...colorPanelDrag.handleProps}>Body Color</DragHandle>
          <div style={{display:'flex', flexWrap:'wrap', gap:6, justifyContent:'center', opacity: colorSel.length>0 ? 1 : 0.4}}>
            {['#3a7bd5','#e05a4e','#4caf50','#fbda2d','#9c6ade','#ff7043','#53d3e4','#888888','#e8e8e8','#2a2a2a'].map(hex => (
              <button key={hex}
                onClick={()=>applyColorToSelection(hex)}
                disabled={colorSel.length===0}
                title={hex}
                style={{
                  width:24, height:24, borderRadius:4, background:hex,
                  border: '1px solid #444', cursor: colorSel.length>0 ? 'pointer' : 'default',
                }}
              />
            ))}
            <input
              type="color"
              value={colorApplyColor}
              onChange={e=>{ setColorApplyColor(e.target.value); applyColorToSelection(e.target.value) }}
              disabled={colorSel.length===0}
              title="Custom color"
              style={{
                width:24, height:24, padding:0, border:'1px solid #444', borderRadius:4,
                background:'none', cursor: colorSel.length>0 ? 'pointer' : 'default',
              }}
            />
          </div>
          <div style={{color:'#997', fontSize:10, marginTop:8, textAlign:'center', letterSpacing:'0.04em'}}>
            {colorSel.length>0
              ? `${colorSel.length} bod${colorSel.length===1?'y':'ies'} selected · click a swatch to apply`
              : 'Click bodies in the 3D view to select'} · Esc to cancel
          </div>
        </div>
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
          display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap',
        }}>
          <span>{fillet3dSel.length} edge{fillet3dSel.length!==1?'s':''} selected</span>
          <button
            onClick={()=>setFillet3dAccepted(true)}
            style={{
              padding:'3px 10px', background:'#9c6ade', color:'#fff',
              border:'none', borderRadius:4, cursor:'pointer',
              fontFamily:'monospace', fontSize:11, fontWeight:'bold',
            }}
          >✓ Lock Edges</button>
          <span style={{color:'#6688aa'}}>Esc to clear</span>
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
        onEditLoft={handleEditLoft}
        hiddenSolidIds={hiddenSolidIds}
        onToggleBodyVisible={handleToggleBodyVisible}
        onConvertSketch={convertSketchFeature}
        hasSolids={solids.length > 0}
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
            // Imported coordinates are meant to land in THIS sketch's local
            // frame — stamp the active plane/facePlane onto every entity
            // (planeTag(), same tagging every draw tool uses) rather than
            // keeping whatever plane info (or lack of it) the source file
            // had. Without this, importing into a face sketch left entities
            // with no facePlane, so pt2three() fell through to rendering
            // them on the flat world plane instead of the actual face —
            // right where the selection overlay still showed them, but
            // nowhere near where the Three.js geometry actually drew.
            const pt = planeTag()
            setLines(data.lines.map(l=>({...l,...pt})))
            setCircles(data.circles.map(c=>({...c,...pt})))
            setArcs(data.arcs.map(a=>({...a,...pt})))
            setSplines((data.splines||[]).map(s=>({...s,...pt})))
            resetDrawState()
          } catch(err) {setLoadError(err.message);setTimeout(()=>setLoadError(null),3000)}
        }}
      />
      {/* Hidden file input — whole-project open (.trc), falls back to
          importing pre-.trc save files as a bare sketch — see handleOpenProject. */}
      <input ref={loadProjectFileRef} type="file" accept=".trc,.json" style={{display:'none'}}
        onChange={async e=>{
          const file=e.target.files[0];e.target.value=''
          if (!file) return
          await handleOpenProject(file)
        }}
      />
      <input ref={importStepFileRef} type="file" accept=".step,.stp" style={{display:'none'}}
        onChange={async e=>{
          const file=e.target.files[0];e.target.value=''
          if (!file) return
          await handleImportStepFile(file)
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

      {flyoutAnchor && (
        <div style={{position:'fixed', top:flyoutAnchor.top, left:flyoutAnchor.right, zIndex:60}}>
          {tool==='line' && (
            <LineSnapPanel
              toolColor={toolConfig.find(([t])=>t==='line')[3]}
              tKeyDown={tKeyDown} pKeyDown={pKeyDown}
              onToggleT={()=>setTKeyDown(p=>!p)}
              onToggleP={()=>setPKeyDown(p=>!p)}
              drawing={!!startPoint&&!deferredTangent}
              dimInput={dimInput} angleInput={angleInput}
              dimLocked={dimLocked} angleLocked={angleLocked}
              onChangeDim={v=>{setDimLocked(false);setDimInput(v)}}
              onChangeAngle={v=>{setAngleLocked(false);setAngleInput(v)}}
              onApply={applyDimAngleLock}
              liveLenMm={lineLiveLenMm}
              liveAngleDeg={lineLiveAngleDeg}
            />
          )}
          {tool==='includeedge' && (() => {
            const toolColor = toolConfig.find(([t])=>t==='includeedge')[3]
            return (
              <div ref={includeEdgePanelDrag.panelRef} style={{
                position:'absolute',top:0,left:'100%',marginLeft:10,
                background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
                padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
                zIndex:50,width:170,fontFamily:'monospace',...includeEdgePanelDrag.panelStyle,
              }}>
                <div style={{position:'absolute',top:18,left:-9,width:0,height:0,
                  borderTop:'8px solid transparent',borderBottom:'8px solid transparent',
                  borderRight:`9px solid ${toolColor}`}}/>
                <DragHandle {...includeEdgePanelDrag.handleProps}>Include Edge</DragHandle>
                <div style={{textAlign:'center',fontSize:20,fontWeight:'bold',color:toolColor}}>
                  {includeEdgeSel.length}
                </div>
                <div style={{textAlign:'center',fontSize:9,color:'#666',marginTop:2}}>
                  edge{includeEdgeSel.length===1?'':'s'} included
                </div>
                <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
                  Click any edge on any solid. Esc when done.
                </div>
              </div>
            )
          })()}
          {tool==='circle' && (
            <CircleSnapPanel
              toolColor={toolConfig.find(([t])=>t==='circle')[3]}
              tKeyDown={tKeyDown}
              onToggleT={()=>setTKeyDown(p=>!p)}
              circleTanA={circleTanA} circleTanB={circleTanB}
              circleCenter={circleCenter}
              dimInput={dimInput} dimLocked={dimLocked}
              onChangeDim={v=>{setDimLocked(false);setDimInput(v)}}
              onApply={applyCircleRadius}
              liveRadiusMm={circleLiveRadiusMm}
            />
          )}
          {tool==='spline' && (
            <SplineSnapPanel
              toolColor={toolConfig.find(([t])=>t==='spline')[3]}
              splineClosed={splineClosed}
              onToggleC={()=>setSplineClosed(p=>!p)}
              splinePoints={splinePoints}
            />
          )}
          {tool==='fillet'&&filletSel.length===2&&(
            <FilletRadiusPanel
              toolColor={toolConfig.find(([t])=>t==='fillet')[3]}
              value={filletRadiusInput}
              onChange={setFilletRadiusInput}
              onApply={applyFillet}
              tooLarge={!!filletPreview?.tooLarge}
            />
          )}
          {tool==='offset'&&offsetEntity&&(
            <OffsetDistPanel
              toolColor={toolConfig.find(([t])=>t==='offset')[3]}
              value={offsetDistInput}
              onChange={setOffsetDistInput}
              canApply={!!offsetPreview}
              liveValueMm={mousePos?pxToMm(distToEntity(mousePos,
                offsetEntity.kind==='line'?lines[offsetEntity.idx]:
                offsetEntity.kind==='circle'?circles[offsetEntity.idx]:
                offsetEntity.kind==='arc'?arcs[offsetEntity.idx]:splines[offsetEntity.idx],
                offsetEntity.kind)):null}
            />
          )}
        </div>
      )}

      {saveAsOpen&&(
        <SaveAsPanel
          defaultName="drawing"
          extension={saveAsOpen==='project' ? '.trc' : '.json'}
          onSave={async filename=>{
            setSaveAsOpen(false)
            if (saveAsOpen==='project') await saveProjectFileAs(features, solids, filename, null, props.getSheetData?.())
            else await saveProjectAs(lines,circles,arcs,splines,dims,filename)
          }}
          onClose={()=>setSaveAsOpen(false)}
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
})

export default App3D

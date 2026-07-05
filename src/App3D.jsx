import { useState, useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import Viewport3D from './Viewport3D.jsx'
import { planeColor, planeAxisLabels, sketchToWorld } from './SketchPlane.js'
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
  IconMirror, IconMoveCopy, IconRotateCopy, IconResize, IconFillet, IconTrace, IconGuide,
  IconUndo, IconRedo, IconFitView, IconSave, IconLoad, IconDXF, IconSpline, IconText, IconSelect, IconJoin, IconDim, IconAxis
} from './draw/ToolIcons.jsx'

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


// ── SmartStep Bar ─────────────────────────────────────────────────────────────
// Shows the current step of the active Extrude / Cutout operation.
// Completed steps show a ✓ and are clickable to go back.
// Disappears entirely when no solid operation is running.

function SmartStepBar({ op, currentStep, color, onStepBack }) {
  if (!op) return null

  const steps = [
    { id: 1, label: 'Pick Plane' },
    { id: 2, label: 'Draw Profile' },
    { id: 3, label: 'Set Depth' },
  ]

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

function FeatureTree({ features, activeSketchId, sketchMode, onEditSketch, onToggleVisible, onDelete, onRename, onEditDepth, onEditExtent }) {
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
          const editingDepth = editDepthId === feat.id

          const itemBg = isActiveSketch ? '#e8f0ff' : 'transparent'
          const borderLeft = isActiveSketch ? '3px solid #3a7bd5'
                           : isSketch ? '3px solid #ddd'
                           : '3px solid transparent'

          return (
            <div key={feat.id} style={{
              borderLeft, background: itemBg,
              padding: '6px 10px 6px 8px',
              borderBottom: '1px solid #eee',
              cursor: isSketch ? 'pointer' : 'default',
            }}>
              {/* Feature header row */}
              <div style={{display:'flex', alignItems:'center', gap:6}}>
                {/* Icon */}
                <span style={{fontSize:14, flexShrink:0}}>
                  {isSketch ? '📐' : '⬆'}
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
                  {isExtrude && (
                    <>
                      {!sketchMode && feat.sketchLines !== undefined && (
                        <button title="Edit sketch"
                          onClick={e=>{e.stopPropagation(); onEditSketch(feat.id)}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            padding:'1px 3px', fontSize:11, color:'#3a7bd5'}}
                        >✏️</button>
                      )}
                      {!sketchMode && (
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

              {/* Extrude subtitle: colour + depth + operation */}
              {isExtrude && (
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
  const featureCountRef=useRef({sketch:0,extrude:0})       // for auto-naming
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
  const [drawStyle,setDrawStyle]=useState(null) // null|'dashed'|'construction'
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
    linesRef.current.forEach((l,idx)=>{
      if(ptIn(l.x1,l.y1)||ptIn(l.x2,l.y2)) hits.push({kind:'line',idx})
    })
    circlesRef.current.forEach((c,idx)=>{
      if(ptIn(c.cx,c.cy)||ptIn(c.cx+c.r,c.cy)||ptIn(c.cx-c.r,c.cy)) hits.push({kind:'circle',idx})
    })
    arcsRef.current.forEach((arc,idx)=>{
      const p1x=arc.cx+arc.r*Math.cos(arc.startAngle),p1y=arc.cy+arc.r*Math.sin(arc.startAngle)
      const p2x=arc.cx+arc.r*Math.cos(arc.endAngle),p2y=arc.cy+arc.r*Math.sin(arc.endAngle)
      if(ptIn(arc.cx,arc.cy)||ptIn(p1x,p1y)||ptIn(p2x,p2y)) hits.push({kind:'arc',idx})
    })
    splinesRef.current.forEach((sp,idx)=>{
      if(sp.points.some(p=>ptIn(p.x,p.y))) hits.push({kind:'spline',idx})
    })
    const merge=(prev)=>{
      const m=[...prev]
      hits.forEach(h=>{if(!m.some(p=>p.kind===h.kind&&p.idx===h.idx))m.push(h)})
      return m
    }
    if(tool==='mirror')      setMirrorSel(merge)
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
      const color=isDelTarget?'#F44336':isOffSel||isMirSel||isMCSel||isRCSel||isRzSel||isFiSel?'#FF9800':isOffHov||isMirHov||isMCHov||isRCHov||isRzHov||isFiHov?'#FFD600':isSelHov||isSelected?'#64B5F6':null
      if (!color) return
      const lw=(isDelTarget||isOffSel||isMirSel||isMCSel||isRCSel||isRzSel||isFiSel?3:2)/sc
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash([])
      ctx.beginPath();ctx.moveTo(line.x1,line.y1);ctx.lineTo(line.x2,line.y2);ctx.stroke()
      ctx.restore()
    })
    drawCircles.forEach((c,idx)=>{
      const isDelTarget=deletePreview?.kind==='circle'&&deletePreview.idx===idx
      const isMirSel=mirrorSel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='circle'&&mirrorHover.idx===idx&&!isMirSel
      const isMCSel=moveCopySel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='circle'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='circle'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='circle'&&resizeHover.idx===idx&&!isRzSel
      const isSelHov=selectHover?.kind==='circle'&&selectHover.idx===idx&&!selection.some(s=>s.kind==='circle'&&s.idx===idx)
      const isSelected=selection.some(s=>s.kind==='circle'&&s.idx===idx)
      const color=isDelTarget?'#F44336':isMirSel||isMCSel||isRCSel||isRzSel?'#FF9800':isMirHov||isMCHov||isRCHov||isRzHov?'#FFD600':isSelHov||isSelected?'#64B5F6':null
      if (!color) return
      const lw=(isDelTarget||isMirSel||isMCSel||isRCSel||isRzSel?3:2)/sc
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash([])
      ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke();ctx.restore()
    })
    drawArcs.forEach((arc,idx)=>{
      const isDelTarget=deletePreview?.kind==='arc'&&deletePreview.idx===idx
      const isOffSel=offsetEntity?.kind==='arc'&&offsetEntity.idx===idx
      const isOffHov=offsetHover?.kind==='arc'&&offsetHover.idx===idx&&!isOffSel
      const isMirSel=mirrorSel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='arc'&&mirrorHover.idx===idx&&!isMirSel
      const isMCSel=moveCopySel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='arc'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='arc'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='arc'&&resizeHover.idx===idx&&!isRzSel
      const isSelHov=selectHover?.kind==='arc'&&selectHover.idx===idx&&!selection.some(s=>s.kind==='arc'&&s.idx===idx)
      const isSelected=selection.some(s=>s.kind==='arc'&&s.idx===idx)
      const color=isDelTarget?'#F44336':isOffSel||isMirSel||isMCSel||isRCSel||isRzSel?'#FF9800':isOffHov||isMirHov||isMCHov||isRCHov||isRzHov?'#FFD600':isSelHov||isSelected?'#64B5F6':null
      if (!color) return
      const lw=(isDelTarget||isOffSel||isMirSel||isMCSel||isRCSel||isRzSel?3:2)/sc
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash([])
      ctx.beginPath();ctx.arc(arc.cx,arc.cy,arc.r,arc.startAngle,arc.endAngle,false);ctx.stroke();ctx.restore()
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

  },[lines,circles,arcs,splines,selection,selectHover,selectLiveGeom,selectDimField,selectDimPending,selectDimAnchor,splinePoints,splineClosed,startPoint,circleCenter,mousePos,dimInput,dimLocked,angleInput,angleLocked,focusField,trackedPts,tool,trimPreview,deletePreview,extendPreview,offsetEntity,offsetPreview,offsetDistInput,offsetDistLocked,offsetHover,mirrorSel,mirrorAccepted,mirrorPreview,mirrorP1,mirrorHover,moveCopySel,moveCopyAccepted,moveCopyMode,moveCopyCountInput,moveCopyHover,rotateCopySel,rotateCopyAccepted,rotateCopyMode,rotateCopyCountInput,rotateCopyHover,resizeSel,resizeAccepted,resizeScaleInput,resizeHover,filletSel,filletAccepted,filletRadiusInput,filletHover,filletPreview,dragSelectRect,viewTransform,tKeyDown,intersectionPts,joinHover,joinFirstPt,dims,selectDimInput,activePlane,sketchMode,extrudeTool,cachedProfiles,extrudeState])


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

  // ── Feature tree helpers ─────────────────────────────────────────────────

  function nextSketchName() {
    featureCountRef.current.sketch += 1
    return `Sketch ${featureCountRef.current.sketch}`
  }
  function nextExtrudeName() {
    featureCountRef.current.extrude += 1
    return `Extrude ${featureCountRef.current.extrude}`
  }

  // Enter sketch mode for a new or existing sketch
  function enterSketch(plane, existingId=null, initialGeometry=null) {
    activePlaneRef.current = plane  // set synchronously
    setActivePlane(plane)
    setSketchMode(true)
    setActiveSketchId(existingId)
    setTool('line')
    resetDrawState();resetOffset();resetMirror();resetMoveCopy()
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
    if (extrudeState) return  // step 3 (depth): ignore stray face clicks
    enterSketch(facePlane)
    viewport3dRef.current?.snapToFace(facePlane)
  }

  function handlePlaneClick({ id }) {
    if (extrudeState) return  // step 3 (depth): ignore stray plane clicks
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

    // Detect closed profiles (needed for both standalone sketches and extrude flow)
    const allProfiles = []
    const profiles = detectProfiles(lines, arcs, planeId, circles, splines)
    profiles.forEach(pts => {
      const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length
      const cy = pts.reduce((s,p)=>s+p.y,0)/pts.length
      allProfiles.push({ planeId, facePlane: isFace ? plane : null, pts, centroid:{x:cx,y:cy} })
    })
    setCachedProfiles(allProfiles)

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

      viewport3dRef.current?.snapToIsometric()

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
    viewport3dRef.current?.snapToIsometric()
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

  // ── Extrude click→move→click state machine ───────────────────────────────
  // Phase 1 (idle):   extrudeTool set, extrudeState null — show "click to extrude" on profile
  // Phase 2 (armed):  first click on profile → extrudeState.armed=true, mouse moves freely
  // Phase 3 (commit): second click → commitExtrude() → OCC builds real solid

  const [extrudeHandlePos, setExtrudeHandlePos] = useState(null)
  const extrudeMouseRef = useRef(null)   // latest mouse client coords while armed
  const previewSolidRef = useRef(null)

  // Called every mouse move — tracks position for arrow + canvas preview
  function handleExtrudeDragMove(e) {
    if (!extrudeState?.armed) return
    extrudeMouseRef.current = { x: e.clientX, y: e.clientY }
    // Extent (depth or revolve angle) comes only from the popup input, not
    // mouse position — both ghost previews run on their own rAF loop reacting
    // to extrudeState (see startExtrudeAnimLoop/startRevolveAnim + effects
    // further down), so there's nothing to compute or draw here on mouse move.
    setSolids(prev => prev.filter(s => s.id !== '__preview__'))
    previewSolidRef.current = null
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
        const elapsed = (now - startTime) % (duration*2)
        const t = elapsed < duration ? elapsed/duration : (2 - elapsed/duration)
        const eased = t*t*(3-2*t)   // smoothstep
        drawExtrudePreview(p.vp, p.profilePts, p.planeId, p.dir, p.centScreen,
          p.depthMm, p.direction, p.opType, p.color, p.facePlane, eased)
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
    const rawDir = vp.planeExtrudeDirection(planeId, facePlane) || { dx:0, dy:-1 }
    const dir = (facePlane && !isCutout) ? { dx:-rawDir.dx, dy:-rawDir.dy } : rawDir
    const centScreen = vp.sketchToScreen(st.centroid.x, st.centroid.y, planeId, facePlane)
    if (!centScreen) return
    const isThroughAll = isCutout && st.extentMode === 'through'
    const depthMm = isThroughAll ? Infinity : (parseFloat(st.depthInput) || 20)
    extrudeAnimParamsRef.current = {
      vp, profilePts: prof, planeId, dir, centScreen, depthMm,
      direction: st.direction || 'front', opType: extrudeTool,
      color: isCutout ? '#e05a4e' : extrudeColor, facePlane,
    }
  }, [extrudeState?.armed, extrudeState?.revolveAxis, extrudeState?.planeId, extrudeState?.facePlane,
      extrudeState?.profiles, extrudeState?.pickedIdx, extrudeState?.centroid,
      extrudeState?.extentMode, extrudeState?.depthInput, extrudeState?.direction, extrudeTool, extrudeColor])

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

    if (direction === 'front') {
      capPts  = screenPts.map(p => ({ x: p.x - dir.dx*offsetLen, y: p.y - dir.dy*offsetLen }))
      basePts = screenPts
    } else if (direction === 'back') {
      capPts  = screenPts.map(p => ({ x: p.x + dir.dx*offsetLen, y: p.y + dir.dy*offsetLen }))
      basePts = screenPts
    } else {
      const half = offsetLen / 2
      basePts = screenPts.map(p => ({ x: p.x - dir.dx*half, y: p.y - dir.dy*half }))
      capPts  = screenPts.map(p => ({ x: p.x + dir.dx*half, y: p.y + dir.dy*half }))
      isBoth = true
    }

    const strokeColor = isCutout ? '#e05a4e' : (color || '#3a7bd5')
    const fillColor   = isCutout ? 'rgba(224,90,78,0.12)' : 'rgba(58,123,213,0.12)'

    // ── Wireframe faces + lateral edges (extrudes only) ──────────────────────
    if (!isCutout) {
      const drawFace = (pts) => {
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
        ctx.closePath()
        ctx.fillStyle = fillColor; ctx.fill()
        ctx.strokeStyle = strokeColor; ctx.lineWidth = 1.5
        ctx.setLineDash([]); ctx.stroke()
      }
      if (isBoth) drawFace(basePts)
      drawFace(capPts)
      if (isBoth) {
        ctx.strokeStyle = strokeColor; ctx.lineWidth = 1; ctx.setLineDash([4,3])
        basePts.forEach((bp, i) => {
          const cp = capPts[i]; if (!cp) return
          ctx.beginPath(); ctx.moveTo(bp.x, bp.y); ctx.lineTo(cp.x, cp.y); ctx.stroke()
        })
        ctx.setLineDash([])
      }
    }

    // ── Direction arrow(s) ────────────────────────────────────────────────────
    const capCx = capPts.reduce((s,p)=>s+p.x,0)/capPts.length
    const capCy = capPts.reduce((s,p)=>s+p.y,0)/capPts.length
    const mainLabel = isThroughAll ? '∞' : `${depthMm}mm`

    const drawArrow = (fromX, fromY, toX, toY, label) => {
      ctx.strokeStyle = strokeColor; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(toX, toY); ctx.stroke()
      const a = Math.atan2(toY-fromY, toX-fromX)
      ctx.save(); ctx.translate(toX, toY); ctx.rotate(a)
      ctx.fillStyle = strokeColor
      ctx.beginPath(); ctx.moveTo(10,0); ctx.lineTo(-6,-5); ctx.lineTo(-6,5); ctx.closePath(); ctx.fill()
      ctx.restore()
      if (label) {
        ctx.fillStyle = strokeColor; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left'
        ctx.fillText(label, toX+14, toY+4)
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

    // Cutout: through-all uses a huge depth to guarantee punch-through; value uses user depth
    const cutDepthMm  = (isCutout && extentMode === 'through') ? 10000 : depthMm
    const cutDirection = (isCutout && extentMode === 'through') ? 'both'  : direction

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

        // Worker params for re-extruding a solid's own (uncut) base shape.
        const buildBaseParams = (solid) => ({
          pts: solid.profilePts,
          depthMm: solid.depthMm,
          planeId: solid.planeId,
          direction: solid.direction || 'both',
          circle: solid.profilePts.circleMeta || null,
          ...(solid.facePlane ? {
            normal: [solid.facePlane.normal.x, solid.facePlane.normal.y, solid.facePlane.normal.z],
            origin: [pxToMm(solid.facePlane.origin.x), pxToMm(solid.facePlane.origin.y), pxToMm(solid.facePlane.origin.z)],
            uAxis:  [solid.facePlane.uAxis.x,  solid.facePlane.uAxis.y,  solid.facePlane.uAxis.z],
          } : {}),
        })
        // Worker params for one specific existing cutout feature's own cut
        // geometry (linear or revolve-shaped) — see buildCutWorkerParams.
        const buildCutParams = buildCutWorkerParams

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
            const baseWorkerParams = buildBaseParams(baseSolid)
            let meshData = await cadEngine.extrude({ solidId: baseSolid.id, ...baseWorkerParams })
            const allCutsOnThisSolid = features.filter(f => f.operation === 'cutout' && f.solidId === baseSolid.id)
            for (const cutFeat of allCutsOnThisSolid) {
              const cFeat = cutFeat.groupId === groupId ? cut : buildCutParams(cutFeat)
              meshData = await cadEngine.subtract({ baseSolidId: baseSolid.id, cut: cFeat, base: baseWorkerParams })
            }
            const group = replicadMeshToThree(meshData, baseSolid.color)
            setSolids(prev => prev.map(s => s.id === baseSolid.id ? { ...s, group } : s))
            updatedById.set(member.id, {
              ...member, depthMm, cutDepthMm, cutDirection, extentMode, profilePts: pts, facePlane,
              revolveAxis, angleDeg, revolveReverse, ...sketchGeom,
            })
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
            const worldNormals = { XY:[0,0,1], XZ:[0,1,0], YZ:[1,0,0] }
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
            const targetBaseParams = buildBaseParams(target)
            const meshData = await cadEngine.subtract({ baseSolidId: target.id, cut, base: targetBaseParams })
            const group = replicadMeshToThree(meshData, target.color)
            setSolids(prev => prev.map(s => s.id === target.id ? { ...s, group } : s))
            newFeats.push({
              id: `cutout-${target.id}-${Date.now()}`,
              type: 'extrude', name: nextExtrudeName(), groupId,
              solidId: target.id, sketchId: lastSketch?.id || null,
              depthMm, cutDepthMm, cutDirection, extentMode, color, operation: 'cutout', planeId, profilePts: pts, facePlane,
              revolveAxis, angleDeg, revolveReverse, ...sketchGeom,
            })
          }
          setFeatures(prev => [...prev, ...newFeats])

        } else {
          // Editing an existing, non-grouped (single-body) cutout.
          const baseSolid = solids.find(s => s.id === editingFeat.solidId)
          if (!baseSolid) throw new Error('No base solid to cut from')
          const baseWorkerParams = buildBaseParams(baseSolid)

          // Re-editing: the worker's shapeStore for this solidId currently holds
          // the OLD compounded result, so a plain subtract here would stack the
          // new cut on top of the old one instead of replacing it. Rebuild the
          // base clean and replay every cutout on it in order, substituting the
          // new profile/extent for the one being edited.
          let meshData = await cadEngine.extrude({ solidId: baseSolid.id, ...baseWorkerParams })
          const allCuts = features.filter(f => f.operation === 'cutout' && f.solidId === baseSolid.id)
          for (const cutFeat of allCuts) {
            const cFeat = cutFeat.id === editingId ? cut : buildCutParams(cutFeat)
            meshData = await cadEngine.subtract({ baseSolidId: baseSolid.id, cut: cFeat, base: baseWorkerParams })
          }

          const group = replicadMeshToThree(meshData, baseSolid.color)
          setSolids(prev => prev.map(s =>
            s.id === baseSolid.id ? { ...s, group } : s
          ))
          const cutoutFeat = {
            id: editingId, type: 'extrude', name: editingFeat?.name || nextExtrudeName(),
            solidId: baseSolid.id, sketchId: lastSketch?.id || null,
            depthMm, cutDepthMm, cutDirection, extentMode, color, operation: 'cutout', planeId, profilePts: pts, facePlane,
            revolveAxis, angleDeg, revolveReverse, ...sketchGeom,
          }
          setFeatures(prev => prev.map(f => f.id === editingId ? cutoutFeat : f))
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
        const group = replicadMeshToThree(meshData, color)
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
            id: solidId, group: replicadMeshToThree(meshData, color), planeId, operation:'extrude',
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
            const group = replicadMeshToThree(meshData, color)
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
          const group = replicadMeshToThree(meshData, member.color)
          setSolids(prev => prev.map(s => s.id === member.solidId ? { ...s, group, direction, depth: mmToPx(depthMm), depthMm } : s))
          updatedById.set(member.id, { ...member, depthMm, direction, extentMode })
        }
        setFeatures(prev => prev.map(f => updatedById.get(f.id) || f))

      } else {
        // Run geometry in worker (OpenCascade WASM); solidId lets worker cache this shape
        const solidId = editingFeat?.solidId || Date.now()
        const meshData = await cadEngine.extrude({ ...workerParams, solidId })
        const group = replicadMeshToThree(meshData, color)
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

    viewport3dRef.current?.snapToIsometric()
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
      const group = replicadMeshToThree(meshData, color)
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
          // Rebuild the base solid clean (this also refreshes the worker's shapeStore)
          const baseWorkerParams = {
            solidId: baseSolid.id,
            pts: baseSolid.profilePts,
            depthMm: baseSolid.depthMm,
            planeId: baseSolid.planeId,
            direction: baseSolid.direction || 'both',
            circle: baseSolid.profilePts.circleMeta || null,
            ...(baseSolid.facePlane ? {
              normal: [baseSolid.facePlane.normal.x, baseSolid.facePlane.normal.y, baseSolid.facePlane.normal.z],
              origin: [pxToMm(baseSolid.facePlane.origin.x), pxToMm(baseSolid.facePlane.origin.y), pxToMm(baseSolid.facePlane.origin.z)],
              uAxis:  [baseSolid.facePlane.uAxis.x, baseSolid.facePlane.uAxis.y, baseSolid.facePlane.uAxis.z],
            } : {}),
          }
          let meshData = await cadEngine.extrude(baseWorkerParams)

          // Re-apply any other cutouts on this solid in order (skip the one(s) being deleted)
          const remainingCuts = features.filter(f =>
            !idsToDelete.includes(f.id) && f.operation === 'cutout' && f.solidId === baseSolid.id
          )
          for (const cutFeat of remainingCuts) {
            const cut = buildCutWorkerParams(cutFeat)
            meshData = await cadEngine.subtract({ baseSolidId: baseSolid.id, cut, base: baseWorkerParams })
          }

          const group = replicadMeshToThree(meshData, baseSolid.color)
          setSolids(prev => prev.map(s => s.id === baseSolid.id ? { ...s, group } : s))
        } catch (err) {
          console.error('Cutout delete restore failed:', err)
        }
      }
      setFeatures(prev => prev.filter(f => !idsToDelete.includes(f.id)))
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
      const facePlaneParams = fp => fp ? {
        normal: [fp.normal.x, fp.normal.y, fp.normal.z],
        origin: [pxToMm(fp.origin.x), pxToMm(fp.origin.y), pxToMm(fp.origin.z)],
        uAxis:  [fp.uAxis.x, fp.uAxis.y, fp.uAxis.z],
      } : {}

      const solidsForExport = solids.map(solid => {
        const base = {
          pts: solid.profilePts,
          depthMm: solid.depthMm,
          planeId: solid.planeId,
          direction: solid.direction || 'both',
          circle: solid.profilePts.circleMeta || null,
          ...facePlaneParams(solid.facePlane),
        }
        const cuts = features
          .filter(f => f.operation === 'cutout' && f.solidId === solid.id)
          .map(buildCutWorkerParams)
        return { solidId: solid.id, base, cuts }
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
        if (offsetPreview.kind==='line')   setLines(p=>[...p,{x1:offsetPreview.x1,y1:offsetPreview.y1,x2:offsetPreview.x2,y2:offsetPreview.y2,...(offsetPreview.style?{style:offsetPreview.style}:{})}])
        if (offsetPreview.kind==='circle') setCircles(p=>[...p,{cx:offsetPreview.cx,cy:offsetPreview.cy,r:offsetPreview.r,...(offsetPreview.style?{style:offsetPreview.style}:{})}])
        if (offsetPreview.kind==='arc')    setArcs(p=>[...p,{cx:offsetPreview.cx,cy:offsetPreview.cy,r:offsetPreview.r,startAngle:offsetPreview.startAngle,endAngle:offsetPreview.endAngle,...(offsetPreview.style?{style:offsetPreview.style}:{})}])
        if (offsetPreview.kind==='spline') setSplines(p=>[...p,{points:offsetPreview.points,closed:offsetPreview.closed,polyline:offsetPreview.polyline,...(offsetPreview.style?{style:offsetPreview.style}:{})}])
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
          commit(snapshot());setLines(p=>[...p,...finalMirror.newLines]);setCircles(p=>[...p,...finalMirror.newCircles]);setArcs(p=>[...p,...finalMirror.newArcs]);setSplines(p=>[...p,...finalMirror.newSplines]);resetMirror()
        }
      }
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
        if (moveCopyMode==='move'){const pruned=removeSelected(moveCopySel,lines,circles,arcs,splines);setLines([...pruned.lines,...copies.newLines]);setCircles([...pruned.circles,...copies.newCircles]);setArcs([...pruned.arcs,...copies.newArcs]);setSplines([...pruned.splines,...copies.newSplines])}
        else{setLines(p=>[...p,...copies.newLines]);setCircles(p=>[...p,...copies.newCircles]);setArcs(p=>[...p,...copies.newArcs]);setSplines(p=>[...p,...copies.newSplines])}
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
        if (rotateCopyMode==='rotate'){const pruned=removeSelected(rotateCopySel,lines,circles,arcs,splines);setLines([...pruned.lines,...copies.newLines]);setCircles([...pruned.circles,...copies.newCircles]);setArcs([...pruned.arcs,...copies.newArcs]);setSplines([...pruned.splines,...copies.newSplines])}
        else{setLines(p=>[...p,...copies.newLines]);setCircles(p=>[...p,...copies.newCircles]);setArcs(p=>[...p,...copies.newArcs]);setSplines(p=>[...p,...copies.newSplines])}
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
        setLines([...pruned.lines,...scaled.newLines])
        setCircles([...pruned.circles,...scaled.newCircles])
        setArcs([...pruned.arcs,...scaled.newArcs])
        setSplines([...pruned.splines,...scaled.newSplines])
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
        setLines(p=>[...p.filter((_,i)=>!filletSel.some(s=>s.idx===i)),
          s1?{...newL1,style:s1}:newL1,
          s2?{...newL2,style:s2}:newL2])
        setArcs(p=>[...p,arc])
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
  }

  function handleMouseMove(e){
    // Middle mouse pan is now handled by OrbitControls inside Viewport3D.
    // We just need world coordinates for tool logic.
    const sx=e.clientX,sy=e.clientY

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
    if ((e.key==='h'||e.key==='H')&&!e.ctrlKey&&!e.shiftKey){
      if (tool==='select'&&selection.length>0){
        // Toggle dashed on selected entities
        const newStyle=(lines[selection.find(s=>s.kind==='line')?.idx]?.style==='dashed')?null:'dashed'
        commit(snapshot())
        setLines(p=>p.map((l,i)=>selection.some(s=>s.kind==='line'&&s.idx===i)?{...l,style:newStyle||undefined}:l))
        setCircles(p=>p.map((c,i)=>selection.some(s=>s.kind==='circle'&&s.idx===i)?{...c,style:newStyle||undefined}:c))
        setArcs(p=>p.map((a,i)=>selection.some(s=>s.kind==='arc'&&s.idx===i)?{...a,style:newStyle||undefined}:a))
        setSplines(p=>p.map((sp,i)=>selection.some(s=>s.kind==='spline'&&s.idx===i)?{...sp,style:newStyle||undefined}:sp))
        return
      }
      else {setDrawStyle(p=>p==='dashed'?null:'dashed');return}
      }
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
    if (e.ctrlKey&&e.key==='z'){e.preventDefault();undo(snapshot(),restore);return}
    if (e.ctrlKey&&e.key==='y'){e.preventDefault();redo(snapshot(),restore);return}
    if (e.ctrlKey&&e.key==='s'){e.preventDefault();saveJSON(lines,circles,arcs,splines,dims);return}
    if ((e.key==='f'||e.key==='F')&&!e.ctrlKey){zoomToFit();return}
    // Escape in sketch mode: finish the sketch (cancel any in-progress tool first)
    if (e.key==='Escape'&&sketchMode){
      resetDrawState();resetSpline();resetOffset();resetMirror();resetMoveCopy()
      resetRotateCopy();resetResize();resetFillet();resetText();resetSelection()
      resetJoin();resetDim()
      if (extrudeTool) {
        // Cancel the whole extrude/cutout operation — restore any hidden solid
        if (hiddenEditSolidRef.current) {
          setSolids(prev => [...prev, ...hiddenEditSolidRef.current])
          hiddenEditSolidRef.current = null
        }
        setSketchMode(false); setActivePlane(null); setActiveSketchId(null)
        activePlaneRef.current = null
        setExtrudeTool(null); setExtrudeState(null); setEditingFeatureId(null)
        setLines([]); setCircles([]); setArcs([]); setSplines([])
        viewport3dRef.current?.snapToIsometric()
      } else {
        handleFinishSketch()
      }
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
        setLines(p=>[...p.filter((_,i)=>!filletSel.some(s=>s.idx===i)),
          s1?{...newL1,style:s1}:newL1,
          s2?{...newL2,style:s2}:newL2])
        setArcs(p=>[...p,arc])
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
      mirror:'#CE93D8', movecopy:'#FFB74D', rotatecopy:'#80DEEA',
      resize:'#F48FB1', fillet:'#80CBC4', offset:'#A5D6A7',
      dim:'#F48FB1',    trim:'#FFAB91',   extend:'#80DEEA',
      delete:'#EF9A9A', join:'#26C6DA',   text:'#FFB74D',  trace:'#B0BEC5',
    }
    const c = C[tool] || '#aaa'
    const K = (k,l='') => ({k,l})

    if (tool==='select') {
      if (selectDimField) return { step:3, total:3, color:c,
        action:`✏ ${selectDimField}: ${selectDimInput||'_'}`,
        hints:[K('Tab','next field'), K('Enter','apply'), K('Esc')] }
      if (selection.length>0) return { step:2, total:3, color:c,
        action:`${selection.length} selected`,
        hints:[K('Tab','edit dims'), K('H','dash'), K('D','construction'), K('Del','delete')] }
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

    if (sketchMode) return { step:null, total:null, color: getPlaneColor(activePlane),
      action:`Sketching on ${getPlaneLabel(activePlane)}  ${getPlaneAxes(activePlane).h}  ${getPlaneAxes(activePlane).v}`,
      hints:[K('Esc','finish sketch')] }

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
    ['axis',       IconAxis,       'Axis (revolve)', '#333333'],
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
    ['mirror',     IconMirror,     'Mirror',         '#9C27B0'],
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
      <div style={{width:72,background:'#1a1a2e',display:'flex',flexDirection:'column',
        padding:'8px 4px',gap:4,overflowY:'auto',borderRight:'1px solid #2a2a4a',
        transition:'background 0.3s'}}>

        {sketchMode ? (
          /* ── SKETCH sidebar: all 2D draw tools ── */
          <>
            {toolConfig.map(([t,Icon,title,activeColor])=>(
              <button key={t}
                onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
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
            {/* SELECT — always present */}
            <button
              title="Select"
              onClick={()=>{setTool('select');resetDrawState();resetSelection()}}
              style={{...btnBase,background:tool==='select'?'#64B5F633':'transparent',
                outline:tool==='select'?'2px solid #64B5F6':'none',outlineOffset:'-2px'}}>
              <IconSelect active={tool==='select'}/>
            </button>

            <div style={{width:60,height:1,background:'#2a2a4a',margin:'4px auto'}}/>

            {/* Solid operation placeholders — your retro icons will replace these */}
            {[
              {id:'extrude', label:'EXTRUDE', color:'#3a7bd5'},
              {id:'cutout',  label:'CUTOUT',  color:'#e05a4e'},
              {id:'revolve', label:'REVOLVE', color:'#4caf7d'},
              {id:'loft',    label:'LOFT',    color:'#f0a830'},
            ].map(({id,label,color})=>(
              <button key={id}
                title={label}
                onClick={()=>{ if(id==='extrude'||id==='cutout') activateExtrudeTool(id) }}
                style={{...btnBase, flexDirection:'column', gap:2,
                  background: extrudeTool===id ? color+'33' : 'transparent',
                  outline: extrudeTool===id ? `2px solid ${color}` : `1px dashed ${color}55`,
                  outlineOffset:'-2px',
                  opacity: (id==='revolve'||id==='loft') ? 0.4 : 1,
                  cursor: (id==='revolve'||id==='loft') ? 'not-allowed' : 'pointer',
                }}>
                {/* Placeholder icon — replace with your retro sprite */}
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <rect x="3" y="3" width="22" height="22" rx="3"
                    stroke={color} strokeWidth="1.2" fill={color+'11'} strokeDasharray="3 2"/>
                  <text x="14" y="17" textAnchor="middle"
                    style={{fontSize:7, fontFamily:'monospace', fill:color, letterSpacing:0}}>
                    {label.slice(0,3)}
                  </text>
                </svg>
                <span style={{fontSize:7,fontFamily:'monospace',color,letterSpacing:'0.04em'}}>
                  {label}
                </span>
              </button>
            ))}

            <div style={{flex:1}}/>

            {/* MEASURE placeholder */}
            <button title="Measure" style={{...btnBase, flexDirection:'column', gap:2,
              background:'transparent', outline:'1px dashed #88889955', outlineOffset:'-2px', opacity:0.5}}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <rect x="3" y="3" width="22" height="22" rx="3" stroke="#888" strokeWidth="1.2" fill="#88888811" strokeDasharray="3 2"/>
                <text x="14" y="17" textAnchor="middle"
                  style={{fontSize:7, fontFamily:'monospace', fill:'#888'}}>MEA</text>
              </svg>
              <span style={{fontSize:7,fontFamily:'monospace',color:'#666',letterSpacing:'0.04em'}}>MEASURE</span>
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
                  onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
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
                <button key={t}
                  onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
                  title={title}
                  style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                    outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
                  <Icon active={tool===t}/>
                </button>
              ))}

              <div style={{flex:1}}/>

              {/* FINISH SKETCH — right-aligned */}
              <button
                title="Finish Sketch  (Esc)"
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
                {label:'TOP',  title:'Top view (XY)',  fn:()=>viewport3dRef.current?.snapToPlane('XY')},
                {label:'FRONT',title:'Front view (XZ)', fn:()=>viewport3dRef.current?.snapToPlane('XZ')},
                {label:'SIDE', title:'Side view (YZ)',  fn:()=>viewport3dRef.current?.snapToPlane('YZ')},
                {label:'ISO',  title:'Isometric view',  fn:()=>viewport3dRef.current?.snapToIsometric()},
              ].map(({label,title,fn})=>(
                <button key={label} title={title} onClick={fn}
                  style={{...btnBase,background:'transparent',
                    outline:'1px solid #2a2a4a',outlineOffset:'-2px',
                    flexDirection:'column',gap:2,width:'auto',padding:'0 8px',height:48}}>
                  <span style={{fontSize:9,fontFamily:'monospace',color:'#6688aa',
                    letterSpacing:'0.06em'}}>{label}</span>
                </button>
              ))}

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
            sketchArmed={(!!extrudeTool && !extrudeState) && !sketchMode}
            showWorkPlanes={!sketchMode}
            activePlane={activePlane}
            sketchMode={sketchMode}
            extrudeTool={extrudeTool}
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
                viewport3dRef.current?.snapToIsometric()
              }
            }}
          />
        </div>
        <div style={{height:52,background:'#16162a',display:'flex',alignItems:'center',padding:'0 8px',gap:4,flexShrink:0,borderTop:'2px solid #2a2a4a'}}>
          <button onClick={()=>undo(snapshot(),restore)} title="Undo (Ctrl+Z)" disabled={!canUndo}
            style={{...btnBase,opacity:canUndo?1:0.3,background:'transparent',border:'none',cursor:canUndo?'pointer':'default'}}>
            <IconUndo active={canUndo}/>
          </button>
          <button onClick={()=>redo(snapshot(),restore)} title="Redo (Ctrl+Y)" disabled={!canRedo}
            style={{...btnBase,opacity:canRedo?1:0.3,background:'transparent',border:'none',cursor:canRedo?'pointer':'default'}}>
            <IconRedo active={canRedo}/>
          </button>
          <button onClick={zoomToFit} title="Zoom to fit (F)" style={{...btnBase,background:'transparent',border:'none'}}>
            <IconFitView/>
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
          <button onClick={handleExportSTL} title="Export STL (for 3D printing — fuses all bodies into one)"
            style={{...btnBase,background:'transparent',border:'none'}}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 2l8 4.5v9L11 20l-8-4.5v-9L11 2z" stroke="#aaa" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M3 6.5L11 11l8-4.5M11 11v9" stroke="#aaa" strokeWidth="1.2"/>
              <text x="4.5" y="19.5" fontSize="5" fill="#4CAF50" fontFamily="monospace" fontWeight="bold">STL</text>
            </svg>
          </button>
          <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
          {/* Grid toggle */}
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
          <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
          {/* Line style buttons */}
          {[
            {s:null,        label:'FIRM',    title:'Normal line',        color:'#aaa',    line:'——'},
            {s:'dashed',    label:'DASH',    title:'Dashed line (H)',    color:'#FF9800', line:'- -'},
            {s:'construction',label:'CONST', title:'Construction (D)',   color:'#9E9E9E', line:'···'},
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
          <div style={{color:'#777',fontFamily:'monospace',fontSize:11,paddingLeft:8,borderLeft:'1px solid #2a2a4a'}}>{zoomPct}%</div>
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
          background: 'rgba(15,20,40,0.95)',
          border: `1.5px solid ${extrudeTool==='cutout' ? '#e05a4e' : '#3a7bd5'}`,
          borderRadius: 8,
          padding: '10px 14px',
          minWidth: 180,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
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
                      background: extrudeState.revolveReverse===k ? (extrudeTool==='cutout' ? '#e05a4e' : '#3a7bd5') : '#1e1e38',
                      color: extrudeState.revolveReverse===k ? '#fff' : '#6688aa',
                      border:`1px solid ${extrudeState.revolveReverse===k?(extrudeTool==='cutout' ? '#ff7a6e' : '#5a9bf5'):'#2a3a5a'}`,
                      borderRadius: 4, fontFamily:'monospace', fontWeight:'bold',
                    }}
                  >{label}</button>
                ))}
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div style={{
                  flex:1, background:'#0a0e1a', border:'1px solid #2a3a5a',
                  borderRadius:4, padding:'4px 8px',
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
                      color:'#dce8ff', fontFamily:'monospace', fontSize:16,
                      fontWeight:'bold', width:70,
                    }}
                  />
                  <span style={{color:'#6688aa', fontSize:12}}>°</span>
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
                    padding:'4px 10px', background: extrudeTool==='cutout' ? '#e05a4e' : '#3a7bd5', color:'#fff',
                    border:'none', borderRadius:4, cursor:'pointer',
                    fontFamily:'monospace', fontSize:12, fontWeight:'bold',
                  }}
                >↵</button>
              </div>
              <div style={{color:'#445566', fontSize:10, marginTop:6, textAlign:'center'}}>
                {extrudeTool==='cutout' ? 'Revolve cutout angle' : 'Revolve angle'} · ↵ to accept · Esc to cancel
              </div>
            </>
          ) : (
            <>
              {/* Symmetry toggle */}
              <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
                {[
                  {k:'front', icon:'▶',  label:'Front'},
                  {k:'both',  icon:'◀▶', label:'Symmetric'},
                  {k:'back',  icon:'◀',  label:'Back'},
                ].map(({k,icon,label}) => (
                  <button key={k}
                    onClick={()=>setExtrudeState(prev=>({...prev, direction:k}))}
                    title={label}
                    style={{
                      flex:1, padding:'4px 0', fontSize:13, cursor:'pointer',
                      background: extrudeState.direction===k ? '#3a7bd5' : '#1e1e38',
                      color: extrudeState.direction===k ? '#fff' : '#6688aa',
                      border:`1px solid ${extrudeState.direction===k?'#5a9bf5':'#2a3a5a'}`,
                      borderRadius: 4,
                    }}
                  >{icon}</button>
                ))}
              </div>
              {/* Distance display + input */}
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div style={{
                  flex:1, background:'#0a0e1a', border:'1px solid #2a3a5a',
                  borderRadius:4, padding:'4px 8px',
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                }}>
                  <input
                    autoFocus
                    value={extrudeState.depthInput}
                    onChange={e=>setExtrudeState(prev=>({...prev,depthInput:e.target.value}))}
                    onKeyDown={e=>{ e.stopPropagation(); handleExtrudeDepthKey(e) }}
                    style={{
                      background:'none', border:'none', outline:'none',
                      color:'#dce8ff', fontFamily:'monospace', fontSize:16,
                      fontWeight:'bold', width:70,
                    }}
                  />
                  <span style={{color:'#6688aa', fontSize:12}}>mm</span>
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
                    padding:'4px 10px', background:'#3a7bd5', color:'#fff',
                    border:'none', borderRadius:4, cursor:'pointer',
                    fontFamily:'monospace', fontSize:12, fontWeight:'bold',
                  }}
                >↵</button>
              </div>
              <div style={{color:'#445566', fontSize:10, marginTop:6, textAlign:'center'}}>
                Enter depth · click or ↵ to accept · Esc to cancel
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
          background: 'rgba(15,20,40,0.95)',
          border: '1.5px solid #e05a4e',
          borderRadius: 8,
          padding: '10px 14px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
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
                      background: active ? '#e05a4e' : '#1e1e38',
                      color: active ? '#fff' : '#6688aa',
                      border:`1px solid ${active?'#ff7a6e':'#2a3a5a'}`,
                      borderRadius:4, fontFamily:'monospace',
                    }}
                  >{icon}</button>
                )
              })}
            </div>

            {/* Right column: direction + depth */}
            <div style={{display:'flex', flexDirection:'column', gap:6}}>

              {/* Direction buttons */}
              <div style={{display:'flex', gap:4}}>
                {[
                  {k:'front', icon:'▶',  label:'Front'},
                  {k:'both',  icon:'◀▶', label:'Symmetric'},
                  {k:'back',  icon:'◀',  label:'Back'},
                ].map(({k,icon,label}) => (
                  <button key={k}
                    onClick={()=>setExtrudeState(prev=>({...prev, direction:k}))}
                    title={label}
                    style={{
                      flex:1, padding:'4px 0', fontSize:13, cursor:'pointer',
                      background: extrudeState.direction===k ? '#e05a4e' : '#1e1e38',
                      color: extrudeState.direction===k ? '#fff' : '#6688aa',
                      border:`1px solid ${extrudeState.direction===k?'#ff7a6e':'#2a3a5a'}`,
                      borderRadius:4,
                    }}
                  >{icon}</button>
                ))}
              </div>

              {/* Depth input (disabled for through-all) */}
              <div style={{display:'flex', gap:6, alignItems:'center'}}>
                <div style={{
                  flex:1, background:'#0a0e1a',
                  border:`1px solid ${extrudeState.extentMode==='through'?'#1a2a3a':'#2a3a5a'}`,
                  borderRadius:4, padding:'4px 8px',
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
                      color: extrudeState.extentMode==='through' ? '#445566' : '#dce8ff',
                      fontFamily:'monospace', fontSize:16, fontWeight:'bold', width:70,
                    }}
                  />
                  <span style={{color:'#6688aa', fontSize:12}}>mm</span>
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
                    padding:'4px 10px', background:'#e05a4e', color:'#fff',
                    border:'none', borderRadius:4, cursor:'pointer',
                    fontFamily:'monospace', fontSize:12, fontWeight:'bold',
                  }}
                >↵</button>
              </div>

            </div>
          </div>
          <div style={{color:'#445566', fontSize:10, marginTop:6, textAlign:'center'}}>
            {extrudeState.extentMode==='through' ? 'Cuts through entire solid' : 'Enter depth · click or ↵ to accept'} · Esc to cancel
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
            commit(snapshot())
            setLines(p=>[...p,...iLines])
            setCircles(p=>[...p,...iCircles])
            setArcs(p=>[...p,...iArcs])
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

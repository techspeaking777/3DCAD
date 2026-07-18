/**
 * Viewport3D.jsx  —  Phase 1 + Phase 2 Step 2
 *
 * Two render layers:
 *  1. Three.js WebGLRenderer  — committed geometry + work planes + grid
 *  2. Transparent <canvas>    — tool overlays (snap, rubber-band, bbox, labels)
 *
 * Phase 2 Step 2 — Camera tween
 * ──────────────────────────────
 * snapToPlane(planeId)   — smoothly animates camera to look straight at a work plane
 * snapToIsometric()      — smoothly animates to a fixed canonical isometric view
 * restoreSavedView()     — smoothly animates back to the saved pre-sketch orbit state
 *
 * The tween runs inside the existing RAF loop using a simple easeInOutCubic.
 * OrbitControls are disabled during the tween and re-enabled when it finishes.
 *
 * Public imperative API  (forwardRef)
 * ────────────────────────────────────
 *   screenToWorld(clientX, clientY) → {x,y}
 *   zoomToFit()
 *   getScale()
 *   getOverlayCtx()      → { ctx, sc }
 *   clearOverlay()
 *   snapToPlane(id)      → Promise  (resolves when tween finishes)
 *   snapToIsometric()    → Promise
 *   restoreSavedView()   → Promise
 *   getDomElement()
 */

import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { createWorkPlanes, hitTestPlanes, setPlaneHover, setPlaneActive, setWorkPlanesVisible } from './WorkPlanes.js'
import { SKETCH_PLANES } from './SketchPlane.js'
import { faceHitToPlane, previewBottomEdge, faceBoundarySegments } from './FacePlane.js'
import { mmToPx } from './constants.js'

// Averages the 3 vertex normals of a hovered face's hit triangle, world-space —
// same convention faceHitToPlane uses, factored out so both the per-frame
// highlight and the keyboard-driven Tab cycling (which runs outside animate())
// compute the exact same normal for a given hover state.
function getHoveredFaceNormal(hf) {
  const geo = hf.mesh.geometry
  const face = hf.hit.face
  const normals = geo?.attributes?.normal
  if (!face) return null
  if (!normals) return face.normal.clone().transformDirection(hf.mesh.matrixWorld).normalize()
  const na = new THREE.Vector3(normals.getX(face.a), normals.getY(face.a), normals.getZ(face.a))
  const nb = new THREE.Vector3(normals.getX(face.b), normals.getY(face.b), normals.getZ(face.b))
  const nc = new THREE.Vector3(normals.getX(face.c), normals.getY(face.c), normals.getZ(face.c))
  return na.add(nb).add(nc).divideScalar(3).transformDirection(hf.mesh.matrixWorld).normalize()
}

// solidId lives on the per-solid GROUP's userData (see cadMesh.js), not on the
// individual face Mesh a raycast actually hits — walk up to find the nearest
// ancestor that has it. Shared by raycastSolidFace and the sketch-armed
// face-click handler below.
function findOwningSolidId(obj) {
  let owner = obj
  while (owner && owner.userData?.solidId == null) owner = owner.parent
  return owner?.userData?.solidId ?? null
}
import { detectProfiles } from './tools/extrudeMath.js'
import { EDGE_LINE_RESOLUTION } from './cadMesh.js'

// ── coordinate helpers ────────────────────────────────────────────────────────

function w2t(x, y) { return new THREE.Vector3(x, -y, 0) }
function t2w(v)    { return { x: v.x, y: -v.y } }

// ── easing ────────────────────────────────────────────────────────────────────

function easeInOutCubic(t) {
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2
}

// ── camera tween target definitions ──────────────────────────────────────────
// Each plane gets a specific camera position / up vector for a perfect flat view.
// Distance 800 puts geometry comfortably in the ortho frustum.

const PLANE_VIEWS = {
  XY: {
    // Look straight down from above — top view
    position: new THREE.Vector3(0,  0, 800),
    up:       new THREE.Vector3(0,  1,   0),
    target:   new THREE.Vector3(0,  0,   0),
  },
  XZ: {
    // Look straight from front (negative Y direction in Three = forward in 2D)
    position: new THREE.Vector3(0, -800, 0),
    up:       new THREE.Vector3(0,    0, 1),
    target:   new THREE.Vector3(0,    0, 0),
  },
  YZ: {
    // Look from the right side (positive X direction)
    position: new THREE.Vector3(800, 0, 0),
    up:       new THREE.Vector3(  0, 0, 1),
    target:   new THREE.Vector3(  0, 0, 0),
  },
}

// Fixed canonical isometric view — front-right-top corner, same distance-800
// convention as PLANE_VIEWS so switching between TOP/FRONT/SIDE/ISO doesn't
// jump zoom level. Matches the camera's own default startup framing.
const ISO_VIEW = {
  position: new THREE.Vector3(1, -1, 1).normalize().multiplyScalar(800),
  up:       new THREE.Vector3(0,  0, 1),
  target:   new THREE.Vector3(0,  0, 0),
}

// Fixed camera half-height (world units, 1mm = 2 units) used when actually
// entering a sketch — 400 gives a 400mm default view, comfortable framing for
// a ~300mm print-bed-sized part without inheriting whatever zoom level the
// general 3D orbit view happens to be at (which can be zoomed out much
// further, e.g. its own default of 900 — see the camera setup below — making
// mouse drags in the 2D sketch profile correspond to huge, unusable mm
// distances if the sketch view just reused it unchanged).
const SKETCH_FRUST_H = 400

const TWEEN_MS = 420   // animation duration in milliseconds

// ── Catmull-Rom ───────────────────────────────────────────────────────────────

function catmullRomPt(p0, p1, p2, p3, t) {
  const t2=t*t, t3=t2*t
  return {
    x: 0.5*(2*p1.x+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y: 0.5*(2*p1.y+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
  }
}
function sampleSpline(pts, closed, seg=16) {
  if (pts.length<2) return pts
  const result=[], n=pts.length
  const ext=closed?[pts[n-1],...pts,pts[0],pts[1]]:[pts[0],...pts,pts[n-1]]
  const segCount=closed?n:n-1
  for (let i=0;i<segCount;i++) {
    const [p0,p1,p2,p3]=[ext[i],ext[i+1],ext[i+2],ext[i+3]]
    for (let j=0;j<seg;j++) result.push(catmullRomPt(p0,p1,p2,p3,j/seg))
  }
  if (closed) result.push(result[0]); else result.push(pts[n-1])
  return result
}

// ── material factory ──────────────────────────────────────────────────────────
// Sketch geometry is rendered as "halo" lines (a wide white outline behind a
// thin colored core) so it stays visible whether it's sitting on a white
// workplane, a saturated blue extrude face, or a shaded/dark solid face.
// Plain THREE.Line ignores linewidth on most GPUs/browsers (a long-standing
// WebGL limitation), so real pixel-width control needs the Line2/LineMaterial
// fat-line module. LINE_RESOLUTION is a shared, mutable Vector2 — every
// LineMaterial references the SAME object, so updating it once (on resize)
// updates every line's resolution without having to track/traverse them all.
const LINE_RESOLUTION = new THREE.Vector2(800, 600)

function flattenPts3(pts) {
  const arr = []
  pts.forEach(p => arr.push(p.x, p.y, p.z))
  return arr
}

function makeHaloLine(pts, color, style) {
  const positions = flattenPts3(pts)
  // LineMaterial's dash support is a single uniform dash+gap cycle, not a true
  // alternating dash-dot pattern — 'axis' just uses a distinct dark color +
  // dashing instead of fighting the shader for an exact centerline look.
  const isDashed = style === 'dashed' || style === 'axis'
  const coreColor = style === 'construction' ? 0x888888 : style === 'axis' ? 0x222222 : color

  const haloGeo = new LineGeometry(); haloGeo.setPositions(positions)
  const haloMat = new LineMaterial({
    color: 0xffffff, linewidth: 4, worldUnits: false,
    depthTest: false, transparent: true, opacity: 0.85,
    resolution: LINE_RESOLUTION,
  })
  const halo = new Line2(haloGeo, haloMat)
  halo.computeLineDistances(); halo.renderOrder = 5

  const coreGeo = new LineGeometry(); coreGeo.setPositions(positions)
  const coreMat = new LineMaterial({
    color: coreColor, linewidth: 1.6, worldUnits: false,
    depthTest: false, transparent: true, opacity: 1.0,
    dashed: isDashed, dashScale: 4, dashSize: isDashed ? 2 : 1, gapSize: isDashed ? 1 : 1,
    resolution: LINE_RESOLUTION,
  })
  const core = new Line2(coreGeo, coreMat)
  core.computeLineDistances(); core.renderOrder = 6

  const group = new THREE.Group()
  group.add(halo, core)
  return group
}

/** Sets opacity on both the halo and core lines of a group built by makeHaloLine. */
function setHaloOpacity(group, opacity) {
  group.traverse(obj => { if (obj.material) obj.material.opacity = opacity })
}

// ── geometry builders ─────────────────────────────────────────────────────────
// pt2three converts a 2D sketch point to a 3D world Vector3 for the entity's plane.

function pt2three(sx, sy, plane, facePlane) {
  if (plane === 'face' && facePlane && facePlane.sketchToWorld) {
    return facePlane.sketchToWorld(sx, sy)
  }
  switch(plane) {
    case 'XZ': return new THREE.Vector3(sx,  0, -sy)
    case 'YZ': return new THREE.Vector3(0,  sx, -sy)
    default:   return new THREE.Vector3(sx, -sy,  0)
  }
}

/** Small sphere at each line endpoint */
function buildEndpoint(x, y, plane, facePlane) {
  const pos = pt2three(x, y, plane, facePlane)
  const geo = new THREE.SphereGeometry(3, 8, 8)
  const mat = new THREE.MeshBasicMaterial({
    color:0x111111, depthTest:false,
    transparent:true, opacity:1.0,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.copy(pos)
  mesh.renderOrder = 6
  return mesh
}

function buildFill(pts, plane, facePlane, color=0xaaccff) {
  if (pts.length < 3) return null
  const shape = new THREE.Shape()
  shape.moveTo(pts[0].x, pts[0].y)
  pts.slice(1).forEach(p => shape.lineTo(p.x, p.y))
  shape.closePath()
  // Letters with a counter (O/A/8/etc.) come from detectProfiles with a
  // `.holes` array of inner contours — punch them out so the fill preview
  // doesn't show a solid blob where the letter should have a hole.
  ;(pts.holes || []).forEach(holePts => {
    if (holePts.length < 3) return
    const holePath = new THREE.Path()
    holePath.moveTo(holePts[0].x, holePts[0].y)
    holePts.slice(1).forEach(p => holePath.lineTo(p.x, p.y))
    holePath.closePath()
    shape.holes.push(holePath)
  })
  const geo = new THREE.ShapeGeometry(shape)
  // ShapeGeometry lives in local XY. Transform to correct world plane.
  // pt2three maps (sx,sy) → world, so we must match that exactly.
  switch(plane) {
    case 'XZ':
      // pt2three XZ: Vector3(sx, 0, -sy)
      // ShapeGeometry: vertex (x,y,0) → world (x, 0, -y) = rotate -90° around X, flip Z
      geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1))        // flip Z so -y→+z
      geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI/2))  // lay flat on XZ
      break
    case 'YZ': {
      // pt2three YZ: Vector3(0, sx, -sy)
      // ShapeGeometry vertex (x,y,0) → world (0, x, -y). A rotation around Y
      // can never produce this — Y-axis rotation always leaves the Y
      // component untouched, but the target needs local X to land in world
      // Y, which only a rotation with a DIFFERENT axis can do. (The old
      // makeScale+makeRotationY here silently produced world (0, y, -x)
      // instead — x/y swapped — rendering the closed-profile fill preview
      // as a point-reflection of the actual sketch through the origin.)
      // rotateX(-90°) maps local (x,y,0) -> (x,0,-y); rotateZ(+90°) then
      // swaps that x into the Y slot, landing on the correct (0,x,-y).
      geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI/2))
      geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI/2))
      break
    }
    case 'face':
      if (facePlane) {
        geo.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1))      // un-flip sketch Y
        const mat4 = new THREE.Matrix4().makeBasis(facePlane.uAxis, facePlane.vAxis, facePlane.normal)
        geo.applyMatrix4(mat4)
        geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
          facePlane.origin.x, facePlane.origin.y, facePlane.origin.z
        ))
      }
      break
    default: // XY
      // pt2three XY: Vector3(sx, -sy, 0) — sketch Y is flipped
      geo.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1))        // un-flip Y
      break
  }
  const mat = new THREE.MeshBasicMaterial({
    color, transparent:true, opacity:0.20,
    side:THREE.DoubleSide, depthTest:false, depthWrite:false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 4
  return mesh
}

function buildLine(l, color=0x111111) {
  const p=l.plane, fp=l.facePlane
  return makeHaloLine([pt2three(l.x1,l.y1,p,fp),pt2three(l.x2,l.y2,p,fp)], color, l.style)
}
function buildCircle(c, color=0xffdd44) {
  const p=c.plane, fp=c.facePlane, SEG=64, pts=[]
  for (let i=0;i<=SEG;i++){const a=(i/SEG)*Math.PI*2; pts.push(pt2three(c.cx+Math.cos(a)*c.r,c.cy+Math.sin(a)*c.r,p,fp))}
  return makeHaloLine(pts, color, c.style)
}
function buildArc(arc, color=0xffdd44) {
  const p=arc.plane, fp=arc.facePlane, SEG=64
  let start=arc.startAngle,end=arc.endAngle; if(end<start)end+=Math.PI*2
  const span=end-start, steps=Math.max(4,Math.round(SEG*span/(Math.PI*2))), pts=[]
  for (let i=0;i<=steps;i++){const a=start+(i/steps)*span; pts.push(pt2three(arc.cx+Math.cos(a)*arc.r,arc.cy+Math.sin(a)*arc.r,p,fp))}
  return makeHaloLine(pts, color, arc.style)
}
function buildSpline(sp, color=0xffdd44) {
  if (sp.points.length<2) return null
  const p=sp.plane, fp=sp.facePlane
  const sampled=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16)
  return makeHaloLine(sampled.map(s=>pt2three(s.x,s.y,p,fp)), color, sp.style)
}

// ── XY grid ───────────────────────────────────────────────────────────────────

function buildGrid(step=10, half=5000) {
  const group=new THREE.Group(); group.renderOrder=0
  const minorPts=[]
  for (let v=-half;v<=half;v+=step) {
    minorPts.push(new THREE.Vector3(-half,v,0),new THREE.Vector3(half,v,0))
    minorPts.push(new THREE.Vector3(v,-half,0),new THREE.Vector3(v,half,0))
  }
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(minorPts),
    new THREE.LineBasicMaterial({color:0xc8c8d4,transparent:true,opacity:0.4,depthTest:false})
  ))
  const majorPts=[], mstep=step*5
  for (let v=-half;v<=half;v+=mstep) {
    majorPts.push(new THREE.Vector3(-half,v,0),new THREE.Vector3(half,v,0))
    majorPts.push(new THREE.Vector3(v,-half,0),new THREE.Vector3(v,half,0))
  }
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(majorPts),
    new THREE.LineBasicMaterial({color:0xa0a0b8,transparent:true,opacity:0.6,depthTest:false})
  ))
  const ax=200
  const xa=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-ax,0,0),new THREE.Vector3(ax,0,0)]),new THREE.LineBasicMaterial({color:0x662222,depthTest:false})); xa.renderOrder=1; group.add(xa)
  const ya=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-ax,0),new THREE.Vector3(0,ax,0)]),new THREE.LineBasicMaterial({color:0x226622,depthTest:false})); ya.renderOrder=1; group.add(ya)
  return group
}

// ── component ─────────────────────────────────────────────────────────────────

const Viewport3D = forwardRef(function Viewport3D(props, ref) {
  const {
    width, height,
    lines=[], circles=[], arcs=[], splines=[],
    solids=[],
    features=[],          // committed sketch features for rendering
    activeSketchId=null,  // id of sketch being edited (others rendered greyed)
    style: cssProp,
    cursor,
    onClick, onDoubleClick, onContextMenu,
    onMouseMove, onMouseDown, onMouseUp,
    onScaleChange,
    onPlaneClick,
    onFaceClick,          // called with FacePlane when a solid face is clicked
    sketchArmed = false,
    // true while sketchArmed's face-pick is for Export Face DXF rather than
    // starting a sketch — swaps the hover label and skips the bottom-edge
    // preview line, which previews sketch orientation and has no meaning here.
    dxfPickMode = false,
    extrudeArmed   = false,  // true once a profile is picked (Phase 2/3) — see extrudeArmedRef
    showWorkPlanes = true,
    activePlane    = null,
    sketchMode     = false,
    gridVisible    = false,  // 3D-mode reference grid toggle — see the GRID toolbar button in App3D.jsx
    gridSizeMm     = 5,      // minor grid line spacing — mirrors the grid-size dropdown in App3D.jsx
    extrudeTool    = null,   // 'extrude'|'cutout' — bypasses work plane click
    filletActive   = false,  // true while the fillet edge-pick tool is active
    measureActive  = false,  // true while the measure tool is active (reuses fillet's edge-highlight machinery, see measureActiveRef)
  } = props

  const mountRef   = useRef(null)
  const overlayRef       = useRef(null)
  const extrudePreviewRef = useRef(null)
  const stateRef   = useRef(null)
  const activePlaneInternalRef = useRef(null)
  const overlayRedrawRef = useRef(null)
  // Face hover state
  const hoveredFaceRef   = useRef(null)  // { mesh, origMat }
  const sketchArmedRef   = useRef(false)
  const dxfPickModeRef   = useRef(false)
  // Extrude/cutout Phase 2/3 (a profile is picked, awaiting the commit
  // click) — see the work-plane hover/click gates below for why this is
  // tracked separately from sketchArmedRef (that one also covers the
  // legitimate "no tool active, click a bare work plane to start a fresh
  // sketch" case, which must NOT be blocked the way Phase 2/3 needs to be).
  const extrudeArmedRef  = useRef(false)
  // Tab-cycled bottom-edge override (see cycleFaceBottomEdge) — null means
  // "follow the cursor" (previewBottomEdge), a number is an index into that
  // face's faceBoundarySegments() list. Reset whenever the hovered face's
  // normal drifts (moved to a genuinely different face) or hover is cleared.
  const tabEdgeIndexRef  = useRef(null)
  const tabEdgeNormalRef = useRef(null)
  // Fillet edge highlight state — drawn every frame in animate() (reprojected
  // fresh each frame so it tracks camera orbit/zoom, same convention as the
  // face-hover highlight below). Two separate refs: the edge currently under
  // the mouse (set by raycastSolidEdges), and the full multi-edge selection
  // set (set by setSelectedEdges) — drawn in different colors so hover vs.
  // "already picked" reads clearly, same distinction the 2D tools' selection
  // highlighting already makes (isXxxHov vs isXxxSel).
  const hoverEdgeHighlightRef    = useRef(null)  // { points: number[], matrixWorld } | null
  const selectedEdgeHighlightsRef = useRef([])   // [{ points: number[], matrixWorld }]
  const filletActiveRef  = useRef(false)
  const measureActiveRef = useRef(false)
  // Whole-solid highlight (Mirror tool step 1: "this is the solid you're
  // about to mirror") — tracks the currently-glowing mesh so it can be reset
  // before highlighting a different one, or cleared outright.
  const highlightedSolidMeshRef = useRef(null)
  // Mirror tool step 1, cutout source specifically: a cutout is often a small
  // detail on a large body, so glowing the whole solid is less useful than
  // showing exactly where the cutout itself sits — a flat outline+fill at the
  // cutout's own entry plane, reprojected every frame like the other overlay
  // highlights. World-space THREE.Vector3[] | null.
  const highlightedProfileRef = useRef(null)
  // Join tool: every currently-selected member solid glows at once (unlike
  // Mirror's single highlightSolid, Join is a multi-select) — array of
  // faceMesh objects, same reset-to-black-emissive convention as highlightSolid.
  const highlightedJoinMeshesRef = useRef([])

  // ── init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return

    const renderer = new THREE.WebGLRenderer({ antialias:true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    renderer.setClearColor(0xffffff, 1)
    LINE_RESOLUTION.set(width, height)
    EDGE_LINE_RESOLUTION.set(width, height)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.top      = '0'
    renderer.domElement.style.left     = '0'
    renderer.domElement.style.width    = '100%'
    renderer.domElement.style.height   = '100%'
    mount.insertBefore(renderer.domElement, mount.firstChild)

    const scene  = new THREE.Scene()
    // frustH is the camera's half-height in world units (1mm = 2 units, same
    // scale cadMesh.js uses for solids) — 900 gives a 900mm total default
    // vertical view, comfortable padding around the 300mm work planes so they
    // don't dominate the screen before any part is modeled (zoomToFit ignores
    // the work planes entirely and only frames actual geometry, so an empty
    // scene always shows this default, unadjusted).
    const aspect = width/height, frustH=900
    const camera = new THREE.OrthographicCamera(
      -frustH*aspect, frustH*aspect, frustH, -frustH, -10000, 10000
    )
    // Start in isometric view
    camera.position.set(400, -350, 350)
    camera.lookAt(0, 0, 0)
    camera.up.set(0, 0, 1)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.screenSpacePanning=true; controls.enableDamping=true; controls.dampingFactor=0.12
    controls.zoomSpeed=1.2; controls.rotateSpeed=0.6
    // LEFT is left unbound (null) deliberately — it used to be PAN, but since
    // OrbitControls listens on the same canvas element sketch tools draw over,
    // a left-drag triggered camera pan AND the tool's own drag logic (e.g.
    // Select's drag-select/drag-handle) at the same time, and the camera pan
    // visually won. Freeing LEFT entirely is what actually fixes drag-select.
    // MIDDLE is ROTATE, which OrbitControls itself automatically swaps to PAN
    // when Shift (or Ctrl/Meta) is held during mousedown — built into its own
    // onMouseDown switch, no extra listeners needed (and adding our own would
    // double-apply the shiftKey check and invert the result). RIGHT stays
    // ROTATE too, harmless alongside every tool's right-click-to-accept (a
    // plain click doesn't drag, so no camera movement happens before the
    // app's own contextmenu handler fires). Scroll wheel already dollies by
    // default, independent of this mapping.
    controls.mouseButtons={ LEFT:null, MIDDLE:THREE.MOUSE.ROTATE, RIGHT:THREE.MOUSE.ROTATE }

    const grid = buildGrid()
    grid.visible = false   // hidden by default — white background, no grid
    scene.add(grid)
    const geomGroup   = new THREE.Group(); scene.add(geomGroup)
    const solidsGroup = new THREE.Group(); scene.add(solidsGroup)

    // Lighting for solid meshes. Higher ambient + softer directional keeps shadowed
    // faces from going too dark (which was eating the blue/red hue and the contrast
    // against the black edge outlines) while still showing enough shading to read as 3D.
    const ambient = new THREE.AmbientLight(0xffffff, 0.85)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.55)
    dirLight.position.set(400, 600, 800)
    scene.add(ambient, dirLight)

    const plane     = new THREE.Plane(new THREE.Vector3(0,0,1), 0)
    const raycaster = new THREE.Raycaster()
    const workPlanes = createWorkPlanes(scene)

    // Generic square plane indicator shown while hovering a face armed for
    // sketching — same visual language as the XY/YZ/XZ work planes above, but
    // fixed-size and oriented to the hovered face's normal instead of a scene
    // axis. Deliberately NOT shaped to the actual face boundary (a cylinder's
    // circular top, a slot's rounded rectangle, etc.) — a neutral square reads
    // as "this defines your sketch plane" the same way regardless of the
    // underlying face's real shape, matching how the axis work planes already
    // communicate that idea.
    const FACE_INDICATOR_SIZE = 60   // half-size, world units
    const facePlaneIndicator = new THREE.Group()
    facePlaneIndicator.visible = false
    facePlaneIndicator.renderOrder = 4
    {
      const S = FACE_INDICATOR_SIZE
      const fillGeo = new THREE.PlaneGeometry(S*2, S*2)
      // Opacity bumped well above the axis work planes' hover-state 0.14 —
      // this sits directly on a solid whose own material is a similar blue
      // hue, so the same opacity that reads clearly against the plain
      // white/gray background behind the work planes was nearly invisible
      // here (verified: correct position/orientation/visible=true in the
      // scene graph, but not perceptible in a screenshot at 0.16).
      const fillMat = new THREE.MeshBasicMaterial({
        color: 0x64aaff, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      })
      facePlaneIndicator.add(new THREE.Mesh(fillGeo, fillMat))
      // Plain THREE.Line/LineBasicMaterial ignores linewidth on most
      // GPUs/browsers (same WebGL limitation cadMesh.js's solid-edge
      // rendering already works around) — use the Line2/LineMaterial fat-line
      // module instead for a border that's actually visible at 1x zoom.
      const corners = [
        -S,-S,0,  S,-S,0,  S,S,0,  -S,S,0,  -S,-S,0,
      ]
      const borderGeo = new LineGeometry()
      borderGeo.setPositions(corners)
      const borderMat = new LineMaterial({
        color: 0x64aaff, linewidth: 2, worldUnits: false,
        transparent: true, opacity: 0.95, depthTest: false,
        resolution: LINE_RESOLUTION,
      })
      const border = new Line2(borderGeo, borderMat)
      border.computeLineDistances()
      facePlaneIndicator.add(border)
    }
    scene.add(facePlaneIndicator)

    // Tween state — stored on stateRef so the RAF loop can access it
    const tween = {
      active:   false,
      startMs:  0,
      fromPos:  new THREE.Vector3(),
      fromUp:   new THREE.Vector3(),
      fromTgt:  new THREE.Vector3(),
      toPos:    new THREE.Vector3(),
      toUp:     new THREE.Vector3(),
      toTgt:    new THREE.Vector3(),
      onDone:   null,
    }

    stateRef.current = {
      renderer, scene, camera, controls,
      geomGroup, solidsGroup, raycaster, plane, workPlanes,
      facePlaneIndicator,
      grid,   // for hide/show in sketch mode
      tween,
      savedPos: null, savedUp: null, savedTgt: null,
    }

    controls.addEventListener('change', () => {
      if (onScaleChange && stateRef.current) {
        const {camera:c}=stateRef.current
        const ph = mountRef.current?.clientHeight || height
        const fh = (c.top - c.bottom) / c.zoom
        onScaleChange(ph / fh)
      }
      if (props.onViewChange) props.onViewChange()
    })

    if (onScaleChange) {
      const fh=(camera.top-camera.bottom)/camera.zoom
      const ph=mountRef.current?.clientHeight||height
      onScaleChange(ph/fh)
    }

    let animId
    function animate(now) {
      animId = requestAnimationFrame(animate)

      // Draw face hover highlight on overlay (only when NOT in sketch mode)
      const hf = hoveredFaceRef.current
      const oc = overlayRef.current
      const inSketchMode = !!activePlaneInternalRef.current
      // Default to hidden every frame; only the sketch-armed-and-hovering path
      // below turns it back on — guarantees it never lingers from a stale
      // frame no matter which branch below runs (or doesn't).
      facePlaneIndicator.visible = false
      if (oc && hf?.hit && !inSketchMode) {
        const ctx2 = oc.getContext('2d')
        ctx2.setTransform(1,0,0,1,0,0)
        if (sketchArmedRef.current) {
          ctx2.clearRect(0,0,oc.width,oc.height)
          const geo = hf.mesh.geometry
          const face = hf.hit.face
          if (face && geo.attributes.position) {
            const faceNormal = getHoveredFaceNormal(hf)
            const rect2 = mountRef.current?.getBoundingClientRect()
            const W = rect2?.width || oc.width
            const H = rect2?.height || oc.height
            const cam = stateRef.current.camera

            // Position/orient the generic square indicator on the hovered
            // face — a cheap local basis from the normal alone (not the real
            // sketch uAxis/vAxis FacePlane.js derives from the nearest
            // boundary edge, which needs an expensive full boundary-loop
            // extraction; a preview square doesn't care which edge ends up
            // "bottom", so it doesn't need that cost paid every frame).
            const refAxis = Math.abs(faceNormal.x) < 0.9
              ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,0,1)
            const uAxis = refAxis.clone().addScaledVector(faceNormal, -refAxis.dot(faceNormal)).normalize()
            const vAxis = new THREE.Vector3().crossVectors(faceNormal, uAxis).normalize()
            facePlaneIndicator.position.copy(hf.hit.point).addScaledVector(faceNormal, 0.5)
            facePlaneIndicator.quaternion.setFromRotationMatrix(
              new THREE.Matrix4().makeBasis(uAxis, vAxis, faceNormal))
            facePlaneIndicator.visible = true

            // If Tab-cycling (cycleFaceBottomEdge) picked an edge, that overrides
            // the cursor-nearest one — but only while still on the same face; a
            // normal that's drifted means the mouse moved to a genuinely
            // different face, so fall back to cursor-tracking for it.
            if (tabEdgeIndexRef.current !== null &&
                (!tabEdgeNormalRef.current || tabEdgeNormalRef.current.dot(faceNormal) < 0.999)) {
              tabEdgeIndexRef.current = null
            }

            // Preview which boundary edge is nearest the cursor right now (or,
            // if Tab-cycled, whichever edge that selected) — this is the edge
            // that will become the sketch's bottom/horizontal reference if the
            // face is clicked now (see FacePlane.js's faceHitToPlane, which
            // picks the same edge — or honors the same override — at click time).
            // Meaningless for a flat DXF export (no sketch orientation involved),
            // so skip it in dxfPickMode.
            if (!dxfPickModeRef.current) {
              let bottomEdge
              if (tabEdgeIndexRef.current !== null) {
                const segs = faceBoundarySegments({ object: hf.mesh, point: hf.hit.point }, faceNormal)
                bottomEdge = segs.length ? segs[tabEdgeIndexRef.current % segs.length] : null
              } else {
                bottomEdge = previewBottomEdge({ object: hf.mesh, point: hf.hit.point }, faceNormal)
              }
              if (bottomEdge) {
                const toScreenWorld = v => {
                  const p = v.clone().project(cam)
                  return { x:(p.x+1)/2*W, y:(-p.y+1)/2*H }
                }
                const bp1 = toScreenWorld(bottomEdge.a)
                const bp2 = toScreenWorld(bottomEdge.b)
                ctx2.beginPath()
                ctx2.moveTo(bp1.x, bp1.y)
                ctx2.lineTo(bp2.x, bp2.y)
                ctx2.strokeStyle = '#4caf50'
                ctx2.lineWidth = 4
                ctx2.lineCap = 'round'
                ctx2.stroke()
              }
            }

            // Label at the cursor's hit point (the square indicator has no
            // per-triangle screen-space centroid to derive one from anymore)
            const hitScreen = hf.hit.point.clone().project(cam)
            const cx = (hitScreen.x+1)/2*W, cy = (-hitScreen.y+1)/2*H
            ctx2.fillStyle = '#fff'
            ctx2.font = 'bold 12px monospace'
            ctx2.textAlign = 'center'
            ctx2.fillText(dxfPickModeRef.current ? 'click to export' : 'click to sketch', cx, cy-8)
          }
        }
      } else if (oc && sketchArmedRef.current && !hf && !inSketchMode) {
        // Clear face highlight when not hovering
        const ctx2 = oc.getContext('2d')
        ctx2.setTransform(1,0,0,1,0,0)
        ctx2.clearRect(0,0,oc.width,oc.height)
      }

      // ── Fillet tool: highlight selected edges (orange) + hovered edge (yellow) ──
      // Reprojected fresh every frame (not a one-time draw) so it tracks camera
      // orbit/zoom exactly like the face-hover highlight above. Mutually
      // exclusive with sketchArmed/sketch-mode's use of this same canvas —
      // fillet3d never sets sketchArmed — so the two never fight over clearing.
      if (oc && (filletActiveRef.current || measureActiveRef.current)) {
        const ctx3 = oc.getContext('2d')
        ctx3.setTransform(1,0,0,1,0,0)
        ctx3.clearRect(0,0,oc.width,oc.height)
        const rect3 = mountRef.current?.getBoundingClientRect()
        const W = rect3?.width || oc.width
        const H = rect3?.height || oc.height
        const cam = stateRef.current.camera

        const drawEdge = (eh, color) => {
          if (!eh?.points || eh.points.length < 6) return
          const mw = eh.matrixWorld
          const toScreen = (x,y,z) => {
            const v = new THREE.Vector3(x,y,z).applyMatrix4(mw).project(cam)
            return { x:(v.x+1)/2*W, y:(-v.y+1)/2*H }
          }
          ctx3.beginPath()
          for (let i=0; i<eh.points.length; i+=6) {
            const p1 = toScreen(eh.points[i],   eh.points[i+1], eh.points[i+2])
            const p2 = toScreen(eh.points[i+3], eh.points[i+4], eh.points[i+5])
            ctx3.moveTo(p1.x, p1.y)
            ctx3.lineTo(p2.x, p2.y)
          }
          ctx3.strokeStyle = color
          ctx3.lineWidth = 4
          ctx3.lineCap = 'round'
          ctx3.stroke()
        }

        // Measure gets its own cyan pair instead of fillet's orange/yellow —
        // the two tools are never active at once, but a distinct color keeps
        // "picked an edge to measure" visually different from "picked an
        // edge to fillet" if a screenshot/memory of one is compared later.
        const selColor = measureActiveRef.current ? '#4FC3F7' : '#ff9800'
        const hovColor = measureActiveRef.current ? '#84FFFF' : '#ffe14d'
        for (const sel of selectedEdgeHighlightsRef.current) drawEdge(sel, selColor)

        // Skip drawing the hover highlight if it's the same edge already in
        // the selected set — otherwise it'd just paint yellow over the
        // orange, masking the "already picked" cue.
        const hov = hoverEdgeHighlightRef.current
        const hovAlreadySelected = hov && selectedEdgeHighlightsRef.current.some(
          s => s.solidId === hov.solidId && s.edgeId === hov.edgeId)
        if (hov && !hovAlreadySelected) drawEdge(hov, hovColor)
      }

      // ── Mirror tool: cutout-source profile highlight (see highlightCutoutFace) ──
      if (oc && highlightedProfileRef.current?.length >= 3) {
        const ctx4 = oc.getContext('2d')
        const rect4 = mountRef.current?.getBoundingClientRect()
        const W = rect4?.width || oc.width
        const H = rect4?.height || oc.height
        const cam = stateRef.current.camera
        const toScreen = v => {
          const p = v.clone().project(cam)
          return { x:(p.x+1)/2*W, y:(-p.y+1)/2*H }
        }
        const screenPts = highlightedProfileRef.current.map(toScreen)
        ctx4.beginPath()
        ctx4.moveTo(screenPts[0].x, screenPts[0].y)
        for (let i=1; i<screenPts.length; i++) ctx4.lineTo(screenPts[i].x, screenPts[i].y)
        ctx4.closePath()
        ctx4.fillStyle = 'rgba(77,217,236,0.35)'
        ctx4.fill()
        ctx4.strokeStyle = '#4dd9ec'
        ctx4.lineWidth = 2.5
        ctx4.stroke()
      }

      // ── tween tick ──
      const tw = stateRef.current?.tween
      if (tw?.active) {
        const elapsed = now - tw.startMs
        const raw     = Math.min(elapsed / TWEEN_MS, 1)
        const t       = easeInOutCubic(raw)

        camera.position.lerpVectors(tw.fromPos, tw.toPos, t)
        camera.up.lerpVectors(tw.fromUp, tw.toUp, t).normalize()
        controls.target.lerpVectors(tw.fromTgt, tw.toTgt, t)
        camera.lookAt(controls.target)
        camera.updateProjectionMatrix()

        if (raw >= 1) {
          tw.active = false
          controls.enabled = true
          // Snap exactly to target to avoid float drift
          camera.position.copy(tw.toPos)
          camera.up.copy(tw.toUp).normalize()
          controls.target.copy(tw.toTgt)
          camera.lookAt(controls.target)
          controls.update()
          if (tw.onDone) { tw.onDone(); tw.onDone = null }
        }
      }

      controls.update()
      renderer.render(scene, camera)
    }
    animate(0)

    return () => {
      cancelAnimationFrame(animId); controls.dispose(); renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── resize ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const s=stateRef.current; if (!s) return
    const {renderer,camera}=s
    const aspect=width/height, frustH=(camera.top-camera.bottom)/2
    camera.left=-frustH*aspect; camera.right=frustH*aspect
    camera.top=frustH; camera.bottom=-frustH
    camera.updateProjectionMatrix(); renderer.setSize(width,height)
    LINE_RESOLUTION.set(width, height)
    EDGE_LINE_RESOLUTION.set(width, height)
    // LineMaterial's resolution setter COPIES the value in rather than keeping a
    // live reference, so already-built halo/edge lines need their resolution updated
    // explicitly here — mutating the shared resolution Vector2s alone only affects
    // materials constructed AFTER this point.
    s.geomGroup.traverse(obj => { if (obj.material?.isLineMaterial) obj.material.resolution.set(width, height) })
    s.solidsGroup.traverse(obj => { if (obj.material?.isLineMaterial) obj.material.resolution.set(width, height) })
  }, [width,height])

  // ── geometry sync ─────────────────────────────────────────────────────────

  useEffect(() => {
    const s=stateRef.current; if (!s) return
    const {geomGroup}=s
    geomGroup.traverse(obj=>{ if(obj.geometry)obj.geometry.dispose(); if(obj.material)obj.material.dispose() })
    geomGroup.clear()

    const lineColor = 0x111111

    // ── Render committed sketch features ──
    // Active sketch (being edited) is shown normally via working arrays below.
    // Other sketches shown at reduced opacity if one is active; hidden if !visible.
    features.forEach(feat => {
      if (feat.type !== 'sketch') return
      if (!feat.visible) return
      const isActive = feat.id === activeSketchId
      const dimmed = activeSketchId && !isActive
      const color = dimmed ? 0xaaaaaa : lineColor

      const fLines   = feat.lines   || []
      const fCircles = feat.circles || []
      const fArcs    = feat.arcs    || []
      const fSplines = feat.splines || []

      fLines  .forEach(l  => { const o=buildLine(l,color);   if(dimmed)setHaloOpacity(o,0.3); geomGroup.add(o) })
      fCircles.forEach(c  => { const o=buildCircle(c,color); if(dimmed)setHaloOpacity(o,0.3); geomGroup.add(o) })
      fArcs   .forEach(a  => { const o=buildArc(a,color);    if(dimmed)setHaloOpacity(o,0.3); geomGroup.add(o) })
      fSplines.forEach(sp => { const o=buildSpline(sp,color);if(o&&dimmed)setHaloOpacity(o,0.3); if(o)geomGroup.add(o) })

      // Closed shape fills for visible committed sketches
      if (!dimmed) {
        const planeId = feat.planeId || 'XY'
        const fp = feat.facePlane || null
        const profiles = detectProfiles(fLines, fArcs, planeId, fCircles, fSplines)
        profiles.forEach(pts => {
          const fill = buildFill(pts, planeId, fp, 0x6699ff)
          if (fill) geomGroup.add(fill)
        })
      }
    })

    // ── Render working arrays (current in-progress sketch) ──
    // ghostRef entries (Loft's previous-profile reference, see App3D.jsx's
    // injectLoftGhost) render dimmed, same treatment as an inactive committed
    // sketch above — they're a visual + snap reference only, not part of the
    // profile currently being drawn.
    const ghostColor = 0xaaaaaa
    lines  .forEach(l  => { const o=buildLine(l,   l.ghostRef?ghostColor:lineColor); if(l.ghostRef)setHaloOpacity(o,0.3); geomGroup.add(o) })
    circles.forEach(c  => { const o=buildCircle(c, c.ghostRef?ghostColor:lineColor); if(c.ghostRef)setHaloOpacity(o,0.3); geomGroup.add(o) })
    arcs   .forEach(a  => { const o=buildArc(a,    a.ghostRef?ghostColor:lineColor); if(a.ghostRef)setHaloOpacity(o,0.3); geomGroup.add(o) })
    splines.forEach(sp => { const o=buildSpline(sp,sp.ghostRef?ghostColor:lineColor); if(o&&sp.ghostRef)setHaloOpacity(o,0.3); if(o) geomGroup.add(o) })

    // Fills for working arrays. Include circles/splines' planes too — a
    // text-only sketch (no lines/arcs yet) would otherwise never get a fill
    // preview since wPlaneIds was derived only from lines/arcs. Ghost entries
    // excluded — they belong to a DIFFERENT (already-finished) loft profile,
    // not the one currently being sketched, so they must never merge into
    // its fill/profile detection.
    const ownLines   = lines  .filter(l=>!l.ghostRef)
    const ownCircles = circles.filter(c=>!c.ghostRef)
    const ownArcs    = arcs   .filter(a=>!a.ghostRef)
    const ownSplines = splines.filter(s=>!s.ghostRef)
    const wPlaneIds = [...new Set([
      ...ownLines.filter(l=>l.plane).map(l=>l.plane),
      ...ownArcs .filter(a=>a.plane).map(a=>a.plane),
      ...ownCircles.filter(c=>c.plane).map(c=>c.plane),
      ...ownSplines.filter(s=>s.plane).map(s=>s.plane),
    ])]
    wPlaneIds.forEach(pid => {
      const pLines   = ownLines  .filter(l=>l.plane===pid)
      const pArcs    = ownArcs   .filter(a=>a.plane===pid)
      const pCircles = ownCircles.filter(c=>c.plane===pid)
      const pSplines = ownSplines.filter(s=>s.plane===pid)
      const fp = pLines[0]?.facePlane || pArcs[0]?.facePlane || pCircles[0]?.facePlane || pSplines[0]?.facePlane || null
      const profiles = detectProfiles(pLines, pArcs, pid, pCircles, pSplines)
      profiles.forEach(pts => {
        const fill = buildFill(pts, pid, fp, 0x6699ff)
        if (fill) geomGroup.add(fill)
      })
    })
  }, [lines,circles,arcs,splines,features,activeSketchId])

  // ── solids sync ───────────────────────────────────────────────────────────

  useEffect(() => {
    const s=stateRef.current; if (!s?.solidsGroup) return
    const {solidsGroup}=s
    // Diff instead of dispose-everything-then-rebuild: a solid toggled
    // `hidden` keeps the SAME .group object (no new mesh built), so
    // blindly disposing every current child on every `solids` change would
    // free that group's GPU buffers, leaving it permanently blank the next
    // time it's un-hidden. Only dispose children whose solid is genuinely
    // gone or was actually rebuilt (a new .group reference).
    const liveGroups = new Set(solids.map(solid => solid.group).filter(Boolean))
    solidsGroup.children.slice().forEach(child => {
      if (liveGroups.has(child)) return
      child.traverse(obj => { if(obj.geometry) obj.geometry.dispose(); if(obj.material) obj.material.dispose() })
      solidsGroup.remove(child)
    })
    // Sync membership: hidden solids come out of the scene (raycasting,
    // zoomToFit etc. all just read solidsGroup.children, so this alone
    // makes a hidden body un-pickable everywhere for free); visible ones
    // go back in if they aren't already there.
    solids.forEach(solid => {
      if (!solid.group) return
      if (solid.hidden) {
        if (solid.group.parent === solidsGroup) solidsGroup.remove(solid.group)
      } else if (solid.group.parent !== solidsGroup) {
        solidsGroup.add(solid.group)
      }
    })
  }, [solids])

  // ── sketch mode: white background, grid follows the GRID toolbar toggle ───

  useEffect(() => {
    const s = stateRef.current; if (!s) return
    // Background always white
    s.renderer.setClearColor(0xffffff, 1)
    // Grid is a 3D-mode reference aid only — always hidden in sketch mode
    // (which has its own 2D grid/snap), shown/hidden by GRID otherwise.
    if (s.grid) s.grid.visible = gridVisible && !sketchMode
  }, [sketchMode, gridVisible])

  // Rebuild the grid mesh whenever the grid-size dropdown changes so its
  // line spacing actually matches gridSizeMm (previously hardcoded).
  useEffect(() => {
    const s = stateRef.current; if (!s?.scene) return
    if (s.grid) {
      s.scene.remove(s.grid)
      s.grid.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.() })
    }
    const grid = buildGrid(mmToPx(gridSizeMm))
    grid.visible = gridVisible && !sketchMode
    s.scene.add(grid)
    s.grid = grid
  }, [gridSizeMm])

  // ── work planes ───────────────────────────────────────────────────────────

  useEffect(() => {
    const s=stateRef.current; if (!s?.workPlanes) return
    setWorkPlanesVisible(s.workPlanes, showWorkPlanes)
    // Clear hover state when hiding planes (entering sketch mode)
    if (!showWorkPlanes) {
      hoveredPlaneRef.current = null
      setPlaneHover(s.workPlanes, null)
    }
  }, [showWorkPlanes])

  useEffect(() => {
    const s=stateRef.current; if (!s?.workPlanes) return
    activePlaneInternalRef.current = activePlane
    setPlaneActive(s.workPlanes, typeof activePlane === 'string' ? activePlane : null)
    // Switch the raycasting plane to match the active sketch plane
    if (!activePlane) {
      s.plane.set(new THREE.Vector3(0,0,1), 0)
    } else if (typeof activePlane === 'object' && activePlane.threePlane) {
      // FacePlane — use its THREE.Plane directly
      s.plane.copy(activePlane.threePlane)
    } else if (SKETCH_PLANES[activePlane]) {
      s.plane.copy(SKETCH_PLANES[activePlane])
    }
  }, [activePlane])

  // ── plane hover ───────────────────────────────────────────────────────────

  const hoveredPlaneRef = useRef(null)
  const showWorkPlanesRef = useRef(true)
  const [isFaceHovered, setIsFaceHovered] = useState(false)
  useEffect(() => { showWorkPlanesRef.current = showWorkPlanes }, [showWorkPlanes])
  useEffect(() => {
    sketchArmedRef.current = sketchArmed
    if (!sketchArmed) tabEdgeIndexRef.current = null
  }, [sketchArmed])
  useEffect(() => { dxfPickModeRef.current = dxfPickMode }, [dxfPickMode])
  useEffect(() => { extrudeArmedRef.current = extrudeArmed }, [extrudeArmed])
  useEffect(() => {
    filletActiveRef.current = filletActive
    if (!filletActive) {
      hoverEdgeHighlightRef.current = null
      selectedEdgeHighlightsRef.current = []
    }
  }, [filletActive])
  useEffect(() => {
    measureActiveRef.current = measureActive
    if (!measureActive) {
      hoverEdgeHighlightRef.current = null
      selectedEdgeHighlightsRef.current = []
    }
  }, [measureActive])

  // Clear face hover highlight helper
  function clearFaceHover() {
    if (hoveredFaceRef.current) {
      hoveredFaceRef.current = null
      setIsFaceHovered(false)
    }
    tabEdgeIndexRef.current = null
  }

  function handleMouseMoveInternal(e) {
    const s = stateRef.current
    if (!s) { if (onMouseMove) onMouseMove(e); return }

    sketchArmedRef.current = sketchArmed
    extrudeArmedRef.current = extrudeArmed

    const el  = mountRef.current
    const rect = el ? el.getBoundingClientRect() : s.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    )
    s.raycaster.setFromCamera(ndc, s.camera)

    // ── Face hover (only when SKETCH tool is armed) ──
    if (sketchArmedRef.current && s.solidsGroup && !s.tween?.active) {
      const hits = s.raycaster.intersectObjects(s.solidsGroup.children, true)
      // Solid-edge overlays (LineSegments2) also report isMesh===true and now
      // raycast (for the fillet tool's edge picking) — exclude them here so
      // they can't shadow the real face mesh underneath during face-pick sketching.
      const meshHit = hits.find(h => h.object.isMesh && !h.object.userData?.isSolidEdge)
      const hitMesh = meshHit ? meshHit.object : null
      if (hitMesh) {
        // A solid's faces all live on ONE Mesh (see cadMesh.js) — refresh the
        // stored hit every move so it tracks the current face/point even while
        // sliding across the solid without the mesh identity ever changing
        // (only setIsFaceHovered is gated, to avoid a React re-render per move).
        if (!hoveredFaceRef.current) setIsFaceHovered(true)
        hoveredFaceRef.current = { mesh: hitMesh, hit: meshHit }
      } else if (hoveredFaceRef.current) {
        clearFaceHover()
      }
    } else if (!sketchArmedRef.current) {
      clearFaceHover()
    }

    // ── Work plane hover (disabled once an extrude/cutout profile is armed,
    // Phase 2/3 — NOT gated by sketchArmedRef, since that would also block
    // the legitimate "no tool active, click a bare work plane to start a
    // fresh sketch" flow, which isn't broken and shouldn't be touched).
    // Work planes have no occlusion check against solids and are huge (see
    // hitTestPlanes/WorkPlanes.js), so without this gate they'd keep
    // registering hover hits — and therefore eating the commit click, see
    // the click handler below — even when the cursor is visually over the
    // solid, not a plane. ──
    if (!extrudeArmedRef.current && s.workPlanes && showWorkPlanesRef.current && !s.tween?.active) {
      s.raycaster.setFromCamera(ndc, s.camera)
      const hit   = hitTestPlanes(s.raycaster, s.workPlanes)
      const newId = hit ? hit.id : null
      if (newId !== hoveredPlaneRef.current) {
        hoveredPlaneRef.current = newId
        setPlaneHover(s.workPlanes, newId)
      }
    } else if (extrudeArmedRef.current && hoveredPlaneRef.current) {
      hoveredPlaneRef.current = null
      setPlaneHover(s.workPlanes, null)
    }

    if (onMouseMove) onMouseMove(e)
  }

  function handleClickInternal(e) {
    const s = stateRef.current
    sketchArmedRef.current = sketchArmed  // sync immediately
    extrudeArmedRef.current = extrudeArmed

    // ── Face click (sketch armed + face hovered) ──
    if (sketchArmedRef.current && hoveredFaceRef.current && onFaceClick && !s?.tween?.active) {
      const hitWithRay = {
        ...hoveredFaceRef.current.hit,
        ray: s.raycaster.ray.clone(),  // store ray so FacePlane can orient normal toward camera
      }
      // Honor a Tab-cycled bottom-edge choice (see cycleFaceBottomEdge) instead
      // of re-deriving nearest-to-click-point — otherwise clicking would silently
      // discard whatever edge was cycled to, since the click position itself
      // rarely sits right on that edge.
      let overrideEdge = null
      if (tabEdgeIndexRef.current !== null) {
        const hf = hoveredFaceRef.current
        const normal = getHoveredFaceNormal(hf)
        const segs = faceBoundarySegments({ object: hf.mesh, point: hf.hit.point }, normal)
        overrideEdge = segs.length ? segs[tabEdgeIndexRef.current % segs.length] : null
      }
      const facePlane = faceHitToPlane(hitWithRay, overrideEdge)
      if (facePlane) {
        // FacePlane itself has no notion of which solid it came from — stamp
        // it on for callers (Export Face DXF) that need to identify the solid,
        // not just the plane geometry.
        facePlane.solidId = findOwningSolidId(hitWithRay.object)
        // facePlane.origin is the coplanar-vertex CENTROID of the whole face
        // (for sketch placement) — on a face with a hole (or any non-convex
        // boundary) that centroid can land inside the cut-out, off the actual
        // material, which then fails a FaceFinder pick server-side. The raw
        // click point is always ON the surface, so callers that need a real
        // surface point (Export Face DXF) should use this instead of origin.
        facePlane.point = hitWithRay.point.clone()
        clearFaceHover()
        onFaceClick(facePlane)
        return
      }
    }

    // ── Work plane click (same extrudeArmedRef gate as hover above — belt
    // and suspenders in case hoveredPlaneRef is still set from a moment ago) ──
    if (!extrudeArmedRef.current && s?.workPlanes && showWorkPlanesRef.current && hoveredPlaneRef.current && !s.tween?.active) {
      const entry = s.workPlanes[hoveredPlaneRef.current]
      if (entry && onPlaneClick) {
        onPlaneClick({ id: entry.def.id, def: entry.def })
        return
      }
    }

    if (onClick) onClick(e)
  }

  // ── imperative API ────────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({

    // screenToWorld: if a sketch plane is active, automatically returns sketch-space
    // coords for that plane. App3D just calls screenToWorld() for everything.
    screenToWorld(clientX, clientY) {
      const s=stateRef.current; if (!s) return {x:0,y:0}
      const {camera,raycaster,plane}=s
      const el   = mountRef.current
      const rect = el ? el.getBoundingClientRect() : s.renderer.domElement.getBoundingClientRect()
      const ndc=new THREE.Vector2(
        ((clientX-rect.left)/rect.width)*2-1,
        ((clientY-rect.top)/rect.height)*-2+1,
      )
      raycaster.setFromCamera(ndc,camera)
      const hit=new THREE.Vector3()
      raycaster.ray.intersectPlane(plane,hit)
      const pid=activePlaneInternalRef.current
      // FacePlane object: use its own worldToSketch transform
      if (pid && typeof pid === 'object' && pid.worldToSketch) {
        return pid.worldToSketch(hit)
      }
      switch(pid) {
        case 'XZ': return { x:  hit.x, y: -hit.z }
        case 'YZ': return { x:  hit.y, y: -hit.z }
        default:   return { x:  hit.x, y: -hit.y }
      }
    },

    screenToSketch(clientX, clientY, planeId) {
      return this.screenToWorld(clientX, clientY)
    },

    // Convert a 2D sketch-space point to screen pixel coords {x,y}.
    // Used by extrude tool to find which profile centroid is nearest to click.
    sketchToScreen(sx, sy, planeId, facePlane=null) {
      const s=stateRef.current; if (!s) return null
      const {camera}=s
      let worldPos
      if (facePlane && facePlane.sketchToWorld) {
        worldPos = facePlane.sketchToWorld(sx, sy)
      } else {
        switch(planeId) {
          case 'XZ': worldPos = new THREE.Vector3(sx, 0, -sy); break
          case 'YZ': worldPos = new THREE.Vector3(0, sx, -sy); break
          default:   worldPos = new THREE.Vector3(sx, -sy, 0); break
        }
      }
      const ndc = worldPos.clone().project(camera)
      const el = mountRef.current; if (!el) return null
      const rect = el.getBoundingClientRect()
      return {
        x: (ndc.x  + 1) / 2 * rect.width,
        y: (-ndc.y + 1) / 2 * rect.height,
      }
    },

    // Convert a 2D sketch-space point to a 3D world-space point {x,y,z} —
    // same transform as sketchToScreen but without the camera projection step.
    // Used for revolve preview math, which needs real 3D points to rotate
    // around an arbitrary axis before projecting each animation frame.
    sketchToWorld(sx, sy, planeId, facePlane=null) {
      if (facePlane && facePlane.sketchToWorld) {
        const w = facePlane.sketchToWorld(sx, sy)
        return { x: w.x, y: w.y, z: w.z }
      }
      switch(planeId) {
        case 'XZ': return { x: sx, y: 0, z: -sy }
        case 'YZ': return { x: 0, y: sx, z: -sy }
        default:   return { x: sx, y: -sy, z: 0 }
      }
    },
      // Force-raycast onto a specific plane regardless of active sketch plane.
    screenToSketchForPlane(clientX, clientY, planeId) {
      const ndc=new THREE.Vector2(
        ((clientX-rect.left)/rect.width)*2-1,
        ((clientY-rect.top)/rect.height)*-2+1,
      )
      raycaster.setFromCamera(ndc,camera)
      const hit=new THREE.Vector3()
      const targetPlane = SKETCH_PLANES[planeId] || SKETCH_PLANES.XY
      raycaster.ray.intersectPlane(targetPlane, hit)
      switch(planeId) {
        case 'XZ': return { x: hit.x,  y: -hit.z }
        case 'YZ': return { x: hit.y,  y: -hit.z }
        default:   return { x: hit.x,  y: -hit.y }
      }
    },

    zoomToFit() {
      const s=stateRef.current; if (!s) return
      const {camera,controls,geomGroup,solidsGroup}=s
      // Frames whatever's actually visible — sketch geometry AND committed
      // solids, whichever groups are non-empty. Previously only measured
      // geomGroup (the sketch-line objects), so outside sketch mode — where
      // that group is empty — this silently did nothing; solidsGroup was
      // never considered at all.
      const box=new THREE.Box3()
      box.union(new THREE.Box3().setFromObject(geomGroup))
      if (solidsGroup) box.union(new THREE.Box3().setFromObject(solidsGroup))
      if (box.isEmpty()) return
      const size=new THREE.Vector3(), centre=new THREE.Vector3()
      box.getSize(size); box.getCenter(centre)
      const aspect=camera.right/camera.top
      const frustHNew=Math.max(size.x/(2*aspect),size.y/2)*1.2
      camera.left=-frustHNew*aspect; camera.right=frustHNew*aspect
      camera.top=frustHNew; camera.bottom=-frustHNew
      camera.updateProjectionMatrix()
      controls.target.copy(centre); controls.update()
    },

    getScale() {
      const s=stateRef.current; if (!s) return 1
      const fh = (s.camera.top - s.camera.bottom) / s.camera.zoom
      return (s.renderer.domElement.clientHeight||1) / fh
    },

    getOverlayCtx(planeId) {
      const s=stateRef.current; if (!s) return null
      const oc=overlayRef.current; if (!oc) return null
      const {camera, controls}=s

      // Use mount div rect for W/H — same source as screenToWorld's NDC calc
      const mount = mountRef.current
      const rect  = mount ? mount.getBoundingClientRect() : { width: oc.width, height: oc.height }
      const W = rect.width
      const H = rect.height

      const frustW = (camera.right - camera.left)   / camera.zoom
      const frustH = (camera.top   - camera.bottom) / camera.zoom
      const scX = W / frustW
      const scY = H / frustH

      // Derive the canvas origin offset by raycasting the screen centre.
      // This is guaranteed to match screenToWorld since they use the same raycaster.
      const {raycaster, plane: activePlane3D} = s
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)  // NDC (0,0) = screen centre
      const centreHit = new THREE.Vector3()
      raycaster.ray.intersectPlane(activePlane3D, centreHit)

      // centreHit is the world point at screen centre in the current sketch plane.
      // Convert to sketch space.
      const pid = activePlaneInternalRef.current || planeId
      let cx, cy
      if (pid && typeof pid === 'object' && pid.worldToSketch) {
        // FacePlane
        const sk = pid.worldToSketch(centreHit)
        cx = sk.x; cy = sk.y
      } else {
        switch(pid) {
          case 'XZ': cx = centreHit.x; cy = -centreHit.z; break
          case 'YZ': cx = centreHit.y; cy = -centreHit.z; break
          default:   cx = centreHit.x; cy = -centreHit.y; break
        }
      }

      // Screen centre = canvas (W/2, H/2), so offset = centre - sketch_centre * scale
      const vtx = W/2 - cx*scX
      const vty = H/2 - cy*scY

      const ctx = oc.getContext('2d')
      ctx.setTransform(scX, 0, 0, scY, vtx, vty)
      return { ctx, sc: scX, scX, scY, vtx, vty }
    },

    clearOverlay() {
      const oc=overlayRef.current; if (!oc) return
      const ctx=oc.getContext('2d')
      ctx.setTransform(1,0,0,1,0,0)
      ctx.clearRect(0,0,oc.width,oc.height)
    },

    getOverlayCanvas() {
      return overlayRef.current || null
    },
    getExtrudePreviewCanvas() {
      return extrudePreviewRef.current || null
    },

    /**
     * Project a 3D world point to canvas pixel coordinates.
     * Returns {x, y} in canvas-relative pixels, or null.
     */
    worldToScreen(worldX, worldY, worldZ) {
      const s = stateRef.current; if (!s) return null
      const el = mountRef.current; if (!el) return null
      const rect = el.getBoundingClientRect()
      const v = new THREE.Vector3(worldX, worldY, worldZ).project(s.camera)
      return {
        x: (v.x + 1) / 2 * rect.width,
        y: (-v.y + 1) / 2 * rect.height,
      }
    },

    /**
     * Raycast against solid edges only (for the Fillet tool's edge picking) —
     * a separate pass from face hover/click so it never interferes with
     * sketch-on-face picking. Uses a dedicated Raycaster (not the shared one)
     * so the generous hit threshold here doesn't affect anything else.
     * Returns { solidId, edgeId, point:[x,y,z] } (point in real mm), or null.
     */
    raycastSolidEdges(clientX, clientY) {
      const s = stateRef.current; if (!s?.solidsGroup) return null
      const el = mountRef.current; if (!el) return null
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width)  *  2 - 1,
        ((clientY - rect.top)  / rect.height) * -2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      // LineSegments2.raycast() requires this explicitly when worldUnits:false
      // (see cadMesh.js's edge material) — the shared face-picking raycaster
      // never sets it, which is why this uses its own instance.
      raycaster.camera = s.camera
      raycaster.params.Line2 = { threshold: 4 }
      raycaster.setFromCamera(ndc, s.camera)
      const edgeObjects = []
      s.solidsGroup.traverse(obj => { if (obj.userData?.isSolidEdge) edgeObjects.push(obj) })
      const hits = raycaster.intersectObjects(edgeObjects, false)
      if (!hits.length) { hoverEdgeHighlightRef.current = null; return null }
      const hit = hits[0]
      const obj = hit.object

      // Map the hit segment back to its full edge polyline (for highlighting the
      // WHOLE edge, not just the clicked point) via userData.edgeGroups — see
      // cadMesh.js. faceIndex is the segment index; each segment consumes 2
      // points, so its point-index is faceIndex*2. edgeId (OCC's edge.hashCode)
      // is a stable identity — needed so the fillet tool can tell "is this the
      // same edge already in my multi-select" without relying on point proximity.
      const groups = obj.userData.edgeGroups || []
      const ptIdx = hit.faceIndex * 2
      const eg = groups.find(g => ptIdx >= g.start && ptIdx < g.start + g.count)
      const solidId = obj.userData.solidId
      if (eg && obj.userData.edgePoints) {
        const pts = obj.userData.edgePoints
        hoverEdgeHighlightRef.current = {
          points: pts.slice(eg.start*3, (eg.start+eg.count)*3),
          matrixWorld: obj.matrixWorld.clone(),
          solidId, edgeId: eg.edgeId,
        }
      } else {
        hoverEdgeHighlightRef.current = null
      }

      // LineSegments2's screen-space raycast reports TWO points: `point` (the
      // closest point on the camera RAY to the segment — can sit noticeably
      // off the true edge in 3D, especially at oblique angles or far from the
      // camera, since the whole point of a thick-line hit test is that you
      // don't have to click exactly on the infinitely-thin line) and
      // `pointOnLine` (the closest point ON the segment itself). We need a
      // point that's actually ON the edge for EdgeFinder().withinDistance()
      // to reliably find it — using `point` here was the bug: fillets would
      // silently succeed or fail (radius input never wrong) depending on how
      // far the ray-point had drifted from the real edge for that click.
      const SCALE = 2   // scene is in px (1mm = 2px) — see cadMesh.js
      const p = hit.pointOnLine
      return { solidId, edgeId: eg?.edgeId ?? null, point: [p.x/SCALE, p.y/SCALE, p.z/SCALE] }
    },

    /**
     * Generic "where on a solid did this click land" raycast, independent of
     * the sketch-armed face-picking flow (which returns an oriented FacePlane
     * for starting a sketch, not a bare point) — used by the Measure tool's
     * point-to-point distance mode. Returns { solidId, point:[x,y,z] } (mm)
     * or null. Same mesh-filtering convention as the face-hover pass in
     * handleMouseMoveInternal (excludes isSolidEdge overlays so a click near
     * an edge overlay still resolves to the real face mesh underneath).
     */
    raycastSolidFace(clientX, clientY) {
      const s = stateRef.current; if (!s?.solidsGroup) return null
      const el = mountRef.current; if (!el) return null
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width)  *  2 - 1,
        ((clientY - rect.top)  / rect.height) * -2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(ndc, s.camera)
      const hits = raycaster.intersectObjects(s.solidsGroup.children, true)
      const meshHit = hits.find(h => h.object.isMesh && !h.object.userData?.isSolidEdge)
      if (!meshHit) return null
      const SCALE = 2
      const p = meshHit.point
      return { solidId: findOwningSolidId(meshHit.object), point: [p.x/SCALE, p.y/SCALE, p.z/SCALE] }
    },

    /**
     * Steps the bottom-edge preview (see the green highlight in animate())
     * through the hovered face's boundary edges, one per call, instead of
     * only following the cursor — for edges the mouse can't easily land near.
     * dir=1 forward / -1 backward (e.g. Shift+Tab). No-op (returns false) if
     * no face is currently hovered. The chosen edge sticks until the mouse
     * moves to a genuinely different face or the hover is cleared (see
     * animate()'s normal-drift check and clearFaceHover).
     */
    cycleFaceBottomEdge(dir = 1) {
      const hf = hoveredFaceRef.current
      if (!hf?.hit) return false
      const normal = getHoveredFaceNormal(hf)
      const segs = faceBoundarySegments({ object: hf.mesh, point: hf.hit.point }, normal)
      if (!segs.length) return false
      const cur = tabEdgeIndexRef.current
      tabEdgeIndexRef.current = cur === null ? 0 : (cur + dir + segs.length) % segs.length
      tabEdgeNormalRef.current = normal
      return true
    },

    /**
     * Looks up one specific edge's polyline by stable identity (solidId +
     * edgeId, as returned by raycastSolidEdges) rather than a fresh raycast —
     * used to re-highlight edges already in the fillet tool's multi-select
     * set, or to re-highlight an existing fillet feature's edges when
     * re-opening it for editing. Returns { points, matrixWorld } or null.
     */
    getEdgePolyline(solidId, edgeId) {
      const s = stateRef.current; if (!s?.solidsGroup) return null
      let found = null
      s.solidsGroup.traverse(obj => {
        if (found || !obj.userData?.isSolidEdge || obj.userData.solidId !== solidId) return
        const eg = (obj.userData.edgeGroups || []).find(g => g.edgeId === edgeId)
        if (eg && obj.userData.edgePoints) {
          found = {
            points: obj.userData.edgePoints.slice(eg.start*3, (eg.start+eg.count)*3),
            matrixWorld: obj.matrixWorld.clone(),
          }
        }
      })
      return found
    },

    /**
     * Sets the fillet tool's persistent (orange) multi-select highlight —
     * list of {solidId, edgeId}. Looks up each edge's current polyline via
     * getEdgePolyline; entries that can't be found (e.g. solid rebuilt since)
     * are silently skipped rather than breaking the whole highlight.
     */
    setSelectedEdges(list) {
      selectedEdgeHighlightsRef.current = (list || [])
        .map(({ solidId, edgeId }) => this.getEdgePolyline(solidId, edgeId))
        .filter(Boolean)
    },

    /** Clears the fillet tool's hover (yellow) and selection (orange) edge highlights (e.g. after commit/cancel). */
    clearEdgeHighlight() {
      hoverEdgeHighlightRef.current = null
      selectedEdgeHighlightsRef.current = []
    },

    /**
     * Makes one whole solid glow (Mirror tool step 1 — "this is the body
     * you're about to mirror"). Finds the solid's own faceMesh (userData.solidId,
     * set in cadMesh.js) and sets its material's emissive color directly —
     * that material is already created fresh per solid there (never shared),
     * so mutating it in place can't bleed into any other solid. Resets any
     * previously-highlighted mesh first so only one solid ever glows at once.
     */
    highlightSolid(solidId) {
      const s = stateRef.current; if (!s?.solidsGroup) return
      this.clearSolidHighlight()
      const group = s.solidsGroup.children.find(g => g.userData?.solidId === solidId)
      const faceMesh = group?.children.find(c => c.isMesh && !c.userData?.isSolidEdge)
      if (faceMesh) {
        faceMesh.material.emissive.set(0x4dd9ec)
        highlightedSolidMeshRef.current = faceMesh
      }
    },

    /**
     * Highlights a cutout feature's own profile (Mirror tool step 1, cutout
     * source specifically) instead of glowing the whole solid it belongs to —
     * a cutout is often a small detail on a much larger body, so this is a
     * clearer cue for exactly what's about to be mirrored. `worldPts` is the
     * profile's own points already converted to world space by the caller
     * (App3D knows the feature's facePlane/planeId, this component doesn't).
     * Reprojected every frame in animate(), same convention as every other
     * camera-tracking overlay highlight here.
     */
    highlightCutoutFace(worldPts) {
      this.clearSolidHighlight()
      highlightedProfileRef.current = worldPts
    },

    /** Clears whatever highlightSolid()/highlightCutoutFace() lit up, if any. */
    clearSolidHighlight() {
      if (highlightedSolidMeshRef.current) {
        highlightedSolidMeshRef.current.material.emissive.set(0x000000)
        highlightedSolidMeshRef.current = null
      }
      highlightedProfileRef.current = null
    },

    /**
     * Glows every solid in `solidIds` at once (Join tool step 1 — a
     * multi-select, unlike Mirror's single pick). Resets any previously
     * highlighted set first. Independent of highlightSolid/clearSolidHighlight
     * so Join and Mirror's highlight state can never stomp on each other,
     * though in practice only one tool is ever active at a time.
     */
    highlightJoinMembers(solidIds) {
      this.clearJoinHighlight()
      const s = stateRef.current; if (!s?.solidsGroup) return
      for (const solidId of solidIds) {
        const group = s.solidsGroup.children.find(g => g.userData?.solidId === solidId)
        const faceMesh = group?.children.find(c => c.isMesh && !c.userData?.isSolidEdge)
        if (faceMesh) {
          faceMesh.material.emissive.set(0x4dd9ec)
          highlightedJoinMeshesRef.current.push(faceMesh)
        }
      }
    },

    /** Clears whatever highlightJoinMembers() lit up, if any. */
    clearJoinHighlight() {
      for (const mesh of highlightedJoinMeshesRef.current) mesh.material.emissive.set(0x000000)
      highlightedJoinMeshesRef.current = []
    },

    /**
     * Get the screen-space direction vector for a plane's extrude normal.
     * Returns a normalised {dx, dy} in canvas pixels.
     * planeId: 'XY'|'XZ'|'YZ'
     */
    planeExtrudeDirection(planeId, facePlane=null) {
      const s = stateRef.current; if (!s) return { dx:0, dy:-1 }
      const el = mountRef.current; if (!el) return { dx:0, dy:-1 }
      const rect = el.getBoundingClientRect()
      let nx, ny, nz
      if (facePlane && facePlane.normal) {
        nx = facePlane.normal.x; ny = facePlane.normal.y; nz = facePlane.normal.z
      } else {
        // XZ's world normal is -Y, not +Y — matches replicad's own PLANES_CONFIG.XZ
        // (and this app's SketchPlane.js camera convention: XZ camera sits at
        // negative Y looking toward +Y). Getting this backwards doesn't break the
        // math, but it does make this preview arrow point the opposite way from
        // where cadWorker.js's buildExtrude (which uses replicad's real XZ plane)
        // actually builds the solid — same bug class as workPlaneToFacePlaneBasisPx.
        const worldNormals = { XY:[0,0,1], XZ:[0,-1,0], YZ:[1,0,0] }
        ;[nx,ny,nz] = worldNormals[planeId] || [0,0,1]
      }
      // Project origin and origin+normal to screen to get direction
      const p0 = new THREE.Vector3(0,0,0).project(s.camera)
      const p1 = new THREE.Vector3(nx,ny,nz).project(s.camera)
      const dx = (p1.x - p0.x) * rect.width  / 2
      const dy = (p1.y - p0.y) * rect.height / 2  // canvas Y is flipped
      const len = Math.hypot(dx, dy) || 1
      return { dx: dx/len, dy: -dy/len }  // negate dy for canvas Y
    },

    // Register a callback that runs every RAF frame to keep overlays in sync
    // with camera motion (zoom, pan, orbit). Called by App3D.
    setOverlayRedraw(fn) {
      overlayRedrawRef.current = fn
    },

    // Like getOverlayCtx but forces a specific plane's coordinate transform —
    // used to draw cached profile outlines from any camera angle.
    getOverlayCtxForPlane(planeId) {
      const s=stateRef.current; if (!s) return null
      const oc=overlayRef.current; if (!oc) return null
      const {camera,controls}=s
      const el=mountRef.current
      const rect=el?el.getBoundingClientRect():{width:oc.width,height:oc.height,left:0,top:0}
      const W=rect.width, H=rect.height
      const frustW=camera.right-camera.left
      const frustH=camera.top-camera.bottom
      const scX=W/frustW, scY=H/frustH
      const tgt=controls.target
      let tx,ty
      switch(planeId) {
        case 'XZ': tx=tgt.x; ty=-tgt.z; break
        case 'YZ': tx=tgt.y; ty=-tgt.z; break
        default:   tx=tgt.x; ty=-tgt.y; break
      }
      const ctx=oc.getContext('2d')
      ctx.setTransform(scX,0,0,scY,W/2-tx*scX,H/2-ty*scY)
      return {ctx,sc:scX,scX,scY}
    },

    /**
     * Tween camera to look straight at the given plane.
     * Saves the current orbit state so snapToIsometric() can restore it.
     * Returns a Promise that resolves when the animation finishes.
     *
     * resetZoom (default true) also resets the frustum to SKETCH_FRUST_H —
     * every caller except the toolbar's plain TOP/FRONT/SIDE view buttons is
     * actually entering a sketch, where a fixed, print-bed-appropriate scale
     * matters more than preserving whatever zoom the general 3D view was at.
     * The view buttons pass {resetZoom:false} to keep their own long-standing
     * "switching angle doesn't jump zoom" behavior.
     */
    snapToPlane(planeId, { resetZoom = true } = {}) {
      const s=stateRef.current; if (!s) return Promise.resolve()
      const view=PLANE_VIEWS[planeId]; if (!view) return Promise.resolve()
      const {camera,controls,tween}=s

      // Save current orbit for snap-back
      s.savedPos = camera.position.clone()
      s.savedUp  = camera.up.clone()
      s.savedTgt = controls.target.clone()

      // Disable controls during tween
      controls.enabled = false
      hoveredPlaneRef.current = null
      setPlaneHover(s.workPlanes, null)

      if (resetZoom) {
        const aspect = camera.right / camera.top
        camera.left=-SKETCH_FRUST_H*aspect; camera.right=SKETCH_FRUST_H*aspect
        camera.top=SKETCH_FRUST_H; camera.bottom=-SKETCH_FRUST_H
        camera.zoom = 1
        camera.updateProjectionMatrix()
      }

      // Set up tween
      tween.fromPos.copy(camera.position)
      tween.fromUp .copy(camera.up)
      tween.fromTgt.copy(controls.target)
      tween.toPos  .copy(view.position)
      tween.toUp   .copy(view.up)
      tween.toTgt  .copy(view.target)
      tween.startMs = performance.now()
      tween.active  = true

      return new Promise(resolve => { tween.onDone = resolve })
    },

    /**
     * Tween camera to look straight at an arbitrary FacePlane.
     * Works like snapToPlane but for any orientation — see its resetZoom doc.
     */
    snapToFace(facePlane, { resetZoom = true } = {}) {
      const s=stateRef.current; if (!s) return Promise.resolve()
      const {camera,controls,tween}=s

      s.savedPos = camera.position.clone()
      s.savedUp  = camera.up.clone()
      s.savedTgt = controls.target.clone()

      const view = facePlane.getCameraView(800)

      controls.enabled = false
      clearFaceHover()

      if (resetZoom) {
        const aspect = camera.right / camera.top
        camera.left=-SKETCH_FRUST_H*aspect; camera.right=SKETCH_FRUST_H*aspect
        camera.top=SKETCH_FRUST_H; camera.bottom=-SKETCH_FRUST_H
        camera.zoom = 1
        camera.updateProjectionMatrix()
      }

      tween.fromPos.copy(camera.position)
      tween.fromUp .copy(camera.up)
      tween.fromTgt.copy(controls.target)
      tween.toPos  .copy(view.position)
      tween.toUp   .copy(view.up)
      tween.toTgt  .copy(view.target)
      tween.startMs = performance.now()
      tween.active  = true

      return new Promise(resolve => { tween.onDone = resolve })
    },

    /**
     * Tweens to the fixed canonical isometric view (ISO_VIEW) — always the
     * same corner angle, regardless of what the camera was doing before.
     * This is what the toolbar's ISO button calls; it's a peer of
     * snapToPlane('XY'/'XZ'/'YZ'), not a "go back" — for that, see
     * restoreSavedView() below.
     */
    snapToIsometric() {
      const s=stateRef.current; if (!s) return Promise.resolve()
      const {camera,controls,tween}=s

      s.savedPos = camera.position.clone()
      s.savedUp  = camera.up.clone()
      s.savedTgt = controls.target.clone()

      controls.enabled = false

      tween.fromPos.copy(camera.position)
      tween.fromUp .copy(camera.up)
      tween.fromTgt.copy(controls.target)
      tween.toPos  .copy(ISO_VIEW.position)
      tween.toUp   .copy(ISO_VIEW.up)
      tween.toTgt  .copy(ISO_VIEW.target)
      tween.startMs = performance.now()
      tween.active  = true

      return new Promise(resolve => { tween.onDone = resolve })
    },

    /**
     * Tweens back to whatever camera state was saved by the last snapToPlane/
     * snapToFace/snapToIsometric call — used after finishing or canceling a
     * sketch/extrude flow to return exactly where the user was, rather than
     * forcing a fixed view. Falls back to a reasonable default if nothing was
     * ever saved (e.g. fresh load). This used to be named snapToIsometric()
     * itself, which is why the toolbar's actual ISO button looked broken —
     * it was calling "go back to wherever I was" instead of "go to isometric."
     */
    restoreSavedView() {
      const s=stateRef.current; if (!s) return Promise.resolve()
      const {camera,controls,tween}=s

      const toPos = s.savedPos ?? ISO_VIEW.position
      const toUp  = s.savedUp  ?? ISO_VIEW.up
      const toTgt = s.savedTgt ?? ISO_VIEW.target

      controls.enabled = false

      tween.fromPos.copy(camera.position)
      tween.fromUp .copy(camera.up)
      tween.fromTgt.copy(controls.target)
      tween.toPos  .copy(toPos)
      tween.toUp   .copy(toUp)
      tween.toTgt  .copy(toTgt)
      tween.startMs = performance.now()
      tween.active  = true

      return new Promise(resolve => { tween.onDone = resolve })
    },

    getDomElement() { return stateRef.current?.renderer.domElement||null },

  }), [])

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={mountRef}
      style={{ width, height, overflow:'hidden',
               cursor: (sketchArmed && isFaceHovered) ? 'pointer' : cursor||'default',
               position:'relative', ...cssProp }}
      onClick={handleClickInternal}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseMove={handleMouseMoveInternal}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
    >
      <canvas
        ref={overlayRef}
        width={width}
        height={height}
        style={{ position:'absolute', top:0, left:0, pointerEvents:'none', zIndex:10 }}
      />
      <canvas
        ref={extrudePreviewRef}
        width={width}
        height={height}
        style={{ position:'absolute', top:0, left:0, pointerEvents:'none', zIndex:11 }}
      />
    </div>
  )
})

export default Viewport3D

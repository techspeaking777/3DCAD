/**
 * Viewport3D.jsx  —  Phase 1 + Phase 2 Step 2
 *
 * Two render layers:
 *  1. Three.js WebGLRenderer  — committed geometry + work planes + grid
 *  2. Transparent <canvas>    — tool overlays (snap, rubber-band, bbox, labels)
 *
 * Phase 2 Step 2 — Camera tween
 * ──────────────────────────────
 * snapToPlane(planeId)  — smoothly animates camera to look straight at a work plane
 * snapToIsometric()     — smoothly animates back to the saved pre-sketch orbit state
 *
 * The tween runs inside the existing RAF loop using a simple easeInOutCubic.
 * OrbitControls are disabled during the tween and re-enabled when it finishes.
 *
 * Public imperative API  (forwardRef)
 * ────────────────────────────────────
 *   screenToWorld(clientX, clientY) → {x,y}
 *   zoomToFit()
 *   getScale()
 *   getOverlayCtx()    → { ctx, sc }
 *   clearOverlay()
 *   snapToPlane(id)    → Promise  (resolves when tween finishes)
 *   snapToIsometric()  → Promise
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
import { faceHitToPlane } from './FacePlane.js'
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
    case 'YZ':
      // pt2three YZ: Vector3(0, sx, -sy)
      // ShapeGeometry vertex (x,y,0) → world (0, x, -y)
      geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1))        // flip Z
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI/2))   // stand on YZ
      break
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

function buildGrid(half=5000) {
  const group=new THREE.Group(); group.renderOrder=0
  const minorPts=[], step=10
  for (let v=-half;v<=half;v+=step) {
    minorPts.push(new THREE.Vector3(-half,v,0),new THREE.Vector3(half,v,0))
    minorPts.push(new THREE.Vector3(v,-half,0),new THREE.Vector3(v,half,0))
  }
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(minorPts),
    new THREE.LineBasicMaterial({color:0x222240,transparent:true,opacity:0.9,depthTest:false})
  ))
  const majorPts=[], mstep=100
  for (let v=-half;v<=half;v+=mstep) {
    majorPts.push(new THREE.Vector3(-half,v,0),new THREE.Vector3(half,v,0))
    majorPts.push(new THREE.Vector3(v,-half,0),new THREE.Vector3(v,half,0))
  }
  group.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(majorPts),
    new THREE.LineBasicMaterial({color:0x383870,transparent:true,opacity:1.0,depthTest:false})
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
    showWorkPlanes = true,
    activePlane    = null,
    sketchMode     = false,
    extrudeTool    = null,   // 'extrude'|'cutout' — bypasses work plane click
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
    const aspect = width/height, frustH=600
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
    controls.mouseButtons={ LEFT:THREE.MOUSE.PAN, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.ROTATE }

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
      if (oc && hf?.hit && !inSketchMode) {
        const ctx2 = oc.getContext('2d')
        ctx2.setTransform(1,0,0,1,0,0)
        if (sketchArmedRef.current) {
          ctx2.clearRect(0,0,oc.width,oc.height)
          const geo = hf.mesh.geometry
          const face = hf.hit.face
          if (face && geo.attributes.position) {
            const pos = geo.attributes.position
            const normals = geo.attributes.normal
            // Get face normal: prefer stored vertex normal (more accurate for ExtrudeGeometry)
            let faceNormal
            if (normals) {
              // Average the 3 vertex normals of the hit face for robustness
              const na = new THREE.Vector3(normals.getX(face.a),normals.getY(face.a),normals.getZ(face.a))
              const nb = new THREE.Vector3(normals.getX(face.b),normals.getY(face.b),normals.getZ(face.b))
              const nc = new THREE.Vector3(normals.getX(face.c),normals.getY(face.c),normals.getZ(face.c))
              faceNormal = na.add(nb).add(nc).divideScalar(3)
                .transformDirection(hf.mesh.matrixWorld).normalize()
            } else {
              faceNormal = face.normal.clone()
                .transformDirection(hf.mesh.matrixWorld).normalize()
            }
            const rect2 = mountRef.current?.getBoundingClientRect()
            const W = rect2?.width || oc.width
            const H = rect2?.height || oc.height
            const cam = stateRef.current.camera

            // Project a vertex index to screen coords
            const toScreen = idx => {
              const v = new THREE.Vector3(pos.getX(idx),pos.getY(idx),pos.getZ(idx))
                .applyMatrix4(hf.mesh.matrixWorld).project(cam)
              return { x:(v.x+1)/2*W, y:(-v.y+1)/2*H }
            }

            // Collect ALL triangles on this exact face (same normal, tight threshold)
            const faceTris = []   // [{a,b,c,pa,pb,pc}] — indices + screen coords
            const edgeCount = new Map()  // "min,max" -> count (boundary = appears once)
            const idx = geo.index
            const count = idx ? idx.count : pos.count
            // normals already declared above

            for (let i=0; i<count; i+=3) {
              const a = idx ? idx.getX(i)   : i
              const b = idx ? idx.getX(i+1) : i+1
              const c = idx ? idx.getX(i+2) : i+2

              // Use stored vertex normal of first vertex (faster than cross product)
              // Transform to world space
              let nx, ny, nz
              if (normals) {
                const n = new THREE.Vector3(normals.getX(a),normals.getY(a),normals.getZ(a))
                  .transformDirection(hf.mesh.matrixWorld).normalize()
                nx=n.x; ny=n.y; nz=n.z
              } else {
                const va2=new THREE.Vector3(pos.getX(a),pos.getY(a),pos.getZ(a))
                const vb2=new THREE.Vector3(pos.getX(b),pos.getY(b),pos.getZ(b))
                const vc2=new THREE.Vector3(pos.getX(c),pos.getY(c),pos.getZ(c))
                const n=new THREE.Vector3().crossVectors(vb2.clone().sub(va2),vc2.clone().sub(va2))
                  .normalize().transformDirection(hf.mesh.matrixWorld).normalize()
                nx=n.x; ny=n.y; nz=n.z
              }
              const dot = nx*faceNormal.x + ny*faceNormal.y + nz*faceNormal.z
              if (dot > 0.999) {  // very tight — only same face
                const pa=toScreen(a), pb=toScreen(b), pc=toScreen(c)
                faceTris.push({a,b,c,pa,pb,pc})
                for (const [u,v] of [[a,b],[b,c],[c,a]]) {
                  const key=`${Math.min(u,v)},${Math.max(u,v)}`
                  edgeCount.set(key,(edgeCount.get(key)||0)+1)
                }
              }
            }

            // Fill all coplanar triangles (no per-triangle stroke — avoids showing triangulation)
            ctx2.beginPath()
            faceTris.forEach(({pa,pb,pc}) => {
              ctx2.moveTo(pa.x,pa.y)
              ctx2.lineTo(pb.x,pb.y)
              ctx2.lineTo(pc.x,pc.y)
              ctx2.closePath()
            })
            ctx2.fillStyle = 'rgba(100,170,255,0.18)'
            ctx2.fill()

            // Stroke only boundary edges (appear in exactly one triangle = outer silhouette)
            ctx2.beginPath()
            faceTris.forEach(({a,b,c,pa,pb,pc}) => {
              const edges=[[a,b,pa,pb],[b,c,pb,pc],[c,a,pc,pa]]
              for (const [u,v,p1,p2] of edges) {
                if (edgeCount.get(`${Math.min(u,v)},${Math.max(u,v)}`)===1) {
                  ctx2.moveTo(p1.x,p1.y)
                  ctx2.lineTo(p2.x,p2.y)
                }
              }
            })
            ctx2.strokeStyle = '#64aaff'
            ctx2.lineWidth = 2
            ctx2.stroke()

            // Label at face centroid
            const allX = faceTris.flatMap(({pa,pb,pc})=>[pa.x,pb.x,pc.x])
            const allY = faceTris.flatMap(({pa,pb,pc})=>[pa.y,pb.y,pc.y])
            const cx = allX.reduce((s,v)=>s+v,0)/allX.length
            const cy = allY.reduce((s,v)=>s+v,0)/allY.length
            ctx2.fillStyle = '#fff'
            ctx2.font = 'bold 12px monospace'
            ctx2.textAlign = 'center'
            ctx2.fillText('click to sketch', cx, cy-8)
          }
        }
      } else if (oc && sketchArmedRef.current && !hf && !inSketchMode) {
        // Clear face highlight when not hovering
        const ctx2 = oc.getContext('2d')
        ctx2.setTransform(1,0,0,1,0,0)
        ctx2.clearRect(0,0,oc.width,oc.height)
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
    lines  .forEach(l  => geomGroup.add(buildLine(l,   lineColor)))
    circles.forEach(c  => geomGroup.add(buildCircle(c, lineColor)))
    arcs   .forEach(a  => geomGroup.add(buildArc(a,    lineColor)))
    splines.forEach(sp => { const o=buildSpline(sp, lineColor); if(o) geomGroup.add(o) })

    // Fills for working arrays. Include circles/splines' planes too — a
    // text-only sketch (no lines/arcs yet) would otherwise never get a fill
    // preview since wPlaneIds was derived only from lines/arcs.
    const wPlaneIds = [...new Set([
      ...lines.filter(l=>l.plane).map(l=>l.plane),
      ...arcs .filter(a=>a.plane).map(a=>a.plane),
      ...circles.filter(c=>c.plane).map(c=>c.plane),
      ...splines.filter(s=>s.plane).map(s=>s.plane),
    ])]
    wPlaneIds.forEach(pid => {
      const pLines   = lines  .filter(l=>l.plane===pid)
      const pArcs    = arcs   .filter(a=>a.plane===pid)
      const pCircles = circles.filter(c=>c.plane===pid)
      const pSplines = splines.filter(s=>s.plane===pid)
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
    // Remove old solid groups
    solidsGroup.traverse(obj=>{ if(obj.geometry)obj.geometry.dispose(); if(obj.material)obj.material.dispose() })
    solidsGroup.clear()
    // Add each solid's pre-built THREE.Group
    solids.forEach(solid => { if(solid.group) solidsGroup.add(solid.group) })
  }, [solids])

  // ── sketch mode: white background, hide grid ──────────────────────────────

  useEffect(() => {
    const s = stateRef.current; if (!s) return
    // Background always white, grid always hidden
    s.renderer.setClearColor(0xffffff, 1)
    if (s.grid) s.grid.visible = false
  }, [sketchMode])

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
  useEffect(() => { sketchArmedRef.current = sketchArmed }, [sketchArmed])

  // Clear face hover highlight helper
  function clearFaceHover() {
    if (hoveredFaceRef.current) {
      hoveredFaceRef.current = null
      setIsFaceHovered(false)
    }
  }

  function handleMouseMoveInternal(e) {
    const s = stateRef.current
    if (!s) { if (onMouseMove) onMouseMove(e); return }

    sketchArmedRef.current = sketchArmed

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
      const meshHit = hits.find(h => h.object.isMesh)
      const hitMesh = meshHit ? meshHit.object : null
      if (!handleMouseMoveInternal._tick) handleMouseMoveInternal._tick = 0
      if (++handleMouseMoveInternal._tick % 120 === 0) {
        console.log('[face] armed=true solids=', s.solidsGroup.children.length, 'hits=', hits.length, 'meshHit=', !!meshHit)
      }
      if (hitMesh !== (hoveredFaceRef.current?.mesh || null)) {
        clearFaceHover()
        if (hitMesh) {
          hoveredFaceRef.current = { mesh: hitMesh, hit: meshHit }
          setIsFaceHovered(true)
        }
      }
    } else if (!sketchArmedRef.current) {
      clearFaceHover()
    }

    // ── Work plane hover ──
    if (s.workPlanes && showWorkPlanesRef.current && !s.tween?.active) {
      s.raycaster.setFromCamera(ndc, s.camera)
      const hit   = hitTestPlanes(s.raycaster, s.workPlanes)
      const newId = hit ? hit.id : null
      if (newId !== hoveredPlaneRef.current) {
        hoveredPlaneRef.current = newId
        setPlaneHover(s.workPlanes, newId)
      }
    }

    if (onMouseMove) onMouseMove(e)
  }

  function handleClickInternal(e) {
    const s = stateRef.current
    sketchArmedRef.current = sketchArmed  // sync immediately

    // ── Face click (sketch armed + face hovered) ──
    if (sketchArmedRef.current && hoveredFaceRef.current && onFaceClick && !s?.tween?.active) {
      const hitWithRay = {
        ...hoveredFaceRef.current.hit,
        ray: s.raycaster.ray.clone(),  // store ray so FacePlane can orient normal toward camera
      }
      const facePlane = faceHitToPlane(hitWithRay)
      if (facePlane) {
        clearFaceHover()
        onFaceClick(facePlane)
        return
      }
    }

    // ── Work plane click ──
    if (s?.workPlanes && showWorkPlanesRef.current && hoveredPlaneRef.current && !s.tween?.active) {
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
      const {camera,controls,geomGroup}=s
      const box=new THREE.Box3().setFromObject(geomGroup)
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
        const worldNormals = { XY:[0,0,1], XZ:[0,1,0], YZ:[1,0,0] }
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
     */
    snapToPlane(planeId) {
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
     * Works like snapToPlane but for any orientation.
     */
    snapToFace(facePlane) {
      const s=stateRef.current; if (!s) return Promise.resolve()
      const {camera,controls,tween}=s

      s.savedPos = camera.position.clone()
      s.savedUp  = camera.up.clone()
      s.savedTgt = controls.target.clone()

      const view = facePlane.getCameraView(800)

      controls.enabled = false
      clearFaceHover()

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

    snapToIsometric() {
      const s=stateRef.current; if (!s) return Promise.resolve()
      const {camera,controls,tween}=s

      // Fall back to a default isometric-ish view if nothing was saved
      const toPos = s.savedPos ?? new THREE.Vector3(400, -400, 400)
      const toUp  = s.savedUp  ?? new THREE.Vector3(0, 0, 1)
      const toTgt = s.savedTgt ?? new THREE.Vector3(0, 0, 0)

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

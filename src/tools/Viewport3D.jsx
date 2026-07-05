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

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createWorkPlanes, hitTestPlanes, setPlaneHover, setPlaneActive, setWorkPlanesVisible } from './WorkPlanes.js'
import { SKETCH_PLANES } from './SketchPlane.js'

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

function makeMat(style, color=0xdce8ff) {
  if (style==='construction') return new THREE.LineDashedMaterial({
    color:0x6688aa, linewidth:1, dashSize:6, gapSize:3, depthTest:false,
  })
  if (style==='dashed') return new THREE.LineDashedMaterial({
    color, linewidth:1, dashSize:8, gapSize:4, depthTest:false,
  })
  return new THREE.LineBasicMaterial({ color, linewidth:1, depthTest:false })
}

// ── geometry builders ─────────────────────────────────────────────────────────
// pt2three converts a 2D sketch point to a 3D world Vector3 for the entity's plane.

function pt2three(sx, sy, plane) {
  switch(plane) {
    // XZ: sketch.x=worldX, sketch.y=-worldZ  →  inverse: worldX=sx, worldZ=-sy
    case 'XZ': return new THREE.Vector3(sx,  0, -sy)
    // YZ: sketch.x=worldY, sketch.y=-worldZ  →  inverse: worldY=sx, worldZ=-sy
    case 'YZ': return new THREE.Vector3(0,  sx, -sy)
    // XY: sketch.x=worldX, sketch.y=-worldY  →  inverse: worldX=sx, worldY=-sy
    default:   return new THREE.Vector3(sx, -sy,  0)
  }
}

function buildLine(l) {
  const p=l.plane
  const geo=new THREE.BufferGeometry().setFromPoints([pt2three(l.x1,l.y1,p),pt2three(l.x2,l.y2,p)])
  const obj=new THREE.Line(geo,makeMat(l.style)); obj.computeLineDistances(); obj.renderOrder=1; return obj
}
function buildCircle(c) {
  const p=c.plane, SEG=64, pts=[]
  for (let i=0;i<=SEG;i++){const a=(i/SEG)*Math.PI*2; pts.push(pt2three(c.cx+Math.cos(a)*c.r,c.cy+Math.sin(a)*c.r,p))}
  const obj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),makeMat(c.style))
  obj.computeLineDistances(); obj.renderOrder=1; return obj
}
function buildArc(arc) {
  const p=arc.plane, SEG=64; let start=arc.startAngle,end=arc.endAngle; if(end<start)end+=Math.PI*2
  const span=end-start, steps=Math.max(4,Math.round(SEG*span/(Math.PI*2))), pts=[]
  for (let i=0;i<=steps;i++){const a=start+(i/steps)*span; pts.push(pt2three(arc.cx+Math.cos(a)*arc.r,arc.cy+Math.sin(a)*arc.r,p))}
  const obj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),makeMat(arc.style))
  obj.computeLineDistances(); obj.renderOrder=1; return obj
}
function buildSpline(sp) {
  if (sp.points.length<2) return null
  const p=sp.plane
  const sampled=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16)
  const obj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(sampled.map(s=>pt2three(s.x,s.y,p))),makeMat(sp.style))
  obj.computeLineDistances(); obj.renderOrder=1; return obj
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
    solids=[],             // Phase 3: [{group: THREE.Group}] pre-built solid objects
    style: cssProp,
    cursor,
    onClick, onDoubleClick, onContextMenu,
    onMouseMove, onMouseDown, onMouseUp,
    onScaleChange,
    onPlaneClick,
    showWorkPlanes = true,
    activePlane    = null,
  } = props

  const mountRef   = useRef(null)
  const overlayRef = useRef(null)
  const stateRef   = useRef(null)
  // Internal ref so screenToSketch/screenToWorld always use the current plane
  // without depending on React prop timing
  const activePlaneInternalRef = useRef(null)

  // ── init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return

    const renderer = new THREE.WebGLRenderer({ antialias:true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    renderer.setClearColor(0x0d0d1a, 1)
    // Position absolutely so it doesn't affect layout flow
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
    camera.position.set(0,0,500); camera.lookAt(0,0,0); camera.up.set(0,1,0)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.screenSpacePanning=true; controls.enableDamping=true; controls.dampingFactor=0.12
    controls.zoomSpeed=1.2; controls.rotateSpeed=0.6
    controls.mouseButtons={ LEFT:THREE.MOUSE.PAN, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.ROTATE }

    scene.add(buildGrid())
    const geomGroup   = new THREE.Group(); scene.add(geomGroup)
    const solidsGroup = new THREE.Group(); scene.add(solidsGroup)  // Phase 3 solids

    // Lighting for solid meshes
    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
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
      tween,
      savedPos: null, savedUp: null, savedTgt: null,
    }

    controls.addEventListener('change', () => {
      if (onScaleChange && stateRef.current) {
        const {camera:c}=stateRef.current
        const ph = mountRef.current?.clientHeight || height
        onScaleChange(ph/(c.top-c.bottom))
      }
    })

    if (onScaleChange) {
      const fh=camera.top-camera.bottom, ph=mountRef.current?.clientHeight||height
      onScaleChange(ph/fh)
    }

    let animId
    function animate(now) {
      animId = requestAnimationFrame(animate)

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
  }, [width,height])

  // ── geometry sync ─────────────────────────────────────────────────────────

  useEffect(() => {
    const s=stateRef.current; if (!s) return
    const {geomGroup}=s
    geomGroup.traverse(obj=>{ if(obj.geometry)obj.geometry.dispose(); if(obj.material)obj.material.dispose() })
    geomGroup.clear()
    lines  .forEach(l  => geomGroup.add(buildLine(l)))
    circles.forEach(c  => geomGroup.add(buildCircle(c)))
    arcs   .forEach(a  => geomGroup.add(buildArc(a)))
    splines.forEach(sp => { const o=buildSpline(sp); if(o) geomGroup.add(o) })
  }, [lines,circles,arcs,splines])

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
    activePlaneInternalRef.current = activePlane   // always current, no closure issues
    setPlaneActive(s.workPlanes, activePlane)
    // Switch the raycasting plane to match the active sketch plane
    if (activePlane && SKETCH_PLANES[activePlane]) {
      s.plane.copy(SKETCH_PLANES[activePlane])
    } else {
      // Back to default XY (z=0)
      s.plane.set(new THREE.Vector3(0,0,1), 0)
    }
  }, [activePlane])

  // ── plane hover ───────────────────────────────────────────────────────────

  const hoveredPlaneRef = useRef(null)
  const showWorkPlanesRef = useRef(true)
  useEffect(() => { showWorkPlanesRef.current = showWorkPlanes }, [showWorkPlanes])

  function handleMouseMoveInternal(e) {
    const s = stateRef.current
    if (s?.workPlanes && showWorkPlanesRef.current && !s.tween?.active) {
      const el=s.renderer.domElement, rect=el.getBoundingClientRect()
      const ndc=new THREE.Vector2(
        ((e.clientX-rect.left)/rect.width)*2-1,
        ((e.clientY-rect.top)/rect.height)*-2+1,
      )
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
      // Use the mount div rect — guaranteed same bounds as the overlay canvas
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
      switch(pid) {
        case 'XZ': return { x:  hit.x, y: -hit.z }
        case 'YZ': return { x:  hit.y, y: -hit.z }
        default:   return { x:  hit.x, y: -hit.y }
      }
    },

    screenToSketch(clientX, clientY, planeId) {
      // Delegates to screenToWorld — planeId arg kept for back-compat but
      // the active plane is read from activePlaneInternalRef
      return this.screenToWorld(clientX, clientY)
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
      return (s.renderer.domElement.clientHeight||1)/(s.camera.top-s.camera.bottom)
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

      const frustW = camera.right - camera.left
      const frustH = camera.top   - camera.bottom
      const scX = W / frustW
      const scY = H / frustH

      const tgt = controls.target
      let tx, ty
      switch(planeId) {
        case 'XZ': tx =  tgt.x; ty = -tgt.z; break
        case 'YZ': tx =  tgt.y; ty = -tgt.z; break
        default:   tx =  tgt.x; ty = -tgt.y; break
      }

      const vtx = W/2 - tx*scX
      const vty = H/2 - ty*scY

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
     * Tween camera back to the saved pre-sketch orbit position.
     * Returns a Promise that resolves when the animation finishes.
     */
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
      style={{ width, height, overflow:'hidden', cursor:cursor||'default',
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
    </div>
  )
})

export default Viewport3D

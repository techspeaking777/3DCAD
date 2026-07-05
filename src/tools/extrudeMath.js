/**
 * extrudeMath.js  —  Phase 3 Step 4
 *
 * Profile detection and THREE.js solid building for the Extrude tool.
 *
 * Profile detection
 * ─────────────────
 * Walks connected line/arc segments in a sketch to find closed loops.
 * Tolerance-based endpoint matching (SNAP_DIST world units).
 *
 * Coordinate space
 * ─────────────────
 * All input geometry is in 2D sketch space {x,y}.
 * Output geometry is in 3D world space via sketchToWorld().
 */

import * as THREE from 'three'
import { sketchToWorld } from '../SketchPlane.js'
import { sampleSpline } from './splineMath.js'

const CLOSE_TOL = 4   // world units — endpoints within this distance are "connected"

// ── profile detection ─────────────────────────────────────────────────────────

/**
 * Build an adjacency list of endpoints from lines and arcs on a given plane.
 * Each segment gets two nodes (start, end).  Connected endpoints are merged.
 *
 * Returns an array of closed profiles, each being an ordered array of
 * {x, y} sketch-space points (the shape outline, CCW preferred).
 */
export function detectProfiles(lines, arcs, planeId, circles=[], splines=[]) {
  // Filter to this plane only
  const planeLines   = lines  .filter(l => (l.plane || 'XY') === planeId)
  const planeArcs    = arcs   .filter(a => (a.plane || 'XY') === planeId)
  const planeCircles = circles.filter(c => (c.plane || 'XY') === planeId)
  const planeSplines = splines.filter(sp => (sp.plane || 'XY') === planeId && sp.closed)

  if (planeLines.length === 0 && planeArcs.length === 0 && planeCircles.length === 0 && planeSplines.length === 0) return []

  // Build segment list: each has {p1:{x,y}, p2:{x,y}, kind, ref}
  const segs = []
  planeLines.forEach(l => segs.push({
    p1:{x:l.x1,y:l.y1}, p2:{x:l.x2,y:l.y2}, kind:'line', ref:l
  }))
  planeArcs.forEach(a => {
    const p1 = { x: a.cx+Math.cos(a.startAngle)*a.r, y: a.cy+Math.sin(a.startAngle)*a.r }
    const p2 = { x: a.cx+Math.cos(a.endAngle  )*a.r, y: a.cy+Math.sin(a.endAngle  )*a.r }
    segs.push({ p1, p2, kind:'arc', ref:a })
  })

  // Union-find: merge endpoints that are within CLOSE_TOL of each other
  const nodes = []    // [{x,y}]
  const segNodes = [] // [[n1idx, n2idx], ...]

  function findOrAdd(pt) {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x-pt.x, nodes[i].y-pt.y) < CLOSE_TOL) return i
    }
    nodes.push({...pt})
    return nodes.length - 1
  }

  segs.forEach(seg => {
    const i1 = findOrAdd(seg.p1)
    const i2 = findOrAdd(seg.p2)
    segNodes.push([i1, i2])
  })

  // Build adjacency: node → [segIdx, ...]
  const adj = Array.from({length:nodes.length}, ()=>[])
  segNodes.forEach(([n1,n2], si) => {
    adj[n1].push(si)
    adj[n2].push(si)
  })

  // Walk closed loops: start from each unvisited segment
  const usedSegs = new Set()
  const profiles = []

  function walkLoop(startSeg) {
    const path = [startSeg]
    usedSegs.add(startSeg)
    let curNode = segNodes[startSeg][1]   // move forward from p2
    const startNode = segNodes[startSeg][0]

    for (let steps = 0; steps < segs.length; steps++) {
      if (curNode === startNode) {
        // closed loop found
        return path
      }
      // Find next unused segment connected to curNode
      const next = adj[curNode].find(si => !usedSegs.has(si))
      if (next === undefined) return null   // dead end — open profile
      usedSegs.add(next)
      path.push(next)
      // Advance to the other end of this segment
      const [na, nb] = segNodes[next]
      curNode = (na === curNode) ? nb : na
    }
    return null
  }

  for (let si = 0; si < segs.length; si++) {
    if (usedSegs.has(si)) continue
    const loop = walkLoop(si)
    if (!loop) continue

    // Convert loop segments to ordered {x,y} point list
    const pts = []
    let prevNode = segNodes[loop[0]][0]
    loop.forEach(si => {
      const [na, nb] = segNodes[si]
      const seg = segs[si]
      const forward = (na === prevNode)
      if (seg.kind === 'line') {
        pts.push(forward ? {...nodes[na]} : {...nodes[nb]})
      } else {
        // Arc — sample intermediate points
        const arc = seg.ref
        let a0 = forward ? arc.startAngle : arc.endAngle
        let a1 = forward ? arc.endAngle   : arc.startAngle
        if (forward && a1 < a0) a1 += Math.PI*2
        if (!forward && a0 < a1) a0 += Math.PI*2
        const steps = Math.max(4, Math.round(Math.abs(a1-a0) / (Math.PI/16)))
        for (let i=0; i<steps; i++) {
          const a = a0 + (a1-a0)*i/steps
          pts.push({ x: arc.cx+Math.cos(a)*arc.r, y: arc.cy+Math.sin(a)*arc.r })
        }
      }
      prevNode = forward ? nb : na
    })

    if (pts.length >= 3) profiles.push(pts)
  }

  // Circles are already closed — sample each one directly into a polygon for
  // profile-detection/rendering purposes (fills, hit-testing, etc. all just want
  // points). But tag the array with the TRUE circle definition so the extrude
  // pipeline can build a real circular edge in the CAD kernel instead of a
  // many-sided polygon prism — see cadWorker.js's makeProfile for the consumer.
  planeCircles.forEach(c => {
    const steps = Math.max(32, Math.round(Math.abs(c.r) * Math.PI / 2))
    const pts = []
    for (let i = 0; i < steps; i++) {
      const a = (Math.PI * 2 * i) / steps
      pts.push({ x: c.cx + Math.cos(a) * c.r, y: c.cy + Math.sin(a) * c.r })
    }
    pts.circleMeta = { cx: c.cx, cy: c.cy, r: c.r }
    profiles.push(pts)
  })

  // Closed splines (currently only produced by the Text tool's font-outline
  // import, see TextPanel.jsx) are already closed loops — use their points
  // directly for polyline splines, or sample the Catmull-Rom curve for
  // hand-drawn closed splines. Tag with textId so resolveTextHoles() below can
  // find each letter's own hole contour (the counter in O/A/8/etc.) without
  // touching unrelated hand-drawn geometry elsewhere in the sketch.
  planeSplines.forEach(sp => {
    if (sp.points.length < 2) return
    const pts = sp.polyline ? sp.points.map(p=>({...p})) : sampleSpline(sp.points, true, 16)
    if (pts.length < 3) return
    if (sp.textId) pts.textId = sp.textId
    profiles.push(pts)
  })

  return resolveTextHoles(profiles)
}

// Letters like O/A/B/D/P/Q/0/4/6/8/9 produce two (or more) closed contours from
// one glyph: an outer boundary and one or more inner "counters". Group profiles
// that share a textId (one text-import batch — see TextPanel.jsx/App3D.jsx),
// then use even-odd containment counting to tell holes from outer boundaries:
// a contour is a hole if it's contained by an ODD number of other contours in
// the same group. Each hole gets attached to its tightest (smallest-area)
// container as `.holes`, and is removed from the flat returned list — a hole
// isn't its own selectable/extrudable shape.
function resolveTextHoles(profiles) {
  const byText = new Map()
  profiles.forEach((pts, idx) => {
    if (!pts.textId) return
    if (!byText.has(pts.textId)) byText.set(pts.textId, [])
    byText.get(pts.textId).push(idx)
  })
  if (byText.size === 0) return profiles

  const toRemove = new Set()
  byText.forEach(indices => {
    const n = indices.length
    if (n < 2) return
    const areas = indices.map(i => polygonArea(profiles[i]))
    const containmentCount = new Array(n).fill(0)
    const containerOf = new Array(n).fill(-1)
    for (let a = 0; a < n; a++) {
      let bestArea = Infinity
      for (let b = 0; b < n; b++) {
        if (a === b) continue
        if (pointInPolygon(profiles[indices[a]][0], profiles[indices[b]])) {
          containmentCount[a]++
          if (areas[b] < bestArea) { bestArea = areas[b]; containerOf[a] = b }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (containmentCount[i] % 2 === 1 && containerOf[i] !== -1) {
        const outerIdx = indices[containerOf[i]]
        const outer = profiles[outerIdx]
        if (!outer.holes) outer.holes = []
        outer.holes.push(profiles[indices[i]])
        toRemove.add(indices[i])
      }
    }
  })

  return profiles.filter((_, idx) => !toRemove.has(idx))
}

function polygonArea(pts) {
  let area = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y)
  }
  return Math.abs(area / 2)
}

/**
 * Build a THREE.Shape from a sketch-space point array.
 * THREE.Shape lives in XY space — we pass sketch coords directly
 * since ExtrudeGeometry handles the 3D orientation.
 */
function profileToShape(pts) {
  const shape = new THREE.Shape()
  shape.moveTo(pts[0].x, pts[0].y)
  for (let i=1; i<pts.length; i++) shape.lineTo(pts[i].x, pts[i].y)
  shape.closePath()
  return shape
}

/**
 * Build a solid mesh for a given profile + depth + plane.
 *
 * @param {Array}  pts      Sketch-space profile points [{x,y}]
 * @param {number} depth    Extrusion depth in world units (same as sketch units)
 * @param {string} planeId  'XY' | 'XZ' | 'YZ'
 * @param {string} color    Hex colour string e.g. '#4488ff'
 * @returns {THREE.Group}   Group containing mesh + wireframe edges
 */
export function buildSolid(pts, depth, planeId, color='#4488cc', facePlane=null) {
  const shape = profileToShape(pts)
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })

  if (facePlane && facePlane.uAxis) {
    // Arbitrary face plane — build a rotation matrix from the face axes
    // ExtrudeGeometry: shape is in local XY, extrudes along local +Z
    // We need: local X → uAxis, local Y → vAxis, local Z → normal
    const mat4 = new THREE.Matrix4().makeBasis(
      facePlane.uAxis,
      facePlane.vAxis,
      facePlane.normal
    )
    // Un-flip Y (sketch Y-down → face vAxis)
    geo.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1))
    geo.applyMatrix4(mat4)
    // Translate to face origin
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
      facePlane.origin.x, facePlane.origin.y, facePlane.origin.z
    ))
  } else {
    switch(planeId) {
      case 'XY':
        geo.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1))
        break
      case 'XZ':
        geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1))
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI/2))
        break
      case 'YZ':
        geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1))
        geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI/2))
        break
    }
  }

  const group = new THREE.Group()
  group.userData.isSolid = true
  group.userData.planeId = planeId

  // Solid face mesh — polygonOffset pushes it back slightly so sketch
  // lines with depthTest:false still render visibly on top
  const mat = new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 3
  group.add(mesh)

  // Wireframe edges
  const edgesGeo = new THREE.EdgesGeometry(geo, 15)   // 15° threshold
  const edgesMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
    depthTest: true,
  })
  const edges = new THREE.LineSegments(edgesGeo, edgesMat)
  edges.renderOrder = 4
  group.add(edges)

  return group
}

/**
 * Given a list of profiles and a 2D click point in sketch space,
 * return the index of the first profile that contains the point, or -1.
 * Uses ray-casting point-in-polygon test.
 */
export function pickProfile(profiles, clickPt) {
  for (let pi = 0; pi < profiles.length; pi++) {
    if (pointInPolygon(clickPt, profiles[pi])) return pi
  }
  return -1
}

function pointInPolygon(pt, poly) {
  let inside = false
  const {x, y} = pt
  for (let i=0, j=poly.length-1; i<poly.length; j=i++) {
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y
    if (((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside
  }
  return inside
}

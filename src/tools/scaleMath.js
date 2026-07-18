import { SELECT_DIST, norm2pi, zoomRef } from '../constants.js'
import { angleOnArc } from '../geometry/intersections.js'
import { distToSeg } from './trimDelete.js'
import { distToSpline } from './splineMath.js'

export function nearestScaleEntity(mouse, lines, circles, arcs, splines = []) {
  const sd = SELECT_DIST / zoomRef.scale
  let best = null, bestDist = sd + 1
  lines.forEach((l, idx) => {
    if (l.ghostRef) return
    const d = distToSeg(mouse.x, mouse.y, l.x1, l.y1, l.x2, l.y2)
    if (d < bestDist) { bestDist = d; best = { kind: 'line', idx } }
  })
  circles.forEach((c, idx) => {
    if (c.ghostRef) return
    const d = Math.abs(Math.hypot(mouse.x - c.cx, mouse.y - c.cy) - c.r)
    if (d < bestDist) { bestDist = d; best = { kind: 'circle', idx } }
  })
  arcs.forEach((arc, idx) => {
    if (arc.ghostRef) return
    const angle = norm2pi(Math.atan2(mouse.y - arc.cy, mouse.x - arc.cx))
    if (!angleOnArc(angle, arc.startAngle, arc.endAngle)) return
    const d = Math.abs(Math.hypot(mouse.x - arc.cx, mouse.y - arc.cy) - arc.r)
    if (d < bestDist) { bestDist = d; best = { kind: 'arc', idx } }
  })
  splines.forEach((sp, idx) => {
    if (sp.ghostRef) return
    if (sp.points.length < 2) return
    const d = distToSpline(mouse.x, mouse.y, sp.points, sp.closed)
    if (d < bestDist) { bestDist = d; best = { kind: 'spline', idx } }
  })
  return best
}

function scalePoint(px, py, ax, ay, s) {
  return { x: ax + (px - ax) * s, y: ay + (py - ay) * s }
}

export function buildScaled(sel, lines, circles, arcs, splines = [], ax, ay, s) {
  const newLines = [], newCircles = [], newArcs = [], newSplines = []
  for (const e of sel) {
    if (e.kind === 'line') {
      const l = lines[e.idx]
      const p1 = scalePoint(l.x1, l.y1, ax, ay, s)
      const p2 = scalePoint(l.x2, l.y2, ax, ay, s)
      newLines.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, ...(l.style?{style:l.style}:{}) })
    }
    if (e.kind === 'circle') {
      const c = circles[e.idx]
      const cp = scalePoint(c.cx, c.cy, ax, ay, s)
      newCircles.push({ cx: cp.x, cy: cp.y, r: c.r * Math.abs(s), ...(c.style?{style:c.style}:{}) })
    }
    if (e.kind === 'arc') {
      const a = arcs[e.idx]
      const cp = scalePoint(a.cx, a.cy, ax, ay, s)
      newArcs.push({ cx: cp.x, cy: cp.y, r: a.r * Math.abs(s), startAngle: a.startAngle, endAngle: a.endAngle, ...(a.style?{style:a.style}:{}) })
    }
    if (e.kind === 'spline') {
      const sp = splines[e.idx]
      newSplines.push({
        points: sp.points.map(p => scalePoint(p.x, p.y, ax, ay, s)),
        closed: sp.closed,
        ...(sp.polyline?{polyline:true}:{}),
        ...(sp.style?{style:sp.style}:{})
      })
    }
  }
  return { newLines, newCircles, newArcs, newSplines }
}

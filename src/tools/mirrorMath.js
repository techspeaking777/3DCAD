import { SELECT_DIST, norm2pi, zoomRef } from '../constants.js'
import { angleOnArc } from '../geometry/intersections.js'
import { distToSeg } from './trimDelete.js'
import { distToSpline } from './splineMath.js'

function mirrorPoint(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-10) return { x: px, y: py }
  const t = ((px - x1) * dx + (py - y1) * dy) / len2
  const fx = x1 + t * dx, fy = y1 + t * dy
  return { x: 2 * fx - px, y: 2 * fy - py }
}

export function mirrorLine(line, x1, y1, x2, y2) {
  const p1 = mirrorPoint(line.x1, line.y1, x1, y1, x2, y2)
  const p2 = mirrorPoint(line.x2, line.y2, x1, y1, x2, y2)
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, ...(line.style?{style:line.style}:{}) }
}

export function mirrorCircle(circle, x1, y1, x2, y2) {
  const c = mirrorPoint(circle.cx, circle.cy, x1, y1, x2, y2)
  return { cx: c.x, cy: c.y, r: circle.r, ...(circle.style?{style:circle.style}:{}) }
}

export function mirrorArc(arc, x1, y1, x2, y2) {
  const c = mirrorPoint(arc.cx, arc.cy, x1, y1, x2, y2)
  const lineAngle = Math.atan2(y2 - y1, x2 - x1)
  const reflectAngle = a => norm2pi(2 * lineAngle - a)
  const newStart = reflectAngle(arc.endAngle)
  const newEnd = reflectAngle(arc.startAngle)
  return { cx: c.x, cy: c.y, r: arc.r, startAngle: newStart, endAngle: newEnd, ...(arc.style?{style:arc.style}:{}) }
}

function mirrorSpline(spline, x1, y1, x2, y2) {
  return {
    points: spline.points.map(p => mirrorPoint(p.x, p.y, x1, y1, x2, y2)),
    closed: spline.closed,
    ...(spline.polyline?{polyline:true}:{}),
    ...(spline.style?{style:spline.style}:{})
  }
}

export function nearestMirrorEntity(mouse, lines, circles, arcs, splines = []) {
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

export function buildMirror(sel, lines, circles, arcs, splines = [], mx1, my1, mx2, my2) {
  const newLines = [], newCircles = [], newArcs = [], newSplines = []
  for (const e of sel) {
    if (e.kind === 'line')   newLines.push(mirrorLine(lines[e.idx], mx1, my1, mx2, my2))
    if (e.kind === 'circle') newCircles.push(mirrorCircle(circles[e.idx], mx1, my1, mx2, my2))
    if (e.kind === 'arc')    newArcs.push(mirrorArc(arcs[e.idx], mx1, my1, mx2, my2))
    if (e.kind === 'spline') newSplines.push(mirrorSpline(splines[e.idx], mx1, my1, mx2, my2))
  }
  return { newLines, newCircles, newArcs, newSplines }
}

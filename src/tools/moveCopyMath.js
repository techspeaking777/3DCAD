import { SELECT_DIST, norm2pi, zoomRef } from '../constants.js'
import { angleOnArc } from '../geometry/intersections.js'
import { distToSeg } from './trimDelete.js'
import { distToSpline } from './splineMath.js'

export function nearestMoveCopyEntity(mouse, lines, circles, arcs, splines = []) {
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

// Carry style field through translation
function translateOne(e, lines, circles, arcs, splines, dx, dy) {
  if (e.kind === 'line') {
    const l = lines[e.idx]
    return { kind: 'line', entity: { x1: l.x1+dx, y1: l.y1+dy, x2: l.x2+dx, y2: l.y2+dy, ...(l.style?{style:l.style}:{}) } }
  }
  if (e.kind === 'circle') {
    const c = circles[e.idx]
    return { kind: 'circle', entity: { cx: c.cx+dx, cy: c.cy+dy, r: c.r, ...(c.style?{style:c.style}:{}) } }
  }
  if (e.kind === 'arc') {
    const a = arcs[e.idx]
    return { kind: 'arc', entity: { cx: a.cx+dx, cy: a.cy+dy, r: a.r, startAngle: a.startAngle, endAngle: a.endAngle, ...(a.style?{style:a.style}:{}) } }
  }
  if (e.kind === 'spline') {
    const sp = splines[e.idx]
    return { kind: 'spline', entity: { points: sp.points.map(p => ({ x: p.x+dx, y: p.y+dy })), closed: sp.closed, ...(sp.polyline?{polyline:true}:{}), ...(sp.style?{style:sp.style}:{}) } }
  }
  return null
}

export function buildCopies(sel, lines, circles, arcs, splines = [], dx, dy, count) {
  const newLines = [], newCircles = [], newArcs = [], newSplines = []
  for (let i = 1; i <= count; i++) {
    for (const e of sel) {
      const t = translateOne(e, lines, circles, arcs, splines, dx * i, dy * i)
      if (!t) continue
      if (t.kind === 'line')   newLines.push(t.entity)
      if (t.kind === 'circle') newCircles.push(t.entity)
      if (t.kind === 'arc')    newArcs.push(t.entity)
      if (t.kind === 'spline') newSplines.push(t.entity)
    }
  }
  return { newLines, newCircles, newArcs, newSplines }
}

export function removeSelected(sel, lines, circles, arcs, splines = []) {
  return {
    lines:   lines.filter((_,i)   => !sel.some(e=>e.kind==='line'  &&e.idx===i)),
    circles: circles.filter((_,i) => !sel.some(e=>e.kind==='circle'&&e.idx===i)),
    arcs:    arcs.filter((_,i)    => !sel.some(e=>e.kind==='arc'   &&e.idx===i)),
    splines: splines.filter((_,i) => !sel.some(e=>e.kind==='spline'&&e.idx===i)),
  }
}

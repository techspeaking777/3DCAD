import { TRIM_DIST, norm2pi, zoomRef } from '../constants.js'
import { angleOnArc } from '../geometry/intersections.js'
import { distToSeg } from './trimDelete.js'
import { splineToPolyline } from './splineMath.js'

function extendedIntersections(lineIdx, lines, circles, arcs, splines = []) {
  const l = lines[lineIdx]
  const { x1, y1, x2, y2 } = l
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-10) return []
  const results = []

  // vs lines
  lines.forEach((other, i) => {
    if (i === lineIdx) return
    const odx = other.x2 - other.x1, ody = other.y2 - other.y1
    const d = dx * ody - dy * odx
    if (Math.abs(d) < 1e-10) return
    const t = ((other.x1 - x1) * ody - (other.y1 - y1) * odx) / d
    const s = ((other.x1 - x1) * dy - (other.y1 - y1) * dx) / d
    if (s >= -1e-8 && s <= 1 + 1e-8) results.push(t)
  })

  const rayVsCircle = (cx, cy, r) => {
    const fx = x1 - cx, fy = y1 - cy
    const a = dx * dx + dy * dy
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - r * r
    const disc = b * b - 4 * a * c
    if (disc < 0) return []
    return [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]
  }

  // vs circles
  circles.forEach(c => rayVsCircle(c.cx, c.cy, c.r).forEach(t => results.push(t)))

  // vs arcs
  arcs.forEach(arc => {
    rayVsCircle(arc.cx, arc.cy, arc.r).forEach(t => {
      const px = x1 + t * dx, py = y1 + t * dy
      const angle = norm2pi(Math.atan2(py - arc.cy, px - arc.cx))
      if (angleOnArc(angle, arc.startAngle, arc.endAngle)) results.push(t)
    })
  })

  // vs splines — sample each spline into polyline segments and ray-test each segment
  splines.forEach(sp => {
    if (!sp || !sp.points || sp.points.length < 2) return
    const pts = splineToPolyline(sp.points, sp.closed, 48)
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x,   ay = pts[i].y
      const bx = pts[i+1].x, by = pts[i+1].y
      const sdx = bx - ax, sdy = by - ay
      const denom = dx * sdy - dy * sdx
      if (Math.abs(denom) < 1e-10) continue
      const t = ((ax - x1) * sdy - (ay - y1) * sdx) / denom
      const s = ((ax - x1) * dy  - (ay - y1) * dx)  / denom
      if (s >= -1e-8 && s <= 1 + 1e-8) results.push(t)
    }
  })

  return results
}

export function computeExtendPreview(mouse, lines, circles, arcs, splines = []) {
  const td = TRIM_DIST / zoomRef.scale
  const END_THRESH = td * 2
  let bestDist = END_THRESH + 1
  let target = null
  lines.forEach((l, idx) => {
    const d1 = Math.hypot(mouse.x - l.x1, mouse.y - l.y1)
    const d2 = Math.hypot(mouse.x - l.x2, mouse.y - l.y2)
    const d = Math.min(d1, d2)
    if (d < bestDist) { bestDist = d; target = { idx, end: d1 < d2 ? 1 : 2 } }
  })
  if (!target) return null
  const l = lines[target.idx]
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1
  const allT = extendedIntersections(target.idx, lines, circles, arcs, splines)
  let newT, boundaryPt
  if (target.end === 1) {
    const candidates = allT.filter(t => t < -1e-4)
    if (!candidates.length) return null
    newT = Math.max(...candidates)
    boundaryPt = { x: l.x1 + newT * dx, y: l.y1 + newT * dy }
    return {
      idx: target.idx, end: 1,
      newLine: { x1: boundaryPt.x, y1: boundaryPt.y, x2: l.x2, y2: l.y2, ...(l.style?{style:l.style}:{}) },
      extStart: boundaryPt, extEnd: { x: l.x1, y: l.y1 },
    }
  } else {
    const candidates = allT.filter(t => t > 1 + 1e-4)
    if (!candidates.length) return null
    newT = Math.min(...candidates)
    boundaryPt = { x: l.x1 + newT * dx, y: l.y1 + newT * dy }
    return {
      idx: target.idx, end: 2,
      newLine: { x1: l.x1, y1: l.y1, x2: boundaryPt.x, y2: boundaryPt.y, ...(l.style?{style:l.style}:{}) },
      extStart: { x: l.x2, y: l.y2 }, extEnd: boundaryPt,
    }
  }
}

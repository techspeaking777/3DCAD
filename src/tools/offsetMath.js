import { SELECT_DIST, norm2pi, zoomRef } from '../constants.js'
import { angleOnArc } from '../geometry/intersections.js'
import { distToSeg } from './trimDelete.js'
import { distToSpline } from './splineMath.js'

// Needed by filletMath.js
export function infLineIntersect(ax1,ay1,ax2,ay2,bx1,by1,bx2,by2) {
  const dx1=ax2-ax1,dy1=ay2-ay1,dx2=bx2-bx1,dy2=by2-by1
  const d=dx1*dy2-dy1*dx2
  if (Math.abs(d)<1e-10) return null
  const t=((bx1-ax1)*dy2-(by1-ay1)*dx2)/d
  return {x:ax1+t*dx1,y:ay1+t*dy1}
}

// ── Nearest entity hover ──────────────────────────────────────────────────────
export function nearestOffsetEntity(mouse, lines, circles, arcs, splines=[]) {
  const sd = SELECT_DIST / zoomRef.scale
  let best = null, bestDist = sd + 1

  lines.forEach((l, idx) => {
    const d = distToSeg(mouse.x, mouse.y, l.x1, l.y1, l.x2, l.y2)
    if (d < bestDist) { bestDist = d; best = { kind: 'line', idx } }
  })
  circles.forEach((c, idx) => {
    const d = Math.abs(Math.hypot(mouse.x - c.cx, mouse.y - c.cy) - c.r)
    if (d < bestDist) { bestDist = d; best = { kind: 'circle', idx } }
  })
  arcs.forEach((arc, idx) => {
    const angle = norm2pi(Math.atan2(mouse.y - arc.cy, mouse.x - arc.cx))
    if (!angleOnArc(angle, arc.startAngle, arc.endAngle)) return
    const d = Math.abs(Math.hypot(mouse.x - arc.cx, mouse.y - arc.cy) - arc.r)
    if (d < bestDist) { bestDist = d; best = { kind: 'arc', idx } }
  })
  splines.forEach((sp, idx) => {
    if (sp.points.length < 2) return
    const d = distToSpline(mouse.x, mouse.y, sp.points, sp.closed)
    if (d < bestDist) { bestDist = d; best = { kind: 'spline', idx } }
  })
  return best
}

// ── Offset distance from mouse to entity ─────────────────────────────────────
export function distToEntity(mouse, entity, kind) {
  if (kind === 'line') {
    const { x1, y1, x2, y2 } = entity
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy)
    if (len < 1e-10) return 0
    return Math.abs((mouse.x - x1) * (-dy / len) + (mouse.y - y1) * (dx / len))
  }
  if (kind === 'circle' || kind === 'arc') {
    return Math.abs(Math.hypot(mouse.x - entity.cx, mouse.y - entity.cy) - entity.r)
  }
  if (kind === 'spline') {
    return distToSpline(mouse.x, mouse.y, entity.points, entity.closed)
  }
  return 0
}

// ── Signed side for line (which side of the line is the mouse on) ─────────────
export function sideOfLine(mouse, line) {
  const { x1, y1, x2, y2 } = line
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy)
  if (len < 1e-10) return 1
  return ((mouse.x - x1) * (-dy / len) + (mouse.y - y1) * (dx / len)) > 0 ? 1 : -1
}

// ── Compute offset preview ────────────────────────────────────────────────────
// Returns { kind, ...entity } ready to draw as dashed preview, or null.
export function computeOffsetPreview(entity, kind, distPx, mouse) {
  if (!entity || distPx <= 0) return null

  if (kind === 'line') {
    const { x1, y1, x2, y2 } = entity
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy)
    if (len < 1e-10) return null
    const side = sideOfLine(mouse, entity)
    const nx = -dy / len * side, ny = dx / len * side
    return { kind: 'line', x1: x1 + nx * distPx, y1: y1 + ny * distPx,
                           x2: x2 + nx * distPx, y2: y2 + ny * distPx,
                           ...(entity.style?{style:entity.style}:{}) }
  }

  if (kind === 'circle') {
    const { cx, cy, r } = entity
    const side = Math.hypot(mouse.x - cx, mouse.y - cy) > r ? 1 : -1
    const newR = Math.max(1, r + side * distPx)
    return { kind: 'circle', cx, cy, r: newR, ...(entity.style?{style:entity.style}:{}) }
  }

  if (kind === 'arc') {
    const { cx, cy, r, startAngle, endAngle } = entity
    const side = Math.hypot(mouse.x - cx, mouse.y - cy) > r ? 1 : -1
    const newR = Math.max(1, r + side * distPx)
    return { kind: 'arc', cx, cy, r: newR, startAngle, endAngle, ...(entity.style?{style:entity.style}:{}) }
  }

  if (kind === 'spline') {
    // Move each control point along its local normal
    const pts = entity.points
    const n = pts.length
    if (n < 2) return null

    // Determine which side of the spline the mouse is on
    // Use the closest segment's normal
    let minD = Infinity, closestNormal = { x: 0, y: -1 }
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i+1].x - pts[i].x, dy = pts[i+1].y - pts[i].y
      const len = Math.hypot(dx, dy)
      if (len < 1e-10) continue
      const d = distToSeg(mouse.x, mouse.y, pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y)
      if (d < minD) {
        minD = d
        // Normal pointing to the right of the segment direction
        closestNormal = { x: dy / len, y: -dx / len }
      }
    }
    const dot = (mouse.x - pts[0].x) * closestNormal.x + (mouse.y - pts[0].y) * closestNormal.y
    const side = dot >= 0 ? 1 : -1

    // Offset each point along averaged segment normals
    const newPts = pts.map((p, i) => {
      let nx = 0, ny = 0, count = 0
      if (i > 0) {
        const dx = p.x - pts[i-1].x, dy = p.y - pts[i-1].y
        const len = Math.hypot(dx, dy)
        if (len > 1e-10) { nx += dy / len; ny += -dx / len; count++ }
      }
      if (i < n - 1) {
        const dx = pts[i+1].x - p.x, dy = pts[i+1].y - p.y
        const len = Math.hypot(dx, dy)
        if (len > 1e-10) { nx += dy / len; ny += -dx / len; count++ }
      }
      if (count > 0) { nx /= count; ny /= count }
      const nlen = Math.hypot(nx, ny)
      if (nlen > 1e-10) { nx /= nlen; ny /= nlen }
      return { x: p.x + nx * distPx * side, y: p.y + ny * distPx * side }
    })
    return { kind: 'spline', points: newPts, closed: entity.closed, polyline: entity.polyline }
  }

  return null
}

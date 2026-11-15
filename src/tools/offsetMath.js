import { SELECT_DIST, norm2pi, zoomRef } from '../constants.js'
import { angleOnArc } from '../geometry/intersections.js'
import { distToSeg } from './trimDelete.js'
import { distToSpline, sampleSpline } from './splineMath.js'
import { fitSplineToPoints } from './splineFit.js'

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
                           // Construction geometry (e.g. an Include Edge reference line)
                           // deliberately does NOT carry over — offsetting it is exactly
                           // how you turn reference geometry into a real, extrudable
                           // profile line, and detectProfiles ignores construction-style
                           // entities entirely (see extrudeMath.js), so inheriting it here
                           // would silently make the offset result un-extrudable.
                           ...(entity.style&&entity.style!=='construction'?{style:entity.style}:{}) }
  }

  if (kind === 'circle') {
    const { cx, cy, r } = entity
    const side = Math.hypot(mouse.x - cx, mouse.y - cy) > r ? 1 : -1
    const newR = Math.max(1, r + side * distPx)
    return { kind: 'circle', cx, cy, r: newR, ...(entity.style&&entity.style!=='construction'?{style:entity.style}:{}) }
  }

  if (kind === 'arc') {
    const { cx, cy, r, startAngle, endAngle } = entity
    const side = Math.hypot(mouse.x - cx, mouse.y - cy) > r ? 1 : -1
    const newR = Math.max(1, r + side * distPx)
    return { kind: 'arc', cx, cy, r: newR, startAngle, endAngle, ...(entity.style&&entity.style!=='construction'?{style:entity.style}:{}) }
  }

  if (kind === 'spline') {
    const pts = offsetSplinePoints(entity, distPx, mouse)
    if (!pts) return null
    const closed = !!entity.closed
    const style = entity.style && entity.style !== 'construction' ? { style: entity.style } : {}
    // The preview is the exact offset curve (dense points — fitting is too slow
    // for every mouse move); finalOffsetSpline turns it into the stored entity.
    // refitMax set = a drawn spline, to be fitted back to an editable spline.
    return { kind: 'spline', points: pts, closed, polyline: true, ...style,
      ...(entity.polyline ? {} : { refitMax: Math.max(40, entity.points.length * 3) }) }
  }

  return null
}

// The spline entity an offset preview becomes. A trimmed / imported (polyline)
// spline stays a polyline — it may have real corners. A drawn spline gets an
// editable spline fitted back through the offset curve (within 0.1 mm, else 0.2 mm);
// if no fit is that close (a loop was cut out, leaving a corner) the dense curve
// is kept — it still builds as one smooth curve in 3D (polylineCurveRuns).
export function finalOffsetSpline(prev) {
  const style = prev.style ? { style: prev.style } : {}
  if (prev.refitMax) {
    const fit = fitSplineToPoints(prev.points, prev.closed, 0.2, prev.refitMax)
      || fitSplineToPoints(prev.points, prev.closed, 0.4, prev.refitMax)   // closed curves: 0.2 mm
    if (fit) return { points: fit.points, closed: prev.closed, ...style }
  }
  return { points: prev.points, closed: prev.closed, polyline: true, ...style }
}

// The TRUE offset of a spline: the curve itself (a drawn spline sampled finely,
// a polyline spline's own points) moved sideways by exactly distPx — each point
// along the bisector of its two neighbouring spans, stretched by 1/cos(half the
// turn) so corners keep the full distance too. Offsetting the control points
// instead (the old way) was only right AT them: a 3 mm offset of a wavy line
// came out thinner and thicker in between. The side is the one the mouse is on,
// judged against the span nearest the mouse (it used to use the first point,
// which could flip it). Small loops an inside offset forms at a bend tighter
// than the distance are cut out, as other CAD programs do.
export function offsetSplinePoints(entity, distPx, mouse) {
  const closed = !!entity.closed
  let P = entity.polyline ? entity.points.map(q => ({ x: q.x, y: q.y })) : sampleSpline(entity.points, closed, 16)
  P = P.filter((q, i) => i === 0 || Math.hypot(q.x - P[i-1].x, q.y - P[i-1].y) > 1e-6)
  if (closed && P.length > 2 && Math.hypot(P[0].x - P[P.length-1].x, P[0].y - P[P.length-1].y) < 1e-6) P.pop()
  const n = P.length
  if (n < 2) return null
  const spanNormal = i => {
    const a = P[(i + n) % n], b = P[(i + 1) % n]
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy)
    return L < 1e-9 ? null : { x: dy / L, y: -dx / L }
  }
  const spans = closed ? n : n - 1
  let best = Infinity, side = 1
  for (let i = 0; i < spans; i++) {
    const a = P[i], b = P[(i + 1) % n]
    const d = distToSeg(mouse.x, mouse.y, a.x, a.y, b.x, b.y)
    const nm = spanNormal(i)
    if (nm && d < best) { best = d; side = (mouse.x - a.x) * nm.x + (mouse.y - a.y) * nm.y >= 0 ? 1 : -1 }
  }
  const d = distPx * side
  const out = P.map((q, i) => {
    const nA = (i > 0 || closed) ? spanNormal(i - 1) : null
    const nB = (i < n - 1 || closed) ? spanNormal(i) : null
    if (nA && nB) {
      let nx = nA.x + nB.x, ny = nA.y + nB.y
      const L = Math.hypot(nx, ny)
      if (L < 1e-9) return { x: q.x + nB.x * d, y: q.y + nB.y * d }
      nx /= L; ny /= L
      const k = 1 / Math.max(nx * nB.x + ny * nB.y, 0.25)   // mitre, capped at 4×
      return { x: q.x + nx * d * k, y: q.y + ny * d * k }
    }
    const nm = nA || nB
    return nm ? { x: q.x + nm.x * d, y: q.y + nm.y * d } : { x: q.x, y: q.y }
  })
  return removeOffsetLoops(out, P, Math.abs(d) * 4)
}

// Cuts out self-crossing loops that only span a short stretch of the original
// curve (window = that much original length) — an inside offset round a bend
// tighter than the distance; a far-apart crossing is left alone.
function removeOffsetLoops(pts, orig, window) {
  const cum = [0]
  for (let i = 1; i < orig.length; i++) cum.push(cum[i-1] + Math.hypot(orig[i].x - orig[i-1].x, orig[i].y - orig[i-1].y))
  const seg = (a, b, c, e) => {
    const r = { x: b.x - a.x, y: b.y - a.y }, s2 = { x: e.x - c.x, y: e.y - c.y }
    const den = r.x * s2.y - r.y * s2.x
    if (Math.abs(den) < 1e-12) return null
    const t = ((c.x - a.x) * s2.y - (c.y - a.y) * s2.x) / den
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? { x: a.x + t * r.x, y: a.y + t * r.y } : null
  }
  const o = pts.slice(), idx = orig.map((_, i) => i)   // idx: which original point each offset point came from
  for (let i = 0; i < o.length - 1; i++) {
    for (let j = o.length - 2; j > i + 1; j--) {
      if (cum[idx[j]] - cum[idx[i]] > window) continue
      const X = seg(o[i], o[i+1], o[j], o[j+1])
      if (X) { o.splice(i + 1, j - i, X); idx.splice(i + 1, j - i, idx[i]); break }
    }
  }
  return o
}

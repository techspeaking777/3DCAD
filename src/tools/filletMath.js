import { SELECT_DIST, zoomRef } from '../constants.js'
import { distToSeg } from './trimDelete.js'

// Find nearest line to cursor for fillet selection
export function nearestFilletLine(mouse, lines) {
  const sd = SELECT_DIST / zoomRef.scale
  let best = null, bestDist = sd + 1
  lines.forEach((l, idx) => {
    if (l.ghostRef) return
    const d = distToSeg(mouse.x, mouse.y, l.x1, l.y1, l.x2, l.y2)
    if (d < bestDist) { bestDist = d; best = { kind: 'line', idx, clickPt: { x: mouse.x, y: mouse.y } } }
  })
  return best
}

// Inline — no longer imported from offsetMath
function infLineIntersect(ax1,ay1,ax2,ay2,bx1,by1,bx2,by2) {
  const dx1=ax2-ax1,dy1=ay2-ay1,dx2=bx2-bx1,dy2=by2-by1
  const d=dx1*dy2-dy1*dx2
  if (Math.abs(d)<1e-10) return null
  const t=((bx1-ax1)*dy2-(by1-ay1)*dx2)/d
  return {x:ax1+t*dx1,y:ay1+t*dy1}
}

const norm2pi = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

// Compute fillet between two lines.
// Returns { newL1, newL2, arc, T1, T2, C, P } or null if not possible.
// clickPt1/2 are where the user clicked on each line — used to determine
// which direction from the intersection to keep.
export function computeFillet(l1, l2, r, clickPt1, clickPt2) {
  if (r <= 0) return null

  // Infinite line intersection
  const P = infLineIntersect(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2)
  if (!P) return null // parallel lines

  // Unit vectors FROM P along each line toward the kept side
  const orient = (l, clickPt) => {
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1
    const len = Math.hypot(dx, dy)
    if (len < 1e-10) return null
    const ux = dx / len, uy = dy / len
    const ref = clickPt || { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 }
    const dot = (ref.x - P.x) * ux + (ref.y - P.y) * uy
    return dot >= 0 ? { x: ux, y: uy } : { x: -ux, y: -uy }
  }

  const u1 = orient(l1, clickPt1)
  const u2 = orient(l2, clickPt2)
  if (!u1 || !u2) return null

  const dotProd = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))
  const angle = Math.acos(dotProd)
  if (angle < 0.01 || angle > Math.PI - 0.01) return null // parallel / collinear

  // Distance from P to each tangent point
  const tl = r / Math.tan(angle / 2)

  // Tangent points on each line
  const T1 = { x: P.x + tl * u1.x, y: P.y + tl * u1.y }
  const T2 = { x: P.x + tl * u2.x, y: P.y + tl * u2.y }

  // Arc centre: perpendicular from T1, in the direction of the interior
  const na = { x: -u1.y, y: u1.x }
  const nb = { x: u1.y, y: -u1.x }
  const dotNa = (T2.x - T1.x) * na.x + (T2.y - T1.y) * na.y
  const n1 = dotNa > 0 ? na : nb

  const C = { x: T1.x + r * n1.x, y: T1.y + r * n1.y }

  // Arc angles from centre
  const aT1 = Math.atan2(T1.y - C.y, T1.x - C.x)
  const aT2 = Math.atan2(T2.y - C.y, T2.x - C.x)

  // Pick the arc direction (CW in canvas = increasing angle) that stays on the inner side
  const s = norm2pi(aT1), e = norm2pi(aT2)
  const span = e >= s ? e - s : 2 * Math.PI - (s - e)
  const midA_angle = s + span / 2
  const midA_pt = { x: C.x + r * Math.cos(midA_angle), y: C.y + r * Math.sin(midA_angle) }
  const midB_pt = { x: C.x + r * Math.cos(midA_angle + Math.PI), y: C.y + r * Math.sin(midA_angle + Math.PI) }

  const distA = Math.hypot(midA_pt.x - P.x, midA_pt.y - P.y)
  const distB = Math.hypot(midB_pt.x - P.x, midB_pt.y - P.y)

  // Inner arc = arc whose midpoint is closer to P (inside corner)
  const arcStart = distA < distB ? aT1 : aT2
  const arcEnd   = distA < distB ? aT2 : aT1

  // Trim each line: keep from far endpoint to tangent point
  const trimLine = (l, T) => {
    const d1 = Math.hypot(l.x1 - P.x, l.y1 - P.y)
    const d2 = Math.hypot(l.x2 - P.x, l.y2 - P.y)
    return d1 > d2
      ? { x1: l.x1, y1: l.y1, x2: T.x, y2: T.y }
      : { x1: T.x, y1: T.y, x2: l.x2, y2: l.y2 }
  }

  // Check tangent points are within or near the line segments (warn if not)
  // tl should be less than each line's length to be a valid fillet
  const len1 = Math.hypot(l1.x2-l1.x1, l1.y2-l1.y1)
  const len2 = Math.hypot(l2.x2-l2.x1, l2.y2-l2.y1)
  if (tl > len1 * 1.01 || tl > len2 * 1.01) return { tooLarge: true, r, tl, T1, T2, C, P }

  return {
    newL1: trimLine(l1, T1),
    newL2: trimLine(l2, T2),
    arc: { cx: C.x, cy: C.y, r, startAngle: arcStart, endAngle: arcEnd },
    T1, T2, C, P
  }
}

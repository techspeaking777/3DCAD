import { sampleSpline } from './splineMath.js'

// Pure helpers for the Select tool's spline point editing: drag a point, add
// one on the curve, delete one. A spline is `{points:[{x,y}...], closed, ...}`
// drawn as a Catmull-Rom curve THROUGH its points, so moving/adding/removing a
// point is all the editing there is — there are no handles. Every function
// returns a new spline object and never mutates its input.

const SEG_SAMPLES = 16   // samples per control segment — only used to map a curve position back to a segment

// Hand-drawn splines only. A `polyline` spline (trimmed or Text-tool output) is
// hundreds of dense points, and a `ghostRef` one is another feature's reference
// — neither makes sense to edit point by point.
export function isEditableSpline(sp) {
  return !!sp && !sp.polyline && !sp.ghostRef && Array.isArray(sp.points) && sp.points.length >= 2
}

// Index of the control point nearest `pos` within `radius` (world units), or -1.
export function hitSplineNode(sp, pos, radius) {
  let best = -1, bestDist = radius
  sp.points.forEach((p, i) => {
    const d = Math.hypot(p.x - pos.x, p.y - pos.y)
    if (d <= bestDist) { bestDist = d; best = i }
  })
  return best
}

export function moveSplineNode(sp, index, pt) {
  return { ...sp, points: sp.points.map((p, i) => i === index ? { ...p, x: pt.x, y: pt.y } : p) }
}

// Adds a control point on the curve at the spot nearest `pos` (at most
// `maxDist` away). It goes into the right place in the point order — between
// the two points whose curve segment it landed on — so the spline keeps its
// shape and direction. Returns { sp, index } or null if `pos` isn't near the curve.
export function insertSplineNode(sp, pos, maxDist) {
  const n = sp.points.length
  const sampled = sampleSpline(sp.points, sp.closed, SEG_SAMPLES)
  let best = null
  for (let k = 0; k < sampled.length - 1; k++) {
    const a = sampled[k], b = sampled[k + 1]
    const dx = b.x - a.x, dy = b.y - a.y, lenSq = dx * dx + dy * dy
    const t = lenSq ? Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / lenSq)) : 0
    const fx = a.x + t * dx, fy = a.y + t * dy
    const d = Math.hypot(pos.x - fx, pos.y - fy)
    if (!best || d < best.d) best = { d, k, x: fx, y: fy }
  }
  if (!best || best.d > maxDist) return null
  const segCount = sp.closed ? n : n - 1
  const seg = Math.min(Math.floor(best.k / SEG_SAMPLES), segCount - 1)
  const index = seg + 1
  const points = [...sp.points.slice(0, index), { x: best.x, y: best.y }, ...sp.points.slice(index)]
  return { sp: { ...sp, points }, index }
}

// Removes a control point. Returns null when that would leave too few points
// to be a spline (2 for an open one, 3 for a closed loop) — the caller says so.
export function deleteSplineNode(sp, index) {
  const min = sp.closed ? 3 : 2
  if (sp.points.length <= min) return null
  return { ...sp, points: sp.points.filter((_, i) => i !== index) }
}

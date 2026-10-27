import { sampleSpline } from './splineMath.js'
import { distToSeg } from './trimDelete.js'

// Fits a Catmull-Rom spline (the app's one spline kind) to a dense run of
// points — the tessellated form of a solid edge that is neither a line, a
// circle nor an arc (ellipse, spline, cylinder–cylinder intersection, …).
//
// Tries 4, 5, 6 … points spaced evenly in a length-plus-bend measure along the
// edge (Catmull-Rom behaves best with even spacing; picking the worst-fitting
// points instead made it overshoot) and keeps the first count where every
// original point is within `tol` of the curve. The bend term puts more points
// where the curve turns tightly and fewer on flat stretches.
//
// Returns { points, closed } in the same units as `pts`, or null when it can't
// reach `tol` within `maxPts` (a sharp corner, a degenerate projection) — the
// caller then keeps the faceted-line fallback rather than a wrong curve.
export function fitSplineToPoints(pts, closed, tol = 0.4, maxPts = 40) {
  let src = pts
  if (closed && src.length > 1) {
    const f = src[0], l = src[src.length - 1]
    if (Math.hypot(l.x - f.x, l.y - f.y) < 1e-6) src = src.slice(0, -1)
  }
  const n = src.length
  if (n < (closed ? 8 : 4)) return null

  // step[i] = effort of walking from point i to i+1 (wrapping when closed):
  // half its share of the length, half its share of the total bend.
  const segs = closed ? n : n - 1
  const at = i => src[(i + n) % n]
  const segLen = i => Math.hypot(at(i+1).x - at(i).x, at(i+1).y - at(i).y)
  const turn = i => {   // bend at point i
    if (!closed && (i <= 0 || i >= n - 1)) return 0
    const a1 = Math.atan2(at(i).y - at(i-1).y, at(i).x - at(i-1).x)
    const a2 = Math.atan2(at(i+1).y - at(i).y, at(i+1).x - at(i).x)
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d
    return d
  }
  let lenTot = 0, turnTot = 0
  for (let i = 0; i < segs; i++) lenTot += segLen(i)
  for (let i = 0; i < n; i++) turnTot += turn(i)
  if (lenTot < 1e-6) return null
  const step = i => 0.5 * segLen(i) / lenTot + (turnTot > 1e-9 ? 0.25 * (turn(i) + turn(i + 1)) / turnTot : 0)
  const cum = [0]
  for (let i = 0; i < segs; i++) cum.push(cum[i] + step(i))
  const total = cum[segs]

  const pickEven = k => {
    const idx = new Set([0])
    if (!closed) idx.add(n - 1)
    const steps = closed ? k : k - 1
    for (let j = 1; j < steps; j++) {
      const target = total * j / steps
      let best = 1, bd = Infinity
      for (let i = 1; i < n; i++) { const d = Math.abs(cum[i] - target); if (d < bd) { bd = d; best = i } }
      idx.add(best)
    }
    return [...idx].sort((a, b) => a - b)
  }
  const maxDev = sel => {
    const curve = sampleSpline(sel.map(i => src[i]), closed, 16)
    const chosen = new Set(sel)
    let worst = 0
    for (let i = 0; i < n; i++) {
      if (chosen.has(i)) continue
      let dev = Infinity
      for (let k = 0; k < curve.length - 1; k++) {
        const d = distToSeg(src[i].x, src[i].y, curve[k].x, curve[k].y, curve[k+1].x, curve[k+1].y)
        if (d < dev) dev = d
      }
      if (dev > worst) { worst = dev; if (worst > tol) return worst }
    }
    return worst
  }

  for (let k = closed ? 4 : 3; k <= maxPts; k++) {
    const sel = pickEven(k)
    if (sel.length < (closed ? 3 : 2)) continue
    if (maxDev(sel) <= tol) return { points: sel.map(i => ({ x: src[i].x, y: src[i].y })), closed: !!closed }
  }
  return null
}

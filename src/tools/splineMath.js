import { TRIM_DIST, zoomRef } from '../constants.js'
import { distToSeg } from './trimDelete.js'
import { segSegIntersect } from '../geometry/intersections.js'

// ── Catmull-Rom interpolation ─────────────────────────────────────────────────
function catmullRomPt(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t
  return {
    x: 0.5 * ((2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y: 0.5 * ((2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
  }
}

export function sampleSpline(pts, closed, segSamples = 16) {
  if (pts.length < 2) return pts.slice()
  const result = []
  const n = pts.length
  const ext = closed
    ? [pts[n-1], ...pts, pts[0], pts[1]]
    : [pts[0],   ...pts, pts[n-1]]
  const segCount = closed ? n : n - 1
  for (let i = 0; i < segCount; i++) {
    const p0 = ext[i], p1 = ext[i+1], p2 = ext[i+2], p3 = ext[i+3]
    for (let j = 0; j < segSamples; j++) {
      result.push(catmullRomPt(p0, p1, p2, p3, j / segSamples))
    }
  }
  if (closed) result.push(result[0])
  else result.push(pts[n-1])
  return result
}

export function distToSpline(mx, my, pts, closed) {
  const sampled = sampleSpline(pts, closed, 12)
  let min = Infinity
  for (let i = 0; i < sampled.length - 1; i++) {
    const d = distToSeg(mx, my, sampled[i].x, sampled[i].y, sampled[i+1].x, sampled[i+1].y)
    if (d < min) min = d
  }
  return min
}

export function nearestSpline(mouse, splines) {
  const dd = TRIM_DIST / zoomRef.scale
  let best = null, bestDist = dd + 1
  splines.forEach((sp, idx) => {
    if (sp.points.length < 2) return
    const d = distToSpline(mouse.x, mouse.y, sp.points, sp.closed)
    if (d < bestDist) { bestDist = d; best = { kind: 'spline', idx } }
  })
  return best
}

export function splineToPolyline(pts, closed, segSamples = 24) {
  return sampleSpline(pts, closed, segSamples)
}

// ── Spline trim support ───────────────────────────────────────────────────────
// Find all intersection points between a sampled spline polyline and all other
// geometry. Returns sorted array of {u} where u is 0..1 along the polyline.
// u=0 is spline start, u=1 is spline end.
function findSplineIntersectionUs(sampled, lines, circles, arcs, otherSplines=[]) {
  const total = sampled.length - 1  // number of polyline segments
  if (total < 1) return []
  const us = []

  sampled.forEach((a, i) => {
    if (i >= sampled.length - 1) return
    const b = sampled[i + 1]
    const segU = i / total  // u at start of this segment

    // vs lines
    lines.forEach(l => {
      const h = segSegIntersect(a.x, a.y, b.x, b.y, l.x1, l.y1, l.x2, l.y2)
      if (h) us.push(segU + h.t / total)
    })

    // vs circles
    circles.forEach(c => {
      const dx = b.x - a.x, dy = b.y - a.y
      const fx = a.x - c.cx, fy = a.y - c.cy
      const A = dx*dx + dy*dy
      const B = 2*(fx*dx + fy*dy)
      const C = fx*fx + fy*fy - c.r*c.r
      const disc = B*B - 4*A*C
      if (disc < 0) return
      [-1,1].forEach(s => {
        const t = (-B + s*Math.sqrt(disc)) / (2*A)
        if (t > 1e-6 && t < 1-1e-6) us.push(segU + t / total)
      })
    })

    // vs arcs — check circle intersection and whether angle is on arc
    arcs.forEach(arc => {
      const dx = b.x - a.x, dy = b.y - a.y
      const fx = a.x - arc.cx, fy = a.y - arc.cy
      const A = dx*dx + dy*dy
      const B = 2*(fx*dx + fy*dy)
      const C = fx*fx + fy*fy - arc.r*arc.r
      const disc = B*B - 4*A*C
      if (disc < 0) return
      [-1,1].forEach(s => {
        const t = (-B + s*Math.sqrt(disc)) / (2*A)
        if (t <= 1e-6 || t >= 1-1e-6) return
        const px = a.x + t*dx, py = a.y + t*dy
        const angle = Math.atan2(py - arc.cy, px - arc.cx)
        const norm = a => ((a % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI)
        const θ = norm(angle), s0 = norm(arc.startAngle), e0 = norm(arc.endAngle)
        const on = s0 <= e0 ? (θ >= s0 - 1e-6 && θ <= e0 + 1e-6)
                            : (θ >= s0 - 1e-6 || θ <= e0 + 1e-6)
        if (on) us.push(segU + t / total)
      })
    })

    // vs other splines — sample each and do seg-seg intersection
    otherSplines.forEach(sp => {
      if (!sp || sp.points.length < 2) return
      const n = sp.points.length
      const spSampled = sp.polyline ? sp.points : (() => {
        const ext = sp.closed
          ? [sp.points[n-1], ...sp.points, sp.points[0], sp.points[1]]
          : [sp.points[0], ...sp.points, sp.points[n-1]]
        const segs = sp.closed ? n : n - 1
        const result = []
        for (let si = 0; si < segs; si++) {
          const p0=ext[si],p1=ext[si+1],p2=ext[si+2],p3=ext[si+3]
          for (let j = 0; j < 16; j++) {
            const t=j/16,t2=t*t,t3=t2*t
            result.push({
              x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
              y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
            })
          }
        }
        result.push(sp.closed ? result[0] : sp.points[n-1])
        return result
      })()
      for (let k = 0; k < spSampled.length - 1; k++) {
        const h = segSegIntersect(a.x, a.y, b.x, b.y, spSampled[k].x, spSampled[k].y, spSampled[k+1].x, spSampled[k+1].y)
        if (h) us.push(segU + h.t / total)
      }
    })
  })

  // Deduplicate and sort
  const uniq = []
  us.sort((a, b) => a - b).forEach(u => {
    if (!uniq.some(v => Math.abs(v - u) < 1/(total*2))) uniq.push(u)
  })
  return uniq
}

// Extract a sub-polyline between u=uStart and u=uEnd from the sampled array.
// Returns array of {x,y} points.
function subPolyline(sampled, uStart, uEnd) {
  const total = sampled.length - 1
  const iStart = uStart * total
  const iEnd   = uEnd   * total
  const pts = []

  // Add interpolated start point
  const iS = Math.floor(iStart)
  const tS = iStart - iS
  if (iS < sampled.length - 1) {
    pts.push({
      x: sampled[iS].x + tS * (sampled[iS+1].x - sampled[iS].x),
      y: sampled[iS].y + tS * (sampled[iS+1].y - sampled[iS].y),
    })
  }

  // Add all full sample points between start and end
  const first = Math.ceil(iStart + 1e-6)
  const last  = Math.floor(iEnd  - 1e-6)
  for (let i = first; i <= last; i++) {
    if (i >= 0 && i < sampled.length) pts.push(sampled[i])
  }

  // Add interpolated end point
  const iE = Math.floor(iEnd)
  const tE = iEnd - iE
  if (iE < sampled.length - 1 && tE > 1e-6) {
    pts.push({
      x: sampled[iE].x + tE * (sampled[iE+1].x - sampled[iE].x),
      y: sampled[iE].y + tE * (sampled[iE+1].y - sampled[iE].y),
    })
  }

  return pts
}

// Compute spline trim preview.
// Returns { kind:'spline', idx, uStart, uEnd, highlightPts } for the segment
// under the mouse cursor, or null if no intersections found.
export function computeSplineTrimPreview(mouse, splineIdx, sp, lines, circles, arcs, allSplines=[]) {
  // For polyline (trimmed) splines, use points directly — don't re-apply Catmull-Rom
  const sampled = sp.polyline ? sp.points : sampleSpline(sp.points, sp.closed, 20)
  // Exclude self from other splines
  const otherSplines = allSplines.filter((_,i) => i !== splineIdx)
  const us = findSplineIntersectionUs(sampled, lines, circles, arcs, otherSplines)
  if (us.length < 1) return null

  // Find which u-segment the mouse is on
  let mouseU = 0
  let minDist = Infinity
  for (let i = 0; i < sampled.length - 1; i++) {
    const d = distToSeg(mouse.x, mouse.y, sampled[i].x, sampled[i].y, sampled[i+1].x, sampled[i+1].y)
    if (d < minDist) {
      minDist = d
      mouseU = (i + 0.5) / (sampled.length - 1)
    }
  }

  // Bracket us with 0 and 1 to get all regions
  const bounds = [0, ...us, 1]
  let uStart = 0, uEnd = 1
  for (let i = 0; i < bounds.length - 1; i++) {
    if (mouseU >= bounds[i] - 1e-6 && mouseU <= bounds[i+1] + 1e-6) {
      uStart = bounds[i]
      uEnd   = bounds[i+1]
      break
    }
  }

  const highlightPts = subPolyline(sampled, uStart, uEnd)
  return { kind: 'spline', idx: splineIdx, uStart, uEnd, highlightPts, fullSampled: sampled, allUs: us }
}

// Execute spline trim — replace the spline with up to 2 sub-splines (the parts outside the trimmed region).
// Since we're working with a polyline approximation, the result is stored as a polyline-based spline
// with closed=false.
export function performSplineTrim(preview, splines) {
  if (!preview) return splines
  const sp = splines[preview.idx]
  if (!sp) return splines

  const { fullSampled, uStart, uEnd } = preview
  const styleField = sp.style ? { style: sp.style } : {}
  const newSplines = splines.filter((_, i) => i !== preview.idx)

  // Part before the trim — carry style from original spline
  if (uStart > 1e-4) {
    const pts = subPolyline(fullSampled, 0, uStart)
    if (pts.length >= 2) newSplines.push({ points: pts, closed: false, polyline: true, ...styleField })
  }
  // Part after the trim — carry style from original spline
  if (uEnd < 1 - 1e-4) {
    const pts = subPolyline(fullSampled, uEnd, 1)
    if (pts.length >= 2) newSplines.push({ points: pts, closed: false, polyline: true, ...styleField })
  }

  return newSplines
}

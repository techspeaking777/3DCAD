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

// ════════════════════════════════════════════════════════════════════════════
// Fillet / Chamfer between any two picks (line or arc), and every corner of a
// shape at once. All return ONE result shape the apps apply the same way:
//   { lineUpdates:[{idx, geom}], arcUpdates:[{idx, geom}], newArcs:[...],
//     newLines:[...], marks:[{x,y}] (tangent/cut points), count }
// or { tooLarge:true } (doesn't fit), { needLines:true } (chamfer on an arc),
// or null (nothing to do yet).
// ════════════════════════════════════════════════════════════════════════════

const TAU = 2 * Math.PI
const JOIN_TOL = 2   // sketch px: ends this close are one corner

// Is angle `a` on arc (start → end, increasing, wrapping)?
function onArc(a, start, end) {
  const s = norm2pi(start), span = norm2pi(end - start) || TAU
  return norm2pi(a - s) <= span + 1e-9
}

// Nearest line OR arc to the cursor: { kind, idx, clickPt } or null.
export function nearestFilletEntity(mouse, lines, arcs = []) {
  const sd = SELECT_DIST / zoomRef.scale
  let best = null, bestDist = sd + 1
  lines.forEach((l, idx) => {
    if (l.ghostRef) return
    const d = distToSeg(mouse.x, mouse.y, l.x1, l.y1, l.x2, l.y2)
    if (d < bestDist) { bestDist = d; best = { kind: 'line', idx, clickPt: { x: mouse.x, y: mouse.y } } }
  })
  arcs.forEach((a, idx) => {
    if (a.ghostRef) return
    if (!onArc(Math.atan2(mouse.y - a.cy, mouse.x - a.cx), a.startAngle, a.endAngle)) return
    const d = Math.abs(Math.hypot(mouse.x - a.cx, mouse.y - a.cy) - a.r)
    if (d < bestDist) { bestDist = d; best = { kind: 'arc', idx, clickPt: { x: mouse.x, y: mouse.y } } }
  })
  return best
}

// ── Line–line chamfer ────────────────────────────────────────────────────────
// Cuts the corner `d` back along each line (equal distances).
export function computeChamfer(l1, l2, d, clickPt1, clickPt2) {
  if (d <= 0) return null
  const P = infLineIntersect(l1.x1, l1.y1, l1.x2, l1.y2, l2.x1, l2.y1, l2.x2, l2.y2)
  if (!P) return null
  const orient = (l, clickPt) => {
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1, len = Math.hypot(dx, dy)
    if (len < 1e-10) return null
    const ux = dx / len, uy = dy / len
    const ref = clickPt || { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 }
    return (ref.x - P.x) * ux + (ref.y - P.y) * uy >= 0 ? { x: ux, y: uy } : { x: -ux, y: -uy }
  }
  const u1 = orient(l1, clickPt1), u2 = orient(l2, clickPt2)
  if (!u1 || !u2) return null
  const ang = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)))
  if (ang < 0.01 || ang > Math.PI - 0.01) return null
  const T1 = { x: P.x + d * u1.x, y: P.y + d * u1.y }, T2 = { x: P.x + d * u2.x, y: P.y + d * u2.y }
  const len1 = Math.hypot(l1.x2 - l1.x1, l1.y2 - l1.y1), len2 = Math.hypot(l2.x2 - l2.x1, l2.y2 - l2.y1)
  // The kept part of each line runs from its far end to the cut point.
  const keep = (l, T) => Math.hypot(l.x1 - P.x, l.y1 - P.y) > Math.hypot(l.x2 - P.x, l.y2 - P.y)
    ? { x1: l.x1, y1: l.y1, x2: T.x, y2: T.y } : { x1: T.x, y1: T.y, x2: l.x2, y2: l.y2 }
  if (d > len1 * 1.01 || d > len2 * 1.01) return { tooLarge: true }
  return { newL1: keep(l1, T1), newL2: keep(l2, T2), cut: { x1: T1.x, y1: T1.y, x2: T2.x, y2: T2.y }, T1, T2 }
}

// ── Fillet with an arc in it (line–arc or arc–arc) ──────────────────────────
// The fillet centre is r from both curves: on a line's parallel offset, or on
// an arc's circle grown/shrunk by r. Every combination is intersected and the
// candidate whose tangent points land ON both picks, nearest the clicks, wins.
function offsetsOf(e) {
  if (e.kind === 'line') {
    const { x1, y1, x2, y2 } = e.g, len = Math.hypot(x2 - x1, y2 - y1)
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len
    return [1, -1].map(s => ({ s, nx, ny }))
  }
  return [1, -1].map(s => ({ s }))
}
function intersectOffsets(a, oa, b, ob, r) {
  const lineOf = (e, o) => ({ x1: e.g.x1 + o.nx * o.s * r, y1: e.g.y1 + o.ny * o.s * r, x2: e.g.x2 + o.nx * o.s * r, y2: e.g.y2 + o.ny * o.s * r })
  const circOf = (e, o) => ({ cx: e.g.cx, cy: e.g.cy, R: e.g.r + o.s * r })
  const lc = (L, C) => {
    if (C.R <= 0) return []
    const dx = L.x2 - L.x1, dy = L.y2 - L.y1, A = dx * dx + dy * dy
    const fx = L.x1 - C.cx, fy = L.y1 - C.cy
    const B = 2 * (fx * dx + fy * dy), Cc = fx * fx + fy * fy - C.R * C.R
    const disc = B * B - 4 * A * Cc
    if (disc < 0) return []
    const sq = Math.sqrt(disc)
    return [(-B + sq) / (2 * A), (-B - sq) / (2 * A)].map(t => ({ x: L.x1 + t * dx, y: L.y1 + t * dy }))
  }
  const cc = (C1, C2) => {
    if (C1.R <= 0 || C2.R <= 0) return []
    const dx = C2.cx - C1.cx, dy = C2.cy - C1.cy, d = Math.hypot(dx, dy)
    if (d < 1e-9 || d > C1.R + C2.R || d < Math.abs(C1.R - C2.R)) return []
    const aa = (C1.R * C1.R - C2.R * C2.R + d * d) / (2 * d), h = Math.sqrt(Math.max(0, C1.R * C1.R - aa * aa))
    const mx = C1.cx + aa * dx / d, my = C1.cy + aa * dy / d
    return [{ x: mx + h * dy / d, y: my - h * dx / d }, { x: mx - h * dy / d, y: my + h * dx / d }]
  }
  if (a.kind === 'line' && b.kind === 'line') return []
  if (a.kind === 'line') return lc(lineOf(a, oa), circOf(b, ob))
  if (b.kind === 'line') return lc(lineOf(b, ob), circOf(a, oa))
  return cc(circOf(a, oa), circOf(b, ob))
}
// Foot of the centre on a pick (the tangent point), or null if it's off the piece.
function tangentOn(e, C) {
  if (e.kind === 'line') {
    const { x1, y1, x2, y2 } = e.g, dx = x2 - x1, dy = y2 - y1
    const t = ((C.x - x1) * dx + (C.y - y1) * dy) / (dx * dx + dy * dy)
    if (t < -0.01 || t > 1.01) return null
    return { x: x1 + t * dx, y: y1 + t * dy, t }
  }
  const a = Math.atan2(C.y - e.g.cy, C.x - e.g.cx)
  if (!onArc(a, e.g.startAngle, e.g.endAngle)) return null
  return { x: e.g.cx + e.g.r * Math.cos(a), y: e.g.cy + e.g.r * Math.sin(a), a }
}
// Where along a pick a point sits: a line's t, or an arc's fraction from start
// to end (a point just off either end counts as that end, so a corner sitting
// exactly on the arc's end isn't mistaken for one past the far end).
function posOn(e, pt) {
  if (e.kind === 'line') {
    const { x1, y1, x2, y2 } = e.g, dx = x2 - x1, dy = y2 - y1
    return ((pt.x - x1) * dx + (pt.y - y1) * dy) / (dx * dx + dy * dy)
  }
  const span = norm2pi(e.g.endAngle - e.g.startAngle) || TAU
  const d = norm2pi(Math.atan2(pt.y - e.g.cy, pt.x - e.g.cx) - e.g.startAngle)
  if (d <= span) return d / span
  return (TAU - d) < (d - span) ? -(TAU - d) / span : d / span   // off the start → below 0, off the end → above 1
}
// The piece kept once the corner is rounded: everything EXCEPT the bit between
// the tangent point T and the corner P (where the two picks actually meet) —
// the same rule as the line–line fillet, whatever side was clicked.
function trimAway(e, T, P) {
  const tT = e.kind === 'line' ? T.t : posOn(e, T), tP = posOn(e, P)
  const cornerAfter = tP > tT   // corner lies toward the end → keep start…T
  if (e.kind === 'line') return cornerAfter ? { ...e.g, x2: T.x, y2: T.y } : { ...e.g, x1: T.x, y1: T.y }
  return cornerAfter ? { ...e.g, endAngle: T.a } : { ...e.g, startAngle: T.a }
}
// Fallback when the two picks don't actually meet: keep the clicked side.
function trimAt(e, T, clickPt) {
  if (e.kind === 'line') {
    const { x1, y1, x2, y2 } = e.g, dx = x2 - x1, dy = y2 - y1
    const tc = ((clickPt.x - x1) * dx + (clickPt.y - y1) * dy) / (dx * dx + dy * dy)
    return tc < T.t ? { ...e.g, x2: T.x, y2: T.y } : { ...e.g, x1: T.x, y1: T.y }
  }
  const ac = Math.atan2(clickPt.y - e.g.cy, clickPt.x - e.g.cx)
  // Keep start→T if the click sits between start and T, else T→end.
  return onArc(ac, e.g.startAngle, T.a) ? { ...e.g, endAngle: T.a } : { ...e.g, startAngle: T.a }
}
function computeCurveFillet(p1, p2, g1, g2, r) {
  const a = { kind: p1.kind, g: g1 }, b = { kind: p2.kind, g: g2 }
  let best = null
  for (const oa of offsetsOf(a)) for (const ob of offsetsOf(b)) {
    for (const C of intersectOffsets(a, oa, b, ob, r)) {
      const T1 = tangentOn(a, C), T2 = tangentOn(b, C)
      if (!T1 || !T2) continue
      const score = Math.hypot(T1.x - p1.clickPt.x, T1.y - p1.clickPt.y) + Math.hypot(T2.x - p2.clickPt.x, T2.y - p2.clickPt.y)
      if (!best || score < best.score) best = { C, T1, T2, score }
    }
  }
  if (!best) return { tooLarge: true }
  const { C, T1, T2 } = best
  // The fillet is the short way round between the tangent points.
  const s = Math.atan2(T1.y - C.y, T1.x - C.x), e = Math.atan2(T2.y - C.y, T2.x - C.x)
  const arc = norm2pi(e - s) <= Math.PI ? { cx: C.x, cy: C.y, r, startAngle: s, endAngle: e } : { cx: C.x, cy: C.y, r, startAngle: e, endAngle: s }
  // The corner: where the two picks (their full line / circle) cross, nearest
  // the new fillet. The bit between it and each tangent point is cut away.
  const mid = { x: (T1.x + T2.x) / 2, y: (T1.y + T2.y) / 2 }
  const meets = intersectOffsets(a, { ...offsetsOf(a)[0], s: 0 }, b, { ...offsetsOf(b)[0], s: 0 }, 0)
  const P = meets.sort((u, v) => Math.hypot(u.x - mid.x, u.y - mid.y) - Math.hypot(v.x - mid.x, v.y - mid.y))[0]
  return P
    ? { g1: trimAway(a, T1, P), g2: trimAway(b, T2, P), arc, T1, T2 }
    : { g1: trimAt(a, T1, p1.clickPt), g2: trimAt(b, T2, p2.clickPt), arc, T1, T2 }
}

// ── Every corner of a shape ─────────────────────────────────────────────────
// The straight lines joined end to end with `startIdx` (corners between two
// lines only; anything meeting an arc or spline stays sharp). Each corner is
// rounded (or chamfered) by `r`; a line shortened at both ends must have room
// for both, or the whole lot is "too large".
function cornerChain(lines, startIdx) {
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_TOL
  const ends = i => [{ x: lines[i].x1, y: lines[i].y1 }, { x: lines[i].x2, y: lines[i].y2 }]
  const inChain = new Set([startIdx]), queue = [startIdx]
  while (queue.length) {
    const i = queue.pop()
    for (const p of ends(i)) lines.forEach((l, j) => {
      if (inChain.has(j) || l.ghostRef || l.style === 'construction' || l.style === 'axis') return
      if (ends(j).some(q => near(p, q))) { inChain.add(j); queue.push(j) }
    })
  }
  // Corners: a point where exactly two chain lines meet.
  const corners = []
  const idx = [...inChain]
  idx.forEach((i, ii) => idx.slice(ii + 1).forEach(j => {
    for (const [ei, pi] of ends(i).entries()) for (const [ej, pj] of ends(j).entries()) {
      if (!near(pi, pj)) continue
      const others = idx.filter(k => k !== i && k !== j && ends(k).some(q => near(q, pi)))
      if (!others.length) corners.push({ i, ei: ei + 1, j, ej: ej + 1, P: pi })
    }
  }))
  return corners
}

export function computeCornerSet(lines, startIdx, r, mode = 'fillet') {
  if (r <= 0) return null
  const corners = cornerChain(lines, startIdx)
  const cut = new Map()   // line idx → {1: point, 2: point} new end positions
  const used = new Map()  // line idx → total length taken off
  const newArcs = [], newLines = [], marks = []
  for (const c of corners) {
    const L1 = lines[c.i], L2 = lines[c.j]
    const far1 = c.ei === 1 ? { x: L1.x2, y: L1.y2 } : { x: L1.x1, y: L1.y1 }
    const far2 = c.ej === 1 ? { x: L2.x2, y: L2.y2 } : { x: L2.x1, y: L2.y1 }
    const res = mode === 'chamfer' ? computeChamfer(L1, L2, r, far1, far2) : computeFillet(L1, L2, r, far1, far2)
    if (!res) continue   // straight-through join — nothing to round
    if (res.tooLarge) return { tooLarge: true }
    const T1 = res.T1, T2 = res.T2
    const take = (i, end, T, L) => {
      const old = end === 1 ? { x: L.x1, y: L.y1 } : { x: L.x2, y: L.y2 }
      used.set(i, (used.get(i) || 0) + Math.hypot(T.x - old.x, T.y - old.y))
      cut.set(i, { ...(cut.get(i) || {}), [end]: T })
    }
    take(c.i, c.ei, T1, L1); take(c.j, c.ej, T2, L2)
    if (mode === 'chamfer') newLines.push(res.cut); else newArcs.push(res.arc)
    marks.push(T1, T2)
  }
  if (!marks.length) return null
  for (const [i, u] of used) {
    const L = lines[i]
    if (u > Math.hypot(L.x2 - L.x1, L.y2 - L.y1) * 1.001) return { tooLarge: true }
  }
  const lineUpdates = [...cut].map(([idx, ends]) => {
    const L = lines[idx]
    return { idx, geom: { ...L, ...(ends[1] ? { x1: ends[1].x, y1: ends[1].y } : {}), ...(ends[2] ? { x2: ends[2].x, y2: ends[2].y } : {}) } }
  })
  return { lineUpdates, arcUpdates: [], newArcs, newLines, marks, count: newArcs.length + newLines.length }
}

// ── One entry point for the Fillet tool ─────────────────────────────────────
// sel: [pick, pick] (two lines / arcs) or [{kind:'chain', idx}] (every corner
// of the shape that line belongs to). mode: 'fillet' | 'chamfer'.
export function computeFilletOp(sel, lines, arcs, r, mode = 'fillet') {
  if (!(r > 0) || !sel?.length) return null
  if (sel[0].kind === 'chain') return computeCornerSet(lines, sel[0].idx, r, mode)
  if (sel.length < 2) return null
  const [p1, p2] = sel
  const g = p => p.kind === 'line' ? lines[p.idx] : arcs[p.idx]
  const g1 = g(p1), g2 = g(p2)
  if (!g1 || !g2) return null
  if (p1.kind === 'line' && p2.kind === 'line') {
    const res = mode === 'chamfer' ? computeChamfer(g1, g2, r, p1.clickPt, p2.clickPt) : computeFillet(g1, g2, r, p1.clickPt, p2.clickPt)
    if (!res || res.tooLarge) return res
    return {
      lineUpdates: [{ idx: p1.idx, geom: { ...g1, ...res.newL1 } }, { idx: p2.idx, geom: { ...g2, ...res.newL2 } }],
      arcUpdates: [], newArcs: mode === 'chamfer' ? [] : [res.arc], newLines: mode === 'chamfer' ? [res.cut] : [],
      marks: [res.T1, res.T2], count: 1,
    }
  }
  if (mode === 'chamfer') return { needLines: true }   // chamfer is for two straight lines
  const res = computeCurveFillet(p1, p2, g1, g2, r)
  if (res.tooLarge) return res
  const upd = (p, geom) => p.kind === 'line' ? { line: { idx: p.idx, geom } } : { arc: { idx: p.idx, geom } }
  const u = [upd(p1, res.g1), upd(p2, res.g2)]
  return {
    lineUpdates: u.filter(x => x.line).map(x => x.line), arcUpdates: u.filter(x => x.arc).map(x => x.arc),
    newArcs: [res.arc], newLines: [], marks: [res.T1, res.T2], count: 1,
  }
}

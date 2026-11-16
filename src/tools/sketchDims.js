// sketchDims.js — driving dimensions in a 3D-tab sketch (docs/plan-edit-history.md,
// Session 5). Pure functions, sketch px (y down, 1 mm = 2 px).
//
// Every line / circle / arc in the sketch has a stable `id` (ensureIds — added
// on the fly to older sketches, and re-issued to a piece that was split off
// and kept its parent's id). A LINKED dimension refers to geometry by id, so
// it always shows the current size and can be typed into:
//   {kind:'len',  lineId, offset}               a line's length
//   {kind:'dist', a:{id,end}, b:{id,end}, offset}  two points (end 1 / 2 of a
//                                               line, or 'c' = a circle/arc centre)
//   {kind:'dia',  circleId, angle}               a circle's diameter
//   {kind:'rad',  arcId, angle}                  an arc's radius
// `ref: true` = a reference dimension (measure only — grey, in brackets).
// Older dims ({kind:'linear'|'diameter'|'radius'} with plain coordinates) are
// kept as they were and are reference only.
import { resizeLineFollowingCorners, moveCornerFollowing, defaultFixedEnd, CORNER_JOIN_TOL } from './selectMath.js'

const PX_PER_MM = 2
export const DIM_TOL_MM = 0.001

let idCounter = 0
export function newEntityId() {
  idCounter = (idCounter + 1) % 1e6
  return 'e' + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 5)
}

// The array with every entity given a unique id; the SAME array when nothing
// was missing (so a React effect can call this without looping).
export function ensureIds(arr, taken = new Set()) {
  let out = null
  arr.forEach((e, i) => {
    if (e.id && !taken.has(e.id)) { taken.add(e.id); return }
    if (!out) out = arr.slice()
    let id = newEntityId()
    while (taken.has(id)) id = newEntityId()
    taken.add(id)
    out[i] = { ...e, id }
  })
  return out || arr
}

const byId = (arr, id) => { const i = arr.findIndex(e => e.id === id); return i < 0 ? null : { i, e: arr[i] } }

export function refPoint(ref, geo) {
  if (!ref) return null
  if (ref.end === 'c') {
    const c = byId(geo.circles, ref.id) || byId(geo.arcs, ref.id)
    return c ? { x: c.e.cx, y: c.e.cy } : null
  }
  const l = byId(geo.lines, ref.id)
  if (!l) return null
  return ref.end === 1 ? { x: l.e.x1, y: l.e.y1 } : { x: l.e.x2, y: l.e.y2 }
}

// The entity point a clicked point sits on: a line end, or a circle/arc centre.
export function pointRefAt(pt, geo, tol = CORNER_JOIN_TOL * 1.5) {
  let best = null, bestD = tol
  const consider = (x, y, ref) => { const d = Math.hypot(x - pt.x, y - pt.y); if (d <= bestD) { bestD = d; best = ref } }
  for (const l of geo.lines) {
    if (!l.id || l.ghostRef || l.style === 'axis') continue
    consider(l.x1, l.y1, { id: l.id, end: 1 }); consider(l.x2, l.y2, { id: l.id, end: 2 })
  }
  for (const c of [...geo.circles, ...geo.arcs]) if (c.id && !c.ghostRef) consider(c.cx, c.cy, { id: c.id, end: 'c' })
  return best
}

// A placed two-point dimension, linked when both points sit on geometry: the
// two ends of one line → that line's length, else the distance between them.
export function linkTwoPointDim(p1, p2, offset, geo) {
  // A line running between the two points (a corner touches two lines, so
  // look for the one that has BOTH ends here).
  const tol = CORNER_JOIN_TOL * 1.5
  const at = (x, y, p) => Math.hypot(x - p.x, y - p.y) <= tol
  for (const l of geo.lines) {
    if (!l.id || l.ghostRef || l.style === 'axis') continue
    if (at(l.x1, l.y1, p1) && at(l.x2, l.y2, p2)) return { kind: 'len', lineId: l.id, offset }
    if (at(l.x2, l.y2, p1) && at(l.x1, l.y1, p2)) return { kind: 'len', lineId: l.id, offset: -offset }
  }
  const a = pointRefAt(p1, geo), b = pointRefAt(p2, geo)
  if (a && b && a.id === b.id && a.end !== 'c' && b.end !== 'c' && a.end !== b.end) {
    // Keep the offset on the same side whichever way round the line runs.
    const flip = a.end === 2
    return { kind: 'len', lineId: a.id, offset: flip ? -offset : offset }
  }
  if (a && b && !(a.id === b.id && a.end === b.end)) return { kind: 'dist', a, b, offset }
  return null
}

// What a dimension shows now, in the shape the drawing / hit-test code uses
// ({kind:'linear', x1..y2, offset} or {kind:'diameter'|'radius', cx, cy, r, angle}),
// plus `valueMm`, `linked`, `driving` and `broken` (its geometry is gone).
export function resolveDim(dim, geo) {
  const linked = dim.kind === 'len' || dim.kind === 'dist' || dim.kind === 'dia' || dim.kind === 'rad'
  if (!linked) {
    const valueMm = dim.kind === 'linear' ? Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1) / PX_PER_MM
      : dim.kind === 'diameter' ? dim.r * 2 / PX_PER_MM : dim.kind === 'radius' ? dim.r / PX_PER_MM : null
    return { ...dim, valueMm, linked: false, driving: false }
  }
  const driving = !dim.ref
  if (dim.kind === 'len') {
    const l = byId(geo.lines, dim.lineId)
    if (!l) return { kind: 'gone', broken: true, linked, driving }
    return { kind: 'linear', x1: l.e.x1, y1: l.e.y1, x2: l.e.x2, y2: l.e.y2, offset: dim.offset || 0,
      valueMm: Math.hypot(l.e.x2 - l.e.x1, l.e.y2 - l.e.y1) / PX_PER_MM, linked, driving, ref: dim.ref }
  }
  if (dim.kind === 'dist') {
    const a = refPoint(dim.a, geo), b = refPoint(dim.b, geo)
    if (!a || !b) return { kind: 'gone', broken: true, linked, driving }
    return { kind: 'linear', x1: a.x, y1: a.y, x2: b.x, y2: b.y, offset: dim.offset || 0,
      valueMm: Math.hypot(b.x - a.x, b.y - a.y) / PX_PER_MM, linked, driving, ref: dim.ref }
  }
  const c = dim.kind === 'dia' ? byId(geo.circles, dim.circleId) : byId(geo.arcs, dim.arcId)
  if (!c) return { kind: 'gone', broken: true, linked, driving }
  return { kind: dim.kind === 'dia' ? 'diameter' : 'radius', cx: c.e.cx, cy: c.e.cy, r: c.e.r, angle: dim.angle || 0,
    valueMm: (dim.kind === 'dia' ? c.e.r * 2 : c.e.r) / PX_PER_MM, linked, driving, ref: dim.ref }
}

// Two dimensions that measure the same thing (a second one would fight the first).
export function sameMeasure(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'len') return a.lineId === b.lineId
  if (a.kind === 'dia') return a.circleId === b.circleId
  if (a.kind === 'rad') return a.arcId === b.arcId
  if (a.kind === 'dist') {
    const k = r => r.id + ':' + r.end
    return (k(a.a) === k(b.a) && k(a.b) === k(b.b)) || (k(a.a) === k(b.b) && k(a.b) === k(b.a))
  }
  return false
}

// Where the dimension's number is drawn (sketch px) — for clicking on it.
export function dimLabelPoint(v) {
  if (v.kind === 'linear') {
    const dx = v.x2 - v.x1, dy = v.y2 - v.y1, len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len
    return { x: (v.x1 + v.x2) / 2 + nx * v.offset, y: (v.y1 + v.y2) / 2 + ny * v.offset }
  }
  if (v.kind === 'diameter') return { x: v.cx, y: v.cy }
  if (v.kind === 'radius') return { x: v.cx + Math.cos(v.angle) * v.r / 2, y: v.cy + Math.sin(v.angle) * v.r / 2 }
  return null
}

const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= CORNER_JOIN_TOL
const arcEnds = a => [{ x: a.cx + Math.cos(a.startAngle) * a.r, y: a.cy + Math.sin(a.startAngle) * a.r },
  { x: a.cx + Math.cos(a.endAngle) * a.r, y: a.cy + Math.sin(a.endAngle) * a.r }]

// A rounded corner (an arc whose two ends meet two straight lines) re-made at
// radius rPx: the corner where the lines would meet stays put, the tangent
// points slide along the lines. null when it isn't one, {error} when too big.
function refilletArc(geo, ai, rPx) {
  const A = geo.arcs[ai]
  const [s, e] = arcEnds(A)
  const at = p => {
    for (let i = 0; i < geo.lines.length; i++) {
      const L = geo.lines[i]
      if (L.ghostRef) continue
      if (near({ x: L.x1, y: L.y1 }, p)) return { i, end: 1, far: { x: L.x2, y: L.y2 } }
      if (near({ x: L.x2, y: L.y2 }, p)) return { i, end: 2, far: { x: L.x1, y: L.y1 } }
    }
    return null
  }
  const ls = at(s), le = at(e)
  if (!ls || !le || ls.i === le.i) return null
  // The two lines' directions (from the arc end toward the far end).
  const u1 = { x: ls.far.x - s.x, y: ls.far.y - s.y }, u2 = { x: le.far.x - e.x, y: le.far.y - e.y }
  const n1 = Math.hypot(u1.x, u1.y), n2 = Math.hypot(u2.x, u2.y)
  if (n1 < 1e-9 || n2 < 1e-9) return null
  u1.x /= n1; u1.y /= n1; u2.x /= n2; u2.y /= n2
  // Corner = where the two lines (extended back past the arc) cross.
  const den = u1.x * u2.y - u1.y * u2.x
  if (Math.abs(den) < 1e-9) return null
  const t = ((e.x - s.x) * u2.y - (e.y - s.y) * u2.x) / den
  const C = { x: s.x + u1.x * t, y: s.y + u1.y * t }
  const cosA = u1.x * u2.x + u1.y * u2.y
  const half = Math.acos(Math.max(-1, Math.min(1, cosA))) / 2
  if (half < 1e-6 || half > Math.PI / 2 - 1e-6) return null
  const tan = rPx / Math.tan(half)
  const T1 = { x: C.x + u1.x * tan, y: C.y + u1.y * tan }, T2 = { x: C.x + u2.x * tan, y: C.y + u2.y * tan }
  // The tangent points must stay on their lines.
  const lenFromC = (far) => Math.hypot(far.x - C.x, far.y - C.y)
  if (tan >= lenFromC(ls.far) - 1e-6 || tan >= lenFromC(le.far) - 1e-6) return { error: 'That radius is too big for the lines it joins.' }
  const bis = { x: u1.x + u2.x, y: u1.y + u2.y }, bn = Math.hypot(bis.x, bis.y)
  const O = { x: C.x + bis.x / bn * rPx / Math.sin(half), y: C.y + bis.y / bn * rPx / Math.sin(half) }
  const lines = geo.lines.map(x => ({ ...x }))
  const setEnd = (rec, P) => { if (rec.end === 1) { lines[rec.i].x1 = P.x; lines[rec.i].y1 = P.y } else { lines[rec.i].x2 = P.x; lines[rec.i].y2 = P.y } }
  setEnd(ls, T1); setEnd(le, T2)
  const arcs = geo.arcs.slice()
  arcs[ai] = { ...A, cx: O.x, cy: O.y, r: rPx,
    startAngle: Math.atan2(T1.y - O.y, T1.x - O.x), endAngle: Math.atan2(T2.y - O.y, T2.x - O.x) }
  return { lines, circles: geo.circles, arcs, splines: geo.splines }
}

// The sketch after dimension `dim` is set to `valueMm`: {lines, circles, arcs,
// splines} or {error: 'plain message'}. Uses the follow-the-corner rules: the
// end / point nearest the sketch origin stays put.
export function applyDimValue(dim, valueMm, geo) {
  const v = valueMm * PX_PER_MM
  if (!(v > 0)) return { error: 'Type a size bigger than 0.' }
  if (dim.kind === 'len') {
    const l = byId(geo.lines, dim.lineId)
    if (!l) return { error: 'The line this measured has gone.' }
    const ang = Math.atan2(l.e.y2 - l.e.y1, l.e.x2 - l.e.x1)
    const res = resizeLineFollowingCorners(geo.lines, geo.arcs, geo.splines, l.i, defaultFixedEnd(l.e), v, ang)
    if (res.refused) return { error: 'That change would have to move the corner nearest the origin.' }
    return { lines: res.lines, circles: geo.circles, arcs: res.arcs, splines: res.splines }
  }
  if (dim.kind === 'dist') {
    const pa = refPoint(dim.a, geo), pb = refPoint(dim.b, geo)
    if (!pa || !pb) return { error: 'Something this measured has gone.' }
    const cur = Math.hypot(pb.x - pa.x, pb.y - pa.y)
    if (cur < 1e-9) return { error: 'Those two points are on top of each other.' }
    // The point nearer the origin stays; the other moves along the line between them.
    const aFixed = Math.hypot(pa.x, pa.y) <= Math.hypot(pb.x, pb.y)
    const F = aFixed ? pa : pb, M = aFixed ? pb : pa, mRef = aFixed ? dim.b : dim.a
    const u = { x: (M.x - F.x) / cur, y: (M.y - F.y) / cur }
    const d = { x: u.x * (v - cur), y: u.y * (v - cur) }
    if (mRef.end === 'c') {
      const c = byId(geo.circles, mRef.id)
      if (c) {
        const circles = geo.circles.slice(); circles[c.i] = { ...c.e, cx: c.e.cx + d.x, cy: c.e.cy + d.y }
        return { ...geo, circles }
      }
      // An arc's centre: the arc moves and its ends carry the move on.
      const a = byId(geo.arcs, mRef.id)
      if (!a) return { error: 'Something this measured has gone.' }
      const [s, e] = arcEnds(a.e)
      const arcs = geo.arcs.slice(); arcs[a.i] = { ...a.e, cx: a.e.cx + d.x, cy: a.e.cy + d.y }
      let res = moveCornerFollowing(geo.lines, arcs, geo.splines, s, d, [F], new Set([a.i]))
      if (!res.refused) res = moveCornerFollowing(res.lines, res.arcs, res.splines, e, d, [F], new Set([a.i]))
      if (res.refused) return { error: 'That change would have to move the other point too.' }
      return { lines: res.lines, circles: geo.circles, arcs: res.arcs, splines: res.splines }
    }
    const res = moveCornerFollowing(geo.lines, geo.arcs, geo.splines, M, d, [F])
    if (res.refused) return { error: 'That change would have to move the other point too.' }
    return { lines: res.lines, circles: geo.circles, arcs: res.arcs, splines: res.splines }
  }
  if (dim.kind === 'dia') {
    const c = byId(geo.circles, dim.circleId)
    if (!c) return { error: 'The circle this measured has gone.' }
    const circles = geo.circles.slice(); circles[c.i] = { ...c.e, r: v / 2 }
    return { ...geo, circles }
  }
  if (dim.kind === 'rad') {
    const a = byId(geo.arcs, dim.arcId)
    if (!a) return { error: 'The arc this measured has gone.' }
    const fillet = refilletArc(geo, a.i, v)
    if (fillet?.error) return fillet
    if (fillet) return fillet
    // A free arc: centre and angles stay; whatever was joined to its ends follows.
    const [s0, e0] = arcEnds(a.e)
    const arcs = geo.arcs.slice(); arcs[a.i] = { ...a.e, r: v }
    const [s1, e1] = arcEnds(arcs[a.i])
    let res = moveCornerFollowing(geo.lines, arcs, geo.splines, s0, { x: s1.x - s0.x, y: s1.y - s0.y }, [], new Set([a.i]))
    if (!res.refused) res = moveCornerFollowing(res.lines, res.arcs, res.splines, e0, { x: e1.x - e0.x, y: e1.y - e0.y }, [], new Set([a.i]))
    if (res.refused) return { error: 'That radius would pull the shape apart.' }
    return { lines: res.lines, circles: geo.circles, arcs: res.arcs, splines: res.splines }
  }
  return { error: 'This dimension can only be read, not typed into.' }
}

// After an edit: the first OTHER driving dimension whose size it would change
// (a clash), or null. Also checks the edited one really reached its value.
export function dimClash(dims, editedIdx, before, after, targetMm) {
  const edited = resolveDim(dims[editedIdx], after)
  if (edited.broken || Math.abs(edited.valueMm - targetMm) > 0.01) return { idx: editedIdx, self: true }
  for (let i = 0; i < dims.length; i++) {
    if (i === editedIdx) continue
    const d = dims[i]
    if (d.ref || !(d.kind === 'len' || d.kind === 'dist' || d.kind === 'dia' || d.kind === 'rad')) continue
    const b = resolveDim(d, before), a = resolveDim(d, after)
    if (b.broken) continue
    if (a.broken || Math.abs(a.valueMm - b.valueMm) > DIM_TOL_MM) return { idx: i, valueMm: b.valueMm }
  }
  return null
}

// The text a dimension shows.
export function dimText(v) {
  if (v.broken) return '?'
  const n = (v.valueMm ?? 0).toFixed(2)
  const t = v.kind === 'diameter' ? '⌀' + n : v.kind === 'radius' ? 'R' + n : n
  return v.linked && !v.driving ? `(${t})` : t + ' mm'
}

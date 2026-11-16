// shapeMath.js — Rectangle (corner-to-corner / centre-to-corner) and 3-point
// arc, the extra modes of the sketch Line and Circle tools (both apps).
// Pure geometry in sketch px (y down). Arcs follow the app's convention:
// {cx, cy, r, startAngle, endAngle}, swept with INCREASING angle from start to
// end (canvas ctx.arc(..., false)).

const TAU = Math.PI * 2
const norm = a => ((a % TAU) + TAU) % TAU

// ── Rectangle ───────────────────────────────────────────────────────────────
// mode 'rect': a = first corner, b = the mouse (the opposite corner).
// mode 'rectc': a = centre, b = the mouse (a corner).
// wPx / hPx (optional): typed width / height, which replace the mouse's size
// (the mouse still picks which side it goes).
// Returns the 4 corners in drawing order, or null when it has no size.
export function rectCorners(a, b, mode, wPx = null, hPx = null) {
  const sx = b.x >= a.x ? 1 : -1, sy = b.y >= a.y ? 1 : -1
  if (mode === 'rectc') {
    const hw = wPx != null ? wPx / 2 : Math.abs(b.x - a.x)
    const hh = hPx != null ? hPx / 2 : Math.abs(b.y - a.y)
    if (hw < 1e-6 || hh < 1e-6) return null
    return [
      { x: a.x - hw, y: a.y - hh }, { x: a.x + hw, y: a.y - hh },
      { x: a.x + hw, y: a.y + hh }, { x: a.x - hw, y: a.y + hh },
    ]
  }
  const w = wPx != null ? wPx : Math.abs(b.x - a.x)
  const h = hPx != null ? hPx : Math.abs(b.y - a.y)
  if (w < 1e-6 || h < 1e-6) return null
  const c = { x: a.x + sx * w, y: a.y + sy * h }
  return [{ x: a.x, y: a.y }, { x: c.x, y: a.y }, { x: c.x, y: c.y }, { x: a.x, y: c.y }]
}

// The 4 sides as plain line entities (each exactly horizontal or vertical, so
// the Select panel's follow-the-corner keeps it a rectangle).
export function rectLines(corners) {
  return corners.map((p, i) => {
    const q = corners[(i + 1) % 4]
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y }
  })
}

// Width / height (px) of the rectangle the tool would make now.
export function rectSize(corners) {
  if (!corners) return null
  return { w: Math.abs(corners[1].x - corners[0].x), h: Math.abs(corners[2].y - corners[1].y) }
}

// ── 3-point arc ─────────────────────────────────────────────────────────────
// An arc from p1 to p2 (in increasing-angle order) going round circle c/r on
// the side that passes `via` (an angle on the circle), as an entity.
function arcThrough(c, r, a1, a2, aVia) {
  return norm(aVia - a1) < norm(a2 - a1)
    ? { cx: c.x, cy: c.y, r, startAngle: a1, endAngle: a2 }
    : { cx: c.x, cy: c.y, r, startAngle: a2, endAngle: a1 }
}

// Circle through three points, or null when they are (nearly) in a line.
export function arcFrom3Points(p1, p2, p3) {
  const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-6) return null
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  const c = { x: ux, y: uy }
  const r = Math.hypot(ax - ux, ay - uy)
  if (r > 1e6) return null
  const ang = p => Math.atan2(p.y - uy, p.x - ux)
  return arcThrough(c, r, ang(p1), ang(p2), ang(p3))
}

// Arc p1 → p2 of radius rPx, bulging toward `side` (the mouse). Picks the
// shorter way round. null when rPx is less than half the chord.
export function arcByRadius(p1, p2, rPx, side) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, d = Math.hypot(dx, dy)
  if (d < 1e-6 || rPx < d / 2 - 1e-9) return null
  const h = Math.sqrt(Math.max(0, rPx * rPx - (d / 2) * (d / 2)))
  const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  const n = { x: -dy / d, y: dx / d }
  // The short arc bulges AWAY from its centre, so the centre goes on the
  // other side of the chord from the mouse.
  const sideSign = (side.x - m.x) * n.x + (side.y - m.y) * n.y >= 0 ? 1 : -1
  const c = { x: m.x - n.x * h * sideSign, y: m.y - n.y * h * sideSign }
  const ang = p => Math.atan2(p.y - c.y, p.x - c.x)
  // The short arc's middle lies from the centre toward the mouse's side.
  const mid = Math.atan2(n.y * sideSign, n.x * sideSign)
  return arcThrough(c, rPx, ang(p1), ang(p2), mid)
}

// The arc leaving p in direction t (unit) that ends at q, or null when q lies
// straight ahead (no arc can do it).
export function tangentArc(p, t, q) {
  const n = { x: -t.y, y: t.x }
  const vx = q.x - p.x, vy = q.y - p.y
  const den = 2 * (n.x * vx + n.y * vy)
  if (Math.abs(den) < 1e-6) return null
  const s = (vx * vx + vy * vy) / den
  const c = { x: p.x + n.x * s, y: p.y + n.y * s }
  const r = Math.abs(s)
  const ap = Math.atan2(p.y - c.y, p.x - c.x), aq = Math.atan2(q.y - c.y, q.x - c.x)
  // Increasing angle moves along (-sin, cos): does that match t at p?
  const inc = (-Math.sin(ap)) * t.x + Math.cos(ap) * t.y > 0
  return inc ? { cx: c.x, cy: c.y, r, startAngle: ap, endAngle: aq } : { cx: c.x, cy: c.y, r, startAngle: aq, endAngle: ap }
}

const arcEnd = (a, which) => {
  const ang = which === 'start' ? a.startAngle : a.endAngle
  return { x: a.cx + Math.cos(ang) * a.r, y: a.cy + Math.sin(ang) * a.r }
}

// Direction an arc LEAVES point p (one of its ends), as a unit vector.
function arcLeaveDir(arc, p) {
  const ds = Math.hypot(arcEnd(arc, 'start').x - p.x, arcEnd(arc, 'start').y - p.y)
  const de = Math.hypot(arcEnd(arc, 'end').x - p.x, arcEnd(arc, 'end').y - p.y)
  const atStart = ds <= de
  const a = atStart ? arc.startAngle : arc.endAngle
  const s = atStart ? 1 : -1   // leaving the start goes forward (increasing angle)
  return { x: -Math.sin(a) * s, y: Math.cos(a) * s }
}

// Directions a line (or arc) arriving at point p is travelling as it reaches p
// — an arc that continues that way is tangent to it. tol = join tolerance (px).
export function tangentDirsAt(p, lines, arcs, tol = 2) {
  const out = []
  for (const l of lines) {
    if (l.ghostRef || l.style === 'axis') continue
    for (const [end, far] of [[{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }], [{ x: l.x2, y: l.y2 }, { x: l.x1, y: l.y1 }]]) {
      if (Math.hypot(end.x - p.x, end.y - p.y) > tol) continue
      const len = Math.hypot(end.x - far.x, end.y - far.y)
      if (len > 1e-6) out.push({ x: (end.x - far.x) / len, y: (end.y - far.y) / len })
    }
  }
  for (const a of arcs) {
    if (a.ghostRef) continue
    for (const which of ['start', 'end']) {
      const e = arcEnd(a, which)
      if (Math.hypot(e.x - p.x, e.y - p.y) > tol) continue
      const leave = arcLeaveDir(a, e)
      out.push({ x: -leave.x, y: -leave.y })   // arriving = opposite of leaving
    }
  }
  return out
}

export const ARC_TANGENT_SNAP_DEG = 8

// The arc the 3-point tool makes for start p1, end p2 and the mouse p3:
//   - typed radius rPx → arcByRadius (bulging toward the mouse)
//   - otherwise the circle through all three; if it leaves p1 (or arrives at
//     p2) within ARC_TANGENT_SNAP_DEG of a line/arc that ends there, it snaps
//     to the exact tangent arc ({tangent: true}).
// Returns {arc, tangent} or null.
export function threePointArc(p1, p2, p3, lines, arcs, rPx = null) {
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 1e-6) return null
  if (rPx != null) {
    const arc = arcByRadius(p1, p2, rPx, p3)
    return arc ? { arc, tangent: false } : null
  }
  const arc = arcFrom3Points(p1, p2, p3)
  if (!arc) return null
  const limit = Math.cos(ARC_TANGENT_SNAP_DEG * Math.PI / 180)
  let best = null
  for (const [from, to] of [[p1, p2], [p2, p1]]) {
    const leave = arcLeaveDir(arc, from)
    for (const t of tangentDirsAt(from, lines, arcs)) {
      const dot = leave.x * t.x + leave.y * t.y
      if (dot > limit && (!best || dot > best.dot)) best = { dot, from, to, t }
    }
  }
  if (best) {
    const ta = tangentArc(best.from, best.t, best.to)
    if (ta) return { arc: ta, tangent: true }
  }
  return { arc, tangent: false }
}

// Point on an arc entity at its middle — used to place the radius label.
export function arcMidPoint(a) {
  const mid = a.startAngle + norm(a.endAngle - a.startAngle) / 2
  return { x: a.cx + Math.cos(mid) * a.r, y: a.cy + Math.sin(mid) * a.r }
}

// Drawing-tab dimensions → plain drawing primitives. Pure JS, no React.
//
// Every dimension kind is turned into {lines, arcs, arrows} in the Drawing
// tab's world px (y-down), with the text already drawn as single-stroke
// lines (strokeFont.js). The canvas, the PDF export and the DXF export all
// draw these same primitives, so a dimension looks identical everywhere.
// Sizes are on paper (text height in mm), like real drafting — they zoom
// with the drawing instead of staying a fixed size on screen.
//
// Dimension kinds (all coordinates world px):
//   linear   {x1,y1,x2,y2, offset}          aligned: measures the true distance
//   ortho    {x1,y1,x2,y2, orient:'h'|'v', pos}  horizontal / vertical: measures
//            only the X (or Y) distance; the dim line sits at y=pos (or x=pos)
//   diameter {cx,cy,r, angle}               angle = where the leader points
//   radius   {cx,cy,r, angle}
//   angle    {cx,cy, start, sweep, r, reach:[r1,r2]}  arc from `start` through
//            `sweep` radians (canvas angles, increasing = clockwise on screen);
//            reach = how far each bounding line runs out from the vertex, so
//            extension lines can bridge the gap to the arc.
// Any kind may carry `scale` (the drawing scale of the view it measures —
// the shown value is divided by it) and `text` (typed override).

import { mmToPx, pxToMm } from '../constants.js'
import { strokeTextLines, strokeTextWidth } from './strokeFont.js'

export const DEFAULT_DIM_STYLE = { decimals: 0, units: false, textMm: 3.5 }

/** The number a dimension states, as text. */
export function dimValueText(dim, style = DEFAULT_DIM_STYLE) {
  if (dim.text) return dim.text
  const d = style.decimals ?? 0
  const fmt = v => {
    const s = v.toFixed(d)
    return Number(s) === 0 ? (0).toFixed(d) : s   // never "-0"
  }
  if (dim.kind === 'angle') return fmt(dim.sweep * 180 / Math.PI) + '°'
  const sc = dim.scale || 1
  let mm
  if (dim.kind === 'diameter') mm = pxToMm(dim.r * 2) / sc
  else if (dim.kind === 'radius') mm = pxToMm(dim.r) / sc
  else if (dim.kind === 'ortho') mm = pxToMm(dim.orient === 'h' ? Math.abs(dim.x2 - dim.x1) : Math.abs(dim.y2 - dim.y1)) / sc
  else mm = pxToMm(Math.hypot(dim.x2 - dim.x1, dim.y2 - dim.y1)) / sc
  const prefix = dim.kind === 'diameter' ? '⌀' : dim.kind === 'radius' ? 'R' : ''
  return prefix + fmt(mm) + (style.units ? ' mm' : '')
}

// Text as lines: `text` with its baseline-centre (align 'center') or end at
// (x, y), reading along angle `a` (y-down radians), lifted `lift` px above
// that point. Returns world-px line segments.
function textLines(text, x, y, a, h, align = 'center', lift = 0) {
  const ux = Math.cos(a), uy = Math.sin(a)
  const wx = Math.sin(a), wy = -Math.cos(a)        // "up" on the page
  return strokeTextLines(text, 0, 0, h, align).map(l => ({
    x1: x + l.x1 * ux + (l.y1 + lift) * wx, y1: y + l.x1 * uy + (l.y1 + lift) * wy,
    x2: x + l.x2 * ux + (l.y2 + lift) * wx, y2: y + l.x2 * uy + (l.y2 + lift) * wy,
  }))
}

// Reading angle of a line direction, turned so text is never upside down;
// vertical text reads bottom-to-top (from the right), as on drawings.
function readable(a) {
  while (a >= Math.PI / 2 - 1e-6) a -= Math.PI
  while (a < -Math.PI / 2 - 1e-6) a += Math.PI
  return a
}

// Filled arrowhead with its tip at (x, y), pointing along (ux, uy).
function arrow(x, y, ux, uy, len) {
  const w = len * 0.3
  const bx = x - ux * len, by = y - uy * len
  return [[x, y], [bx - uy * w, by + ux * w], [bx + uy * w, by - ux * w]]
}

function sizes(style) {
  const h = mmToPx(style.textMm ?? 3.5)
  return {
    h,
    arr: h * 0.85,            // arrow length
    gap: mmToPx(1),           // gap between the object and an extension line
    over: mmToPx(2),          // extension line overshoot past the dim line
    lift: mmToPx(1),          // text above its line
  }
}

// The shared part of aligned / horizontal / vertical dims: the dimension
// line d1→d2 with arrows and centred text. Short dims put the arrows outside.
function linearCore(out, d1, d2, text, S) {
  const dx = d2.x - d1.x, dy = d2.y - d1.y, len = Math.hypot(dx, dy)
  if (len < 1e-6) return
  const ux = dx / len, uy = dy / len
  const tw = strokeTextWidth(text, S.h)
  const inside = len >= 2 * S.arr + mmToPx(1)
  if (inside) {
    out.lines.push({ x1: d1.x, y1: d1.y, x2: d2.x, y2: d2.y })
    out.arrows.push(arrow(d1.x, d1.y, -ux, -uy, S.arr), arrow(d2.x, d2.y, ux, uy, S.arr))
  } else {
    const t = S.arr * 2
    out.lines.push({ x1: d1.x - ux * t, y1: d1.y - uy * t, x2: d2.x + ux * t, y2: d2.y + uy * t })
    out.arrows.push(arrow(d1.x, d1.y, ux, uy, S.arr), arrow(d2.x, d2.y, -ux, -uy, S.arr))
  }
  const mx = (d1.x + d2.x) / 2, my = (d1.y + d2.y) / 2
  const a = readable(Math.atan2(uy, ux))
  // Text wider than the gap between short arrows goes beside the line's end.
  if (!inside && tw > len) {
    const ex = d2.x + ux * (S.arr * 2 + tw / 2 + S.lift), ey = d2.y + uy * (S.arr * 2 + tw / 2 + S.lift)
    out.lines.push(...textLines(text, ex, ey, a, S.h, 'center', S.lift))
  } else {
    out.lines.push(...textLines(text, mx, my, a, S.h, 'center', S.lift))
  }
}

// Extension line from object point p to just past dim-line point d.
function extension(out, p, d, S) {
  const dx = d.x - p.x, dy = d.y - p.y, len = Math.hypot(dx, dy)
  if (len <= S.gap) return
  const ux = dx / len, uy = dy / len
  out.lines.push({ x1: p.x + ux * S.gap, y1: p.y + uy * S.gap, x2: d.x + ux * S.over, y2: d.y + uy * S.over })
}

// Diameter / radius leader for a circle too small for the text inside:
// arrow on the rim, a line out, a short shoulder with the text on it.
function leader(out, dim, text, S) {
  const c = Math.cos(dim.angle), s = Math.sin(dim.angle)
  const px = dim.cx + dim.r * c, py = dim.cy + dim.r * s
  const qx = dim.cx + (dim.r + S.arr * 2.5) * c, qy = dim.cy + (dim.r + S.arr * 2.5) * s
  const side = c >= 0 ? 1 : -1
  const tw = strokeTextWidth(text, S.h)
  const shoulder = tw + mmToPx(2)
  out.arrows.push(arrow(px, py, -c, -s, S.arr))
  out.lines.push({ x1: px, y1: py, x2: qx, y2: qy })
  out.lines.push({ x1: qx, y1: qy, x2: qx + side * shoulder, y2: qy })
  out.lines.push(...textLines(text, qx + side * shoulder / 2, qy, 0, S.h, 'center', S.lift))
}

/**
 * One dimension as {lines, arcs, arrows} in world px. Arrows are filled
 * triangles [[x,y],[x,y],[x,y]]; arcs are {cx,cy,r,start,end} drawn with
 * increasing angle (canvas convention).
 */
export function dimPrimitives(dim, style = DEFAULT_DIM_STYLE) {
  const S = sizes(style)
  const out = { lines: [], arcs: [], arrows: [] }
  const text = dimValueText(dim, style)

  if (dim.kind === 'linear') {
    const dx = dim.x2 - dim.x1, dy = dim.y2 - dim.y1, len = Math.hypot(dx, dy)
    if (len < 1e-6) return out
    const nx = -dy / len, ny = dx / len, off = dim.offset || 0
    const d1 = { x: dim.x1 + nx * off, y: dim.y1 + ny * off }
    const d2 = { x: dim.x2 + nx * off, y: dim.y2 + ny * off }
    extension(out, { x: dim.x1, y: dim.y1 }, d1, S)
    extension(out, { x: dim.x2, y: dim.y2 }, d2, S)
    linearCore(out, d1, d2, text, S)
  } else if (dim.kind === 'ortho') {
    const h = dim.orient === 'h'
    const d1 = h ? { x: dim.x1, y: dim.pos } : { x: dim.pos, y: dim.y1 }
    const d2 = h ? { x: dim.x2, y: dim.pos } : { x: dim.pos, y: dim.y2 }
    extension(out, { x: dim.x1, y: dim.y1 }, d1, S)
    extension(out, { x: dim.x2, y: dim.y2 }, d2, S)
    // Measure left→right / top→bottom so the text sits on the outer side.
    const [a, b] = (h ? d1.x <= d2.x : d1.y >= d2.y) ? [d1, d2] : [d2, d1]
    linearCore(out, a, b, text, S)
  } else if (dim.kind === 'diameter' || dim.kind === 'radius') {
    const tw = strokeTextWidth(text, S.h)
    const c = Math.cos(dim.angle), s = Math.sin(dim.angle)
    if (dim.kind === 'diameter' && 2 * dim.r >= tw + 2 * S.arr + mmToPx(2)) {
      const p1 = { x: dim.cx - dim.r * c, y: dim.cy - dim.r * s }
      const p2 = { x: dim.cx + dim.r * c, y: dim.cy + dim.r * s }
      out.lines.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y })
      out.arrows.push(arrow(p1.x, p1.y, -c, -s, S.arr), arrow(p2.x, p2.y, c, s, S.arr))
      out.lines.push(...textLines(text, dim.cx, dim.cy, readable(dim.angle), S.h, 'center', S.lift))
    } else if (dim.kind === 'radius' && dim.r >= tw + S.arr + mmToPx(2)) {
      const p = { x: dim.cx + dim.r * c, y: dim.cy + dim.r * s }
      out.lines.push({ x1: dim.cx, y1: dim.cy, x2: p.x, y2: p.y })
      out.arrows.push(arrow(p.x, p.y, c, s, S.arr))
      out.lines.push(...textLines(text, (dim.cx + p.x) / 2, (dim.cy + p.y) / 2, readable(dim.angle), S.h, 'center', S.lift))
    } else {
      leader(out, dim, text, S)
    }
  } else if (dim.kind === 'angle') {
    const { cx, cy, start, sweep, r } = dim
    const end = start + sweep
    out.arcs.push({ cx, cy, r, start, end })
    // Arrows lie along the arc's tangent at each end, pointing outward.
    const tan = t => ({ x: -Math.sin(t), y: Math.cos(t) })
    const t0 = tan(start), t1 = tan(end)
    const p0 = { x: cx + r * Math.cos(start), y: cy + r * Math.sin(start) }
    const p1 = { x: cx + r * Math.cos(end), y: cy + r * Math.sin(end) }
    out.arrows.push(arrow(p0.x, p0.y, -t0.x, -t0.y, S.arr), arrow(p1.x, p1.y, t1.x, t1.y, S.arr))
    // Extension lines along each bounding line when the arc sits beyond it.
    ;[[start, dim.reach?.[0] ?? 0], [end, dim.reach?.[1] ?? 0]].forEach(([t, reach]) => {
      if (r <= reach + S.gap) return
      const ux = Math.cos(t), uy = Math.sin(t)
      out.lines.push({ x1: cx + ux * (reach + S.gap), y1: cy + uy * (reach + S.gap), x2: cx + ux * (r + S.over), y2: cy + uy * (r + S.over) })
    })
    const mid = start + sweep / 2
    const tr = r + S.h * 0.9
    const tx = cx + tr * Math.cos(mid), ty = cy + tr * Math.sin(mid)
    out.lines.push(...textLines(text, tx, ty + S.h / 2, 0, S.h, 'center', 0))
  }
  return out
}

/** Distance from point (x, y) to a dimension's drawn lines and arc — for hover/select/delete. */
export function distToDim(x, y, dim, style = DEFAULT_DIM_STYLE) {
  const pr = dimPrimitives(dim, style)
  let best = Infinity
  for (const l of pr.lines) {
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1, L2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - l.x1) * dx + (y - l.y1) * dy) / L2))
    best = Math.min(best, Math.hypot(x - (l.x1 + dx * t), y - (l.y1 + dy * t)))
  }
  for (const a of pr.arcs) {
    const ang = Math.atan2(y - a.cy, x - a.cx)
    const rel = ((ang - a.start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
    if (rel <= a.end - a.start) best = Math.min(best, Math.abs(Math.hypot(x - a.cx, y - a.cy) - a.r))
  }
  return best
}

/** World-px bounding points of a dimension (for fit-to-page). */
export function dimBoundsPoints(dim, style = DEFAULT_DIM_STYLE) {
  const pr = dimPrimitives(dim, style)
  const pts = []
  for (const l of pr.lines) pts.push([l.x1, l.y1], [l.x2, l.y2])
  for (const a of pr.arcs) pts.push([a.cx - a.r, a.cy - a.r], [a.cx + a.r, a.cy + a.r])
  for (const t of pr.arrows) pts.push(...t)
  return pts
}

/**
 * Angle dimension between two lines, placed toward `mouse`: the vertex is
 * where the lines (extended) cross, and of the four sectors they make, the
 * one the mouse is in is measured. Returns null for parallel lines.
 */
export function angleDimFromLines(l1, l2, mouse) {
  const d1x = l1.x2 - l1.x1, d1y = l1.y2 - l1.y1
  const d2x = l2.x2 - l2.x1, d2y = l2.y2 - l2.y1
  const den = d1x * d2y - d1y * d2x
  const n1 = Math.hypot(d1x, d1y), n2 = Math.hypot(d2x, d2y)
  if (!n1 || !n2 || Math.abs(den) / (n1 * n2) < 1e-3) return null
  const t = ((l2.x1 - l1.x1) * d2y - (l2.y1 - l1.y1) * d2x) / den
  const cx = l1.x1 + d1x * t, cy = l1.y1 + d1y * t
  const TWO = 2 * Math.PI
  const norm = a => ((a % TWO) + TWO) % TWO
  const a1 = Math.atan2(d1y, d1x), a2 = Math.atan2(d2y, d2x)
  // The four rays out of the vertex, each tagged with the line it belongs to.
  const rays = [[norm(a1), l1], [norm(a1 + Math.PI), l1], [norm(a2), l2], [norm(a2 + Math.PI), l2]]
    .sort((p, q) => p[0] - q[0])
  const m = norm(Math.atan2(mouse.y - cy, mouse.x - cx))
  let i = rays.findIndex((r, k) => {
    const next = k === 3 ? rays[0][0] + TWO : rays[k + 1][0]
    return (m >= r[0] && m < next) || (m + TWO >= r[0] && m + TWO < next)
  })
  if (i < 0) i = 0
  const [start, la] = rays[i]
  const [endRaw, lb] = rays[(i + 1) % 4]
  const sweep = norm(endRaw - start) || TWO
  // How far each bounding line runs out from the vertex along its ray.
  const reach = (l, t) => {
    const ux = Math.cos(t), uy = Math.sin(t)
    return Math.max(0, (l.x1 - cx) * ux + (l.y1 - cy) * uy, (l.x2 - cx) * ux + (l.y2 - cy) * uy)
  }
  const r = Math.max(mmToPx(4), Math.hypot(mouse.x - cx, mouse.y - cy))
  return { kind: 'angle', cx, cy, start, sweep, r, reach: [reach(la, start), reach(lb, endRaw)] }
}

/**
 * Horizontal or vertical dimension from p1/p2 placed at the mouse. `lock`
 * forces 'h' or 'v'; otherwise the side the mouse is dragged to decides,
 * like most CAD: out above/below the points → horizontal, out to the
 * left/right → vertical.
 */
export function orthoDimFromPoints(p1, p2, mouse, lock = null) {
  let orient = lock
  if (!orient) {
    const outX = Math.max(0, Math.min(p1.x, p2.x) - mouse.x, mouse.x - Math.max(p1.x, p2.x))
    const outY = Math.max(0, Math.min(p1.y, p2.y) - mouse.y, mouse.y - Math.max(p1.y, p2.y))
    if (outY > 0 && outX === 0) orient = 'h'
    else if (outX > 0 && outY === 0) orient = 'v'
    else if (outX > 0 && outY > 0) orient = outY >= outX ? 'h' : 'v'
    else orient = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? 'h' : 'v'
  }
  return { kind: 'ortho', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, orient, pos: orient === 'h' ? mouse.y : mouse.x }
}

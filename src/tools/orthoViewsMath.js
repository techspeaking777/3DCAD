// Pure JS, no React — matches the tools/*Math.js convention used throughout
// this app. Takes the raw per-view mm geometry cadEngine.computeOrthoViews()
// returns and (1) lays the selected views out on one shared drawing-sheet mm
// frame, (2) converts the result to App.jsx's px/Y-down entity convention —
// the exact same mm<->px/angle-flip rules saveLoad.js's parseDXF/exportDXF
// already use, since cadWorker.js's computeOrthoViews emits geometry in that
// same mm/CCW/Y-up convention (proven already by exportFaceDXF).

import { mmToPx } from '../constants.js'
import { strokeTextLines } from './strokeFont.js'

const GAP_MM = 20
const VIEW_PRIORITY = ['front', 'top', 'right', 'left', 'back', 'bottom']

function bboxOf(view) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const grow = (x, y) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const l of view.lines) { grow(l.x1, l.y1); grow(l.x2, l.y2) }
  for (const c of view.circles) { grow(c.cx - c.r, c.cy - c.r); grow(c.cx + c.r, c.cy + c.r) }
  for (const a of view.arcs) { grow(a.cx - a.r, a.cy - a.r); grow(a.cx + a.r, a.cy + a.r) }
  for (const s of view.splines || []) for (const p of s.points) grow(p.x, p.y)
  if (!isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0, w: 0, h: 0 }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY }
}

function translateView(view, dx, dy) {
  return {
    lines: view.lines.map(l => ({ ...l, x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy })),
    circles: view.circles.map(c => ({ ...c, cx: c.cx + dx, cy: c.cy + dy })),
    arcs: view.arcs.map(a => ({ ...a, cx: a.cx + dx, cy: a.cy + dy })),
    splines: (view.splines || []).map(s => ({ ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) })),
    centres: (view.centres || []).map(c => c.kind === 'mark'
      ? { ...c, cx: c.cx + dx, cy: c.cy + dy }
      : { ...c, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy }),
  }
}

/**
 * Lays a subset of {front,back,left,right,top,bottom} view geometry (each
 * {lines,circles,arcs,splines} in mm, as returned by
 * cadEngine.computeOrthoViews) out onto one shared drawing-sheet mm frame, in
 * simple third-angle arrangement: top above front, bottom below front, right
 * to the right of front, left to the left of front, back to the right of
 * whichever of right/front is present — all axis-aligned, since the fixed
 * view bases in cadWorker.js guarantee front shares its u-axis with top/
 * bottom and its v-axis with left/right/back.
 *
 * Combinations that omit `front` fall back to simple top-to-bottom stacking,
 * left-aligned — a deliberately unsophisticated fallback for the case where
 * there's no shared axis to align against, not a textbook-correct standard.
 *
 * Returns flat {lines,circles,arcs,splines,centres} in mm, still untranslated
 * to px, plus `boxes`: each view's {minX,minY,maxX,maxY} on the sheet.
 */
export function layoutViews(viewsData, gapMm = GAP_MM) {
  const present = VIEW_PRIORITY.filter(v => viewsData[v])
  if (present.length === 0) return { lines: [], circles: [], arcs: [], splines: [], centres: [], boxes: {} }

  const boxes = {}
  for (const v of present) boxes[v] = bboxOf(viewsData[v])

  const pagePos = {}   // v -> {x, y} — where the view's bbox min-corner lands on the sheet
  const anchor = present[0]

  if (anchor === 'front') {
    const fb = boxes.front
    pagePos.front = { x: 0, y: 0 }
    if (viewsData.top)    pagePos.top    = { x: 0, y: fb.h + gapMm }
    if (viewsData.bottom) pagePos.bottom = { x: 0, y: -(boxes.bottom.h + gapMm) }
    if (viewsData.right)  pagePos.right  = { x: fb.w + gapMm, y: 0 }
    if (viewsData.left)   pagePos.left   = { x: -(boxes.left.w + gapMm), y: 0 }
    if (viewsData.back) {
      const rightEdge = viewsData.right ? pagePos.right.x + boxes.right.w : fb.w
      pagePos.back = { x: rightEdge + gapMm, y: 0 }
    }
  } else {
    let y = 0
    for (const v of present) {
      pagePos[v] = { x: 0, y }
      y -= boxes[v].h + gapMm
    }
  }

  const merged = { lines: [], circles: [], arcs: [], splines: [], centres: [], boxes: {} }
  for (const v of present) {
    const dx = pagePos[v].x - boxes[v].minX
    const dy = pagePos[v].y - boxes[v].minY
    const translated = translateView(viewsData[v], dx, dy)
    // `view` tags each entity with its view name (Auto sizes measures per view).
    const tag = e => ({ ...e, view: v })
    merged.lines.push(...translated.lines.map(tag))
    merged.circles.push(...translated.circles.map(tag))
    merged.arcs.push(...translated.arcs.map(tag))
    merged.splines.push(...translated.splines.map(tag))
    merged.centres.push(...translated.centres)
    const b = boxes[v]
    merged.boxes[v] = { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy }
  }
  return merged
}

const TIDY_TOL = 0.02   // mm — edges this close count as the same edge
const MIN_PIECE = 0.1   // mm — leftover bits shorter than this are dropped

// The parts of segment `l` not already covered by any collinear segment in
// `cover`, as new segments (keeping l's other fields, e.g. style).
function uncoveredPieces(l, cover) {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1
  const len = Math.hypot(dx, dy)
  if (len < MIN_PIECE) return []
  const ux = dx / len, uy = dy / len
  const off = (x, y) => Math.abs((x - l.x1) * uy - (y - l.y1) * ux)
  const along = (x, y) => (x - l.x1) * ux + (y - l.y1) * uy
  const spans = []
  for (const c of cover) {
    if (off(c.x1, c.y1) > TIDY_TOL || off(c.x2, c.y2) > TIDY_TOL) continue
    const a = along(c.x1, c.y1), b = along(c.x2, c.y2)
    spans.push([Math.min(a, b) - TIDY_TOL, Math.max(a, b) + TIDY_TOL])
  }
  if (!spans.length) return [l]
  spans.sort((p, q) => p[0] - q[0])
  const pieces = []
  let t = 0
  for (const [a, b] of spans) {
    if (a > t + MIN_PIECE) pieces.push([t, Math.min(a, len)])
    t = Math.max(t, b)
    if (t >= len) break
  }
  if (len - t > MIN_PIECE) pieces.push([t, len])
  return pieces.map(([a, b]) => ({
    ...l, x1: l.x1 + ux * a, y1: l.y1 + uy * a, x2: l.x1 + ux * b, y2: l.y1 + uy * b,
  }))
}

const sameCircle = (a, b) =>
  Math.abs(a.cx - b.cx) < TIDY_TOL && Math.abs(a.cy - b.cy) < TIDY_TOL && Math.abs(a.r - b.r) < TIDY_TOL

function angleInArc(ang, arc) {
  const TWO_PI = Math.PI * 2
  const norm = x => ((x % TWO_PI) + TWO_PI) % TWO_PI
  return norm(ang - arc.startAngle) <= norm(arc.endAngle - arc.startAngle) + 1e-6
}

/**
 * Drafting rule: a visible edge wins over a hidden one in the same place, and
 * nothing is drawn twice. Hidden-line removal hands back every edge of every
 * body, so the back outline of a block lies exactly under the front one, a
 * through-hole's far rim under its near rim, and so on. This drops (or trims)
 * hidden lines covered by visible ones, hidden circles/arcs on a visible
 * circle, and duplicates within each set. Input/output: one view's
 * {lines,circles,arcs,splines} in mm, hidden entities marked style:'dashed'.
 */
export function tidyView(view) {
  const vis = e => !e.style
  const keptLines = []
  for (const pass of [vis, e => !vis(e)]) {
    for (const l of view.lines) {
      if (!pass(l)) continue
      keptLines.push(...uncoveredPieces(l, keptLines))
    }
  }
  const keptCircles = []
  for (const pass of [vis, e => !vis(e)]) {
    for (const c of view.circles) {
      if (pass(c) && !keptCircles.some(k => sameCircle(k, c))) keptCircles.push(c)
    }
  }
  const keptArcs = []
  for (const pass of [vis, e => !vis(e)]) {
    for (const a of view.arcs) {
      if (!pass(a)) continue
      if (keptCircles.some(k => sameCircle(k, a))) continue
      const mid = a.startAngle + (((a.endAngle - a.startAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / 2
      if (keptArcs.some(k => sameCircle(k, a) && angleInArc(a.startAngle, k) && angleInArc(a.endAngle, k) && angleInArc(mid, k))) continue
      keptArcs.push(a)
    }
  }
  return { lines: keptLines, circles: keptCircles, arcs: keptArcs, splines: view.splines || [], centres: view.centres || [] }
}

// Standard drawing scales, biggest first. 2 means 2:1 (twice real size).
export const DRAWING_SCALES = [10, 5, 2, 1, 1/2, 1/5, 1/10, 1/20, 1/50, 1/100]

export function scaleLabel(s) {
  return s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`
}

const PAPER_MM = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] }

// The usable drawing area of the Drawing tab's page (inside the margins), mm.
export function pageAreaMm(pageConfig) {
  let [w, h] = PAPER_MM[pageConfig?.size] || PAPER_MM.A4
  if (pageConfig?.orientation === 'landscape') [w, h] = [h, w]
  const m = pageConfig?.margin ?? 10
  return { w: w - 2 * m, h: h - 2 * m }
}

const VIEW_TITLES = { front: 'FRONT VIEW', back: 'BACK VIEW', left: 'LEFT VIEW', right: 'RIGHT VIEW', top: 'TOP VIEW', bottom: 'BOTTOM VIEW' }
const LABEL_H = 3.5    // mm on paper — standard annotation height
const LABEL_GAP = 4    // mm between a view and its label
const CL_OVERHANG = 3  // mm a centre line runs past the round part it marks

// Centre-line entities (style 'center') in paper mm from the worker's
// per-view axes, already moved to paper coordinates by `toPaper`. A mark is
// a cross through the centre; an axis is a line along the round part.
// Each runs CL_OVERHANG past the edge. Coincident ones are drawn once.
function centreLineEntities(centres, toPaper, scale) {
  const out = []
  const seen = new Set()
  const key = l => [l.x1, l.y1, l.x2, l.y2].map(v => v.toFixed(2)).join(',')
  const push = l => {
    const k = key(l), k2 = key({ x1: l.x2, y1: l.y2, x2: l.x1, y2: l.y1 })
    if (seen.has(k) || seen.has(k2)) return
    seen.add(k)
    out.push({ ...l, style: 'center' })
  }
  // Biggest round part per centre wins (a counterbore's two radii share one mark).
  const marks = new Map()
  for (const c of centres) {
    if (c.kind !== 'mark') continue
    const p = toPaper({ x: c.cx, y: c.cy })
    const k = `${p.x.toFixed(2)},${p.y.toFixed(2)}`
    const r = c.r * scale
    if (!marks.has(k) || marks.get(k).r < r) marks.set(k, { ...p, r })
  }
  for (const m of marks.values()) {
    if (m.r < 0.5) continue
    const h = m.r + CL_OVERHANG
    push({ x1: m.x - h, y1: m.y, x2: m.x + h, y2: m.y })
    push({ x1: m.x, y1: m.y - h, x2: m.x, y2: m.y + h })
  }
  for (const c of centres) {
    if (c.kind !== 'axis' || c.r * scale < 0.5) continue
    const a = toPaper({ x: c.x1, y: c.y1 }), b = toPaper({ x: c.x2, y: c.y2 })
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
    push({ x1: a.x - ux * CL_OVERHANG, y1: a.y - uy * CL_OVERHANG, x2: b.x + ux * CL_OVERHANG, y2: b.y + uy * CL_OVERHANG })
  }
  return out
}

/**
 * Lays the views out at drawing scale `scale` and centres the block on the
 * sheet origin (the Drawing tab's page is centred there too). The gap between
 * views stays GAP_MM on paper whatever the scale. Options: `centreLines`
 * adds chain-line centre marks/axes, `labels` writes "FRONT VIEW" etc. under
 * each view, and with `labels` plus `pageConfig` a "SCALE 2:1" note goes in
 * the page's bottom-right corner. Returns mm geometry plus the block's paper
 * size (labels included).
 */
export function layoutOnSheet(viewsData, scale, { centreLines = false, labels = false, pageConfig = null } = {}) {
  const laid = layoutViews(viewsData, GAP_MM / scale)
  const box = bboxOf(laid)
  // Room for the labels under the lowest views, so the block stays centred.
  const below = labels ? (LABEL_GAP + LABEL_H) / scale : 0
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY - below + box.maxY) / 2
  const s = p => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })
  // viewScale on every piece of view geometry: the Drawing tab's DIM tool
  // divides by it, so dimensions read the real part size.
  const geo = {
    lines: laid.lines.map(l => {
      const a = s({ x: l.x1, y: l.y1 }), b = s({ x: l.x2, y: l.y2 })
      return { ...l, x1: a.x, y1: a.y, x2: b.x, y2: b.y, viewScale: scale }
    }),
    circles: laid.circles.map(c => { const p = s({ x: c.cx, y: c.cy }); return { ...c, cx: p.x, cy: p.y, r: c.r * scale, viewScale: scale } }),
    arcs: laid.arcs.map(a => { const p = s({ x: a.cx, y: a.cy }); return { ...a, cx: p.x, cy: p.y, r: a.r * scale, viewScale: scale } }),
    splines: laid.splines.map(sp => ({ ...sp, points: sp.points.map(s), viewScale: scale })),
  }
  if (centreLines) geo.lines.push(...centreLineEntities(laid.centres, s, scale).map(l => ({ ...l, viewScale: scale })))
  if (labels) {
    for (const [v, b] of Object.entries(laid.boxes)) {
      const lo = s({ x: (b.minX + b.maxX) / 2, y: b.minY })
      geo.lines.push(...strokeTextLines(VIEW_TITLES[v], lo.x, lo.y - LABEL_GAP - LABEL_H, LABEL_H, 'center'))
    }
    if (pageConfig) {
      const area = pageAreaMm(pageConfig)
      geo.lines.push(...strokeTextLines(`SCALE ${scaleLabel(scale)}`, area.w / 2 - 3, -area.h / 2 + 3, LABEL_H, 'right'))
    }
  }
  return { geo, w: box.w * scale, h: box.h * scale + (labels ? LABEL_GAP + LABEL_H : 0) }
}

// The biggest standard scale at which the views fit the page's drawing area
// (with a little breathing room); the smallest scale if nothing fits.
export function autoScale(viewsData, pageConfig, opts = {}) {
  const area = pageAreaMm(pageConfig)
  for (const s of DRAWING_SCALES) {
    const { w, h } = layoutOnSheet(viewsData, s, { labels: opts.labels })
    if (w <= area.w * 0.9 && h <= area.h * 0.9) return s
  }
  return DRAWING_SCALES[DRAWING_SCALES.length - 1]
}

/**
 * Converts flat {lines,circles,arcs,splines} in mm (CCW angles, Y-up — the
 * convention cadWorker.js's computeOrthoViews already emits) to App.jsx's
 * px, Y-down entity convention — the exact rules parseDXF already uses
 * (saveLoad.js:391 `mm = v => v*scale`, `y_px = -mm(y_mm)`, arc
 * `startAngle_px = -endAngle_mm, endAngle_px = -startAngle_mm`). Splines
 * (used only for the oblique-circle sampling fallback, see cadWorker.js's
 * projectEdge) get the same {x, y:-y} treatment per point, mirroring how
 * parseDXF converts LWPOLYLINE vertices.
 */
export function mmViewToPx({ lines, circles, arcs, splines }) {
  // Keep style ('dashed' hidden edges, 'center' centre lines), the lettering
  // flag, the view's drawing scale (read by the DIM tool) and its name.
  const st = e => ({
    ...(e.style ? { style: e.style } : {}), ...(e.text ? { text: true } : {}),
    ...(e.viewScale ? { viewScale: e.viewScale } : {}), ...(e.view ? { view: e.view } : {}),
  })
  return {
    lines: lines.map(l => ({
      x1: mmToPx(l.x1), y1: -mmToPx(l.y1), x2: mmToPx(l.x2), y2: -mmToPx(l.y2), ...st(l),
    })),
    circles: circles.map(c => ({ cx: mmToPx(c.cx), cy: -mmToPx(c.cy), r: mmToPx(c.r), ...st(c) })),
    arcs: arcs.map(a => ({
      cx: mmToPx(a.cx), cy: -mmToPx(a.cy), r: mmToPx(a.r),
      startAngle: -a.endAngle, endAngle: -a.startAngle, ...st(a),
    })),
    // polyline:true — these are literal sampled points (the oblique-circle
    // fallback, see cadWorker.js's projectEdge), not Catmull-Rom control
    // points, so they must render as straight segments between exactly the
    // points given. Same shape parseDXF's LWPOLYLINE import already
    // produces (saveLoad.js:474/552).
    splines: (splines || []).map(s => ({
      points: s.points.map(p => ({ x: mmToPx(p.x), y: -mmToPx(p.y) })),
      closed: !!s.closed,
      polyline: true,
      ...st(s),
    })),
  }
}

// Pure JS, no React — matches the tools/*Math.js convention used throughout
// this app. Takes the raw per-view mm geometry cadEngine.computeOrthoViews()
// returns and (1) lays the selected views out on one shared drawing-sheet mm
// frame, (2) converts the result to App.jsx's px/Y-down entity convention —
// the exact same mm<->px/angle-flip rules saveLoad.js's parseDXF/exportDXF
// already use, since cadWorker.js's computeOrthoViews emits geometry in that
// same mm/CCW/Y-up convention (proven already by exportFaceDXF).

import { mmToPx } from '../constants.js'

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
 * Returns flat {lines,circles,arcs,splines} in mm, still untranslated to px.
 */
export function layoutViews(viewsData, gapMm = GAP_MM) {
  const present = VIEW_PRIORITY.filter(v => viewsData[v])
  if (present.length === 0) return { lines: [], circles: [], arcs: [], splines: [] }

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

  const merged = { lines: [], circles: [], arcs: [], splines: [] }
  for (const v of present) {
    const dx = pagePos[v].x - boxes[v].minX
    const dy = pagePos[v].y - boxes[v].minY
    const translated = translateView(viewsData[v], dx, dy)
    merged.lines.push(...translated.lines)
    merged.circles.push(...translated.circles)
    merged.arcs.push(...translated.arcs)
    merged.splines.push(...translated.splines)
  }
  return merged
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
  return {
    lines: lines.map(l => ({
      x1: mmToPx(l.x1), y1: -mmToPx(l.y1), x2: mmToPx(l.x2), y2: -mmToPx(l.y2),
    })),
    circles: circles.map(c => ({ cx: mmToPx(c.cx), cy: -mmToPx(c.cy), r: mmToPx(c.r) })),
    arcs: arcs.map(a => ({
      cx: mmToPx(a.cx), cy: -mmToPx(a.cy), r: mmToPx(a.r),
      startAngle: -a.endAngle, endAngle: -a.startAngle,
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
    })),
  }
}

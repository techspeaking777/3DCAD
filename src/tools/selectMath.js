import { norm2pi } from '../constants.js'

// ── Bounding box of a single entity ──────────────────────────────────────────

export function entityBBox(kind, entity) {
  if (kind === 'line') {
    return {
      x1: Math.min(entity.x1, entity.x2),
      y1: Math.min(entity.y1, entity.y2),
      x2: Math.max(entity.x1, entity.x2),
      y2: Math.max(entity.y1, entity.y2),
    }
  }
  if (kind === 'circle') {
    return { x1: entity.cx - entity.r, y1: entity.cy - entity.r,
             x2: entity.cx + entity.r, y2: entity.cy + entity.r }
  }
  if (kind === 'arc') {
    const { cx, cy, r, startAngle, endAngle } = entity
    // Start with endpoints
    let x1 = Math.min(cx + r * Math.cos(startAngle), cx + r * Math.cos(endAngle))
    let y1 = Math.min(cy + r * Math.sin(startAngle), cy + r * Math.sin(endAngle))
    let x2 = Math.max(cx + r * Math.cos(startAngle), cx + r * Math.cos(endAngle))
    let y2 = Math.max(cy + r * Math.sin(startAngle), cy + r * Math.sin(endAngle))
    // Check axis-aligned extrema
    const extrema = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]
    for (const a of extrema) {
      const na = norm2pi(a)
      const s = norm2pi(startAngle), en = norm2pi(endAngle)
      const on = s <= en ? (na >= s && na <= en) : (na >= s || na <= en)
      if (on) {
        const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a)
        x1 = Math.min(x1, px); y1 = Math.min(y1, py)
        x2 = Math.max(x2, px); y2 = Math.max(y2, py)
      }
    }
    return { x1, y1, x2, y2 }
  }
  if (kind === 'spline') {
    const pts = entity.points
    if (!pts || !pts.length) return { x1: 0, y1: 0, x2: 0, y2: 0 }
    return {
      x1: Math.min(...pts.map(p => p.x)),
      y1: Math.min(...pts.map(p => p.y)),
      x2: Math.max(...pts.map(p => p.x)),
      y2: Math.max(...pts.map(p => p.y)),
    }
  }
  return { x1: 0, y1: 0, x2: 0, y2: 0 }
}

// ── Bounding box of entire selection ─────────────────────────────────────────

export function selectionBBox(selection, lines, circles, arcs, splines) {
  if (!selection.length) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const e of selection) {
    let entity
    if (e.kind === 'line')   entity = lines[e.idx]
    if (e.kind === 'circle') entity = circles[e.idx]
    if (e.kind === 'arc')    entity = arcs[e.idx]
    if (e.kind === 'spline') entity = splines[e.idx]
    if (!entity) continue
    const b = entityBBox(e.kind, entity)
    x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1)
    x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2)
  }
  if (!isFinite(x1)) return null

  // Minimum bbox size so handles are always distinct and usable.
  // A horizontal line has h=0, vertical line has w=0 — without padding
  // all 9 handles collapse onto one line and the move handle is unreachable.
  const MIN_PAD = 20  // world pixels (~10mm at normal scale)
  if (x2 - x1 < MIN_PAD) { const pad = (MIN_PAD - (x2-x1)) / 2; x1 -= pad; x2 += pad }
  if (y2 - y1 < MIN_PAD) { const pad = (MIN_PAD - (y2-y1)) / 2; y1 -= pad; y2 += pad }

  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 }
}

// ── Handle layout ─────────────────────────────────────────────────────────────
// Returns 9 handles: 4 corners, 4 edges, 1 centre (move)
// Each: { id, x, y }
const HANDLE_IDS = ['tl','tc','tr','ml','mc','mr','bl','bc','br']

export function getBBoxHandles(bbox) {
  const { x1, y1, x2, y2 } = bbox
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  return {
    tl: { id: 'tl', x: x1, y: y1 },
    tc: { id: 'tc', x: mx, y: y1 },
    tr: { id: 'tr', x: x2, y: y1 },
    ml: { id: 'ml', x: x1, y: my },
    mc: { id: 'mc', x: mx, y: my },   // move handle
    mr: { id: 'mr', x: x2, y: my },
    bl: { id: 'bl', x: x1, y: y2 },
    bc: { id: 'bc', x: mx, y: y2 },
    br: { id: 'br', x: x2, y: y2 },
  }
}

// ── Hit-test handles ──────────────────────────────────────────────────────────

export function hitTestHandles(pos, handles, hitRadius) {
  for (const id of HANDLE_IDS) {
    const h = handles[id]
    if (Math.hypot(pos.x - h.x, pos.y - h.y) <= hitRadius) return id
  }
  return null
}

// ── Transform math ────────────────────────────────────────────────────────────
// Given handle being dragged, original bbox, start pos, current pos:
// Returns { anchor:{x,y}, sx, sy, dx, dy }
// anchor = fixed point (opposite corner/edge)
// sx, sy = scale factors (1 = no scale)
// dx, dy = translation

export function computeHandleTransform(handleId, bbox, startPos, currentPos) {
  const { x1, y1, x2, y2 } = bbox
  const dx = currentPos.x - startPos.x
  const dy = currentPos.y - startPos.y
  const w = x2 - x1 || 1, h = y2 - y1 || 1

  if (handleId === 'mc') {
    // Pure move
    return { anchor: { x: x1, y: y1 }, sx: 1, sy: 1, dx, dy }
  }

  // Anchor = opposite corner/edge; scale from that fixed point
  const anchorMap = {
    tl: { ax: x2, ay: y2 }, tc: { ax: (x1+x2)/2, ay: y2 },
    tr: { ax: x1, ay: y2 }, ml: { ax: x2, ay: (y1+y2)/2 },
    mr: { ax: x1, ay: (y1+y2)/2 },
    bl: { ax: x2, ay: y1 }, bc: { ax: (x1+x2)/2, ay: y1 },
    br: { ax: x1, ay: y1 },
  }
  const { ax, ay } = anchorMap[handleId]

  let sx = 1, sy = 1
  // Which edges move?
  if (['tl','tr','bl','br'].includes(handleId)) {
    // Corner: scale both axes uniformly (shift = uniform scale from opposite corner)
    const newW = Math.abs(w + (handleId.includes('r') ? dx : -dx))
    const newH = Math.abs(h + (handleId.includes('b') ? dy : -dy))
    // Uniform scale: use the larger dimension to determine scale
    const s = Math.max(newW / w, newH / h)
    sx = s; sy = s
  } else if (['tc','bc'].includes(handleId)) {
    sy = Math.abs(h + (handleId === 'bc' ? dy : -dy)) / h
    sx = 1
  } else if (['ml','mr'].includes(handleId)) {
    sx = Math.abs(w + (handleId === 'mr' ? dx : -dx)) / w
    sy = 1
  }

  return { anchor: { x: ax, y: ay }, sx, sy, dx: 0, dy: 0 }
}

// ── Apply transform to a point ────────────────────────────────────────────────
function tp(px, py, anchor, sx, sy, dx, dy) {
  return {
    x: anchor.x + (px - anchor.x) * sx + dx,
    y: anchor.y + (py - anchor.y) * sy + dy,
  }
}

// ── Apply transform to a single entity ───────────────────────────────────────
function transformEntity(kind, entity, anchor, sx, sy, dx, dy) {
  if (kind === 'line') {
    const p1 = tp(entity.x1, entity.y1, anchor, sx, sy, dx, dy)
    const p2 = tp(entity.x2, entity.y2, anchor, sx, sy, dx, dy)
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, ...(entity.style?{style:entity.style}:{}) }
  }
  if (kind === 'circle') {
    const c = tp(entity.cx, entity.cy, anchor, sx, sy, dx, dy)
    // Use axis-appropriate scale: whichever axis the centre is further from anchor on
    const adx = Math.abs(entity.cx - anchor.x)
    const ady = Math.abs(entity.cy - anchor.y)
    const rs = (sx === sy) ? sx
             : (adx > ady) ? sx
             : (ady > adx) ? sy
             : Math.sqrt(sx * sy)  // equidistant — geometric mean
    return { cx: c.x, cy: c.y, r: entity.r * rs, ...(entity.style?{style:entity.style}:{}) }
  }
  if (kind === 'arc') {
    const c = tp(entity.cx, entity.cy, anchor, sx, sy, dx, dy)
    const adx = Math.abs(entity.cx - anchor.x)
    const ady = Math.abs(entity.cy - anchor.y)
    const rs = (sx === sy) ? sx
             : (adx > ady) ? sx
             : (ady > adx) ? sy
             : Math.sqrt(sx * sy)
    return { cx: c.x, cy: c.y, r: entity.r * rs,
             startAngle: entity.startAngle, endAngle: entity.endAngle,
             ...(entity.style?{style:entity.style}:{}) }
  }
  if (kind === 'spline') {
    return {
      ...entity,
      points: entity.points.map(p => tp(p.x, p.y, anchor, sx, sy, dx, dy)),
    }
  }
  return entity
}

// ── Apply transform to all selected entities ─────────────────────────────────
// Returns new { lines, circles, arcs, splines } with selection transformed.
// Non-selected entities are unchanged.
export function applySelectionTransform(
  selection, lines, circles, arcs, splines,
  anchor, sx, sy, dx, dy
) {
  const selLines   = new Set(selection.filter(e=>e.kind==='line')  .map(e=>e.idx))
  const selCircles = new Set(selection.filter(e=>e.kind==='circle').map(e=>e.idx))
  const selArcs    = new Set(selection.filter(e=>e.kind==='arc')   .map(e=>e.idx))
  const selSplines = new Set(selection.filter(e=>e.kind==='spline').map(e=>e.idx))

  return {
    lines:   lines.map((e,i)   => selLines.has(i)   ? transformEntity('line',  e, anchor, sx, sy, dx, dy) : e),
    circles: circles.map((e,i) => selCircles.has(i) ? transformEntity('circle',e, anchor, sx, sy, dx, dy) : e),
    arcs:    arcs.map((e,i)    => selArcs.has(i)    ? transformEntity('arc',   e, anchor, sx, sy, dx, dy) : e),
    splines: splines.map((e,i) => selSplines.has(i) ? transformEntity('spline',e, anchor, sx, sy, dx, dy) : e),
  }
}

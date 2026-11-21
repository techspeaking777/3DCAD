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
    return { ...entity, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
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
    return { ...entity, cx: c.x, cy: c.y, r: entity.r * rs }
  }
  if (kind === 'arc') {
    const c = tp(entity.cx, entity.cy, anchor, sx, sy, dx, dy)
    const adx = Math.abs(entity.cx - anchor.x)
    const ady = Math.abs(entity.cy - anchor.y)
    const rs = (sx === sy) ? sx
             : (adx > ady) ? sx
             : (ady > adx) ? sy
             : Math.sqrt(sx * sy)
    return { ...entity, cx: c.x, cy: c.y, r: entity.r * rs }
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

// ── Corners: keeping joined lines together ───────────────────────────────────
// A "corner" is every line end / open-spline end sitting at one point. Moving a
// corner moves all of them, so a closed outline stays closed when a student
// drags a corner or edits one line's length/angle. Arcs are left out: moving
// one end of an arc would change its shape, so a corner that includes an arc
// end isn't dragged (findCorner reports hasArc) and edits leave arcs alone.

export const CORNER_JOIN_TOL = 2   // sketch px (1 mm): ends this close count as joined

const isOpenEditable = sp => !sp.closed && !sp.ghostRef && Array.isArray(sp.points) && sp.points.length >= 2

// The corner nearest `pos` within `radius`: { pt, members, hasArc } or null.
// members: [{kind:'line', idx, end:1|2}, {kind:'spline', idx, node}].
// `skip` (optional) is a predicate on a member, to leave some ends out.
export function findCorner(pos, lines, arcs, splines, radius, skip = null) {
  let best = null, bestD = radius
  const consider = p => { const d = Math.hypot(p.x - pos.x, p.y - pos.y); if (d <= bestD) { bestD = d; best = { x: p.x, y: p.y } } }
  lines.forEach(l => { if (!l.ghostRef) { consider({ x: l.x1, y: l.y1 }); consider({ x: l.x2, y: l.y2 }) } })
  splines.forEach(sp => { if (isOpenEditable(sp)) { consider(sp.points[0]); consider(sp.points[sp.points.length - 1]) } })
  if (!best) return null
  const near = (x, y) => Math.hypot(x - best.x, y - best.y) <= CORNER_JOIN_TOL
  const members = []
  lines.forEach((l, idx) => {
    if (l.ghostRef) return
    if (near(l.x1, l.y1)) members.push({ kind: 'line', idx, end: 1 })
    if (near(l.x2, l.y2)) members.push({ kind: 'line', idx, end: 2 })
  })
  splines.forEach((sp, idx) => {
    if (!isOpenEditable(sp)) return
    const last = sp.points.length - 1
    if (near(sp.points[0].x, sp.points[0].y)) members.push({ kind: 'spline', idx, node: 0 })
    if (near(sp.points[last].x, sp.points[last].y)) members.push({ kind: 'spline', idx, node: last })
  })
  const hasArc = arcs.some(a => !a.ghostRef && (
    near(a.cx + Math.cos(a.startAngle) * a.r, a.cy + Math.sin(a.startAngle) * a.r) ||
    near(a.cx + Math.cos(a.endAngle) * a.r, a.cy + Math.sin(a.endAngle) * a.r)))
  return { pt: best, members: skip ? members.filter(m => !skip(m)) : members, hasArc }
}

// Moves every member end to `to`. Returns new { lines, splines } arrays.
export function moveCorner(lines, splines, members, to) {
  const lineEnds = new Map(), splineNodes = new Map()
  for (const m of members) {
    if (m.kind === 'line') lineEnds.set(m.idx, [...(lineEnds.get(m.idx) || []), m.end])
    else splineNodes.set(m.idx, [...(splineNodes.get(m.idx) || []), m.node])
  }
  return {
    lines: lines.map((l, i) => {
      const ends = lineEnds.get(i); if (!ends) return l
      return { ...l, ...(ends.includes(1) ? { x1: to.x, y1: to.y } : {}), ...(ends.includes(2) ? { x2: to.x, y2: to.y } : {}) }
    }),
    splines: splines.map((sp, i) => {
      const nodes = splineNodes.get(i); if (!nodes) return sp
      return { ...sp, points: sp.points.map((p, k) => nodes.includes(k) ? { ...p, x: to.x, y: to.y } : p) }
    }),
  }
}

// After some lines' ends were moved (from → to), drag the OTHER lines/splines
// that were joined at the old end positions along with them. `moves` =
// [{from, to}]. `edited` = the line index that was edited (already moved), or
// {lines:Set, splines:Set} of everything that was (those are never touched).
export function carryJoinedEnds(lines, splines, moves, edited) {
  const skipLines = edited instanceof Object && edited.lines ? edited.lines : new Set([edited])
  const skipSplines = edited instanceof Object && edited.splines ? edited.splines : new Set()
  let out = { lines, splines }
  for (const { from, to } of moves) {
    if (Math.hypot(from.x - to.x, from.y - to.y) < 1e-9) continue
    const c = findCorner(from, out.lines, [], out.splines, CORNER_JOIN_TOL,
      m => m.kind === 'line' ? skipLines.has(m.idx) : skipSplines.has(m.idx))
    if (c?.members.length) out = moveCorner(out.lines, out.splines, c.members, to)
  }
  return out
}

// Select-handle drag (stretch / scale / move a selection): the selected lines
// moved from `before` to `after`; lines and splines NOT in the selection that
// were joined to their ends follow live, so a closed shape stays closed — the
// same as dragging a corner. Returns `after` with those ends carried.
// Follow the corner (Session 4 rules) for a LIVE handle drag too: a
// horizontal/vertical line joined to a moved end slides and stays straight
// instead of tipping over (a stretched rectangle side used to drag the side
// next to it off vertical). Falls back to plain end-carrying if the walk fails.
export function carrySelectionJoins(before, after, selection) {
  const selLines = new Set(selection.filter(e => e.kind === 'line').map(e => e.idx))
  if (!selLines.size) return after
  const selSplines = new Set(selection.filter(e => e.kind === 'spline').map(e => e.idx))
  const selArcs = new Set(selection.filter(e => e.kind === 'arc').map(e => e.idx))
  const queue = []
  for (const i of selLines) {
    const a = before.lines[i], b = after.lines[i]
    if (!a || !b) continue
    for (const [fx, fy, tx, ty] of [[a.x1, a.y1, b.x1, b.y1], [a.x2, a.y2, b.x2, b.y2]]) {
      const d = { x: tx - fx, y: ty - fy }
      if (Math.hypot(d.x, d.y) > 1e-9) queue.push({ p: { x: fx, y: fy }, d })
    }
  }
  if (!queue.length) return after
  const arcsB = before.arcs || [], arcsA = after.arcs || arcsB
  const outL = after.lines.map(x => ({ ...x }))
  const outA = arcsA.map(a => ({ ...a }))
  const outS = after.splines.map(s => (Array.isArray(s.points) ? { ...s, points: s.points.map(p => ({ ...p })) } : s))
  const res = spreadCornerMove(before.lines, arcsB, before.splines, outL, outA, outS, queue, [], new Set(selLines), selArcs, selSplines)
  if (!res.refused) return { ...after, lines: res.lines, arcs: res.arcs, splines: res.splines }
  return carrySelectionJoinsSimple(before, after, selection)
}

// The old way: joined ends just move with the selected line's ends.
function carrySelectionJoinsSimple(before, after, selection) {
  const selLines = new Set(selection.filter(e => e.kind === 'line').map(e => e.idx))
  const selSplines = new Set(selection.filter(e => e.kind === 'spline').map(e => e.idx))
  if (!selLines.size) return after
  const moves = []
  for (const i of selLines) {
    const a = before.lines[i], b = after.lines[i]
    if (!a || !b) continue
    moves.push({ from: { x: a.x1, y: a.y1 }, to: { x: b.x1, y: b.y1 } }, { from: { x: a.x2, y: a.y2 }, to: { x: b.x2, y: b.y2 } })
  }
  // Find joined ends against the BEFORE positions (nothing else has moved yet).
  let out = { lines: after.lines, splines: after.splines }
  for (const { from, to } of moves) {
    if (Math.hypot(from.x - to.x, from.y - to.y) < 1e-9) continue
    const c = findCorner(from, before.lines, [], before.splines, CORNER_JOIN_TOL,
      m => m.kind === 'line' ? selLines.has(m.idx) : selSplines.has(m.idx))
    if (c?.members.length) out = moveCorner(out.lines, out.splines, c.members, to)
  }
  return { ...after, lines: out.lines, splines: out.splines }
}

// ── Follow the corner (docs/plan-edit-history.md, Session 4) ────────────────
// Changing one line's length/angle in the Select panel moves the rest of the
// shape the way a student expects — a rectangle stays a rectangle:
//   - one end of the edited line stays put (defaultFixedEnd, or the anchor dot)
//   - at each corner the moved end reaches: a line the move runs ALONG just
//     stretches; a horizontal/vertical line the move would tilt SLIDES sideways
//     (staying straight) and passes the sideways part on to its far corner; a
//     sloped line stretches and tilts (as before)
//   - an arc (rounded corner) slides with the move and passes it on, so a
//     rounded rectangle stays rounded; a spline moves only its joined end
//   - if the move would reach the fixed end, nothing changes ({refused})
// H/V comes from the geometry: an exactly horizontal or vertical line (lines
// drawn with the H/V snap are exact, and so are old ones). Dragging a line
// off-axis therefore drops it.
export const HV_TOL = 1e-3   // sketch px

export function lineHV(l) {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1
  if (Math.hypot(dx, dy) < 1e-9) return null
  if (Math.abs(dy) <= HV_TOL) return 'H'
  if (Math.abs(dx) <= HV_TOL) return 'V'
  return null
}

// The end (1 or 2) that stays put by default: the one nearest the sketch
// origin, so the shape grows away from it (like Fusion); a tie keeps the left
// end, or the bottom end of a vertical line (y is down, so the larger y).
export function defaultFixedEnd(l) {
  const d1 = Math.hypot(l.x1, l.y1), d2 = Math.hypot(l.x2, l.y2)
  if (Math.abs(d1 - d2) > 1e-6) return d1 < d2 ? 1 : 2
  if (Math.abs(l.x1 - l.x2) > 1e-6) return l.x1 < l.x2 ? 1 : 2
  return l.y1 >= l.y2 ? 1 : 2
}

export const FOLLOW_REFUSED_MSG = 'That would move the fixed corner — choose the other end to stay put (the anchor dots).'

// Line `idx` gets length newLen (px) and direction angleRad (x1→x2, sketch
// coords), end `fixedEnd` staying put. Returns {lines, arcs, splines} (new
// arrays) or {refused: true}.
export function resizeLineFollowingCorners(lines, arcs, splines, idx, fixedEnd, newLen, angleRad, rigid = null) {
  const l = lines[idx]
  const nx = Math.cos(angleRad), ny = Math.sin(angleRad)
  const F = fixedEnd === 1 ? { x: l.x1, y: l.y1 } : { x: l.x2, y: l.y2 }
  const M = fixedEnd === 1 ? { x: l.x2, y: l.y2 } : { x: l.x1, y: l.y1 }
  const Mn = fixedEnd === 1 ? { x: F.x + nx * newLen, y: F.y + ny * newLen } : { x: F.x - nx * newLen, y: F.y - ny * newLen }
  const outL = lines.map(x => ({ ...x }))
  const outA = arcs.map(a => ({ ...a }))
  const outS = splines.map(s => (Array.isArray(s.points) ? { ...s, points: s.points.map(p => ({ ...p })) } : s))
  if (fixedEnd === 1) { outL[idx].x2 = Mn.x; outL[idx].y2 = Mn.y } else { outL[idx].x1 = Mn.x; outL[idx].y1 = Mn.y }
  return spreadCornerMove(lines, arcs, splines, outL, outA, outS, [{ p: M, d: { x: Mn.x - M.x, y: Mn.y - M.y } }], [F], new Set([idx]), null, null, rigid)
}

// Corner P moves by d (px) and the shape follows by the same rules (dimension
// edits: one corner of a distance, edit history Session 5). `fixedPts` must not
// move ({refused} if the change reaches one). `rigid` (a Set of line indices —
// lines locked by a driving length dimension) slide whole instead of stretching.
// Returns {lines, arcs, splines}.
export function moveCornerFollowing(lines, arcs, splines, P, d, fixedPts = [], skipArcs = null, rigid = null) {
  const outL = lines.map(x => ({ ...x }))
  const outA = arcs.map(a => ({ ...a }))
  const outS = splines.map(s => (Array.isArray(s.points) ? { ...s, points: s.points.map(p => ({ ...p })) } : s))
  return spreadCornerMove(lines, arcs, splines, outL, outA, outS, [{ p: P, d }], fixedPts, new Set(), skipArcs, null, rigid)
}

// The shared walk: each queued {p, d} moves whatever meets at p (see the rules above).
function spreadCornerMove(lines, arcs, splines, outL, outA, outS, queue, fixedPts, doneLines, doneArcs = null, skipSplines = null, rigid = null) {
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= CORNER_JOIN_TOL
  doneArcs = doneArcs || new Set()
  const doneSplineEnds = new Set()
  // Line ends this walk has moved ('i:1' / 'i:2'); lines handed in as done count as moved.
  const movedEnds = new Set()
  doneLines.forEach(i => { movedEnds.add(i + ':1'); movedEnds.add(i + ':2') })
  let steps = 0
  while (queue.length) {
    const { p, d } = queue.shift()
    if (++steps > 1000) return { refused: true }
    if (Math.hypot(d.x, d.y) < 1e-9) continue
    if (fixedPts.some(F => near(F, p))) return { refused: true }
    lines.forEach((L, i) => {
      if (L.ghostRef) return
      const e = near({ x: L.x1, y: L.y1 }, p) ? 1 : near({ x: L.x2, y: L.y2 }, p) ? 2 : 0
      if (!e) return
      const move = (end, v) => {
        movedEnds.add(i + ':' + end)
        if (end === 1) { outL[i].x1 += v.x; outL[i].y1 += v.y } else { outL[i].x2 += v.x; outL[i].y2 += v.y }
      }
      // Reached again at its OTHER end (the move went round a closed shape):
      // that end follows the corner too, so the shape stays joined.
      if (doneLines.has(i)) { if (!movedEnds.has(i + ':' + e)) move(e, d); return }
      doneLines.add(i)
      const far = e === 1 ? { x: L.x2, y: L.y2 } : { x: L.x1, y: L.y1 }
      const len = Math.hypot(far.x - p.x, far.y - p.y)
      if (len < 1e-9) { move(1, d); move(2, d); return }
      // A locked line (driving length dimension) slides whole and passes the move on.
      if (rigid?.has(i)) { move(1, d); move(2, d); queue.push({ p: far, d }); return }
      const u = { x: (far.x - p.x) / len, y: (far.y - p.y) / len }
      const along = d.x * u.x + d.y * u.y
      const perp = { x: d.x - along * u.x, y: d.y - along * u.y }
      // Stretch: the move runs along this line, or it is sloped (it tilts).
      if (Math.hypot(perp.x, perp.y) < 1e-6 || !lineHV(L)) { move(e, d); return }
      // Slide: stays horizontal/vertical; the sideways part goes on.
      move(e, d); move(3 - e, perp)
      queue.push({ p: far, d: perp })
    })
    arcs.forEach((A, i) => {
      if (doneArcs.has(i) || A.ghostRef) return
      const s = { x: A.cx + Math.cos(A.startAngle) * A.r, y: A.cy + Math.sin(A.startAngle) * A.r }
      const en = { x: A.cx + Math.cos(A.endAngle) * A.r, y: A.cy + Math.sin(A.endAngle) * A.r }
      const atS = near(s, p), atE = near(en, p)
      if (!atS && !atE) return
      doneArcs.add(i)
      outA[i].cx += d.x; outA[i].cy += d.y
      queue.push({ p: atS ? en : s, d })
    })
    splines.forEach((sp, i) => {
      if (!isOpenEditable(sp) || skipSplines?.has(i)) return
      const last = sp.points.length - 1
      for (const k of [0, last]) {
        const key = i + ':' + k
        if (doneSplineEnds.has(key) || !near(sp.points[k], p)) continue
        doneSplineEnds.add(key)
        outS[i].points[k].x += d.x; outS[i].points[k].y += d.y
      }
    })
  }
  return { lines: outL, arcs: outA, splines: outS }
}

// Every line joined (end to end, through lines and arcs) to line `idx` — the
// shape it belongs to. Used to show the H/V marks on that shape.
export function connectedLineIdxs(lines, arcs, idx) {
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= CORNER_JOIN_TOL
  const ends = l => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]
  const arcEnds = a => [{ x: a.cx + Math.cos(a.startAngle) * a.r, y: a.cy + Math.sin(a.startAngle) * a.r },
    { x: a.cx + Math.cos(a.endAngle) * a.r, y: a.cy + Math.sin(a.endAngle) * a.r }]
  const seenL = new Set([idx]), seenA = new Set()
  const pts = [...ends(lines[idx])]
  while (pts.length) {
    const p = pts.pop()
    lines.forEach((L, i) => { if (!seenL.has(i) && !L.ghostRef && ends(L).some(q => near(q, p))) { seenL.add(i); pts.push(...ends(L)) } })
    arcs.forEach((A, i) => { if (!seenA.has(i) && !A.ghostRef && arcEnds(A).some(q => near(q, p))) { seenA.add(i); pts.push(...arcEnds(A)) } })
  }
  return [...seenL]
}

// Which end of line l stays put for the Select panel's anchor dot `anchorId`
// ('mc' = automatic: defaultFixedEnd), given the selection's handles.
export function fixedEndForAnchor(l, anchorId, handles) {
  const a = anchorId !== 'mc' && handles ? handles[anchorId] : null
  if (!a) return defaultFixedEnd(l)
  return Math.hypot(l.x1 - a.x, l.y1 - a.y) <= Math.hypot(l.x2 - a.x, l.y2 - a.y) ? 1 : 2
}

// The H/V marks and the pin for drawFollowCornerMarks.
export function followCornerMarks(lines, arcs, idx, anchorId, handles) {
  const l = lines[idx]
  const fe = fixedEndForAnchor(l, anchorId, handles)
  const hvLines = connectedLineIdxs(lines, arcs, idx).map(i => ({ ...lines[i], hv: lineHV(lines[i]) })).filter(x => x.hv)
  return { hvLines, pin: fe === 1 ? { x: l.x1, y: l.y1 } : { x: l.x2, y: l.y2 } }
}

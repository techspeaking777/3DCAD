// Text → sketch geometry, shared by the 3D sketch's Text tool (its options
// live in the sketch-tool ribbon, with a live preview under the mouse) and
// the Drawing tab's TextPanel. Fonts are parsed with opentype.js, loaded from
// a CDN on first use (no npm dependency).

// ── Bezier helpers ────────────────────────────────────────────────────────────
function cubicPt(p0, p1, p2, p3, t) {
  const mt = 1 - t
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  }
}
function quadPt(p0, p1, p2, t) {
  const mt = 1 - t
  return { x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x, y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y }
}

// opentype.js path commands → polyline contours. Each contour:
// { points:[{x,y},...], closed:bool, segs } — segs is one letter per span after
// the start point ('L' line = 1 point, 'Q'/'C' curve = `samples` points at
// t = i/samples). It lets the 3D build recover the font's EXACT curves from the
// points (extrudeMath glyphCurveSegments) instead of facets.
export function pathToContours(commands, samples = 12) {
  const contours = []
  let pts = [], cx = 0, cy = 0, segs = ''
  for (const cmd of commands) {
    if (cmd.type === 'M') {
      if (pts.length >= 2) contours.push({ points: pts, closed: false, segs })
      pts = [{ x: cmd.x, y: cmd.y }]; cx = cmd.x; cy = cmd.y; segs = ''
    } else if (cmd.type === 'L') {
      pts.push({ x: cmd.x, y: cmd.y }); cx = cmd.x; cy = cmd.y; segs += 'L'
    } else if (cmd.type === 'C') {
      const p0 = { x: cx, y: cy }, p1 = { x: cmd.x1, y: cmd.y1 }, p2 = { x: cmd.x2, y: cmd.y2 }, p3 = { x: cmd.x, y: cmd.y }
      for (let i = 1; i <= samples; i++) pts.push(cubicPt(p0, p1, p2, p3, i / samples))
      cx = cmd.x; cy = cmd.y; segs += 'C'
    } else if (cmd.type === 'Q') {
      const p0 = { x: cx, y: cy }, p1 = { x: cmd.x1, y: cmd.y1 }, p2 = { x: cmd.x, y: cmd.y }
      for (let i = 1; i <= samples; i++) pts.push(quadPt(p0, p1, p2, i / samples))
      cx = cmd.x; cy = cmd.y; segs += 'Q'
    } else if (cmd.type === 'Z') {
      if (pts.length >= 2) contours.push({ points: pts, closed: true, segs })
      pts = []; segs = ''
    }
  }
  if (pts.length >= 2) contours.push({ points: pts, closed: false, segs })
  return contours
}

export const PRESET_FONTS = [
  { label: 'Roboto (sans)', url: 'https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/roboto-latin-400-normal.woff' },
  { label: 'Roboto Bold',   url: 'https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/roboto-latin-700-normal.woff' },
  { label: 'Roboto Mono',   url: 'https://cdn.jsdelivr.net/npm/@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff' },
  { label: 'Oswald',        url: 'https://cdn.jsdelivr.net/npm/@fontsource/oswald/files/oswald-latin-400-normal.woff' },
]

async function ensureOpentype() {
  if (window.opentype) return
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js'
    s.onload = resolve
    s.onerror = () => reject(new Error('Could not load opentype.js from CDN'))
    document.head.appendChild(s)
  })
}

export async function parseFontBuffer(buffer) {
  await ensureOpentype()
  return window.opentype.parse(buffer)
}

const urlCache = new Map()   // url → Promise<font>, so each preset downloads once
export function loadFontFromUrl(url) {
  if (!urlCache.has(url)) {
    urlCache.set(url, (async () => {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      return parseFontBuffer(await resp.arrayBuffer())
    })().catch(e => { urlCache.delete(url); throw e }))
  }
  return urlCache.get(url)
}

export async function loadFontFromFile(file) {
  return parseFontBuffer(await file.arrayBuffer())
}

// The words as sketch splines (px, y-down), starting at insertPt (the text's
// baseline start), rotated by angleDeg. Closed letter contours carry `glyph`
// so the 3D build can rebuild their exact curves.
export function textToSplines(font, text, sizePx, angleDeg, insertPt, samples = 12) {
  const path = font.getPath(text, 0, 0, sizePx)
  const contours = pathToContours(path.commands, samples)
  const rad = angleDeg * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  return contours.map(c => ({
    points: c.points.map(p => ({ x: insertPt.x + p.x * cos - p.y * sin, y: insertPt.y + p.x * sin + p.y * cos })),
    closed: c.closed,
    polyline: true,
    ...(c.closed ? { glyph: { segs: c.segs, samples } } : {}),
  }))
}

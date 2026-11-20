// Image → outline tracing, shared by the 3D sketch's Trace tool (options in
// the sketch-tool ribbon, live preview under the mouse) and the Drawing tab's
// TracerPanel.

// Douglas-Peucker (iterative — no stack overflow)
export function douglasPeucker(pts, eps) {
  if (pts.length <= 2) return pts.slice()
  const n = pts.length, keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    if (e - s <= 1) continue
    const [fx, fy] = pts[s], [lx, ly] = pts[e]
    const dx = lx - fx, dy = ly - fy, len = Math.hypot(dx, dy)
    let maxD = 0, maxI = s + 1
    for (let i = s + 1; i < e; i++) {
      const d = len < 1e-9
        ? Math.hypot(pts[i][0] - fx, pts[i][1] - fy)
        : Math.abs(dy * pts[i][0] - dx * pts[i][1] + lx * fy - ly * fx) / len
      if (d > maxD) { maxD = d; maxI = i }
    }
    if (maxD > eps) { keep[maxI] = 1; stack.push([s, maxI], [maxI, e]) }
  }
  return pts.filter((_, i) => keep[i])
}

// Pixel-boundary contour tracer: dark pixels (or light ones with invert) →
// closed outlines in the canvas's own pixels, simplified by `epsilon`.
export function traceContours(canvas, threshold, invert, epsilon) {
  const w = canvas.width, h = canvas.height
  if (!w || !h) return []
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data
  const bin = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const br = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    bin[i] = invert ? (br > threshold ? 1 : 0) : (br < threshold ? 1 : 0)
  }
  const segs = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!bin[y * w + x]) continue
    if (y === 0     || !bin[(y - 1) * w + x]) segs.push([[x, y],     [x + 1, y]])
    if (x === w - 1 || !bin[y * w + x + 1])   segs.push([[x + 1, y], [x + 1, y + 1]])
    if (y === h - 1 || !bin[(y + 1) * w + x]) segs.push([[x + 1, y + 1], [x, y + 1]])
    if (x === 0     || !bin[y * w + x - 1])   segs.push([[x, y + 1], [x, y]])
  }
  const idx = new Map()
  segs.forEach(([p], i) => {
    const k = p[0] * 1024 + p[1]
    const a = idx.get(k); if (a) a.push(i); else idx.set(k, [i])
  })
  const used = new Uint8Array(segs.length), chains = []
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue
    const chain = [segs[s][0]]; used[s] = 1; let cur = segs[s][1]
    for (;;) {
      chain.push(cur)
      const nexts = idx.get(cur[0] * 1024 + cur[1])
      if (!nexts) break
      const ni = nexts.find(i => !used[i])
      if (ni === undefined) break
      used[ni] = 1; cur = segs[ni][1]
    }
    const last = chain[chain.length - 1], first = chain[0]
    if (last[0] === first[0] && last[1] === first[1]) chain.pop()
    if (chain.length >= 4) chains.push(douglasPeucker(chain, epsilon))
  }
  return chains
}

// Reads an image file onto a hidden canvas no bigger than maxDisp across.
export function loadImageToCanvas(file, maxDisp = 520) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) { reject(new Error('That is not an image file.')); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const sc = Math.min(maxDisp / img.naturalWidth, maxDisp / img.naturalHeight, 1)
      const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve({ img, canvas, w, h, url, name: file.name })
    }
    img.onerror = () => reject(new Error('Could not read that image.'))
    img.src = url
  })
}

// Traced contours (image pixels) → sketch lines, `widthPx` wide, centred on `centre`.
export function contoursToLines(contours, dispW, dispH, widthPx, centre) {
  const k = widthPx / dispW, cx = dispW / 2, cy = dispH / 2
  const out = []
  contours.forEach(pts => {
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
      out.push({ x1: centre.x + (x1 - cx) * k, y1: centre.y + (y1 - cy) * k,
                 x2: centre.x + (x2 - cx) * k, y2: centre.y + (y2 - cy) * k })
    }
  })
  return out
}

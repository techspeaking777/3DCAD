import { useState, useRef, useEffect } from 'react'
import { SCALE } from '../constants.js'

// ── Douglas-Peucker (iterative — no stack overflow)
function douglasPeucker(pts, eps) {
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

// ── Pixel-boundary contour tracer
function traceContours(canvas, threshold, invert, epsilon) {
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

const MAX_DISP = 520

export default function TracerPanel({ insertPt, onImport, onClose }) {
  const [imgSrc, setImgSrc]     = useState(null)
  const [dispW, setDispW]       = useState(0)
  const [dispH, setDispH]       = useState(0)
  const [threshold, setThreshold] = useState(128)
  const [epsilon, setEpsilon]   = useState(1.5)
  const [invert, setInvert]     = useState(false)
  const [showImg, setShowImg]   = useState(true)
  const [contours, setContours] = useState([])
  const [widthMm, setWidthMm]   = useState('100')
  const [dragging, setDragging] = useState(null)
  const [hoverNode, setHoverNode] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const canvasRef = useRef(null)
  const fileRef   = useRef(null)
  const timerRef  = useRef(null)

  const loadFile = (file) => {
    if (!file?.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const sc = Math.min(MAX_DISP / img.naturalWidth, MAX_DISP / img.naturalHeight, 1)
      const w = Math.round(img.naturalWidth * sc)
      const h = Math.round(img.naturalHeight * sc)
      setDispW(w); setDispH(h); setImgSrc(url)
      const c = canvasRef.current
      c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
    }
    img.src = url
  }

  // Retrace whenever any param changes, debounced
  useEffect(() => {
    if (!imgSrc) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setContours(traceContours(canvasRef.current, threshold, invert, epsilon))
    }, 120)
    return () => clearTimeout(timerRef.current)
  }, [imgSrc, threshold, invert, epsilon])

  function handleImport() {
    if (!contours.length || !dispW) return
    const wMm = Math.max(1, parseFloat(widthMm) || 100)
    const scaleFactor = (wMm * SCALE) / dispW
    const cx = dispW / 2, cy = dispH / 2
    const newLines = []
    contours.forEach(pts => {
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]
        const [x2, y2] = pts[(i + 1) % pts.length]
        newLines.push({
          x1: insertPt.x + (x1 - cx) * scaleFactor,
          y1: insertPt.y + (y1 - cy) * scaleFactor,
          x2: insertPt.x + (x2 - cx) * scaleFactor,
          y2: insertPt.y + (y2 - cy) * scaleFactor,
        })
      }
    })
    onImport({ lines: newLines, circles: [], arcs: [] })
  }

  const pathD = pts => pts.length < 2 ? '' :
    `M${pts[0][0]},${pts[0][1]}` + pts.slice(1).map(p => `L${p[0]},${p[1]}`).join('') + 'Z'

  const nodeCount = contours.reduce((s, p) => s + p.length, 0)

  return (
    // Overlay
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      {/* Panel */}
      <div style={{
        background: '#141414', borderRadius: 8, border: '1px solid #2a2a2a',
        display: 'flex', flexDirection: 'column',
        width: 760, maxHeight: '90vh', overflow: 'hidden',
        fontFamily: 'monospace'
      }}>

        {/* Header */}
        <div style={{
          background: '#1a1a1a', borderBottom: '1px solid #222',
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0
        }}>
          <div style={{ width: 16, height: 16, background: '#e8e8e0', borderRadius: 2 }} />
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#e8e8e0' }}>SILHOUETTE TRACER</span>
          {imgSrc && (
            <span style={{ fontSize: 10, color: '#555', marginLeft: 4 }}>
              · {contours.length} contours · {nodeCount} nodes
            </span>
          )}
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', border: 'none',
            color: '#555', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px'
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* Sidebar */}
          <div style={{
            width: 180, background: '#111', borderRight: '1px solid #1e1e1e',
            padding: '16px 14px', display: 'flex', flexDirection: 'column',
            gap: 0, overflowY: 'auto', flexShrink: 0
          }}>
            {/* Threshold */}
            <SliderRow label="THRESHOLD" value={threshold} min={0} max={255} step={1}
              fmt={v => String(v)} onChange={setThreshold} />
            {/* Simplify */}
            <SliderRow label="SIMPLIFY" value={epsilon} min={0} max={8} step={0.1}
              fmt={v => v.toFixed(1)} onChange={setEpsilon} />

            <Toggle label="INVERT"      hint="white silhouette on dark" value={invert}   onChange={setInvert} />
            <Toggle label="SHOW IMAGE"  hint="ghost behind trace"       value={showImg}  onChange={setShowImg} />

            <div style={{ borderTop: '1px solid #1e1e1e', margin: '14px 0' }} />

            {/* Width input */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#555', marginBottom: 6 }}>
                IMPORT WIDTH (mm)
              </div>
              <input
                type="number" min="1" value={widthMm}
                onChange={e => setWidthMm(e.target.value)}
                style={{
                  width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a',
                  color: '#c8f0a0', borderRadius: 3, padding: '6px 8px',
                  fontFamily: 'monospace', fontSize: 13, boxSizing: 'border-box'
                }}
              />
              <div style={{ fontSize: 8, color: '#383838', marginTop: 4 }}>
                sets real-world width of traced outline
              </div>
            </div>

            <div style={{ marginTop: 'auto', fontSize: 8, color: '#2e2e2e', lineHeight: 2, paddingTop: 16 }}>
              DRAG nodes to refine.<br />
              THRESHOLD: lower = only very dark pixels.<br />
              SIMPLIFY: higher = fewer nodes.
            </div>
          </div>

          {/* Canvas area */}
          <div
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'auto', padding: 16, background: '#0a0a0a'
            }}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); loadFile(e.dataTransfer.files[0]) }}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
          >
            {!imgSrc ? (
              <div
                onClick={() => fileRef.current.click()}
                style={{
                  border: `1px dashed ${isDragOver ? '#c8f0a0' : '#2a2a2a'}`,
                  borderRadius: 6, padding: '48px 60px', textAlign: 'center',
                  cursor: 'pointer', color: isDragOver ? '#c8f0a0' : '#3a3a3a',
                  background: isDragOver ? '#0a1a0a' : 'transparent', userSelect: 'none'
                }}
              >
                <div style={{ fontSize: 9, letterSpacing: '0.2em', marginBottom: 10 }}>DROP IMAGE HERE</div>
                <div style={{ fontSize: 8, color: '#2a2a2a', letterSpacing: '0.1em' }}>
                  OR CLICK · PNG JPG BMP
                </div>
              </div>
            ) : (
              <div style={{ position: 'relative', display: 'inline-block', boxShadow: '0 0 0 1px #2a2a2a' }}>
                <div style={{ width: dispW, height: dispH, background: 'white' }} />
                {showImg && (
                  <img src={imgSrc} alt="" style={{
                    position: 'absolute', top: 0, left: 0,
                    width: dispW, height: dispH,
                    opacity: 0.28, display: 'block', pointerEvents: 'none'
                  }} />
                )}
                <svg
                  width={dispW} height={dispH}
                  style={{ position: 'absolute', top: 0, left: 0, cursor: dragging ? 'grabbing' : 'crosshair' }}
                  onMouseMove={e => {
                    if (!dragging) return
                    const r = e.currentTarget.getBoundingClientRect()
                    const x = Math.max(0, Math.min(dispW, e.clientX - r.left))
                    const y = Math.max(0, Math.min(dispH, e.clientY - r.top))
                    setContours(prev => prev.map((pts, ci) =>
                      ci !== dragging.ci ? pts : pts.map((p, ni) => ni !== dragging.ni ? p : [x, y])
                    ))
                  }}
                  onMouseUp={() => setDragging(null)}
                  onMouseLeave={() => setDragging(null)}
                >
                  {contours.map((pts, ci) => (
                    <path key={ci} d={pathD(pts)} fill="none" stroke="#22c55e" strokeWidth={1.5} />
                  ))}
                  {contours.map((pts, ci) => pts.map((p, ni) => {
                    const isH = hoverNode?.ci === ci && hoverNode?.ni === ni
                    const isD = dragging?.ci === ci && dragging?.ni === ni
                    return (
                      <circle key={`${ci}-${ni}`}
                        cx={p[0]} cy={p[1]}
                        r={isD ? 7 : isH ? 6 : 3.5}
                        fill={isD ? '#fbbf24' : isH ? 'white' : '#22c55e'}
                        stroke={isD ? '#f59e0b' : '#14532d'} strokeWidth={isD ? 1.5 : 1}
                        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
                        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDragging({ ci, ni }) }}
                        onMouseEnter={() => setHoverNode({ ci, ni })}
                        onMouseLeave={() => setHoverNode(null)}
                      />
                    )
                  }))}
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          background: '#1a1a1a', borderTop: '1px solid #222',
          padding: '10px 16px', display: 'flex', alignItems: 'center',
          gap: 10, flexShrink: 0
        }}>
          {imgSrc && (
            <button onClick={() => fileRef.current.click()} style={{
              padding: '7px 14px', background: 'transparent', color: '#666',
              border: '1px solid #2a2a2a', borderRadius: 4, cursor: 'pointer',
              fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em'
            }}>LOAD NEW</button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              padding: '7px 18px', background: 'transparent', color: '#666',
              border: '1px solid #2a2a2a', borderRadius: 4, cursor: 'pointer',
              fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em'
            }}>CANCEL</button>
            <button
              onClick={handleImport}
              disabled={!contours.length}
              style={{
                padding: '7px 22px',
                background: contours.length ? '#0f2a0f' : '#111',
                color: contours.length ? '#86efac' : '#333',
                border: `1px solid ${contours.length ? '#1a4a1a' : '#1e1e1e'}`,
                borderRadius: 4, cursor: contours.length ? 'pointer' : 'default',
                fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.06em'
              }}
            >
              IMPORT TO DRAWING →
            </button>
          </div>
        </div>
      </div>

      {/* Hidden elements */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => loadFile(e.target.files[0])} />
    </div>
  )
}

// ── Small helper components
function SliderRow({ label, value, min, max, step, fmt, onChange }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, letterSpacing: '0.1em', color: '#555', marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: '#b8b8b0' }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{ width: '100%', accentColor: '#86efac', cursor: 'pointer' }} />
    </div>
  )
}

function Toggle({ label, hint, value, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <div onClick={() => onChange(!value)} style={{
          width: 30, height: 16, background: value ? '#86efac' : '#222',
          borderRadius: 8, position: 'relative', flexShrink: 0,
          border: `1px solid ${value ? '#4ade80' : '#2a2a2a'}`, cursor: 'pointer'
        }}>
          <div style={{
            position: 'absolute', top: 2, left: value ? 13 : 2,
            width: 10, height: 10, borderRadius: '50%',
            background: value ? '#14532d' : '#444', transition: 'left 0.12s'
          }} />
        </div>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: value ? '#86efac' : '#444' }}>{label}</div>
          <div style={{ fontSize: 8, color: '#2e2e2e', marginTop: 1 }}>{hint}</div>
        </div>
      </label>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'

// World is Z-up (see Viewport3D's PLANE_VIEWS: Front = camera at -Y, Right =
// camera at +X, Top = camera at +Z). `dir` is where the camera goes to look
// at that face; `up` is screen-up once it gets there.
const FACES = [
  { id: 'front',  label: 'FRONT',  n: [0, -1, 0], dir: [0, -1, 0], up: [0, 0, 1] },
  { id: 'back',   label: 'BACK',   n: [0,  1, 0], dir: [0,  1, 0], up: [0, 0, 1] },
  { id: 'right',  label: 'RIGHT',  n: [1,  0, 0], dir: [1,  0, 0], up: [0, 0, 1] },
  { id: 'left',   label: 'LEFT',   n: [-1, 0, 0], dir: [-1, 0, 0], up: [0, 0, 1] },
  { id: 'top',    label: 'TOP',    n: [0,  0, 1], dir: [0,  0, 1], up: [0, 1, 0] },
  { id: 'bottom', label: 'BOTTOM', n: [0,  0, -1], dir: [0, 0, -1], up: [0, 1, 0] },
]

// Each face's 4 corners (cube spans -1..1), wound consistently.
function faceCorners(n) {
  const axis = n[0] ? 0 : n[1] ? 1 : 2
  const s = n[axis]
  const a = (axis + 1) % 3, b = (axis + 2) % 3
  const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  return quad.map(([u, v]) => {
    const p = [0, 0, 0]
    p[axis] = s; p[a] = u; p[b] = v
    return p
  })
}

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
const neg = v => [-v[0], -v[1], -v[2]]

// Up vector for stepping to an adjacent face via an arrow. Side faces always
// keep Z up. Top/bottom take their "up" from the way the camera was already
// facing, so tipping forward onto the top reads as a natural tilt instead of
// landing rotated (top's fixed default would be 180° off from Back, say).
function arrowUp(target, axes) {
  const horizBack = [axes.back[0], axes.back[1], 0]
  const len = Math.hypot(horizBack[0], horizBack[1])
  if (len < 0.05) return target.up
  const hb = [horizBack[0] / len, horizBack[1] / len, 0]
  if (target.id === 'top') return neg(hb)
  if (target.id === 'bottom') return hb
  return target.up
}

// Screen-space arrow directions (x right, y down in SVG) and the world vector
// each one means for "which face is that way".
const ARROWS = [
  { id: 'up',    sx: 0,  sy: -1, world: a => a.up },
  { id: 'down',  sx: 0,  sy: 1,  world: a => neg(a.up) },
  { id: 'left',  sx: -1, sy: 0,  world: a => neg(a.right) },
  { id: 'right', sx: 1,  sy: 0,  world: a => a.right },
]

// Small clickable cube that mirrors the 3D camera — click a face to jump to
// that view; hover it to get edge arrows that step to the neighbouring face,
// and a home button that returns to the isometric view. Drawn as plain 2D SVG
// polygons (back-face culled) instead of a CSS 3D cube so face labels always
// read upright and never mirror/skew.
export default function ViewCube({ getAxes, onSnap, onHome, size = 96, accent = '#3ad6ff' }) {
  const [axes, setAxes] = useState(null)
  const [hover, setHover] = useState(null)
  const [overCube, setOverCube] = useState(false)
  const lastRef = useRef('')

  useEffect(() => {
    let raf
    const tick = () => {
      const a = getAxes?.()
      if (a) {
        // Re-render only when the view actually moved.
        const key = [...a.right, ...a.up, ...a.back].map(v => v.toFixed(3)).join(',')
        if (key !== lastRef.current) { lastRef.current = key; setAxes(a) }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getAxes])

  if (!axes) return null

  const c = size / 2
  const scale = size * 0.24
  const project = p => ({
    x: c + dot(p, axes.right) * scale,
    y: c - dot(p, axes.up) * scale,
  })

  const withFacing = FACES.map(f => ({ ...f, facing: dot(f.n, axes.back) }))
  const visible = withFacing.filter(f => f.facing > 0.02)
  const frontFace = withFacing.reduce((best, f) => (f.facing > best.facing ? f : best))

  // For each arrow, the neighbouring face lying that way on screen — never
  // the face we're already looking at, nor the one directly behind it.
  const arrowTargets = ARROWS.map(ar => {
    const w = ar.world(axes)
    let best = null, bestScore = 0.3
    for (const f of withFacing) {
      if (f.id === frontFace.id) continue
      if (dot(f.n, frontFace.n) < -0.5) continue
      const score = dot(f.n, w)
      if (score > bestScore) { bestScore = score; best = f }
    }
    return best ? { ...ar, target: best } : null
  }).filter(Boolean)

  const arrowDist = size * 0.44
  const arrowSize = size * 0.075

  return (
    <div style={{ position: 'relative', width: size, height: size }}
      onMouseEnter={() => setOverCube(true)}
      onMouseLeave={() => { setOverCube(false); setHover(null) }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block', userSelect: 'none', overflow: 'visible' }}>
        {visible.map(f => {
          const pts = faceCorners(f.n).map(project)
          const center = project(f.n)
          const isHover = hover === f.id
          // Fade faces that are edge-on so the label doesn't crowd the cube.
          const labelOpacity = Math.min(1, f.facing * 2.2)
          return (
            <g key={f.id} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)}
              onClick={e => { e.stopPropagation(); onSnap?.(f.dir, f.up) }}>
              <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                fill={isHover ? accent : '#1b2740'}
                fillOpacity={isHover ? 0.55 : 0.88}
                stroke={accent} strokeWidth="1.2" strokeLinejoin="round"/>
              <text x={center.x} y={center.y} textAnchor="middle" dominantBaseline="middle"
                fontFamily="monospace" fontSize={size * 0.1} fontWeight="bold"
                fill={isHover ? '#fff' : accent} opacity={labelOpacity}
                style={{ pointerEvents: 'none' }}>
                {f.label}
              </text>
            </g>
          )
        })}

        {overCube && arrowTargets.map(ar => {
          const cx = c + ar.sx * arrowDist, cy = c + ar.sy * arrowDist
          // Triangle pointing outward along (sx, sy).
          const px = -ar.sy, py = ar.sx
          const tip = [cx + ar.sx * arrowSize, cy + ar.sy * arrowSize]
          const b1 = [cx - ar.sx * arrowSize * 0.5 + px * arrowSize, cy - ar.sy * arrowSize * 0.5 + py * arrowSize]
          const b2 = [cx - ar.sx * arrowSize * 0.5 - px * arrowSize, cy - ar.sy * arrowSize * 0.5 - py * arrowSize]
          return (
            <g key={ar.id} style={{ cursor: 'pointer' }}
              onClick={e => { e.stopPropagation(); onSnap?.(ar.target.dir, arrowUp(ar.target, axes)) }}>
              {/* Generous invisible hit area so the small arrow is easy to click. */}
              <circle cx={cx} cy={cy} r={arrowSize * 1.8} fill="transparent"/>
              <polygon points={`${tip} ${b1} ${b2}`} fill={accent} stroke="#0d0d1a" strokeWidth="0.8">
                <title>{`Go to ${ar.target.label}`}</title>
              </polygon>
            </g>
          )
        })}
      </svg>

      <button title="Home — isometric view" onClick={e => { e.stopPropagation(); onHome?.() }}
        style={{
          position: 'absolute', top: -6, left: -10, width: 22, height: 22, padding: 0,
          background: '#0d0d1acc', border: `1px solid ${accent}88`, borderRadius: 5,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 7 L7 2.5 L12 7 M3.5 6.2 V11.5 H10.5 V6.2" stroke={accent}
            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}

import { useState, useMemo, useEffect } from 'react'

// ── Panel component ───────────────────────────────────────────────────────
// Numeric-params form for the Pattern tool. Two modes:
//  • Circular — collects every number up front, then closes and hands off to
//    an interactive "click a circular edge" pivot+axis pick in the viewport
//    (App3D.jsx's handlePatternAxisHover/Click).
//  • Rectangular — a plain columns × rows grid. No viewport picking at all:
//    each direction is an X/Y/Z dropdown (+ flip), defaulting to the axes the
//    camera is looking along, and spacing defaults to the body's own size + 5mm
//    so copies never overlap. This mode floats WITHOUT a dimming backdrop so
//    the live ghost grid (reported through onRectChange) stays visible.
const AXES = ['x', 'y', 'z']
const AXIS_INDEX = { x: 0, y: 1, z: 2 }
const GAP_MM = 5
const MAX_PER_DIR = 50
const MAX_TOTAL = 200

const axisVec = (axis, sign) => ({ x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 })
const round1 = v => Math.round(v * 10) / 10

export default function PatternPanel({
  onConfirm, onClose, color = '#4DB6AC',
  bounds = null,            // {min:[x,y,z], max:[x,y,z]} mm of the picked body
  defaultAxes = null,       // {a1:{axis,sign}, a2:{axis,sign}} from the current camera
  onRectChange,             // (params|null) => void — live params for the ghost preview
  isCutout = false,         // repeating a cutout feature (cut copies) rather than a body
}) {
  const ACCENT = color
  const [mode, setMode] = useState('rectangular')

  // ── Circular ──
  const [count, setCount] = useState(6)
  const [specifyVia, setSpecifyVia] = useState('total')  // 'step' | 'total'
  const [stepAngle, setStepAngle] = useState(60)
  const [totalAngle, setTotalAngle] = useState(360)
  const [reversed, setReversed] = useState(false)

  // ── Rectangular ──
  const sizeAlong = axis => bounds ? bounds.max[AXIS_INDEX[axis]] - bounds.min[AXIS_INDEX[axis]] : 10
  const defaultSpacing = axis => round1(sizeAlong(axis) + GAP_MM)
  const [axis1, setAxis1] = useState(defaultAxes?.a1?.axis || 'x')
  const [sign1, setSign1] = useState(defaultAxes?.a1?.sign || 1)
  const [axis2, setAxis2] = useState(defaultAxes?.a2?.axis || 'y')
  const [sign2, setSign2] = useState(defaultAxes?.a2?.sign || 1)
  const [cols, setCols] = useState(3)
  const [rows, setRows] = useState(4)
  // null until the user types — then the spacing stops following the axis size.
  const [spacing1Input, setSpacing1Input] = useState(null)
  const [spacing2Input, setSpacing2Input] = useState(null)
  const spacing1 = spacing1Input ?? defaultSpacing(axis1)
  const spacing2 = spacing2Input ?? defaultSpacing(axis2)

  const rectErrors = useMemo(() => {
    const errs = []
    if (axis1 === axis2) errs.push('Columns and rows need different axes')
    if (!(cols >= 1) || !(rows >= 1)) errs.push('Counts must be at least 1')
    if (cols * rows < 2) errs.push('Need more than one cell')
    if (cols > MAX_PER_DIR || rows > MAX_PER_DIR) errs.push(`Max ${MAX_PER_DIR} per direction`)
    if (cols * rows > MAX_TOTAL) errs.push(`Max ${MAX_TOTAL} copies in total`)
    if (!(spacing1 > 0) || !(spacing2 > 0)) errs.push('Spacing must be greater than 0')
    return errs
  }, [axis1, axis2, cols, rows, spacing1, spacing2])

  const circErrors = useMemo(() => {
    const errs = []
    if (!(count >= 2)) errs.push('Count must be at least 2')
    if (specifyVia === 'step' && stepAngle === 0) errs.push('Step angle must be nonzero')
    if (specifyVia === 'total' && totalAngle === 0) errs.push('Total angle must be nonzero')
    return errs
  }, [count, specifyVia, stepAngle, totalAngle])

  const isRect = mode === 'rectangular'
  const errors = isRect ? rectErrors : circErrors
  const isValid = errors.length === 0

  const rectParams = () => ({
    mode: 'rectangular',
    dir1: axisVec(axis1, sign1), count1: cols, spacing1,
    dir2: axisVec(axis2, sign2), count2: rows, spacing2,
  })

  // Live ghost-grid feed. Cleared (null) whenever the panel isn't in a valid
  // rectangular state, so a stale preview never lingers.
  useEffect(() => {
    onRectChange?.(isRect && isValid ? rectParams() : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRect, isValid, axis1, sign1, axis2, sign2, cols, rows, spacing1, spacing2])

  const handleConfirm = () => {
    if (!isValid) return
    if (isRect) onConfirm(rectParams())
    else onConfirm({ mode: 'circular', count, specifyVia, stepAngleDeg: stepAngle, totalAngleDeg: totalAngle, reversed })
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: '#2a2a2a', border: '1px solid #444', borderRadius: 4,
    padding: '7px 10px', color: 'white', fontSize: 13, fontFamily: 'monospace',
  }
  const labelStyle = { fontSize: 10, color: '#888', marginBottom: 5, letterSpacing: '0.08em' }

  const toggleBtn = (active) => ({
    flex: 1, background: active ? ACCENT : '#2a2a2a',
    border: `1px solid ${active ? ACCENT : '#444'}`,
    color: active ? '#000' : '#ccc',
    borderRadius: 4, padding: '7px 10px', cursor: 'pointer',
    fontSize: 11, fontFamily: 'monospace', fontWeight: active ? 'bold' : 'normal',
  })

  const totalInstances = isRect ? Math.max(1, (cols | 0) * (rows | 0)) : Math.max(1, count | 0)

  // One direction's row: label, count, spacing, axis dropdown, flip.
  const dirRow = (label, n, setN, spacing, setSpacing, axis, setAxis, sign, setSign) => (
    <div style={{ marginBottom: 14 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="number" value={n} min={1} max={MAX_PER_DIR} step={1} title="Number of copies in this direction (including the original)"
          onChange={e => setN(parseInt(e.target.value) || 1)} style={{ ...inputStyle, width: 58 }} />
        <span style={{ fontSize: 11, color: '#666' }}>×</span>
        <input type="number" value={spacing} min={0.1} step={1} title="Spacing between centres (mm)"
          onChange={e => setSpacing(parseFloat(e.target.value) || 0)} style={{ ...inputStyle, flex: 1 }} />
        <span style={{ fontSize: 11, color: '#666' }}>mm</span>
        <select value={axis} onChange={e => setAxis(e.target.value)} title="Direction axis"
          style={{ ...inputStyle, width: 54, padding: '7px 4px' }}>
          {AXES.map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
        </select>
        <button onClick={() => setSign(-sign)} title="Flip direction"
          style={{ ...toggleBtn(false), flex: 'none', padding: '7px 8px' }}>{sign > 0 ? '+' : '−'}</button>
      </div>
    </div>
  )

  const card = (
    <div style={{
      background: '#1e1e1e', border: '1px solid #555', borderRadius: 8,
      padding: 20, width: isRect ? 360 : 440, color: 'white', fontFamily: 'monospace',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)', pointerEvents: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 'bold', color: ACCENT, letterSpacing: '0.1em' }}>{isCutout ? 'PATTERN CUTOUT' : 'PATTERN'}</span>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button onClick={() => setMode('rectangular')} style={toggleBtn(isRect)}>Rectangular</button>
        <button onClick={() => setMode('circular')} style={toggleBtn(!isRect)}>Circular</button>
      </div>

      {isRect ? (
        <>
          {dirRow('COLUMNS  (count × spacing, axis)', cols, setCols, spacing1, setSpacing1Input, axis1, a => { setAxis1(a); setSpacing1Input(null) }, sign1, setSign1)}
          {dirRow('ROWS  (count × spacing, axis)', rows, setRows, spacing2, setSpacing2Input, axis2, a => { setAxis2(a); setSpacing2Input(null) }, sign2, setSign2)}
          <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
            Spacing is centre-to-centre. Default = body size + {GAP_MM}mm
            {bounds ? ` (body is ${round1(sizeAlong('x'))} × ${round1(sizeAlong('y'))} × ${round1(sizeAlong('z'))} mm)` : ''}.
            The teal boxes show where the copies will go.
          </div>
        </>
      ) : (
        <>
          {/* Count */}
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>NUMBER OF INSTANCES</div>
            <input type="number" value={count} min={2} step={1}
              onChange={e => setCount(parseInt(e.target.value) || 2)} style={inputStyle} />
          </div>

          {/* Specify via */}
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>SPECIFY VIA</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setSpecifyVia('total')} style={toggleBtn(specifyVia === 'total')}>Total Angle + Count</button>
              <button onClick={() => setSpecifyVia('step')} style={toggleBtn(specifyVia === 'step')}>Step Angle + Count</button>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            {specifyVia === 'total' ? (
              <>
                <div style={labelStyle}>TOTAL ANGLE (°, 360 = full circle)</div>
                <input type="number" value={totalAngle} step={5}
                  onChange={e => setTotalAngle(parseFloat(e.target.value) || 0)} style={inputStyle} />
              </>
            ) : (
              <>
                <div style={labelStyle}>STEP ANGLE (° between copies)</div>
                <input type="number" value={stepAngle} step={1}
                  onChange={e => setStepAngle(parseFloat(e.target.value) || 0)} style={inputStyle} />
              </>
            )}
          </div>

          {/* Direction — only matters for a partial (non-360°) sweep;
              flips which way the copies wind around the same pivot/axis. */}
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>DIRECTION</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setReversed(false)} style={toggleBtn(!reversed)}>Forward</button>
              <button onClick={() => setReversed(true)} style={toggleBtn(reversed)}>Reversed</button>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#888', marginBottom: 14 }}>
            Next you'll click a circular edge on any body to set the pivot + axis (or a vertex, then pick a world axis).
          </div>
        </>
      )}

      <div style={{ fontSize: 11, color: '#666', marginBottom: 14 }}>
        {isRect ? `${cols} × ${rows} = ` : ''}{totalInstances} total instance{totalInstances !== 1 ? 's' : ''} ({totalInstances - 1} new + the original)
      </div>

      {/* Validation */}
      {errors.length > 0 && (
        <div style={{
          fontSize: 11, padding: '7px 12px', borderRadius: 4, marginBottom: 16,
          background: '#2a2a2a', color: '#f97316',
        }}>
          {errors[0]}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{
            background: '#2a2a2a', border: '1px solid #444', color: '#aaa',
            padding: '8px 18px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
          }}>
          Cancel
        </button>
        <button onClick={handleConfirm}
          disabled={!isValid}
          style={{
            background: isValid ? ACCENT : '#333',
            border: 'none',
            color: isValid ? '#000' : '#555',
            padding: '8px 22px', borderRadius: 4,
            cursor: isValid ? 'pointer' : 'default',
            fontSize: 12, fontWeight: 'bold', letterSpacing: '0.05em',
          }}>
          {isRect ? 'CREATE PATTERN' : 'NEXT: PICK AXIS →'}
        </button>
      </div>
    </div>
  )

  // Circular keeps the original dimming modal; Rectangular floats at the top
  // right with no backdrop (and lets clicks pass through around the card) so
  // the ghost grid in the viewport stays visible and orbitable.
  if (isRect) {
    return (
      <div style={{ position: 'fixed', top: 70, right: 16, zIndex: 1000, pointerEvents: 'none' }}>
        {card}
      </div>
    )
  }
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000,
    }}>
      {card}
    </div>
  )
}

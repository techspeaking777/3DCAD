import { useState, useMemo, useEffect, useRef } from 'react'

// ── Pattern options (step ribbon) ─────────────────────────────────────────
// The Pattern tool's numbers, shown as items in App3D's step ribbon (they
// used to be a floating panel / dimming modal — moved 2026-11-19).
// `usePatternOptions` keeps the fields and returns `{actions, hint}` for the
// SmartStepBar. Two modes:
//  • Rectangular — a plain columns × rows grid. No viewport picking at all:
//    each direction is an X/Y/Z choice (+ flip), defaulting to the axes the
//    camera is looking along, and spacing defaults to the body's own size + 5mm
//    so copies never overlap. The live ghost grid is reported through
//    onRectChange.
//  • Circular — collects every number up front, then hands off to an
//    interactive "click a circular edge" pivot+axis pick in the viewport
//    (App3D.jsx's handlePatternAxisHover/Click).
const AXES = ['x', 'y', 'z']
const AXIS_INDEX = { x: 0, y: 1, z: 2 }
const GAP_MM = 5
const MAX_PER_DIR = 50
const MAX_TOTAL = 200

const axisVec = (axis, sign) => ({ x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 })
const round1 = v => Math.round(v * 10) / 10

export function usePatternOptions({
  open,                     // the options step is showing
  onConfirm, onClose, color = '#4DB6AC',
  bounds = null,            // {min:[x,y,z], max:[x,y,z]} mm of the picked body
  defaultAxes = null,       // {a1:{axis,sign}, a2:{axis,sign}} from the current camera
  onRectChange,             // (params|null) => void — live params for the ghost preview
}) {
  const [mode, setMode] = useState('rectangular')

  // ── Circular ── (text fields keep what's typed; parsed below)
  const [countText, setCountText] = useState('6')
  const [specifyVia, setSpecifyVia] = useState('total')  // 'step' | 'total'
  const [stepText, setStepText] = useState('60')
  const [totalText, setTotalText] = useState('360')
  const [reversed, setReversed] = useState(false)

  // ── Rectangular ──
  const sizeAlong = axis => bounds ? bounds.max[AXIS_INDEX[axis]] - bounds.min[AXIS_INDEX[axis]] : 10
  const defaultSpacing = axis => round1(sizeAlong(axis) + GAP_MM)
  const [axis1, setAxis1] = useState('x')
  const [sign1, setSign1] = useState(1)
  const [axis2, setAxis2] = useState('y')
  const [sign2, setSign2] = useState(1)
  const [colsText, setColsText] = useState('3')
  const [rowsText, setRowsText] = useState('4')
  // null until the user types — then the spacing stops following the axis size.
  const [spacing1Input, setSpacing1Input] = useState(null)
  const [spacing2Input, setSpacing2Input] = useState(null)

  // Fresh fields every time the step opens (the old panel remounted).
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMode('rectangular')
      setCountText('6'); setSpecifyVia('total'); setStepText('60'); setTotalText('360'); setReversed(false)
      setAxis1(defaultAxes?.a1?.axis || 'x'); setSign1(defaultAxes?.a1?.sign || 1)
      setAxis2(defaultAxes?.a2?.axis || 'y'); setSign2(defaultAxes?.a2?.sign || 1)
      setColsText('3'); setRowsText('4')
      setSpacing1Input(null); setSpacing2Input(null)
    }
    wasOpen.current = open
  }, [open, defaultAxes])

  const cols = parseInt(colsText) || 0
  const rows = parseInt(rowsText) || 0
  const count = parseInt(countText) || 0
  const stepAngle = parseFloat(stepText) || 0
  const totalAngle = parseFloat(totalText) || 0
  const spacing1 = spacing1Input != null ? (parseFloat(spacing1Input) || 0) : defaultSpacing(axis1)
  const spacing2 = spacing2Input != null ? (parseFloat(spacing2Input) || 0) : defaultSpacing(axis2)

  const rectErrors = useMemo(() => {
    const errs = []
    if (axis1 === axis2) errs.push('Columns and rows need different axes.')
    if (!(cols >= 1) || !(rows >= 1)) errs.push('Counts must be at least 1.')
    else if (cols * rows < 2) errs.push('Make more than one copy.')
    if (cols > MAX_PER_DIR || rows > MAX_PER_DIR) errs.push(`At most ${MAX_PER_DIR} each way.`)
    if (cols * rows > MAX_TOTAL) errs.push(`At most ${MAX_TOTAL} copies in total.`)
    if (!(spacing1 > 0) || !(spacing2 > 0)) errs.push('Spacing must be more than 0.')
    return errs
  }, [axis1, axis2, cols, rows, spacing1, spacing2])

  const circErrors = useMemo(() => {
    const errs = []
    if (!(count >= 2)) errs.push('Count must be at least 2.')
    if (specifyVia === 'step' && stepAngle === 0) errs.push('The step angle can\'t be 0.')
    if (specifyVia === 'total' && totalAngle === 0) errs.push('The total angle can\'t be 0.')
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

  // Live ghost-grid feed. Cleared (null) whenever the step isn't showing a
  // valid rectangular grid, so a stale preview never lingers.
  useEffect(() => {
    onRectChange?.(open && isRect && isValid ? rectParams() : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isRect, isValid, axis1, sign1, axis2, sign2, cols, rows, spacing1, spacing2])

  const handleConfirm = () => {
    if (!isValid) return
    if (isRect) onConfirm(rectParams())
    else onConfirm({ mode: 'circular', count, specifyVia, stepAngleDeg: stepAngle, totalAngleDeg: totalAngle, reversed })
  }

  if (!open) return { actions: null, hint: null }

  // ── Ribbon items ──────────────────────────────────────────────────────────
  const field = { display: 'flex', alignItems: 'center', gap: 4, height: 26, boxSizing: 'border-box',
    background: '#0a0e1a', border: `1px solid ${color}88`, borderRadius: 13, padding: '0 10px' }
  const inputStyle = w => ({ width: w, background: 'none', border: 'none', outline: 'none', color: '#dce8ff',
    fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold' })
  const label = t => <span style={{ color: '#8fa0b8', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.06em' }}>{t}</span>
  const unit = t => <span style={{ color: '#6688aa', fontFamily: 'monospace', fontSize: 11 }}>{t}</span>
  const keys = e => { e.stopPropagation(); if (e.key === 'Enter') handleConfirm(); else if (e.key === 'Escape') onClose() }
  const smallBtn = (txt, title, onClick) => (
    <button title={title} onClick={onClick} style={{ background: 'none', border: `1px solid ${color}55`, borderRadius: 8,
      color: '#dce8ff', fontFamily: 'monospace', fontSize: 11, padding: '0 6px', height: 18, lineHeight: '16px', cursor: 'pointer' }}>{txt}</button>
  )

  // One direction: count × spacing mm, along X/Y/Z, +/− flips it.
  const dirField = (name, title, nText, setN, spacing, spacingInput, setSpacing, axis, setAxis, sign, setSign, autoFocus) => ({ node: (
    <div style={field} title={title}>
      {label(name)}
      <input autoFocus={autoFocus} value={nText} onChange={e => setN(e.target.value)} onKeyDown={keys}
        onFocus={e => e.target.select()} style={inputStyle(24)} title="How many (including the original)"/>
      {unit('×')}
      <input value={spacingInput ?? String(spacing)} onChange={e => setSpacing(e.target.value)} onKeyDown={keys}
        onFocus={e => e.target.select()} style={inputStyle(40)} title="Spacing, centre to centre"/>
      {unit('mm')}
      {smallBtn(axis.toUpperCase(), 'Which axis — click to change', () => setAxis(AXES[(AXES.indexOf(axis) + 1) % 3]))}
      {smallBtn(sign > 0 ? '+' : '−', 'Flip the direction', () => setSign(-sign))}
    </div>
  ) })

  const modeItems = [
    { label: 'Rectangular', enabled: true, active: isRect, onClick: () => setMode('rectangular') },
    { label: 'Circular', enabled: true, active: !isRect, onClick: () => setMode('circular') },
    { divider: true },
  ]
  const endItems = [
    { divider: true },
    { label: '✕ Cancel', enabled: true, danger: true, onClick: onClose },
    { label: isRect ? '✓ Make pattern' : '✓ Next: pick axis', enabled: isValid, success: true, onClick: handleConfirm },
  ]

  if (isRect) {
    const total = Math.max(1, cols * rows)
    return {
      actions: [
        ...modeItems,
        dirField('COLUMNS', 'Columns: how many × spacing, and which way', colsText, setColsText, spacing1, spacing1Input, setSpacing1Input,
          axis1, a => { setAxis1(a); setSpacing1Input(null) }, sign1, setSign1, true),
        dirField('ROWS', 'Rows: how many × spacing, and which way', rowsText, setRowsText, spacing2, spacing2Input, setSpacing2Input,
          axis2, a => { setAxis2(a); setSpacing2Input(null) }, sign2, setSign2, false),
        ...endItems,
      ],
      hint: errors[0] || `${cols} × ${rows} = ${total} (${total - 1} new). The teal boxes show where they go. Spacing is centre to centre — it starts at the body's size + ${GAP_MM} mm.`,
    }
  }
  return {
    actions: [
      ...modeItems,
      { node: (
        <div style={field} title="How many, including the original">
          {label('COUNT')}
          <input autoFocus value={countText} onChange={e => setCountText(e.target.value)} onKeyDown={keys}
            onFocus={e => e.target.select()} style={inputStyle(28)}/>
        </div>
      ) },
      { node: (
        <div style={field} title={specifyVia === 'total' ? 'The angle the copies spread over (360 = all the way round)' : 'The angle between one copy and the next'}>
          {label(specifyVia === 'total' ? 'TOTAL ANGLE' : 'STEP ANGLE')}
          <input value={specifyVia === 'total' ? totalText : stepText}
            onChange={e => (specifyVia === 'total' ? setTotalText : setStepText)(e.target.value)} onKeyDown={keys}
            onFocus={e => e.target.select()} style={inputStyle(36)}/>
          {unit('°')}
        </div>
      ) },
      { label: 'Total', enabled: true, active: specifyVia === 'total', onClick: () => setSpecifyVia('total') },
      { label: 'Step', enabled: true, active: specifyVia === 'step', onClick: () => setSpecifyVia('step') },
      { divider: true },
      { label: 'Forward', enabled: true, active: !reversed, onClick: () => setReversed(false) },
      { label: 'Reversed', enabled: true, active: reversed, onClick: () => setReversed(true) },
      ...endItems,
    ],
    hint: errors[0] || `${Math.max(1, count)} round a circle (${Math.max(0, count - 1)} new). Next you click a round edge to set the centre and axis.`,
  }
}

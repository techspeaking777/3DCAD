import { useState, useMemo } from 'react'

// ── Panel component ───────────────────────────────────────────────────────
// Numeric-params form for the Pattern tool, modeled directly on
// SpringPanel.jsx's structure (conditional fields, a "specify via" radio,
// Cancel/Next buttons). Circular-only for now — a Rectangular mode existed
// here briefly but the user found the workflow clunky and asked to park it
// in favor of nailing Circular first (the actual grouser-wheel use case).
// commitRectangularPattern/buildRectangularOffsets still exist in
// App3D.jsx/patternMath.js, just unreached from this panel — revive by
// reintroducing the mode toggle if Rectangular comes back later.
// This panel collects every number up front, then closes and hands off to
// an interactive "click a circular edge" pivot+axis pick in the viewport
// (App3D.jsx's handlePatternAxisHover/Click), mirroring how Spring's own
// panel hands off to its sketch-profile step.
export default function PatternPanel({ onConfirm, onClose, color = '#4DB6AC' }) {
  const ACCENT = color

  const [count, setCount] = useState(6)
  const [specifyVia, setSpecifyVia] = useState('total')  // 'step' | 'total'
  const [stepAngle, setStepAngle] = useState(60)
  const [totalAngle, setTotalAngle] = useState(360)
  const [reversed, setReversed] = useState(false)

  const errors = useMemo(() => {
    const errs = []
    if (!(count >= 2)) errs.push('Count must be at least 2')
    if (specifyVia === 'step' && stepAngle === 0) errs.push('Step angle must be nonzero')
    if (specifyVia === 'total' && totalAngle === 0) errs.push('Total angle must be nonzero')
    return errs
  }, [count, specifyVia, stepAngle, totalAngle])

  const isValid = errors.length === 0

  const handleConfirm = () => {
    if (!isValid) return
    onConfirm({ mode: 'circular', count, specifyVia, stepAngleDeg: stepAngle, totalAngleDeg: totalAngle, reversed })
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

  const totalInstances = Math.max(1, count|0)

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#1e1e1e', border: '1px solid #555', borderRadius: 8,
        padding: 24, width: 440, color: 'white', fontFamily: 'monospace',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 'bold', color: ACCENT, letterSpacing: '0.1em' }}>
            CIRCULAR PATTERN
          </span>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

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

        <div style={{ fontSize: 11, color: '#666', marginBottom: 14 }}>
          {totalInstances} total instance{totalInstances !== 1 ? 's' : ''} ({totalInstances - 1} new + the original)
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
            NEXT: PICK AXIS →
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'

// ── Panel component ───────────────────────────────────────────────────────────
// Numeric-only params form for the Spring tool's coil geometry — the wire's
// CROSS-SECTION is hand-sketched instead (see App3D.jsx's
// startSpringProfileSketch/commitSpring: this panel's Confirm advances to a
// real 2D sketch step, on the exact plane replicad's own sweepSketch will
// use, rather than building anything itself). Modeled on TextPanel.jsx's
// fullscreen-backdrop/centered-card layout rather than an anchored popover —
// still more fields than a single-value popover (OffsetDistancePopover)
// supports even without a wire-diameter field.
export default function SpringPanel({ onConfirm, onClose, color = '#F06292', isCut = false, initialReversed = false }) {
  const ACCENT = color
  const [coilDia, setCoilDia] = useState(20)    // mm, MEAN/centerline diameter
  const [mode, setMode]       = useState('pitchCoils')   // 'pitchCoils' | 'lengthCoils'
  const [coils, setCoils]     = useState(6)
  const [pitch, setPitch]     = useState(5)     // mm — used when mode==='pitchCoils'
  const [length, setLength]   = useState(30)    // mm — used when mode==='lengthCoils'
  const [lefthand, setLefthand] = useState(false)
  // Which way the coil grows along the picked plane's normal — a picked
  // FACE's normal always points OUTWARD from its solid (see cadWorker.js's
  // buildExtrude: "Replicad face plane normal points OUTWARD"), so a spring
  // CUT on a face needs to grow the opposite way to actually remove material
  // instead of just clipping a sliver where the coil's start barely grazes
  // the surface. App3D.jsx passes a smart initialReversed for exactly that
  // case (cut + real face pick) — this toggle lets the user override it
  // either way, same role Extrude/Cutout's own In/Out direction buttons play.
  const [reversed, setReversed] = useState(initialReversed)

  // Resolve the OUTCOME (pitch + height), not which mode was entered — same
  // "store the result, not how it was drawn" convention Sweep's resolved
  // pathPts already follows, so commitSpring/buildBaseWorkerParams never
  // need to re-derive which mode was active.
  const effectivePitch = mode === 'pitchCoils' ? pitch : (coils > 0 ? length / coils : 0)

  // No wire-vs-coil relationship to check anymore — the cross-section's own
  // size relative to pitch/radius is only knowable once it's actually
  // sketched, so that validity check now happens where the profile is drawn
  // (buildSpring's BRepCheck_Analyzer guard), not here.
  const errors = useMemo(() => {
    const errs = []
    if (!(coilDia > 0)) errs.push('Coil diameter must be greater than 0')
    if (!(coils > 0)) errs.push('Number of coils must be greater than 0')
    if (mode === 'pitchCoils' && !(pitch > 0)) errs.push('Pitch must be greater than 0')
    if (mode === 'lengthCoils' && !(length > 0)) errs.push('Free length must be greater than 0')
    return errs
  }, [coilDia, coils, mode, pitch, length])

  const isValid = errors.length === 0

  const handleConfirm = () => {
    if (!isValid) return
    onConfirm({
      coilRadiusMm: coilDia / 2,
      pitchMm: effectivePitch,
      heightMm: effectivePitch * coils,
      coils,
      lefthand,
      reversed,
    })
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
            {isCut ? 'SPRING CUT PARAMETERS' : 'SPRING PARAMETERS'}
          </span>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Coil diameter */}
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>COIL DIAMETER (mm, mean)</div>
          <input type="number" value={coilDia} min={0.1} step={0.5}
            onChange={e => setCoilDia(parseFloat(e.target.value) || 0)}
            style={inputStyle} />
        </div>

        {/* Mode toggle */}
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>SPECIFY VIA</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setMode('pitchCoils')} style={toggleBtn(mode === 'pitchCoils')}>
              Pitch + Coils
            </button>
            <button onClick={() => setMode('lengthCoils')} style={toggleBtn(mode === 'lengthCoils')}>
              Free Length + Coils
            </button>
          </div>
        </div>

        {/* Coils / Pitch-or-Length row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>NUMBER OF COILS</div>
            <input type="number" value={coils} min={0.25} step={0.25}
              onChange={e => setCoils(parseFloat(e.target.value) || 0)}
              style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            {mode === 'pitchCoils' ? (
              <>
                <div style={labelStyle}>PITCH (mm)</div>
                <input type="number" value={pitch} min={0.1} step={0.1}
                  onChange={e => setPitch(parseFloat(e.target.value) || 0)}
                  style={inputStyle} />
              </>
            ) : (
              <>
                <div style={labelStyle}>FREE LENGTH (mm)</div>
                <input type="number" value={length} min={0.1} step={1}
                  onChange={e => setLength(parseFloat(e.target.value) || 0)}
                  style={inputStyle} />
              </>
            )}
          </div>
        </div>

        {/* Handedness */}
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>HANDEDNESS</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setLefthand(false)} style={toggleBtn(!lefthand)}>Right-hand</button>
            <button onClick={() => setLefthand(true)} style={toggleBtn(lefthand)}>Left-hand</button>
          </div>
        </div>

        {/* Growth direction — which way along the picked plane's normal the
            coil grows. Defaults (via initialReversed) to whichever way makes
            sense for this pick, but always overridable. */}
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>DIRECTION</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setReversed(false)} style={toggleBtn(!reversed)}>Along Normal</button>
            <button onClick={() => setReversed(true)} style={toggleBtn(reversed)}>Reversed</button>
          </div>
        </div>

        {/* Resolved pitch readout — only shown in Free Length mode, where the
            pitch isn't a field the user typed directly. */}
        {mode === 'lengthCoils' && coils > 0 && (
          <div style={{ fontSize: 11, color: '#888', marginBottom: 14 }}>
            Resolves to pitch = {effectivePitch.toFixed(2)}mm
          </div>
        )}

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
            NEXT: SKETCH PROFILE →
          </button>
        </div>
      </div>
    </div>
  )
}

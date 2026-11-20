// The step ribbon (SmartStepBar) and its hover descriptions, shared by the
// 3D tab (App3D: the feature ribbon + the compact sketch-tool row under it)
// and the Drawing tab (App: its tool row). Moved out of App3D.jsx 2026-11-20.
import { Fragment, useState, useRef, useEffect } from 'react'

// Longer descriptions shown when hovering a step in the ribbon (SmartStepBar),
// looked up by the step's label (lower-case). A step can carry its own `tip`
// instead. Keep them short and plain — one or two sentences.
export const STEP_TIPS = {
  'pick plane': 'Choose where your sketch sits: a work plane (XY, XZ, YZ) or any flat face of a body. Offset Plane makes a new plane parallel to one you pick.',
  'pick start plane': 'Choose the plane or flat face the first shape is drawn on.',
  'draw profile': 'Draw the closed outline with the sketch tools, then Finish. Cancel throws the sketch away.',
  'sketch profile': 'Draw the closed shape that will be swept along the path, then Finish.',
  'sketch profiles': 'Draw each shape the loft blends between.',
  'sketch path': 'Draw the line or curve the shape travels along.',
  'sketch wire': 'Draw the wire shape and, if you like, an axis line for the spring to wind round.',
  'set depth': 'Choose how far the shape grows: drag the arrow or type a depth. One way goes toward the side your mouse is on (or type a minus number for the other side); Both ways centres it on the sketch.',
  'set angle': 'Move the mouse round the axis line to spin the shape (10° steps), or type an exact angle — 360° makes a full solid. The mouse picks which way it spins; Both ways centres it on the sketch.',
  'set a depth': 'Choose how far the shape grows: drag the arrow or type a depth.',
  'set radius': 'Type how big the rounding is, in mm.',
  'set thickness': 'Type how thick the walls are, in mm.',
  'set coil': 'Choose the pitch (gap between coils), the number of turns and the direction.',
  'pick body': 'Click the body to work on. With only one body it is picked for you.',
  'select body': 'Click the body to work on.',
  'select bodies': 'Click each body to include. Click again to leave one out.',
  'select faces': 'Click the faces to use. Click a face again to drop it.',
  'select edges': 'Click the edges to use. Click an edge again to drop it.',
  'pick edges': 'Click the edges to use. Click an edge again to drop it.',
  'pick holes': 'Click the holes to use.',
  'keep faces flat · radius': 'Click any face that should stay flat (it keeps a crisp edge), then type the radius. Everything else gets rounded.',
}

// The step ribbon across the TOP of the 3D view (2026-11-19, replaces the bar
// that sat along the bottom). Each step is an arrow: finished steps shrink to a
// green tick (click one to go back to it), the current step is drawn in the
// tool's colour with its options right after it, and later steps are grey
// with no options. One plain hint line underneath; hovering a step shows its
// longer description (STEP_TIPS). The ViewCube moves down by the ribbon's
// height (`--ribbon-h` on the viewport container) so it stays visible.
// Same props as before, so no tool had to change: `action` is one
// {label, enabled, onClick, active, popover} or a list of them (plus
// {divider:true}, or {node} for a field such as Extrude's depth box; `danger`
// draws it red, `success` green); they are the current step's options. `extraActions` are added
// after them — the shared sketch ✕ Cancel / ✓ Finish sketch pair.
// `compact` (2026-11-19, trial): the SECOND ribbon, for the sketch tool in use
// (its own steps / options / hint). It sits right under the main ribbon
// (top: var(--ribbon-h)), is a little smaller, and publishes its height as
// --tool-ribbon-h so the ViewCube and the sketch flyouts clear both rows.
export function SmartStepBar({ op, currentStep, color, onStepBack, steps = [], hint = null, action = null, extraActions = null, compact = false }) {
  const barRef = useRef(null)
  const [hoverStep, setHoverStep] = useState(null)
  // Publish the ribbon's height to its container (for the ViewCube); cleared on unmount.
  useEffect(() => {
    const el = barRef.current
    const host = el?.parentElement
    if (!el || !host) return
    // The sketch tools' flyouts open below the ribbon; tell them when it changes size.
    const cssVar = compact ? '--tool-ribbon-h' : '--ribbon-h'
    const set = () => { host.style.setProperty(cssVar, el.offsetHeight + 'px'); window.dispatchEvent(new Event('step-ribbon-resize')) }
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => { ro.disconnect(); host.style.removeProperty(cssVar); window.dispatchEvent(new Event('step-ribbon-resize')) }
  }, [op, compact])
  if (!op) return null
  const actions = [...(action ? (Array.isArray(action) ? action : [action]) : []), ...(extraActions || [])]
  const chev = 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 7px 50%)'
  const chevFirst = 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)'
  const tipFor = (step, state) => {
    const base = step.tip || STEP_TIPS[String(step.label).toLowerCase()] || null
    if (state === 'done') return `Done${base ? ' — ' + base : ''} Click to go back to this step.`
    if (state === 'next') return base ? `Coming up: ${base}` : null
    return base
  }

  return (
    <div ref={barRef} data-step-ribbon="1" style={{
      position: 'absolute', top: compact ? 'var(--ribbon-h, 0px)' : 0, left: 0, right: 0, zIndex: compact ? 199 : 200,
      boxSizing: 'border-box', pointerEvents: 'all',
      background: compact ? 'rgba(20,20,40,0.96)' : 'rgba(12,12,26,0.96)',
      borderBottom: `2px solid ${color}55`,
      padding: compact ? '5px 12px 4px 22px' : '7px 12px 6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, rowGap: 6 }}>
        {/* Tool name */}
        <div style={{
          fontFamily: 'monospace', fontSize: 10, fontWeight: 'bold', letterSpacing: '0.16em',
          color, textTransform: 'uppercase', background: color + '18', border: `1px solid ${color}55`,
          borderRadius: 4, padding: '4px 9px', marginRight: 4, flexShrink: 0,
        }}>{op}</div>

        {steps.map((step, i) => {
          const state = step.id < currentStep ? 'done' : step.id === currentStep ? 'current' : 'next'
          const tip = tipFor(step, state)
          const shapeStyle = {
            position: 'relative', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            height: 28, boxSizing: 'border-box', clipPath: i === 0 ? chevFirst : chev,
            padding: i === 0 ? '0 17px 0 10px' : '0 17px 0 14px',
            fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.05em', whiteSpace: 'nowrap',
            cursor: state === 'done' ? 'pointer' : 'default',
            ...(state === 'done'    ? { background: '#1f3d2a', color: '#7ee08f' }
              : state === 'current' ? { background: color, color: '#0d0d1a', fontWeight: 'bold' }
              :                       { background: '#22223a', color: '#6b7690' }),
          }
          // The step and its options are separate items of the wrapping row, so
          // in a narrow window the options flow onto the next line.
          return (
            <Fragment key={step.id}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              onMouseEnter={() => setHoverStep(step.id)} onMouseLeave={() => setHoverStep(h => h === step.id ? null : h)}>
              <div style={shapeStyle} onClick={state === 'done' ? () => onStepBack?.(step.id) : undefined}>
                {state === 'done' ? <span style={{ fontSize: 13, fontWeight: 'bold' }}>✓</span>
                  : <>{step.id}&nbsp;{String(step.label).toUpperCase()}</>}
              </div>
              {hoverStep === step.id && tip && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 300, width: 240,
                  background: '#0f1428', border: `1px solid ${state === 'current' ? color : '#3a4a6a'}`,
                  borderRadius: 8, padding: '8px 10px', color: '#c7d3e6',
                  fontFamily: 'sans-serif', fontSize: 12, lineHeight: 1.45, whiteSpace: 'normal',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.45)', pointerEvents: 'none',
                }}>
                  {state === 'done' && <div style={{ color: '#7ee08f', fontFamily: 'monospace', fontSize: 11, marginBottom: 3 }}>{step.label}</div>}
                  {tip}
                </div>
              )}
            </div>
              {/* The current step's options sit right after it */}
              {state === 'current' && actions.map((a, k) => {
                if (a.divider) return k === 0 ? null : <div key={'a' + k} style={{ width: 1, height: 20, background: '#2a2a4a', flexShrink: 0 }}/>
                if (a.node) return <div key={'a' + k} style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{a.node}</div>
                const commit = /^✓/.test(String(a.label))
                const on = a.active === true
                const base = {
                  height: 26, padding: '0 12px', borderRadius: 13, fontFamily: 'monospace', fontSize: 11,
                  fontWeight: 'bold', whiteSpace: 'nowrap', cursor: a.enabled ? 'pointer' : 'default',
                }
                const look = !a.enabled ? { background: '#22223a', color: '#5a6170', border: '1px solid #2a2a4a' }
                  : a.danger ? { background: 'transparent', color: '#ff6b5e', border: '1px solid #e05a4e' }
                  : a.success ? { background: '#1a3a2a', color: '#69F0AE', border: '2px solid #69F0AE' }
                  : commit ? { background: color, color: '#0d0d1a', border: `1px solid ${color}` }
                  : on ? { background: color + '33', color, border: `1px solid ${color}` }
                  : { background: 'transparent', color: color, border: `1px solid ${color}88` }
                return (
                  <div key={'a' + k} style={{ position: 'relative', flexShrink: 0 }}>
                    <button onClick={a.onClick} disabled={!a.enabled} title={a.title} style={{ ...base, ...look }}>{a.label}</button>
                    {a.popover}
                  </div>
                )
              })}
            </Fragment>
          )
        })}

        {!compact && (
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: '#4a5a70', letterSpacing: '0.05em', flexShrink: 0 }}>
          Esc · cancel
        </span>
        )}
      </div>
      {hint && (
        <div style={{ fontFamily: 'monospace', fontSize: compact ? 10.5 : 11, color, opacity: 0.9, marginTop: compact ? 4 : 5, letterSpacing: '0.03em' }}>
          {hint}
        </div>
      )}
    </div>
  )
}


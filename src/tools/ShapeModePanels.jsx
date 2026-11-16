// ShapeModePanels.jsx — the extra modes of the sketch Line and Circle tools
// (both apps): Line | Rectangle (corner to corner) | Rectangle (centre to
// corner), and Circle | 3-point arc. ShapeModeRow is the row of mode buttons
// shown at the top of the tool's popover; RectPanel / ArcPanel are the
// popovers for the new modes (the Line / Circle ones keep their own panels).
// Geometry lives in shapeMath.js.
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

const MODE_ICONS = {
  line: c => <><line x1="4" y1="18" x2="18" y2="4" stroke={c} strokeWidth="2" strokeLinecap="round"/></>,
  rect: c => <><rect x="3" y="5" width="16" height="12" stroke={c} strokeWidth="2" fill="none"/><circle cx="3" cy="17" r="2" fill={c}/><circle cx="19" cy="5" r="2" fill={c}/></>,
  rectc: c => <><rect x="3" y="5" width="16" height="12" stroke={c} strokeWidth="2" fill="none"/><path d="M9 11 H13 M11 9 V13" stroke={c} strokeWidth="1.5"/><circle cx="19" cy="5" r="2" fill={c}/></>,
  circle: c => <><circle cx="11" cy="11" r="7.5" stroke={c} strokeWidth="2" fill="none"/></>,
  arc3: c => <><path d="M3 16 A9 9 0 0 1 19 16" stroke={c} strokeWidth="2" fill="none"/><circle cx="3" cy="16" r="2" fill={c}/><circle cx="11" cy="7.5" r="2" fill={c}/><circle cx="19" cy="16" r="2" fill={c}/></>,
}

// modes: [[id, label, hotkey hint], …]
export function ShapeModeRow({ modes, mode, onMode, toolColor }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
      {modes.map(([id, label, hint]) => {
        const on = mode === id
        return (
          <button key={id} title={hint} onClick={() => onMode(id)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '4px 0', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace',
              background: on ? `${toolColor}33` : 'transparent',
              border: `1px solid ${on ? toolColor : '#3a3a5a'}`,
            }}>
            <svg width="22" height="22" viewBox="0 0 22 22">{MODE_ICONS[id](on ? toolColor : '#777')}</svg>
            <span style={{ fontSize: 8, color: on ? toolColor : '#777', letterSpacing: '0.04em' }}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

export const LINE_MODES = [
  ['line', 'LINE', 'Line'],
  ['rect', 'RECT', 'Rectangle — corner to corner (R)'],
  ['rectc', 'CENTRE', 'Rectangle — centre to corner (R again)'],
]
export const CIRCLE_MODES = [
  ['circle', 'CIRCLE', 'Circle'],
  ['arc3', '3-PT ARC', '3-point arc — start, end, then bend it (A)'],
]

const panelBox = toolColor => ({
  position: 'absolute', top: 0, left: '100%', marginLeft: 10,
  background: '#14142a', border: `3px solid ${toolColor}`, borderRadius: 10,
  padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
  zIndex: 50, width: 180, fontFamily: 'monospace',
})
const Arrow = ({ toolColor }) => (
  <div style={{ position: 'absolute', top: 18, left: -9, width: 0, height: 0,
    borderTop: '8px solid transparent', borderBottom: '8px solid transparent',
    borderRight: `9px solid ${toolColor}` }}/>
)

function NumField({ label, value, onChange, placeholder, toolColor }) {
  const locked = value !== '' && parseFloat(value) > 0
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
      <span style={{ fontSize: 9, color: locked ? '#FF9800' : '#888' }}>{locked ? '🔒 ' : ''}{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input value={value}
          onChange={e => { if (/^[0-9.]*$/.test(e.target.value)) onChange(e.target.value) }}
          onKeyDown={e => { if (e.key !== 'Tab' && e.key !== 'Escape' && !e.ctrlKey && !e.metaKey) e.stopPropagation(); if (e.key === 'Enter') e.target.blur() }}
          placeholder={placeholder}
          style={{ width: 56, textAlign: 'center', fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold',
            background: '#0d0d1a', color: locked ? '#FF9800' : '#fff',
            border: `2px solid ${locked ? '#FF9800' : toolColor}`, borderRadius: 6, padding: '5px 4px' }}/>
        <span style={{ color: '#888', fontSize: 10 }}>mm</span>
      </span>
    </label>
  )
}

const Tip = ({ children }) => <div style={{ marginTop: 8, textAlign: 'center', fontSize: 9, color: '#666' }}>{children}</div>

// Rectangle (both modes). Width/Height typed here lock the size; the mouse
// still picks which way it goes, and the click places it.
export function RectPanel({ toolColor, mode, onMode, started, w, h, onW, onH, liveW, liveH }) {
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  const tip = !started
    ? (mode === 'rectc' ? '👉 Click the centre' : '👉 Click the first corner')
    : '👉 Click the opposite corner'
  return (
    <div ref={panelRef} style={{ ...panelBox(toolColor), ...panelStyle }}>
      <Arrow toolColor={toolColor}/>
      <DragHandle {...handleProps}>{mode === 'rectc' ? 'Centre Rectangle' : 'Rectangle'}</DragHandle>
      <ShapeModeRow modes={LINE_MODES} mode={mode} onMode={onMode} toolColor={toolColor}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <NumField label="Width" value={w} onChange={onW} placeholder={liveW != null ? liveW.toFixed(1) : '—'} toolColor={toolColor}/>
        <NumField label="Height" value={h} onChange={onH} placeholder={liveH != null ? liveH.toFixed(1) : '—'} toolColor={toolColor}/>
      </div>
      <Tip>{tip}</Tip>
      <Tip>Type a size to lock it · Esc starts again</Tip>
    </div>
  )
}

// 3-point arc: start, end, then the click that sets the bend. A typed radius
// locks the size (the mouse still picks which side it bulges).
export function ArcPanel({ toolColor, mode, onMode, step, r, onR, liveR, tangent }) {
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  const tip = step === 0 ? '👉 Click where the arc starts'
    : step === 1 ? '👉 Click where it ends'
    : tangent ? '👉 Tangent! Click to place it' : '👉 Move to bend it, then click'
  return (
    <div ref={panelRef} style={{ ...panelBox(toolColor), ...panelStyle }}>
      <Arrow toolColor={toolColor}/>
      <DragHandle {...handleProps}>3-Point Arc</DragHandle>
      <ShapeModeRow modes={CIRCLE_MODES} mode={mode} onMode={onMode} toolColor={toolColor}/>
      <NumField label="Radius" value={r} onChange={onR} placeholder={liveR != null ? liveR.toFixed(1) : '—'} toolColor={toolColor}/>
      <Tip>{tip}</Tip>
      <Tip>Bends to a tangent when it lines up with a line it starts or ends on</Tip>
    </div>
  )
}

// DimPanel.jsx — the Dimension tool's flyout, shown next to its toolbar button.
// Top: which kind of dimension (Horizontal/Vertical, Aligned, Circle, Angle),
// each with a tiny drawn icon. Middle: that kind's own option (H/V lock, or
// ⌀ / R for circles). Bottom: how every dimension's number is written —
// decimals, "mm" on or off, text height — which applies to the whole sheet.
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

const MODES = [
  { id: 'hv',      label: 'H / V',   title: 'Horizontal or vertical distance' },
  { id: 'aligned', label: 'ALIGNED', title: 'True distance between two points (slanted edges)' },
  { id: 'circle',  label: '⌀ / R',   title: 'Diameter or radius of a circle or arc' },
  { id: 'angle',   label: 'ANGLE',   title: 'Angle between two lines' },
]

// Little line drawings for the mode buttons.
function ModeIcon({ id, color }) {
  const s = { stroke: color, strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' }
  return (
    <svg width="30" height="20" viewBox="0 0 30 20">
      {id === 'hv' && <>
        <path d="M4 16 V4 M26 16 V4" {...s} opacity="0.5" />
        <path d="M4 8 H26" {...s} /><path d="M4 8 l4 -2 v4 z M26 8 l-4 -2 v4 z" fill={color} stroke="none" />
      </>}
      {id === 'aligned' && <>
        <path d="M4 17 L24 5" {...s} /><path d="M4 17 l2.2 -4.2 l2 3.4 z M24 5 l-2.2 4.2 l-2 -3.4 z" fill={color} stroke="none" />
      </>}
      {id === 'circle' && <>
        <circle cx="15" cy="10" r="7" {...s} /><path d="M9 15 L21 5" {...s} />
      </>}
      {id === 'angle' && <>
        <path d="M5 17 H27 M5 17 L20 3" {...s} opacity="0.5" /><path d="M17 17 A12 12 0 0 0 14 8.5" {...s} />
      </>}
    </svg>
  )
}

export default function DimPanel({
  toolColor, mode, onMode, orientLock, onOrientLock, circleKind, onCircleKind,
  style, onStyle, anglePicked,
}) {
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()

  const chip = (on, extra = {}) => ({
    padding: '4px 0', borderRadius: 5, cursor: 'pointer', fontFamily: 'monospace',
    fontSize: 10, fontWeight: 'bold', flex: 1,
    background: on ? toolColor : '#2a2a4a', color: on ? '#0d0d1a' : '#999',
    border: `1px solid ${on ? toolColor : '#3a3a5a'}`, ...extra,
  })
  const section = { fontSize: 9, color: '#777', letterSpacing: '0.08em', margin: '10px 0 4px' }

  const tip = mode === 'hv' ? (orientLock ? `Locked ${orientLock === 'h' ? 'horizontal' : 'vertical'}` : 'Drag up/down → horizontal, sideways → vertical')
    : mode === 'aligned' ? 'Measures straight from point to point'
    : mode === 'circle' ? 'Small holes get a leader outside'
    : anglePicked === 0 ? 'Click two lines' : anglePicked === 1 ? 'Now the second line' : 'Move to pick the side, click'

  return (
    <div ref={panelRef} style={{
      position: 'absolute', top: 0, left: '100%', marginLeft: 10,
      background: '#14142a', border: `3px solid ${toolColor}`, borderRadius: 10,
      padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      zIndex: 50, width: 196, fontFamily: 'monospace', ...panelStyle,
    }}>
      <div style={{ position: 'absolute', top: 18, left: -9, width: 0, height: 0,
        borderTop: '8px solid transparent', borderBottom: '8px solid transparent',
        borderRight: `9px solid ${toolColor}` }} />

      <DragHandle {...handleProps}>Dimension</DragHandle>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {MODES.map(m => {
          const on = mode === m.id
          return (
            <button key={m.id} title={m.title} onClick={() => onMode(m.id)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '5px 0', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace',
              fontSize: 9, fontWeight: 'bold',
              background: on ? toolColor + '33' : '#1e1e38', color: on ? toolColor : '#888',
              border: `2px solid ${on ? toolColor : '#3a3a5a'}`,
            }}>
              <ModeIcon id={m.id} color={on ? toolColor : '#888'} />
              {m.label}
            </button>
          )
        })}
      </div>

      {mode === 'hv' && <>
        <div style={section}>DIRECTION</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={chip(!orientLock)} onClick={() => onOrientLock(null)}>AUTO</button>
          <button style={chip(orientLock === 'h')} onClick={() => onOrientLock('h')}>H</button>
          <button style={chip(orientLock === 'v')} onClick={() => onOrientLock('v')}>V</button>
        </div>
      </>}
      {mode === 'circle' && <>
        <div style={section}>SHOW</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={chip(circleKind === 'auto')} onClick={() => onCircleKind('auto')} title="Diameter for circles, radius for arcs">AUTO</button>
          <button style={chip(circleKind === 'diameter')} onClick={() => onCircleKind('diameter')}>⌀</button>
          <button style={chip(circleKind === 'radius')} onClick={() => onCircleKind('radius')}>R</button>
        </div>
      </>}

      <div style={{ marginTop: 8, textAlign: 'center', fontSize: 9, color: '#888' }}>👉 {tip}</div>

      <div style={{ borderTop: '1px solid #2a2a4a', marginTop: 10 }} />
      <div style={section}>NUMBERS (WHOLE SHEET)</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: '#777', width: 44 }}>DECIMALS</span>
        {[0, 1, 2].map(d => (
          <button key={d} style={chip(style.decimals === d)} onClick={() => onStyle({ ...style, decimals: d })}>{d}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: 9, color: '#777', width: 44 }}>UNITS</span>
        <button style={chip(!style.units)} onClick={() => onStyle({ ...style, units: false })}>40</button>
        <button style={chip(style.units)} onClick={() => onStyle({ ...style, units: true })}>40 mm</button>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: 9, color: '#777', width: 44 }}>TEXT</span>
        {[2.5, 3.5, 5].map(h => (
          <button key={h} style={chip(style.textMm === h)} onClick={() => onStyle({ ...style, textMm: h })}>{h}</button>
        ))}
      </div>
    </div>
  )
}

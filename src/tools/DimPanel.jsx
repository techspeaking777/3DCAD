// DimPanel.jsx — the Dimension tool's flyout, shown next to its toolbar button.
// Top: which kind of dimension (Horizontal/Vertical, Aligned, Circle, Angle),
// each with a tiny drawn icon. Middle: that kind's own option (H/V lock, or
// ⌀ / R for circles). Bottom: how every dimension's number is written —
// decimals, "mm" on or off, text height — which applies to the whole sheet.
import { useState } from 'react'
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

const MODES = [
  { id: 'hv',      label: 'H / V',   title: 'Horizontal or vertical distance' },
  { id: 'aligned', label: 'ALIGNED', title: 'True distance between two points (slanted edges)' },
  { id: 'circle',  label: '⌀ / R',   title: 'Diameter or radius of a circle or arc' },
  { id: 'angle',   label: 'ANGLE',   title: 'Angle between two lines' },
  { id: 'chain',   label: 'CHAIN',   title: 'A row of dimensions end to end' },
  { id: 'baseline',label: 'BASELINE',title: 'Several dimensions all measured from one edge' },
  { id: 'hole',    label: 'HOLE',    title: 'Hole callout — counts matching holes: "4× ⌀10"' },
  { id: 'note',    label: 'NOTE',    title: 'An arrow with your own text' },
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
      {id === 'chain' && <>
        <path d="M3 16 V6 M12 16 V6 M20 16 V6 M27 16 V6" {...s} opacity="0.5" />
        <path d="M3 9 H27" {...s} /><path d="M12 7 v4 M20 7 v4" {...s} />
      </>}
      {id === 'baseline' && <>
        <path d="M3 18 V3 M13 18 V10 M25 18 V5" {...s} opacity="0.5" />
        <path d="M3 13 H13 M3 8 H25" {...s} />
      </>}
      {id === 'hole' && <>
        <circle cx="9" cy="12" r="5" {...s} /><path d="M12.5 8.5 L18 4 H28" {...s} />
      </>}
      {id === 'note' && <>
        <path d="M4 17 L14 7 H27" {...s} /><path d="M4 17 l1 -4 l3 3 z" fill={color} stroke="none" />
        <path d="M17 4.5 H25" {...s} opacity="0.6" />
      </>}
    </svg>
  )
}

export default function DimPanel({
  toolColor, mode, onMode, orientLock, onOrientLock, circleKind, onCircleKind,
  style, onStyle, anglePicked, running, onFinish, noteText, onNoteText, onAutoSizes,
}) {
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  const [autoMsg, setAutoMsg] = useState('')

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
    : mode === 'chain' ? (running ? 'Click each next point · Enter to finish' : 'Place the first dimension, then keep clicking')
    : mode === 'baseline' ? (running ? 'Click each next point · Enter to finish' : 'First point is the edge everything is measured from')
    : mode === 'hole' ? 'Click a hole — same-size holes in the view are counted'
    : mode === 'note' ? (noteText.trim() ? 'Click the arrow tip, then the text spot' : 'Type the note first')
    : anglePicked === 0 ? 'Click two lines' : anglePicked === 1 ? 'Now the second line' : 'Move to pick the side, click'

  return (
    <div ref={panelRef} style={{
      // Grows upward from the DIM button (it sits low in the toolbar).
      position: 'absolute', bottom: 0, left: '100%', marginLeft: 10,
      background: '#14142a', border: `3px solid ${toolColor}`, borderRadius: 10,
      padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      zIndex: 50, width: 236, fontFamily: 'monospace', ...panelStyle,
    }}>
      <div style={{ position: 'absolute', bottom: 18, left: -9, width: 0, height: 0,
        borderTop: '8px solid transparent', borderBottom: '8px solid transparent',
        borderRight: `9px solid ${toolColor}` }} />

      <DragHandle {...handleProps}>Dimension</DragHandle>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
        {MODES.map(m => {
          const on = mode === m.id
          return (
            <button key={m.id} title={m.title} onClick={() => onMode(m.id)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '4px 0', borderRadius: 6, cursor: 'pointer', fontFamily: 'monospace',
              fontSize: 7.5, fontWeight: 'bold', letterSpacing: '-0.02em',
              background: on ? toolColor + '33' : '#1e1e38', color: on ? toolColor : '#888',
              border: `2px solid ${on ? toolColor : '#3a3a5a'}`,
            }}>
              <ModeIcon id={m.id} color={on ? toolColor : '#888'} />
              {m.label}
            </button>
          )
        })}
      </div>

      {(mode === 'hv' || ((mode === 'chain' || mode === 'baseline') && !running)) && <>
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

      {mode === 'note' && <>
        <div style={section}>NOTE TEXT</div>
        <input
          value={noteText}
          onChange={e => onNoteText(e.target.value)}
          onKeyDown={e => { if (e.key !== 'Escape' && !e.ctrlKey && !e.metaKey) e.stopPropagation(); if (e.key === 'Enter') e.target.blur() }}
          placeholder="e.g. M6 THREAD"
          maxLength={40}
          style={{
            width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12,
            textTransform: 'uppercase', background: '#0d0d1a', color: '#fff',
            border: `2px solid ${toolColor}`, borderRadius: 6, padding: '5px 6px',
          }}
        />
      </>}
      {running && (
        <button onClick={onFinish} style={{ ...chip(true), width: '100%', marginTop: 8, padding: '6px 0' }}>FINISH ↵</button>
      )}

      <div style={{ marginTop: 8, textAlign: 'center', fontSize: 9, color: '#888' }}>👉 {tip}</div>

      <button
        onClick={() => {
          const n = onAutoSizes()
          setAutoMsg(n ? `Added ${n} overall size${n > 1 ? 's' : ''}` : 'Generate orthogonal views first')
        }}
        title="Overall width, height and depth on the generated views — each shown once"
        style={{ ...chip(false), width: '100%', marginTop: 8, padding: '6px 0', color: toolColor, border: `1px solid ${toolColor}` }}
      >⚡ AUTO SIZES</button>
      {autoMsg && <div style={{ marginTop: 4, textAlign: 'center', fontSize: 9, color: '#888' }}>{autoMsg}</div>}

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

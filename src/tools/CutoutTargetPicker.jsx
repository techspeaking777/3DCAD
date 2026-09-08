// Shown when a brand-new Cutout's swept volume overlaps more than one solid
// body — lets the user say which body/bodies it should actually apply to,
// rather than silently cutting every body it geometrically overlaps (the
// original bug report: a hole cut for a pin joint was also chewing into the
// pin already modeled on the OTHER body, since both bodies legitimately
// occupy the same space by design).
//
// The primary way to pick is clicking bodies directly in the viewport (see
// App3D's handleCutoutTargetClick/Hover, highlighted the same light-blue/
// orange as Mirror3D/Export STL's own body picks) — this panel is a small,
// non-blocking fallback list for anything currently hidden (nothing to
// click on) and a live readout of the current selection either way. It's
// deliberately NOT a modal: no dark overlay, no click-outside-to-cancel —
// Confirm/Cancel live on the SmartStepBar's own Pick Target(s) step instead,
// consistent with every other step-based tool in this app.
export default function CutoutTargetPicker({ candidates, selected, solidLabel, onToggle, onHoverRow }) {
  const styles = {
    panel: {
      position: 'absolute', bottom: 64, right: 20, zIndex: 150,
      background: 'rgba(20,20,42,0.97)', border: '1.5px solid #e05a4e88', borderRadius: 8,
      padding: '10px 12px', width: 220, maxWidth: '90vw', boxShadow: '0 8px 32px #000a',
      fontFamily: 'monospace', color: '#eee', fontSize: 12,
    },
    row: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', borderRadius: 4 },
    swatch: { width: 10, height: 10, borderRadius: 2, display: 'inline-block', flexShrink: 0 },
  }

  return (
    <div style={styles.panel}>
      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#e05a4e', marginBottom: 2, letterSpacing: '0.05em' }}>
        CUT WHICH BODY?
      </div>
      <div style={{ color: '#889', fontSize: 10, marginBottom: 8, lineHeight: 1.4 }}>
        Click bodies in the viewport, or check them here (needed for hidden ones).
      </div>
      <div>
        {candidates.map(body => (
          <label
            key={body.id}
            style={styles.row}
            onMouseEnter={() => onHoverRow(body.id)}
            onMouseLeave={() => onHoverRow(null)}
          >
            <input type="checkbox" checked={selected.has(body.id)} onChange={() => onToggle(body.id)} />
            <span style={{ ...styles.swatch, background: body.color }} />
            <span>{solidLabel(body.id)}{body.hidden ? ' (hidden)' : ''}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

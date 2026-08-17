import { useEffect, useState } from 'react'
import { cadEngine } from '../cadEngine.js'
import { layoutViews, mmViewToPx } from './orthoViewsMath.js'

const VIEWS = ['front', 'top', 'right', 'left', 'back', 'bottom']
const DEFAULT_VIEWS = ['front', 'top', 'right']

// Three-step wizard: pick solids (from the live 3D project via getSolidIds,
// an imperative call up into App3D — see AppShell.jsx) -> pick views ->
// Generate. Modal-overlay shell matches TracerPanel.jsx's convention.
export default function OrthoViewsPanel({ getSolidIds, onGenerate, onClose }) {
  const [solidList, setSolidList] = useState([])
  const [selectedSolids, setSelectedSolids] = useState([])
  const [selectedViews, setSelectedViews] = useState(DEFAULT_VIEWS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const list = getSolidIds() || []
    setSolidList(list)
    // Hidden solids start unchecked (per plan — a body hidden in the 3D
    // view is very often a reference/construction body, not something the
    // user wants pulled into a drawing by default).
    setSelectedSolids(list.filter(s => !s.hidden).map(s => s.id))
  }, [])

  function toggleSolid(id) {
    setSelectedSolids(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleView(v) {
    setSelectedViews(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  async function handleGenerate() {
    if (selectedSolids.length === 0 || selectedViews.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await cadEngine.computeOrthoViews({ solidIds: selectedSolids, views: selectedViews })
      const laidOut = layoutViews(res.orthoViews.views)
      const px = mmViewToPx(laidOut)
      onGenerate(px)
    } catch (err) {
      setError(err.message || 'Failed to generate views')
      setBusy(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div style={{
        background: '#141414', borderRadius: 8, border: '1px solid #2a2a2a',
        display: 'flex', flexDirection: 'column',
        width: 420, maxHeight: '85vh', overflow: 'hidden',
        fontFamily: 'monospace',
      }}>
        {/* Header */}
        <div style={{
          background: '#1a1a1a', borderBottom: '1px solid #222',
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <div style={{ width: 16, height: 16, background: '#FF7043', borderRadius: 2 }} />
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: '#e8e8e0' }}>GENERATE ORTHOGONAL VIEWS</span>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', border: 'none',
            color: '#555', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px',
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', color: '#888', marginBottom: 8 }}>SOLIDS</div>
          {solidList.length === 0 && (
            <div style={{ fontSize: 11, color: '#555', marginBottom: 16 }}>
              No solids in the open 3D project — build something in the 3D Model tab first.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 18 }}>
            {solidList.map(s => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                opacity: s.hidden ? 0.5 : 1, fontSize: 12, color: '#ddd',
              }}>
                <input type="checkbox" checked={selectedSolids.includes(s.id)} onChange={() => toggleSolid(s.id)} />
                <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color || '#3a7bd5', flexShrink: 0 }} />
                <span>{s.name}{s.hidden ? ' (hidden)' : ''}</span>
              </label>
            ))}
          </div>

          <div style={{ fontSize: 10, letterSpacing: '0.08em', color: '#888', marginBottom: 8 }}>VIEWS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 18 }}>
            {VIEWS.map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#ddd' }}>
                <input type="checkbox" checked={selectedViews.includes(v)} onChange={() => toggleView(v)} />
                <span style={{ textTransform: 'uppercase' }}>{v}</span>
              </label>
            ))}
          </div>

          {error && (
            <div style={{ fontSize: 11, color: '#ff6b6b', marginBottom: 12, wordBreak: 'break-word' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={busy || selectedSolids.length === 0 || selectedViews.length === 0}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 4, border: 'none',
              background: busy || selectedSolids.length === 0 || selectedViews.length === 0 ? '#333' : '#FF7043',
              color: busy || selectedSolids.length === 0 || selectedViews.length === 0 ? '#777' : '#111',
              fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.05em',
              cursor: busy || selectedSolids.length === 0 || selectedViews.length === 0 ? 'default' : 'pointer',
            }}
          >
            {busy ? 'GENERATING…' : 'GENERATE'}
          </button>
        </div>
      </div>
    </div>
  )
}

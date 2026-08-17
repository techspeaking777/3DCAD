import { useRef, useState } from 'react'
import App3D from './App3D.jsx'
import DrawingApp from './App.jsx'

// Top-level shell: one running app, two tabs sharing the same window. Both
// tabs stay mounted simultaneously (toggled via CSS display, never
// unmounted) so switching tabs never loses in-progress sketch/tool state or
// undo history in either one — the same "keep both alive" approach the app
// already uses for its two superimposed 3D/2D-overlay canvases.
export default function AppShell() {
  const [activeTab, setActiveTab] = useState('3d')   // '3d' | 'drawing'
  const app3dRef = useRef(null)
  const drawingRef = useRef(null)
  const app3dWrapRef = useRef(null)
  const drawingWrapRef = useRef(null)

  function selectTab(tab) {
    setActiveTab(tab)
    // Route keyboard shortcuts to whichever app is now visible — both apps'
    // root divs are plain per-element tabIndex={0}, not window-level
    // listeners, so focusing the right one is enough.
    requestAnimationFrame(() => {
      const wrap = tab === '3d' ? app3dWrapRef.current : drawingWrapRef.current
      wrap?.querySelector('[tabindex]')?.focus()
    })
  }

  // Distinct accent per tab (not just position) so the active one reads at a
  // glance: cyan matches the app's wordmark/3D-viewport accent, orange
  // matches the Drawing tab's own tool-icon palette.
  const ACCENT = { '3d': '#3ad6ff', drawing: '#FF7043' }

  const tabBtnStyle = (tab, active) => ({
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '0 26px',
    height: '100%',
    background: active ? '#161616' : 'transparent',
    color: active ? '#fff' : '#777',
    border: 'none',
    borderBottom: active ? `3px solid ${ACCENT[tab]}` : '3px solid transparent',
    boxShadow: active ? `inset 0 0 16px ${ACCENT[tab]}22` : 'none',
    fontFamily: 'monospace',
    fontWeight: 'bold',
    fontSize: 15,
    letterSpacing: '0.08em',
    cursor: 'pointer',
    transition: 'all 0.12s',
  })

  const CubeIcon = ({ color }) => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M10 1.5l8 4.5v8l-8 4.5-8-4.5v-8l8-4.5z" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M2 6l8 4.5 8-4.5M10 10.5v8" stroke={color} strokeWidth="1.1" opacity="0.7"/>
    </svg>
  )
  const PencilIcon = ({ color }) => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M3 17l1-4.2L12.3 4.5a1.5 1.5 0 0 1 2.2 0l1 1a1.5 1.5 0 0 1 0 2.2L7.2 16 3 17z" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M11 6.5l2.5 2.5" stroke={color} strokeWidth="1.1"/>
    </svg>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#000' }}>
      <div style={{ height: 48, flexShrink: 0, display: 'flex', background: '#0a0a0a', borderBottom: '1px solid #222' }}>
        <button style={tabBtnStyle('3d', activeTab === '3d')} onClick={() => selectTab('3d')}>
          <CubeIcon color={activeTab === '3d' ? ACCENT['3d'] : '#777'}/>
          3D MODEL
        </button>
        <button style={tabBtnStyle('drawing', activeTab === 'drawing')} onClick={() => selectTab('drawing')}>
          <PencilIcon color={activeTab === 'drawing' ? ACCENT.drawing : '#777'}/>
          DRAWING
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div ref={app3dWrapRef} style={{ display: activeTab === '3d' ? 'block' : 'none', height: '100%' }}>
          <App3D
            ref={app3dRef}
            getSheetData={() => drawingRef.current?.getSheetData()}
            onSheetLoaded={sheet => drawingRef.current?.restoreSheetData(sheet)}
          />
        </div>
        <div ref={drawingWrapRef} style={{ display: activeTab === 'drawing' ? 'block' : 'none', height: '100%' }}>
          <DrawingApp ref={drawingRef} getSolidIds={() => app3dRef.current?.getSolidIds() ?? []} />
        </div>
      </div>
    </div>
  )
}

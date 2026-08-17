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

  const tabBtnStyle = active => ({
    padding: '0 18px',
    height: '100%',
    background: active ? '#1a1a1a' : 'transparent',
    color: active ? '#fff' : '#888',
    border: 'none',
    borderBottom: active ? '2px solid #FF7043' : '2px solid transparent',
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: '0.05em',
    cursor: 'pointer',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#000' }}>
      <div style={{ height: 32, flexShrink: 0, display: 'flex', background: '#0a0a0a', borderBottom: '1px solid #222' }}>
        <button style={tabBtnStyle(activeTab === '3d')} onClick={() => selectTab('3d')}>3D MODEL</button>
        <button style={tabBtnStyle(activeTab === 'drawing')} onClick={() => selectTab('drawing')}>DRAWING</button>
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

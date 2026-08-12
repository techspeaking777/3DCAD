// CenterPanel.jsx — popover shown under the Centre toolbar button. Centre is
// single-phase (no accept step like Move/Copy or Mirror) — select entities,
// then Tab/right-click/this panel's button re-centers the selection's
// bounding-box middle on the sketch origin. The button just mirrors the
// existing Tab/right-click gesture for discoverability.
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

export default function CenterPanel({toolColor, selCount, onApply}){
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  return (
    <div ref={panelRef} style={{
      position:'absolute',top:'100%',left:0,marginTop:10,
      background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
      padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
      zIndex:50,width:200,fontFamily:'monospace',...panelStyle,
    }}>
      {/* pointer arrow back to the toolbar button */}
      <div style={{position:'absolute',top:-9,left:24,width:0,height:0,
        borderLeft:'8px solid transparent',borderRight:'8px solid transparent',
        borderBottom:`9px solid ${toolColor}`}}/>

      <DragHandle {...handleProps}>{selCount>0 ? `${selCount} Selected` : 'Click or Drag to Select'}</DragHandle>
      <button
        onClick={()=>{ if(selCount>0) onApply() }}
        style={{
          width:'100%',padding:'6px 0',borderRadius:6,border:'none',
          background:selCount>0?toolColor:'#2a2a4a',color:selCount>0?'#0d0d1a':'#666',
          fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:selCount>0?'pointer':'default',
        }}>
        ✓ Centre on Origin
      </button>
      <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
        👉 Click or drag to select, then centre
      </div>
    </div>
  )
}

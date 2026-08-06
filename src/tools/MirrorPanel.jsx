// MirrorPanel.jsx — kid-friendly popover shown under the Mirror toolbar button.
// A "Done Selecting" button replaces the hidden Tab/right-click gesture needed
// to move from "still picking entities" into drawing the mirror line (same
// reasoning as Move/Copy and Scale — selection count is open-ended). Unlike
// those two, there's nothing to type here: once accepted, you just click two
// points to draw the mirror axis, so no input box is needed.
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

export default function MirrorPanel({toolColor, selCount, accepted, onAccept, hasAxisStart}){
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

      {!accepted && (
        <>
          <DragHandle {...handleProps}>{selCount>0 ? `${selCount} Selected` : 'Click or Drag to Select'}</DragHandle>
          <button
            onClick={()=>{ if(selCount>0) onAccept() }}
            style={{
              width:'100%',padding:'6px 0',borderRadius:6,border:'none',
              background:selCount>0?toolColor:'#2a2a4a',color:selCount>0?'#0d0d1a':'#666',
              fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:selCount>0?'pointer':'default',
            }}>
            ✓ Done Selecting
          </button>
          <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
            👉 Click or drag a box to select
          </div>
        </>
      )}

      {accepted && (
        <>
          <DragHandle {...handleProps}>Mirror Line</DragHandle>
          <div style={{textAlign:'center',fontSize:11,color:toolColor,fontWeight:'bold'}}>
            {hasAxisStart ? 'Click the 2nd point' : 'Click the 1st point'}
          </div>
          <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
            👉 Draw a line to flip across
          </div>
        </>
      )}
    </div>
  )
}

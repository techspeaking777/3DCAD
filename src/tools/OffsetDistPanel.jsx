import { useEffect, useRef } from 'react'
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

// Kid-friendly popover shown next to the Offset toolbar button once an entity
// is picked. A real, visible input box for the distance — typing overrides the
// live drag-preview, clearing it goes back to following the mouse. Typing (and
// the "Set" button) only fixes the NUMBER — placing the copy still requires a
// click on the canvas, since that click is what picks which side to offset
// toward (the button/keyboard have no canvas position to work with).
export default function OffsetDistPanel({ toolColor, value, onChange, liveValueMm, canApply }){
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  const inputRef = useRef(null)
  useEffect(()=>{ inputRef.current?.focus() }, [])

  const showingLive = !value
  const displayMm = value || (liveValueMm!=null ? liveValueMm.toFixed(1) : '0.0')

  return (
    <div ref={panelRef} style={{
      position:'absolute',top:0,left:'100%',marginLeft:10,
      background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
      padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
      zIndex:50,width:170,fontFamily:'monospace',...panelStyle,
    }}>
      {/* pointer arrow back to the toolbar button */}
      <div style={{position:'absolute',top:18,left:-9,width:0,height:0,
        borderTop:'8px solid transparent',borderBottom:'8px solid transparent',
        borderRight:`9px solid ${toolColor}`}}/>

      <DragHandle {...handleProps}>Offset Distance</DragHandle>

      <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
        <input
          ref={inputRef}
          value={value}
          onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChange(e.target.value) }}
          onKeyDown={e=>{
            if (e.key!=='Escape') e.stopPropagation()
            if (e.key==='Enter') e.target.blur()
          }}
          placeholder={showingLive?displayMm:'0'}
          style={{
            width:70,textAlign:'center',fontFamily:'monospace',fontSize:16,fontWeight:'bold',
            background:'#0d0d1a',color: showingLive?'#888':'#fff',border:`2px solid ${toolColor}`,borderRadius:6,
            padding:'6px 4px',
          }}
        />
        <span style={{color:'#888',fontSize:11}}>mm</span>
      </div>

      {showingLive && <div style={{marginTop:6,textAlign:'center',fontSize:9,color:'#666'}}>following your mouse</div>}

      <button
        onClick={()=>inputRef.current?.blur()}
        disabled={!canApply}
        style={{
          marginTop:8,width:'100%',padding:'6px 0',borderRadius:6,border:'none',
          background:canApply?toolColor:'#2a2a4a',color:canApply?'#0d0d1a':'#666',
          fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:canApply?'pointer':'default',
        }}>
        ✓ Set Distance
      </button>

      <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
        👉 Now click the canvas to place it
      </div>
    </div>
  )
}

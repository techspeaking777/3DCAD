// ResizeScalePanel.jsx — kid-friendly popover shown under the Resize/Scale
// toolbar button. A "Done Selecting" button replaces the hidden Tab/right-click
// gesture (selection count is open-ended, same reasoning as Move/Copy), and a
// real, visible Scale Factor box replaces blind typing. There's no separate
// "lock" step — clicking the canvas already both picks the anchor point and
// applies the scale in one action, so typing + click is all that's needed.
import { useEffect, useRef } from 'react'
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

export default function ResizeScalePanel({toolColor, selCount, accepted, onAccept, scaleInput, onChangeScale}){
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  const inputRef = useRef(null)
  useEffect(()=>{ if (accepted) inputRef.current?.focus() }, [accepted])

  const s = parseFloat(scaleInput)
  const validScale = s>0

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
          <DragHandle {...handleProps}>Scale Factor</DragHandle>
          <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
            <input
              ref={inputRef}
              value={scaleInput}
              onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChangeScale(e.target.value) }}
              onKeyDown={e=>{ if(e.key!=='Escape')e.stopPropagation(); if(e.key==='Enter') e.target.blur() }}
              placeholder="1"
              style={{
                width:70,textAlign:'center',fontFamily:'monospace',fontSize:16,fontWeight:'bold',
                background:'#0d0d1a',color: scaleInput?'#fff':'#888',
                border:`2px solid ${toolColor}`,borderRadius:6,padding:'6px 4px',
              }}
            />
            <span style={{color:'#888',fontSize:11}}>×</span>
          </div>
          <div style={{marginTop:6,textAlign:'center',fontSize:9,color:'#666'}}>
            {validScale ? (s<1?'shrinks it':s>1?'grows it':'stays the same') : 'try 2 for double, 0.5 for half'}
          </div>
          <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
            👉 Now click the canvas to place it
          </div>
        </>
      )}
    </div>
  )
}

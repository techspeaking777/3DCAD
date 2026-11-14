import { useEffect, useRef } from 'react'
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

// Kid-friendly popover shown next to the Fillet toolbar button once both lines
// are picked. A real, visible input box for the radius — no blind keystrokes —
// Enter or the Apply button rounds the corner.
// mode: 'fillet' | 'chamfer' (onMode switches it); corners: how many corners
// the preview will change (more than 1 for a whole shape); needLines: Chamfer
// was asked for on an arc.
export default function FilletRadiusPanel({ toolColor, value, onChange, onApply, tooLarge, mode = 'fillet', onMode, corners = 0, needLines = false }){
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  const inputRef = useRef(null)
  useEffect(()=>{ inputRef.current?.focus() }, [])

  const canApply = parseFloat(value)>0 && !tooLarge && !needLines
  const chamfer = mode === 'chamfer'

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

      <DragHandle {...handleProps}>{chamfer ? 'Chamfer Distance' : 'Fillet Radius'}</DragHandle>

      {onMode && (
        <div style={{display:'flex',gap:4,marginBottom:8}}>
          {[['fillet','ROUND'],['chamfer','CHAMFER']].map(([m,label])=>(
            <button key={m} onClick={()=>onMode(m)} title={m==='fillet'?'Round the corner':'Cut the corner off straight'}
              style={{flex:1,padding:'4px 0',borderRadius:5,cursor:'pointer',fontFamily:'monospace',fontSize:9,
                letterSpacing:'0.05em',fontWeight:'bold',background:mode===m?toolColor+'33':'#0d0d1a',
                border:`2px solid ${mode===m?toolColor:'#3a3a5a'}`,color:mode===m?toolColor:'#666'}}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
        <input
          ref={inputRef}
          value={value}
          onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChange(e.target.value) }}
          onKeyDown={e=>{
            if (e.key!=='Escape'&&!e.ctrlKey&&!e.metaKey) e.stopPropagation()
            if (e.key==='Enter' && canApply) onApply()
          }}
          placeholder="0"
          style={{
            width:70,textAlign:'center',fontFamily:'monospace',fontSize:16,fontWeight:'bold',
            background:'#0d0d1a',color:'#fff',border:`2px solid ${toolColor}`,borderRadius:6,
            padding:'6px 4px',
          }}
        />
        <span style={{color:'#888',fontSize:11}}>mm</span>
      </div>

      {corners > 1 && !tooLarge && <div style={{marginTop:6,textAlign:'center',fontSize:9,color:toolColor}}>{corners} corners</div>}
      {tooLarge && <div style={{marginTop:6,textAlign:'center',fontSize:9,color:'#F44336'}}>Too big for {corners > 1 ? 'these corners' : 'this corner'}</div>}
      {needLines && <div style={{marginTop:6,textAlign:'center',fontSize:9,color:'#F44336'}}>Chamfer needs two straight lines</div>}

      <button
        onClick={onApply}
        disabled={!canApply}
        style={{
          marginTop:8,width:'100%',padding:'6px 0',borderRadius:6,border:'none',
          background:canApply?toolColor:'#2a2a4a',color:canApply?'#0d0d1a':'#666',
          fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:canApply?'pointer':'default',
        }}>
        ✓ Apply
      </button>

      <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
        👉 Type a number, then Enter
      </div>
    </div>
  )
}

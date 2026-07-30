import { useEffect, useRef } from 'react'

// Kid-friendly popover shown next to the Fillet toolbar button once both lines
// are picked. A real, visible input box for the radius — no blind keystrokes —
// Enter or the Apply button rounds the corner.
export default function FilletRadiusPanel({ toolColor, value, onChange, onApply, tooLarge }){
  const inputRef = useRef(null)
  useEffect(()=>{ inputRef.current?.focus() }, [])

  const canApply = parseFloat(value)>0 && !tooLarge

  return (
    <div style={{
      position:'absolute',top:0,left:'100%',marginLeft:10,
      background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
      padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
      zIndex:50,width:170,fontFamily:'monospace',
    }}>
      {/* pointer arrow back to the toolbar button */}
      <div style={{position:'absolute',top:18,left:-9,width:0,height:0,
        borderTop:'8px solid transparent',borderBottom:'8px solid transparent',
        borderRight:`9px solid ${toolColor}`}}/>

      <div style={{textAlign:'center',color:'#888',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>
        Fillet Radius
      </div>

      <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
        <input
          ref={inputRef}
          value={value}
          onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChange(e.target.value) }}
          onKeyDown={e=>{
            if (e.key!=='Escape') e.stopPropagation()
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

      {tooLarge && <div style={{marginTop:6,textAlign:'center',fontSize:9,color:'#F44336'}}>Too big for this corner</div>}

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

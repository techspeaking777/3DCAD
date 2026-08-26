// SelectDimPanel.jsx — kid-friendly popover that follows the current Select-tool
// selection around the canvas. Shows real, visible input boxes for whichever
// dimensions apply (Length/Angle for a line, Radius for a circle, Radius/Angle
// for an arc, Width/Height for a multi-selection) instead of the old blind
// Tab-cycle-then-type flow. The 3x3 anchor-dot grid (which corner/edge/centre
// stays put while resizing) is still drawn on the canvas itself and is
// unchanged by this panel — click a dot there, then type/Apply here.
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

export default function SelectDimPanel({style, toolColor, fields, pending, liveValues, onChangeField, onApply, styleOptions, currentStyle, onSetStyle}){
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  return (
    <div ref={panelRef} style={{
      ...style,
      background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
      padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
      zIndex:60,width:170,fontFamily:'monospace',
      transform:`${style?.transform||''} ${panelStyle.transform}`,
    }}>
      <DragHandle {...handleProps}>Edit</DragHandle>
      {styleOptions && (
        <div style={{display:'flex',gap:4,marginBottom:8}}>
          {styleOptions.map(({s,label,color})=>(
            <button key={s||'firm'} onClick={()=>onSetStyle(s)} title={label}
              style={{
                flex:1,padding:'4px 0',borderRadius:5,cursor:'pointer',
                fontFamily:'monospace',fontSize:9,letterSpacing:'0.05em',fontWeight:'bold',
                background: currentStyle===s?color+'33':'#0d0d1a',
                border:`2px solid ${currentStyle===s?color:'#3a3a5a'}`,
                color: currentStyle===s?color:'#666',
              }}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {fields.map(f=>(
          <label key={f.key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6}}>
            <span style={{fontSize:9,color:'#888'}}>{f.label}</span>
            <span style={{display:'flex',alignItems:'center',gap:4}}>
              <input
                value={pending[f.key]||''}
                onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChangeField(f.key,e.target.value) }}
                onKeyDown={e=>{ if(e.key!=='Escape'&&!e.ctrlKey&&!e.metaKey)e.stopPropagation(); if(e.key==='Enter') onApply() }}
                placeholder={liveValues&&liveValues[f.key]!=null?liveValues[f.key].toFixed(2):'0'}
                style={{
                  width:60,textAlign:'center',fontFamily:'monospace',fontSize:14,fontWeight:'bold',
                  background:'#0d0d1a',color: pending[f.key]?'#fff':'#888',
                  border:`2px solid ${toolColor}`,borderRadius:6,padding:'5px 4px',
                }}
              />
              <span style={{color:'#888',fontSize:10}}>{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <button
        onClick={onApply}
        style={{
          marginTop:8,width:'100%',padding:'6px 0',borderRadius:6,border:'none',
          background:toolColor,color:'#0d0d1a',
          fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:'pointer',
        }}>
        ✓ Apply
      </button>
      <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
        👉 Click a dot above to pick what stays put
      </div>
    </div>
  )
}

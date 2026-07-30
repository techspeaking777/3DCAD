// CopyModePanel.jsx — kid-friendly popover shown under Move/Rotate toolbar buttons.
// Lets a child see and click the Move/Rotate <-> Copy toggle and the copy count,
// while staying in sync with the same keyboard shortcuts (M/R, C, digits).
// A "Done Selecting" button replaces the hidden Tab/right-click gesture needed
// to move from "still picking entities" into the placement phase — selection
// count is open-ended here (unlike Fillet's fixed 2), so some explicit
// confirm step is unavoidable; this just makes it visible and clickable.
import React from 'react'

const stepBtnStyle={
  width:28,height:28,borderRadius:6,border:'2px solid #3a3a5a',background:'#2a2a4a',
  color:'#ccc',fontSize:16,fontWeight:'bold',cursor:'pointer',
  display:'flex',alignItems:'center',justifyContent:'center',
}

export default function CopyModePanel({toolColor, primaryKey, primaryLabel, primaryMode, mode, count, onSetMode, onSetCount, locked, selCount, accepted, onAccept, angleInput, angleLocked, onChangeAngle, onApplyAngle, liveAngleDeg}){
  const isCopy=mode==='copy'
  const n=Math.max(1,parseInt(count)||1)
  const showAngleBox = locked && angleInput!==undefined

  const dec=()=>{ if(locked||!isCopy) return; onSetCount(Math.max(1,n-1)) }
  const inc=()=>{ if(locked) return; if(!isCopy) onSetMode('copy'); else onSetCount(Math.min(100,n+1)) }

  const keycapStyle=(active)=>({
    width:44,height:44,borderRadius:8,
    display:'flex',alignItems:'center',justifyContent:'center',
    fontFamily:'monospace',fontWeight:'bold',fontSize:20,
    background:active?toolColor:'#2a2a4a',
    color:active?'#0d0d1a':'#666',
    border:`2px solid ${active?toolColor:'#3a3a5a'}`,
    boxShadow:active?`0 0 12px ${toolColor}aa`:'none',
    transform:active?'scale(1.08)':'scale(1)',
    transition:'all 0.15s',
    cursor:locked?'default':'pointer',
  })

  return (
    <div style={{
      position:'absolute',top:'100%',left:0,marginTop:10,
      background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
      padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
      zIndex:50,width:210,fontFamily:'monospace',
    }}>
      {/* pointer arrow back to the toolbar button */}
      <div style={{position:'absolute',top:-9,left:24,width:0,height:0,
        borderLeft:'8px solid transparent',borderRight:'8px solid transparent',
        borderBottom:`9px solid ${toolColor}`}}/>

      {!accepted && (
        <>
          <div style={{textAlign:'center',color:'#888',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>
            {selCount>0 ? `${selCount} Selected` : 'Click or Drag to Select'}
          </div>
          <button
            onClick={()=>{ if(selCount>0) onAccept() }}
            style={{
              width:'100%',padding:'6px 0',borderRadius:6,border:'none',marginBottom:10,
              background:selCount>0?toolColor:'#2a2a4a',color:selCount>0?'#0d0d1a':'#666',
              fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:selCount>0?'pointer':'default',
            }}>
            ✓ Done Selecting
          </button>
          <div style={{height:1,background:'#2a2a4a',margin:'0 0 10px'}}/>
        </>
      )}

      <div style={{opacity:locked?0.55:1, transition:'opacity 0.15s'}}>
        <div style={{textAlign:'center',color:'#888',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>
          {isCopy?`Making ${n} ${n===1?'Copy':'Copies'}`:`${primaryLabel} Mode`}
        </div>

        <div style={{display:'flex',gap:10,justifyContent:'center'}}>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
            <span style={{fontSize:9,color:!isCopy?toolColor:'#666',fontWeight:'bold'}}>{primaryLabel.toUpperCase()}</span>
            <button disabled={locked} onClick={()=>onSetMode(primaryMode)} style={keycapStyle(!isCopy)}>{primaryKey}</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
            <span style={{fontSize:9,color:isCopy?toolColor:'#666',fontWeight:'bold'}}>COPY</span>
            <button disabled={locked} onClick={()=>onSetMode('copy')} style={keycapStyle(isCopy)}>C</button>
          </div>
        </div>

        <div style={{height:1,background:'#2a2a4a',margin:'10px 0'}}/>

        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,opacity:isCopy?1:0.35}}>
          <span style={{fontSize:9,color:isCopy?'#aaa':'#555',fontWeight:'bold',letterSpacing:'0.05em'}}>NUMBER</span>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <button disabled={locked||!isCopy} onClick={dec} style={stepBtnStyle}>−</button>
            <div style={{width:48,height:36,borderRadius:6,background:'#0d0d1a',
              border:`2px solid ${isCopy?toolColor:'#3a3a5a'}`,display:'flex',alignItems:'center',justifyContent:'center',
              color:isCopy?'#fff':'#555',fontSize:18,fontWeight:'bold'}}>
              {n}
            </div>
            <button disabled={locked} onClick={inc} style={stepBtnStyle}>+</button>
          </div>
        </div>

        {!locked && (
          <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
            {isCopy?`👉 Click where to put ${n>1?'them':'it'}`:`👉 Press ${primaryKey} or C, or click above`}
          </div>
        )}
      </div>

      {showAngleBox && (
        <>
          <div style={{height:1,background:'#2a2a4a',margin:'10px 0'}}/>
          <div style={{textAlign:'center',color:angleLocked?'#FF9800':'#888',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>
            {angleLocked?'🔒 ':''}Angle
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
            <input
              value={angleInput}
              onChange={e=>{ if(/^-?[0-9.]*$/.test(e.target.value)) onChangeAngle(e.target.value) }}
              onKeyDown={e=>{ e.stopPropagation(); if(e.key==='Enter') onApplyAngle() }}
              placeholder={liveAngleDeg!=null?liveAngleDeg.toFixed(1):'0'}
              style={{
                width:70,textAlign:'center',fontFamily:'monospace',fontSize:16,fontWeight:'bold',
                background:'#0d0d1a',color: angleLocked?'#FF9800':angleInput?'#fff':'#888',
                border:`2px solid ${angleLocked?'#FF9800':toolColor}`,borderRadius:6,
                padding:'6px 4px',
              }}
            />
            <span style={{color:'#888',fontSize:11}}>°</span>
          </div>
          <button
            onClick={onApplyAngle}
            style={{
              marginTop:8,width:'100%',padding:'6px 0',borderRadius:6,border:'none',
              background:angleInput?toolColor:'#2a2a4a',color:angleInput?'#0d0d1a':'#666',
              fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:'pointer',
            }}>
            ✓ Lock It In
          </button>
          <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
            👉 Now click the canvas to place it
          </div>
        </>
      )}
    </div>
  )
}

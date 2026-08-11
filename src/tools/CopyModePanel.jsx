// CopyModePanel.jsx — kid-friendly popover shown under Move/Rotate toolbar buttons.
// Lets a child see and click the Move/Rotate <-> Copy toggle and the copy count,
// while staying in sync with the same keyboard shortcuts (M/R, C, digits).
// A "Done Selecting" button replaces the hidden Tab/right-click gesture needed
// to move from "still picking entities" into the placement phase — selection
// count is open-ended here (unlike Fillet's fixed 2), so some explicit
// confirm step is unavoidable; this just makes it visible and clickable.
import React, { useEffect, useRef } from 'react'
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

const stepBtnStyle={
  width:28,height:28,borderRadius:6,border:'2px solid #3a3a5a',background:'#2a2a4a',
  color:'#ccc',fontSize:16,fontWeight:'bold',cursor:'pointer',
  display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'auto',
}

export default function CopyModePanel({toolColor, primaryKey, primaryLabel, primaryMode, mode, count, onSetMode, onSetCount, locked, selCount, accepted, onAccept, dimInput, dimLocked, onChangeDim, angleInput, angleLocked, onChangeAngle, onApplyLock, liveDistMm, liveAngleDeg}){
  const isCopy=mode==='copy'
  const n=Math.max(1,parseInt(count)||1)
  const showDistBox = locked && dimInput!==undefined
  const showAngleBox = locked && angleInput!==undefined
  const canApply = (showDistBox&&dimInput&&parseFloat(dimInput)>0) || (showAngleBox&&angleInput&&parseFloat(angleInput)>=0)

  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  const distRef = useRef(null)
  const angleRef = useRef(null)

  // Focus the first available box the moment the pivot/start point lands.
  useEffect(()=>{ if (showDistBox) distRef.current?.focus(); else if (showAngleBox) angleRef.current?.focus() }, [locked])

  // Tab cycles focus between whichever of Distance/Direction boxes are
  // shown. The actual locking happens in the app's global keydown handler
  // (same one the Line tool uses) — the inputs below deliberately don't
  // stopPropagation on Tab/Escape so that handler still sees the keystroke.
  // This capture-phase handler only moves the visible focus, same split
  // as LineSnapPanel.jsx.
  function handleTabCapture(e){
    if (e.key!=='Tab') return
    const order=[showDistBox?distRef.current:null, showAngleBox?angleRef.current:null].filter(Boolean)
    if (order.length<2) return
    const idx=order.indexOf(document.activeElement)
    if (idx===-1) return
    e.preventDefault()
    const dir=e.shiftKey?-1:1
    const next=(idx+dir+order.length)%order.length
    order[next]?.focus()
  }

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
    pointerEvents:'auto',
  })

  // pointerEvents:'none' on the outer shell lets clicks on its background/
  // padding/labels fall through to the canvas underneath — important once
  // angle is locked, since "click the canvas to place it" can land anywhere,
  // including the area this panel visually covers. Each actual control
  // below re-enables pointerEvents:'auto' so it still works normally.
  return (
    <div ref={panelRef} onKeyDownCapture={handleTabCapture} style={{
      position:'absolute',top:'100%',left:0,marginTop:10,
      background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
      padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
      zIndex:50,width:210,fontFamily:'monospace',pointerEvents:'none',...panelStyle,
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
              width:'100%',padding:'6px 0',borderRadius:6,border:'none',marginBottom:10,
              background:selCount>0?toolColor:'#2a2a4a',color:selCount>0?'#0d0d1a':'#666',
              fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:selCount>0?'pointer':'default',
              pointerEvents:'auto',
            }}>
            ✓ Done Selecting
          </button>
          <div style={{height:1,background:'#2a2a4a',margin:'0 0 10px'}}/>
        </>
      )}

      <div style={{opacity:locked?0.55:1, transition:'opacity 0.15s'}}>
        <DragHandle {...handleProps}>{isCopy?`Making ${n} ${n===1?'Copy':'Copies'}`:`${primaryLabel} Mode`}</DragHandle>

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

      {(showDistBox||showAngleBox) && (
        <>
          <div style={{height:1,background:'#2a2a4a',margin:'10px 0'}}/>

          {showDistBox && (
            <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6,marginBottom:showAngleBox?8:0}}>
              <span style={{fontSize:9,color:dimLocked?'#FF9800':'#888',fontWeight:'bold'}}>{dimLocked?'🔒 ':''}Distance</span>
              <span style={{display:'flex',alignItems:'center',gap:4}}>
                <input
                  ref={distRef}
                  value={dimInput}
                  onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChangeDim(e.target.value) }}
                  onKeyDown={e=>{ if(e.key!=='Tab'&&e.key!=='Escape'&&!e.ctrlKey&&!e.metaKey)e.stopPropagation(); if(e.key==='Enter') onApplyLock() }}
                  placeholder={liveDistMm!=null?liveDistMm.toFixed(1):'0'}
                  style={{
                    width:64,textAlign:'center',fontFamily:'monospace',fontSize:14,fontWeight:'bold',
                    background:'#0d0d1a',color: dimLocked?'#FF9800':dimInput?'#fff':'#888',
                    border:`2px solid ${dimLocked?'#FF9800':toolColor}`,borderRadius:6,
                    padding:'5px 4px',pointerEvents:'auto',
                  }}
                />
                <span style={{color:'#888',fontSize:10}}>mm</span>
              </span>
            </label>
          )}

          {showAngleBox && (
            <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6}}>
              <span style={{fontSize:9,color:angleLocked?'#FF9800':'#888',fontWeight:'bold'}}>{angleLocked?'🔒 ':''}{primaryMode==='rotate'?'Angle':'Direction'}</span>
              <span style={{display:'flex',alignItems:'center',gap:4}}>
                <input
                  ref={angleRef}
                  value={angleInput}
                  onChange={e=>{ if(/^-?[0-9.]*$/.test(e.target.value)) onChangeAngle(e.target.value) }}
                  onKeyDown={e=>{ if(e.key!=='Tab'&&e.key!=='Escape'&&!e.ctrlKey&&!e.metaKey)e.stopPropagation(); if(e.key==='Enter') onApplyLock() }}
                  placeholder={liveAngleDeg!=null?liveAngleDeg.toFixed(1):'0'}
                  style={{
                    width:64,textAlign:'center',fontFamily:'monospace',fontSize:14,fontWeight:'bold',
                    background:'#0d0d1a',color: angleLocked?'#FF9800':angleInput?'#fff':'#888',
                    border:`2px solid ${angleLocked?'#FF9800':toolColor}`,borderRadius:6,
                    padding:'5px 4px',pointerEvents:'auto',
                  }}
                />
                <span style={{color:'#888',fontSize:10}}>°</span>
              </span>
            </label>
          )}

          <button
            onClick={()=>{ if(canApply) onApplyLock() }}
            style={{
              marginTop:8,width:'100%',padding:'6px 0',borderRadius:6,border:'none',
              background:canApply?toolColor:'#2a2a4a',color:canApply?'#0d0d1a':'#666',
              fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:canApply?'pointer':'default',
              pointerEvents:'auto',
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

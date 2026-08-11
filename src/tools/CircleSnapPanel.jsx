// CircleSnapPanel.jsx — kid-friendly popover shown next to the Circle toolbar button.
// Section 1: Tangent (T) snap toggle, always shown.
// Section 2: once a centre is placed (or both tangent circles are picked),
// a real Radius input box appears. Typing + Lock It In only sets that value —
// placing the actual circle still requires a click on the canvas.
import { useEffect, useRef } from 'react'
import { useDraggablePanel, DragHandle } from './useDraggablePanel.jsx'

export default function CircleSnapPanel({
  toolColor, tKeyDown, onToggleT, circleTanA, circleTanB,
  circleCenter, dimInput, dimLocked, onChangeDim, onApply, liveRadiusMm,
}){
  const { panelRef, panelStyle, handleProps } = useDraggablePanel()
  const dimRef = useRef(null)
  const drawing = !!circleCenter || (!!circleTanA && !!circleTanB)

  useEffect(()=>{ if (drawing) dimRef.current?.focus() }, [drawing])

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
    cursor:'pointer',
  })

  const label = circleTanA&&circleTanB?'Adjust the Size':circleTanA?'Pick 2nd Circle':tKeyDown?'Tangent Mode':'Circle'

  let tip
  if (circleTanA&&circleTanB) tip='👉 Now click the canvas to place it'
  else if (circleTanA) tip='👉 Click a different circle\'s edge'
  else if (circleCenter) tip='👉 Now click the canvas to place it'
  else if (tKeyDown) tip='👉 Click a circle\'s edge'
  else tip='👉 Click T to touch other circles'

  const canApply = dimInput&&parseFloat(dimInput)>0

  return (
    <div ref={panelRef} style={{
      position:'absolute',top:0,left:'100%',marginLeft:10,
      background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
      padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
      zIndex:50,width:150,fontFamily:'monospace',...panelStyle,
    }}>
      {/* pointer arrow back to the toolbar button */}
      <div style={{position:'absolute',top:18,left:-9,width:0,height:0,
        borderTop:'8px solid transparent',borderBottom:'8px solid transparent',
        borderRight:`9px solid ${toolColor}`}}/>

      <DragHandle {...handleProps}>{label}</DragHandle>

      <div style={{display:'flex',justifyContent:'center'}}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
          <span style={{fontSize:9,color:tKeyDown?toolColor:'#666',fontWeight:'bold'}}>TANGENT</span>
          <button onClick={onToggleT} style={keycapStyle(tKeyDown)}>T</button>
        </div>
      </div>

      {drawing && (
        <>
          <div style={{height:1,background:'#2a2a4a',margin:'10px 0'}}/>
          <div style={{textAlign:'center',color:'#888',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>
            Radius
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center'}}>
            <input
              ref={dimRef}
              value={dimInput}
              onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChangeDim(e.target.value) }}
              onKeyDown={e=>{ if(e.key!=='Tab'&&e.key!=='Escape'&&!e.ctrlKey&&!e.metaKey)e.stopPropagation(); if(e.key==='Enter') e.target.blur() }}
              placeholder={liveRadiusMm!=null?liveRadiusMm.toFixed(1):'0'}
              style={{
                width:70,textAlign:'center',fontFamily:'monospace',fontSize:16,fontWeight:'bold',
                background:'#0d0d1a',color: dimLocked?'#FF9800':dimInput?'#fff':'#888',
                border:`2px solid ${dimLocked?'#FF9800':toolColor}`,borderRadius:6,
                padding:'6px 4px',
              }}
            />
            <span style={{color:'#888',fontSize:11}}>mm</span>
          </div>

          <button
            onClick={onApply}
            style={{
              marginTop:8,width:'100%',padding:'6px 0',borderRadius:6,border:'none',
              background:canApply?toolColor:'#2a2a4a',color:canApply?'#0d0d1a':'#666',
              fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:'pointer',
            }}>
            ✓ Lock It In
          </button>
        </>
      )}

      <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
        {tip}
      </div>
    </div>
  )
}

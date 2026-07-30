// LineSnapPanel.jsx — kid-friendly popover shown next to the Line toolbar button.
// Section 1: Tangent (T) / Perpendicular (P) snap toggles, always shown.
// Section 2: once a start point is placed, real Length/Angle input boxes appear.
// Typing + Apply only LOCKS those values — you still click the canvas to draw
// the line, since the click is what actually places the endpoint (or, for a
// fully locked length+angle, confirms the already-fixed segment).
//
// Tab cycles through the panel's own controls in a closed loop (T → P →
// Length → Angle → Lock It In → back to T), rather than following the page's
// normal tab order out into the rest of the toolbar.
import { useEffect, useRef } from 'react'

export default function LineSnapPanel({
  toolColor, tKeyDown, pKeyDown, onToggleT, onToggleP,
  drawing, dimInput, angleInput, dimLocked, angleLocked,
  onChangeDim, onChangeAngle, onApply, liveLenMm, liveAngleDeg,
}){
  const tRef = useRef(null)
  const pRef = useRef(null)
  const dimRef = useRef(null)
  const angleRef = useRef(null)
  const applyRef = useRef(null)

  // Focus the Length box the moment the start point is placed.
  useEffect(()=>{ if (drawing) dimRef.current?.focus() }, [drawing])

  // Closed tab loop over whichever controls are currently visible.
  function handleTabCapture(e){
    if (e.key!=='Tab') return
    const order=[tRef.current, pRef.current]
    if (drawing){
      order.push(dimRef.current)
      if (!pKeyDown) order.push(angleRef.current)
      order.push(applyRef.current)
    }
    const idx=order.indexOf(document.activeElement)
    if (idx===-1) return
    e.preventDefault()
    const dir=e.shiftKey?-1:1
    const next=(idx+dir+order.length)%order.length
    order[next]?.focus()
  }

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

  const activeLabel = tKeyDown?'Tangent Mode':pKeyDown?'Perpendicular Mode':'Line'
  const canApply = (dimInput&&parseFloat(dimInput)>0) || (!pKeyDown&&angleInput&&parseFloat(angleInput)>=0)

  const fieldStyle = (locked) => ({
    width:56,textAlign:'center',fontFamily:'monospace',fontSize:14,fontWeight:'bold',
    background:'#0d0d1a',color: locked?'#FF9800':(dimInput||angleInput)?'#fff':'#888',
    border:`2px solid ${locked?'#FF9800':toolColor}`,borderRadius:6,padding:'5px 4px',
  })

  return (
    <div onKeyDownCapture={handleTabCapture} style={{
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
        {activeLabel}
      </div>

      <div style={{display:'flex',gap:10,justifyContent:'center'}}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
          <span style={{fontSize:9,color:tKeyDown?toolColor:'#666',fontWeight:'bold'}}>TANGENT</span>
          <button ref={tRef} onClick={onToggleT} style={keycapStyle(tKeyDown)}>T</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
          <span style={{fontSize:9,color:pKeyDown?toolColor:'#666',fontWeight:'bold'}}>PERP</span>
          <button ref={pRef} onClick={onToggleP} style={keycapStyle(pKeyDown)}>P</button>
        </div>
      </div>

      {!drawing && (
        <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
          {tKeyDown
            ? '👉 Click near a circle\'s edge'
            : pKeyDown
              ? '👉 Click a line to square off it'
              : '👉 Click T or P for special lines'}
        </div>
      )}

      {drawing && (
        <>
          <div style={{height:1,background:'#2a2a4a',margin:'10px 0'}}/>
          <div style={{textAlign:'center',color:'#888',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>
            {pKeyDown?'Length':'Length & Angle'}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6}}>
              <span style={{fontSize:9,color:dimLocked?'#FF9800':'#888'}}>{dimLocked?'🔒 ':''}Length</span>
              <span style={{display:'flex',alignItems:'center',gap:4}}>
                <input
                  ref={dimRef}
                  value={dimInput}
                  onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChangeDim(e.target.value) }}
                  onKeyDown={e=>{ if(e.key!=='Tab'&&e.key!=='Escape')e.stopPropagation(); if(e.key==='Enter') e.target.blur() }}
                  placeholder={liveLenMm!=null?liveLenMm.toFixed(1):'0'}
                  style={fieldStyle(dimLocked)}
                />
                <span style={{color:'#888',fontSize:10}}>mm</span>
              </span>
            </label>
            {!pKeyDown && (
              <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6}}>
                <span style={{fontSize:9,color:angleLocked?'#FF9800':'#888'}}>{angleLocked?'🔒 ':''}Angle</span>
                <span style={{display:'flex',alignItems:'center',gap:4}}>
                  <input
                    ref={angleRef}
                    value={angleInput}
                    onChange={e=>{ if(/^[0-9.]*$/.test(e.target.value)) onChangeAngle(e.target.value) }}
                    onKeyDown={e=>{ if(e.key!=='Tab'&&e.key!=='Escape')e.stopPropagation(); if(e.key==='Enter') e.target.blur() }}
                    placeholder={liveAngleDeg!=null?liveAngleDeg.toFixed(1):'0'}
                    style={fieldStyle(angleLocked)}
                  />
                  <span style={{color:'#888',fontSize:10}}>°</span>
                </span>
              </label>
            )}
          </div>

          <button
            ref={applyRef}
            onClick={()=>{ if(canApply) onApply() }}
            style={{
              marginTop:8,width:'100%',padding:'6px 0',borderRadius:6,border:'none',
              background:canApply?toolColor:'#2a2a4a',color:canApply?'#0d0d1a':'#666',
              fontFamily:'monospace',fontWeight:'bold',fontSize:12,cursor:canApply?'pointer':'default',
            }}>
            ✓ Lock It In
          </button>

          <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
            👉 Now click the canvas to draw it
          </div>
        </>
      )}
    </div>
  )
}

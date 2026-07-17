// SplineSnapPanel.jsx — kid-friendly popover shown next to the Spline toolbar button.
// Lets a child see and click the Open/Closed (C) toggle, while staying in sync
// with the same keyboard shortcut.
import React from 'react'

export default function SplineSnapPanel({toolColor, splineClosed, onToggleC, splinePoints}){
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

  const hasPoints = splinePoints && splinePoints.length>0
  const label = splineClosed?'Closed Loop':'Open Line'
  const tip = !hasPoints
    ? '👉 Click points, then C to loop'
    : splineClosed
      ? '👉 Dbl-click to finish (loops shut)'
      : '👉 Dbl-click to finish'

  return (
    <div style={{
      position:'absolute',top:0,left:'100%',marginLeft:10,
      background:'#14142a',border:`3px solid ${toolColor}`,borderRadius:10,
      padding:'10px 12px',boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
      zIndex:50,width:150,fontFamily:'monospace',
    }}>
      {/* pointer arrow back to the toolbar button */}
      <div style={{position:'absolute',top:18,left:-9,width:0,height:0,
        borderTop:'8px solid transparent',borderBottom:'8px solid transparent',
        borderRight:`9px solid ${toolColor}`}}/>

      <div style={{textAlign:'center',color:'#888',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>
        {label}
      </div>

      <div style={{display:'flex',justifyContent:'center'}}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
          <span style={{fontSize:9,color:splineClosed?toolColor:'#666',fontWeight:'bold'}}>CLOSE</span>
          <button onClick={onToggleC} style={keycapStyle(splineClosed)}>C</button>
        </div>
      </div>

      <div style={{marginTop:8,textAlign:'center',fontSize:9,color:'#666'}}>
        {tip}
      </div>
    </div>
  )
}

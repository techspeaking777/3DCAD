import { useState, useRef, useEffect, useCallback } from 'react'

// ── Bezier helpers ────────────────────────────────────────────────────────────
function cubicPt(p0,p1,p2,p3,t) {
  const mt=1-t
  return {
    x:mt*mt*mt*p0.x+3*mt*mt*t*p1.x+3*mt*t*t*p2.x+t*t*t*p3.x,
    y:mt*mt*mt*p0.y+3*mt*mt*t*p1.y+3*mt*t*t*p2.y+t*t*t*p3.y,
  }
}
function quadPt(p0,p1,p2,t) {
  const mt=1-t
  return {x:mt*mt*p0.x+2*mt*t*p1.x+t*t*p2.x,y:mt*mt*p0.y+2*mt*t*p1.y+t*t*p2.y}
}

// Convert opentype.js path commands → array of polyline contours
// Each contour: { points:[{x,y},...], closed:bool }
// samples: how many points per bezier curve segment
function pathToContours(commands, samples=12) {
  const contours=[]
  let pts=[], cx=0, cy=0
  for (const cmd of commands) {
    if (cmd.type==='M') {
      if (pts.length>=2) contours.push({points:pts,closed:false})
      pts=[{x:cmd.x,y:cmd.y}];cx=cmd.x;cy=cmd.y
    } else if (cmd.type==='L') {
      pts.push({x:cmd.x,y:cmd.y});cx=cmd.x;cy=cmd.y
    } else if (cmd.type==='C') {
      const p0={x:cx,y:cy},p1={x:cmd.x1,y:cmd.y1},p2={x:cmd.x2,y:cmd.y2},p3={x:cmd.x,y:cmd.y}
      for (let i=1;i<=samples;i++) pts.push(cubicPt(p0,p1,p2,p3,i/samples))
      cx=cmd.x;cy=cmd.y
    } else if (cmd.type==='Q') {
      const p0={x:cx,y:cy},p1={x:cmd.x1,y:cmd.y1},p2={x:cmd.x,y:cmd.y}
      for (let i=1;i<=samples;i++) pts.push(quadPt(p0,p1,p2,i/samples))
      cx=cmd.x;cy=cmd.y
    } else if (cmd.type==='Z') {
      if (pts.length>=2) contours.push({points:pts,closed:true})
      pts=[]
    }
  }
  if (pts.length>=2) contours.push({points:pts,closed:false})
  return contours
}

// ── Panel component ───────────────────────────────────────────────────────────
const PRESET_FONTS = [
  { label:'Roboto (sans)', url:'https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/roboto-latin-400-normal.woff' },
  { label:'Roboto Bold',   url:'https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/roboto-latin-700-normal.woff' },
  { label:'Roboto Mono',   url:'https://cdn.jsdelivr.net/npm/@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff' },
  { label:'Oswald',        url:'https://cdn.jsdelivr.net/npm/@fontsource/oswald/files/oswald-latin-400-normal.woff' },
  { label:'Upload TTF/OTF/WOFF…', url:null },
]

export default function TextPanel({ insertPt, onImport, onClose, mmToPx }) {
  const [text,setText]       = useState('RETRO CAD')
  const [fontSize,setFontSize]= useState(20)   // mm
  const [angle,setAngle]     = useState(0)     // degrees
  const [font,setFont]       = useState(null)
  const [fontLabel,setFontLabel] = useState('')
  const [loading,setLoading] = useState(false)
  const [error,setError]     = useState(null)
  const [samples,setSamples] = useState(12)    // bezier resolution
  const previewRef           = useRef(null)
  const fileInputRef         = useRef(null)

  // Load opentype.js from CDN on first use — no npm install needed
  const loadBuffer = useCallback(async (buffer, label) => {
    setLoading(true);setError(null)
    try {
      // Load from CDN if not already present
      if (!window.opentype) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js'
          s.onload = resolve
          s.onerror = () => reject(new Error('Could not load opentype.js from CDN'))
          document.head.appendChild(s)
        })
      }
      const f = window.opentype.parse(buffer)
      setFont(f);setFontLabel(label)
    } catch(e) {
      setError('Could not load font: '+e.message)
    }
    setLoading(false)
  },[])

  const loadFromFile = useCallback(async (file) => {
    const buf = await file.arrayBuffer()
    loadBuffer(buf, file.name.replace(/\.[^.]+$/,''))
  },[loadBuffer])

  const loadFromUrl = useCallback(async (url, label) => {
    setLoading(true);setError(null)
    try {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error('HTTP '+resp.status)
      const buf  = await resp.arrayBuffer()
      loadBuffer(buf, label)
    } catch(e) {
      setError('Download failed: '+e.message)
      setLoading(false)
    }
  },[loadBuffer])

  const handlePreset = useCallback((preset) => {
    if (!preset.url) { fileInputRef.current?.click(); return }
    loadFromUrl(preset.url, preset.label)
  },[loadFromUrl])

  // ── Preview canvas ──────────────────────────────────────────────────────
  useEffect(()=>{
    const canvas=previewRef.current
    if (!canvas||!font||!text.trim()) return
    const ctx=canvas.getContext('2d')
    ctx.clearRect(0,0,canvas.width,canvas.height)
    ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,canvas.width,canvas.height)

    // Scale text to fit preview
    const testPath=font.getPath(text,0,0,1000)
    const bb=testPath.getBoundingBox()
    const textW=bb.x2-bb.x1||100,textH=bb.y2-bb.y1||100
    const scaleW=(canvas.width-40)/textW,scaleH=(canvas.height-24)/textH
    const previewPx=Math.min(scaleW,scaleH)*900

    const path=font.getPath(text,20,canvas.height*0.78,previewPx)
    ctx.beginPath();path.draw(ctx)
    ctx.fillStyle='#ff9800';ctx.fill()
    ctx.strokeStyle='#ff9800';ctx.lineWidth=0.5;ctx.stroke()
  },[font,text,fontSize])

  // ── Import ──────────────────────────────────────────────────────────────
  const handleImport = useCallback(()=>{
    if (!font||!text.trim()||!insertPt) return
    const pxSize = mmToPx(fontSize)
    const path   = font.getPath(text,0,0,pxSize)
    const contours = pathToContours(path.commands, samples)

    const rad = angle * Math.PI / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)

    const newSplines = contours.map(c=>({
      points: c.points.map(p=>{
        // opentype.js path from getPath(text,0,0,size) gives canvas-space coords
        // (Y already points down). Rotate around origin then offset to insertPt.
        const rx = p.x*cos - p.y*sin
        const ry = p.x*sin + p.y*cos
        return { x: insertPt.x + rx, y: insertPt.y + ry }
      }),
      closed:   c.closed,
      polyline: true,
    }))

    onImport(newSplines)
  },[font,text,fontSize,angle,samples,insertPt,mmToPx,onImport])

  // ── UI ──────────────────────────────────────────────────────────────────
  const inputStyle={
    width:'100%',boxSizing:'border-box',
    background:'#2a2a2a',border:'1px solid #444',borderRadius:4,
    padding:'7px 10px',color:'white',fontSize:13,fontFamily:'monospace',
  }
  const labelStyle={fontSize:10,color:'#888',marginBottom:5,letterSpacing:'0.08em'}

  return (
    <div style={{
      position:'fixed',top:0,left:0,width:'100vw',height:'100vh',
      background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',
      justifyContent:'center',zIndex:1000
    }}>
      <div style={{
        background:'#1e1e1e',border:'1px solid #555',borderRadius:8,
        padding:24,width:500,color:'white',fontFamily:'monospace',
        boxShadow:'0 8px 40px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
          <span style={{fontSize:13,fontWeight:'bold',color:'#ff9800',letterSpacing:'0.1em'}}>
            TEXT → GEOMETRY
          </span>
          <button onClick={onClose}
            style={{background:'none',border:'none',color:'#888',cursor:'pointer',fontSize:20,lineHeight:1}}>×</button>
        </div>

        {/* Font picker */}
        <div style={{marginBottom:14}}>
          <div style={labelStyle}>FONT</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
            {PRESET_FONTS.map(p=>(
              <button key={p.label} onClick={()=>handlePreset(p)}
                style={{
                  background: fontLabel===p.label?'#ff9800':'#2a2a2a',
                  border:`1px solid ${fontLabel===p.label?'#ff9800':'#444'}`,
                  color: fontLabel===p.label?'#000':'#ccc',
                  borderRadius:4,padding:'5px 10px',cursor:'pointer',
                  fontSize:11,fontFamily:'monospace',
                }}>
                {p.label}
              </button>
            ))}
          </div>
          {loading&&<div style={{fontSize:11,color:'#888'}}>Loading font…</div>}
          {error  &&<div style={{fontSize:11,color:'#ef4444'}}>{error}</div>}
          {font&&!loading&&<div style={{fontSize:11,color:'#4ade80'}}>✓ {fontLabel}</div>}
          <input ref={fileInputRef} type="file" accept=".ttf,.otf,.woff"
            style={{display:'none'}}
            onChange={e=>e.target.files[0]&&loadFromFile(e.target.files[0])} />
        </div>

        {/* Text input */}
        <div style={{marginBottom:14}}>
          <div style={labelStyle}>TEXT</div>
          <input value={text} onChange={e=>setText(e.target.value)}
            placeholder="Type your text…"
            style={{...inputStyle,fontSize:15}} />
        </div>

        {/* Size / Angle / Resolution row */}
        <div style={{display:'flex',gap:10,marginBottom:14}}>
          <div style={{flex:1}}>
            <div style={labelStyle}>SIZE (mm)</div>
            <input type="number" value={fontSize} min={1} max={1000}
              onChange={e=>setFontSize(Math.max(1,parseFloat(e.target.value)||20))}
              style={inputStyle} />
          </div>
          <div style={{flex:1}}>
            <div style={labelStyle}>ANGLE (°)</div>
            <input type="number" value={angle} min={-360} max={360}
              onChange={e=>setAngle(parseFloat(e.target.value)||0)}
              style={inputStyle} />
          </div>
          <div style={{flex:1}}>
            <div style={labelStyle}>CURVE QUALITY</div>
            <select value={samples} onChange={e=>setSamples(+e.target.value)}
              style={{...inputStyle,cursor:'pointer'}}>
              <option value={6}>Fast (6)</option>
              <option value={12}>Normal (12)</option>
              <option value={20}>Fine (20)</option>
              <option value={32}>Ultra (32)</option>
            </select>
          </div>
        </div>

        {/* Preview */}
        <div style={{marginBottom:14}}>
          <div style={labelStyle}>PREVIEW</div>
          <canvas ref={previewRef} width={452} height={100}
            style={{width:'100%',background:'#1a1a2e',borderRadius:4,
              border:'1px solid #333',display:'block'}} />
          {!font&&<div style={{fontSize:11,color:'#555',marginTop:4,textAlign:'center'}}>
            Load a font to see preview
          </div>}
        </div>

        {/* Insert point status */}
        <div style={{
          fontSize:11,padding:'7px 12px',borderRadius:4,marginBottom:16,
          background:'#2a2a2a',
          color: insertPt?'#4ade80':'#f97316',
        }}>
          {insertPt
            ? '✓ Insert point set — click Import to place text in drawing'
            : 'Close this panel then click the canvas to set the insert point (text baseline start)'}
        </div>

        {/* Buttons */}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose}
            style={{background:'#2a2a2a',border:'1px solid #444',color:'#aaa',
              padding:'8px 18px',borderRadius:4,cursor:'pointer',fontSize:12}}>
            Cancel
          </button>
          <button onClick={handleImport}
            disabled={!font||!text.trim()||!insertPt}
            style={{
              background: font&&text.trim()&&insertPt?'#ff9800':'#333',
              border:'none',
              color: font&&text.trim()&&insertPt?'#000':'#555',
              padding:'8px 22px',borderRadius:4,
              cursor: font&&text.trim()&&insertPt?'pointer':'default',
              fontSize:12,fontWeight:'bold',letterSpacing:'0.05em',
            }}>
            IMPORT TO DRAWING →
          </button>
        </div>
      </div>
    </div>
  )
}

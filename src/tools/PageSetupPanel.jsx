import { useState, useEffect, useRef } from 'react'

// Paper sizes in mm [width, height] portrait
const PAPER_SIZES = {
  'A4':  [210, 297],
  'A3':  [297, 420],
  'A2':  [420, 594],
  'A1':  [594, 841],
  'A0':  [841, 1189],
  'Custom': [210, 297],
}

const SCALES = ['Fit to page', '1:1', '1:2', '1:5', '1:10', '1:20', '1:50', '1:100', '1:200', '1:500']

export default function PageSetupPanel({ lines, circles, arcs, splines, pxToMm, mmToPx, onClose }) {
  const [size, setSize]         = useState('A4')
  const [orientation, setOri]   = useState('landscape')
  const [margin, setMargin]     = useState('10')
  const [scale, setScale]       = useState('Fit to page')
  const [customW, setCustomW]   = useState('210')
  const [customH, setCustomH]   = useState('297')
  const [exporting, setExporting] = useState(false)
  const [status, setStatus]     = useState('')

  // Computed page dimensions in mm
  const getPageMm = () => {
    let [w, h] = size === 'Custom' ? [parseFloat(customW)||210, parseFloat(customH)||297] : PAPER_SIZES[size]
    if (orientation === 'landscape') [w, h] = [h, w]
    return { w, h }
  }

  const handleExport = async () => {
    setExporting(true)
    setStatus('Loading PDF library...')
    try {
      // Load jsPDF from CDN
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      setStatus('Generating PDF...')

      const { w: pageW, h: pageH } = getPageMm()
      const marginMm = parseFloat(margin) || 10
      const drawW = pageW - marginMm * 2
      const drawH = pageH - marginMm * 2

      // Gather all entity points to compute bounding box
      const allX = [], allY = []
      lines.forEach(l => { allX.push(l.x1,l.x2); allY.push(l.y1,l.y2) })
      circles.forEach(c => { allX.push(c.cx-c.r,c.cx+c.r); allY.push(c.cy-c.r,c.cy+c.r) })
      arcs.forEach(a => { allX.push(a.cx-a.r,a.cx+a.r); allY.push(a.cy-a.r,a.cy+a.r) })
      splines.forEach(sp => sp.points.forEach(p => { allX.push(p.x); allY.push(p.y) }))

      if (!allX.length) { setStatus('Nothing to export'); setExporting(false); return }

      const bx1=Math.min(...allX), by1=Math.min(...allY)
      const bx2=Math.max(...allX), by2=Math.max(...allY)
      const geomWpx=bx2-bx1, geomHpx=by2-by1
      const geomWmm=pxToMm(geomWpx), geomHmm=pxToMm(geomHpx)

      // Compute scale factor
      let sf // px-to-mm scale for output
      if (scale === 'Fit to page') {
        const sx = drawW / geomWmm
        const sy = drawH / geomHmm
        sf = Math.min(sx, sy)
      } else if (scale === '1:1') {
        sf = 1
      } else {
        const ratio = parseFloat(scale.split(':')[1]) || 1
        sf = 1 / ratio
      }

      // Origin offset so geometry is centred on page
      const scaledW = geomWmm * sf
      const scaledH = geomHmm * sf
      const ox = marginMm + (drawW - scaledW) / 2 - pxToMm(bx1) * sf
      const oy = marginMm + (drawH - scaledH) / 2 - pxToMm(by1) * sf

      // px to PDF mm
      const px2mm = (px) => pxToMm(px) * sf
      const tx = (px) => ox + px2mm(px)
      const ty = (py) => oy + px2mm(py)  // canvas Y is down, PDF Y is also down

      const { jsPDF } = window.jspdf
      const doc = new jsPDF({
        orientation: pageW > pageH ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageW, pageH],
      })

      // Style helpers
      const applyStyle = (entity, defaultLW) => {
        if (entity?.style === 'construction') {
          doc.setDrawColor(180, 180, 180)
          doc.setLineWidth(defaultLW * 0.5)
          doc.setLineDashPattern([], 0)
        } else if (entity?.style === 'dashed') {
          doc.setDrawColor(30, 30, 30)
          doc.setLineWidth(defaultLW)
          doc.setLineDashPattern([1.5, 1], 0)
        } else {
          doc.setDrawColor(30, 30, 30)
          doc.setLineWidth(defaultLW)
          doc.setLineDashPattern([], 0)
        }
      }

      const LW = 0.25

      // Draw lines
      lines.forEach(l => {
        applyStyle(l, LW)
        doc.line(tx(l.x1), ty(l.y1), tx(l.x2), ty(l.y2))
      })

      // Draw circles (as polyline approximation)
      circles.forEach(c => {
        applyStyle(c, LW)
        const N = Math.max(64, Math.ceil(2 * Math.PI * px2mm(c.r) / 0.2))
        const pts = []
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * 2 * Math.PI
          pts.push([tx(c.cx + c.r * Math.cos(a)), ty(c.cy + c.r * Math.sin(a))])
        }
        drawPolylinePDF(doc, pts)
      })

      // Draw arcs
      arcs.forEach(a => {
        applyStyle(a, LW)
        let span = ((a.endAngle - a.startAngle) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI)
        if (span < 0.001) span = 2 * Math.PI
        const N = Math.max(4, Math.ceil(span * px2mm(a.r) / 0.2))
        const pts = []
        for (let i = 0; i <= N; i++) {
          const ang = a.startAngle + (i / N) * span
          pts.push([tx(a.cx + a.r * Math.cos(ang)), ty(a.cy + a.r * Math.sin(ang))])
        }
        drawPolylinePDF(doc, pts)
      })

      // Draw splines (Catmull-Rom sampled)
      splines.forEach(sp => {
        if (sp.points.length < 2) return
        applyStyle(sp, LW)
        const pts = sampleSplineForPDF(sp)
        drawPolylinePDF(doc, pts.map(p => [tx(p.x), ty(p.y)]))
      })

      // Draw page border
      doc.setDrawColor(200, 200, 200)
      doc.setLineWidth(0.1)
      doc.setLineDashPattern([], 0)
      doc.rect(marginMm, marginMm, drawW, drawH)

      // Scale label
      doc.setFontSize(6)
      doc.setTextColor(150, 150, 150)
      const scaleLabel = scale === 'Fit to page'
        ? `Scale: 1:${(1/sf).toFixed(2)}`
        : `Scale: ${scale}`
      doc.text(scaleLabel, marginMm, pageH - marginMm / 2)

      doc.save('retro-cad-drawing.pdf')
      setStatus('PDF saved!')
      setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setStatus('Export failed: ' + err.message)
      console.error(err)
    }
    setExporting(false)
  }

  const { w: pageWmm, h: pageHmm } = getPageMm()

  const s = {
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 },
    panel:   { background:'#1e1e1e',borderRadius:8,padding:24,minWidth:320,maxWidth:400,color:'#eee',fontFamily:'monospace',fontSize:13,boxShadow:'0 8px 40px #000a' },
    row:     { display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,gap:8 },
    label:   { color:'#aaa',flexShrink:0,width:90 },
    select:  { background:'#2a2a2a',border:'1px solid #444',color:'#eee',borderRadius:4,padding:'4px 8px',flex:1,fontFamily:'monospace',fontSize:12 },
    input:   { background:'#2a2a2a',border:'1px solid #444',color:'#eee',borderRadius:4,padding:'4px 8px',width:70,fontFamily:'monospace',fontSize:12 },
    btn:     { background:'#2196F3',border:'none',color:'#fff',borderRadius:6,padding:'8px 18px',cursor:'pointer',fontFamily:'monospace',fontSize:13,fontWeight:'bold' },
    btnGrey: { background:'#333',border:'none',color:'#aaa',borderRadius:6,padding:'8px 18px',cursor:'pointer',fontFamily:'monospace',fontSize:13 },
    btnPDF:  { background:'#E53935',border:'none',color:'#fff',borderRadius:6,padding:'10px 24px',cursor:'pointer',fontFamily:'monospace',fontSize:14,fontWeight:'bold',width:'100%',marginTop:8 },
    radio:   { display:'flex',gap:12,alignItems:'center' },
    radioOpt:{ display:'flex',gap:4,alignItems:'center',cursor:'pointer' },
    divider: { borderTop:'1px solid #333',margin:'16px 0' },
    dim:     { color:'#64B5F6',fontSize:11,textAlign:'center',marginBottom:8 },
  }

  return (
    <div style={s.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={s.panel}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <span style={{fontSize:15,fontWeight:'bold',color:'#fff'}}>📄 Page Setup & Export</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#888',fontSize:18,cursor:'pointer'}}>✕</button>
        </div>

        {/* Paper size */}
        <div style={s.row}>
          <span style={s.label}>Paper size</span>
          <select style={s.select} value={size} onChange={e=>setSize(e.target.value)}>
            {Object.keys(PAPER_SIZES).map(k=><option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        {/* Custom dimensions */}
        {size==='Custom'&&<div style={s.row}>
          <span style={s.label}>W × H (mm)</span>
          <input style={s.input} value={customW} onChange={e=>setCustomW(e.target.value)} placeholder="210"/>
          <span style={{color:'#666'}}>×</span>
          <input style={s.input} value={customH} onChange={e=>setCustomH(e.target.value)} placeholder="297"/>
        </div>}

        {/* Orientation */}
        <div style={s.row}>
          <span style={s.label}>Orientation</span>
          <div style={s.radio}>
            {['portrait','landscape'].map(o=>(
              <label key={o} style={s.radioOpt}>
                <input type="radio" checked={orientation===o} onChange={()=>setOri(o)}/>
                {o.charAt(0).toUpperCase()+o.slice(1)}
              </label>
            ))}
          </div>
        </div>

        {/* Margin */}
        <div style={s.row}>
          <span style={s.label}>Margin (mm)</span>
          <input style={{...s.input,flex:1}} value={margin} onChange={e=>setMargin(e.target.value)} placeholder="10"/>
        </div>

        {/* Scale */}
        <div style={s.row}>
          <span style={s.label}>Scale</span>
          <select style={s.select} value={scale} onChange={e=>setScale(e.target.value)}>
            {SCALES.map(sc=><option key={sc} value={sc}>{sc}</option>)}
          </select>
        </div>

        {/* Page preview info */}
        <div style={s.dim}>{pageWmm} × {pageHmm} mm · margin {margin}mm</div>

        <div style={s.divider}/>

        {/* Export button */}
        <button style={{...s.btnPDF,opacity:exporting?0.6:1}} onClick={handleExport} disabled={exporting}>
          {exporting ? '⏳ Exporting...' : '⬇ Export PDF'}
        </button>

        {status&&<div style={{textAlign:'center',marginTop:8,color:status.includes('fail')?'#F44336':'#66BB6A',fontSize:12}}>{status}</div>}

        <div style={{display:'flex',gap:8,marginTop:12}}>
          <button style={s.btnGrey} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src; s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

function drawPolylinePDF(doc, pts) {
  if (pts.length < 2) return
  for (let i = 0; i < pts.length - 1; i++) {
    doc.line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
  }
}

function sampleSplineForPDF(sp) {
  if (sp.polyline || sp.points.length < 2) return sp.points
  const pts = sp.points, n = pts.length
  const ext = sp.closed
    ? [pts[n-1], ...pts, pts[0], pts[1]]
    : [pts[0], ...pts, pts[n-1]]
  const segs = sp.closed ? n : n - 1
  const result = []
  for (let i = 0; i < segs; i++) {
    const p0=ext[i],p1=ext[i+1],p2=ext[i+2],p3=ext[i+3]
    const N = 24
    for (let j = 0; j < N; j++) {
      const t=j/N,t2=t*t,t3=t2*t
      result.push({
        x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
      })
    }
  }
  result.push(sp.closed ? result[0] : pts[n-1])
  return result
}

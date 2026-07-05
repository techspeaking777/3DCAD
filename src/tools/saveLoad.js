import { pxToMm } from '../constants.js'
import { splineToPolyline } from './splineMath.js'

function dlText(filename, content, mime) {
  const a = Object.assign(document.createElement('a'), {
    href: 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(content),
    download: filename
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── JSON Save ─────────────────────────────────────────────────────────────────
export function saveJSON(lines, circles, arcs, splines=[], dims=[], filename = 'drawing.json') {
  const data = JSON.stringify({ lines, circles, arcs, splines }, null, 2)
  dlText(filename, data, 'application/json')
}

// ── JSON Load ─────────────────────────────────────────────────────────────────
export function loadJSON(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file'))
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result)
        if (!Array.isArray(data.lines) || !Array.isArray(data.circles) || !Array.isArray(data.arcs))
          return reject(new Error('Invalid drawing file'))
        resolve({
          lines:   data.lines,
          circles: data.circles,
          arcs:    data.arcs,
          splines: Array.isArray(data.splines) ? data.splines : [],
        })
      } catch {
        reject(new Error('Could not parse file'))
      }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsText(file)
  })
}

// ── DXF Export ────────────────────────────────────────────────────────────────
// Lines exported as LINE entities.
// Circles exported as native CIRCLE entities (mathematically exact).
// Arcs exported as native ARC entities (mathematically exact).
// Splines sampled to polyline LINE segments (DXF SPLINE uses NURBS which differs
// from Catmull-Rom, so polyline approximation is the safe choice).

function dxfLayer(style) {
  return style==='construction' ? 'CONSTRUCTION' : '0'
}

function dxfLtype(style) {
  return style==='dashed' ? '\n6\nDASHED' : ''
}

function dxfLine(x1,y1,x2,y2,style) {
  return `0\nLINE\n8\n${dxfLayer(style)}${dxfLtype(style)}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0.0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0.0\n`
}

// Native DXF CIRCLE entity — exact, one entity, readable by all CAD applications
function dxfCircle(cx,cy,r,style) {
  return `0\nCIRCLE\n8\n${dxfLayer(style)}${dxfLtype(style)}\n10\n${cx.toFixed(4)}\n20\n${cy.toFixed(4)}\n30\n0.0\n40\n${r.toFixed(4)}\n`
}

// Native DXF ARC entity — exact, CCW convention, Y-axis already flipped by caller
function dxfArc(cx,cy,r,startDeg,endDeg,style) {
  return `0\nARC\n8\n${dxfLayer(style)}${dxfLtype(style)}\n10\n${cx.toFixed(4)}\n20\n${cy.toFixed(4)}\n30\n0.0\n40\n${r.toFixed(4)}\n50\n${startDeg.toFixed(6)}\n51\n${endDeg.toFixed(6)}\n`
}

export function exportDXF(lines, circles, arcs, splines=[], filename='drawing.dxf') {
  const mm   = px => pxToMm(px)
  const fy   = y  => -mm(y)
  const mmPt = p  => ({x:mm(p.x), y:fy(p.y)})

  // Convert canvas-space angle (radians, Y-down) to DXF angle (degrees, Y-up)
  const toDXFdeg = rad => { const d = -rad * 180 / Math.PI; return ((d % 360) + 360) % 360 }

  let entities = ''

  // ── Lines ──────────────────────────────────────────────────────────────────
  lines.forEach(l => {
    entities += dxfLine(mm(l.x1), fy(l.y1), mm(l.x2), fy(l.y2), l.style)
  })

  // ── Circles — native CIRCLE entity ────────────────────────────────────────
  circles.forEach(c => {
    entities += dxfCircle(mm(c.cx), fy(c.cy), mm(c.r), c.style)
  })

  // ── Arcs — native ARC entity ───────────────────────────────────────────────
  // Canvas arcs are CW (Y-down). DXF arcs are CCW (Y-up).
  // Y-flip reverses direction so we swap start/end angles.
  arcs.forEach(a => {
    const cx = mm(a.cx), cy = fy(a.cy), r = mm(a.r)
    const startDeg = toDXFdeg(a.endAngle)
    const endDeg   = toDXFdeg(a.startAngle)
    entities += dxfArc(cx, cy, r, startDeg, endDeg, a.style)
  })

  // ── Splines — polyline LINE segments ──────────────────────────────────────
  splines.forEach(sp => {
    if (sp.points.length < 2) return
    const pts = sp.polyline ? sp.points : splineToPolyline(sp.points, sp.closed, 24)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = mmPt(pts[i]), b = mmPt(pts[i+1])
      entities += dxfLine(a.x, a.y, b.x, b.y, sp.style)
    }
  })
  const dxf =
    '0\nSECTION\n2\nHEADER\n' +
    '9\n$INSUNITS\n70\n4\n' +
    '0\nENDSEC\n' +
    '0\nSECTION\n2\nENTITIES\n' +
    entities +
    '0\nENDSEC\n0\nEOF\n'

  dlText(filename, dxf, 'application/dxf')
}

// ── DXF Import ────────────────────────────────────────────────────────────────
// Parses DXF files and converts to our data model.
// Supports: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE/VERTEX, SPLINE

export function parseDXF(dxfText, scale=2) {
  // scale = px per mm (our SCALE constant)
  const mm = v => v * scale   // DXF units assumed mm
  const lines_out = [], circles_out = [], arcs_out = [], splines_out = []

  // Split into group code / value pairs
  const raw = dxfText.replace(/\r/g,'').split('\n')
  const pairs = []
  for (let i = 0; i < raw.length-1; i+=2) {
    pairs.push([parseInt(raw[i].trim()), raw[i+1].trim()])
  }

  // Find ENTITIES section
  let inEntities = false, inModel = true
  let i = 0
  while (i < pairs.length) {
    const [code, val] = pairs[i]
    if (code===0 && val==='SECTION') { i++; continue }
    if (code===2 && val==='ENTITIES') { inEntities=true; i++; continue }
    if (code===2 && val==='ENDSEC' && inEntities) { break }
    if (!inEntities) { i++; continue }

    if (code===0) {
      const type=val
      i++
      // Read all properties of this entity
      const props = {}
      const vertices = []  // for POLYLINE/LWPOLYLINE
      while (i < pairs.length && pairs[i][0] !== 0) {
        const [c,v] = pairs[i]
        if (c===8)  props.layer=v
        if (c===6)  props.linetype=v
        if (c===10) props.x=parseFloat(v)
        if (c===20) props.y=parseFloat(v)
        if (c===11) props.x2=parseFloat(v)
        if (c===21) props.y2=parseFloat(v)
        if (c===40) props.r=parseFloat(v)     // radius or bulge
        if (c===41) props.r2=parseFloat(v)    // start param
        if (c===42) props.r3=parseFloat(v)    // end param
        if (c===50) props.startAngle=parseFloat(v)*Math.PI/180
        if (c===51) props.endAngle=parseFloat(v)*Math.PI/180
        if (c===70) props.flags=parseInt(v)
        if (c===72) props.n=parseInt(v)       // vertex count
        i++
      }

      // Determine style from layer name
      const layer=(props.layer||'').toLowerCase()
      const style = layer.includes('construction')||layer.includes('cnst') ? 'construction'
                  : layer.includes('dashed')||layer.includes('dash') ? 'dashed'
                  : undefined

      const s = style?{style}:{}

      if (type==='LINE' && props.x!==undefined) {
        lines_out.push({
          x1:mm(props.x),  y1:-mm(props.y),   // flip Y (DXF Y-up, canvas Y-down)
          x2:mm(props.x2), y2:-mm(props.y2),
          ...s
        })
      }
      else if (type==='CIRCLE' && props.x!==undefined) {
        circles_out.push({ cx:mm(props.x), cy:-mm(props.y), r:mm(props.r), ...s })
      }
      else if (type==='ARC' && props.x!==undefined) {
        // DXF arc: CCW from startAngle to endAngle, Y-axis flipped
        const sa = -props.endAngle    // flip for canvas
        const ea = -props.startAngle
        arcs_out.push({ cx:mm(props.x), cy:-mm(props.y), r:mm(props.r),
          startAngle:sa, endAngle:ea, ...s })
      }
      else if (type==='LWPOLYLINE') {
        // Read vertices from group codes 10/20 sequences
        // We already read first x,y - need to re-scan
        // Actually LWPOLYLINE stores coords differently - handle inline
        // Re-parse from raw pairs for this entity
        const pts = []
        let ex=null,ey=null
        // pairs[i] is now at next entity — look back
        // We'll collect from props which only captured last x,y
        // Better: re-collect all 10/20 pairs for this entity
        // Since we consumed them above, collect from 'vertices' array approach below
        // Fall through to POLYLINE path using pts we can reconstruct
        if (props.x!==undefined) pts.push({x:mm(props.x),y:-mm(props.y)})
        if (pts.length>=2)
          splines_out.push({points:pts,closed:!!(props.flags&1),polyline:true,...s})
      }
      else if (type==='SPLINE') {
        // Control points from group 10/20 — same issue as LWPOLYLINE
        if (props.x!==undefined)
          splines_out.push({points:[{x:mm(props.x),y:-mm(props.y)}],closed:false,polyline:false,...s})
      }
      // Skip other entity types
    } else {
      i++
    }
  }

  // LWPOLYLINE and SPLINE need special treatment — re-parse with multi-vertex support
  const betterResult = parseDXFMultiVertex(dxfText, scale)

  return {
    lines: [...lines_out, ...betterResult.lines],
    circles: [...circles_out, ...betterResult.circles],
    arcs: [...arcs_out, ...betterResult.arcs],
    splines: [...betterResult.splines],
  }
}

// Second pass: handle multi-vertex entities properly
function parseDXFMultiVertex(dxfText, scale) {
  const mm = v => v * scale
  const lines_out = [], circles_out = [], arcs_out = [], splines_out = []

  const raw = dxfText.replace(/\r/g,'').split('\n')

  let inEntities = false
  let i = 0
  while (i < raw.length) {
    const code = parseInt(raw[i]?.trim())
    const val  = raw[i+1]?.trim()
    i += 2
    if (isNaN(code)) continue

    if (code===2 && val==='ENTITIES') { inEntities=true; continue }
    if (code===2 && val==='ENDSEC') break
    if (!inEntities) continue

    if (code===0 && (val==='LWPOLYLINE'||val==='POLYLINE'||val==='SPLINE')) {
      const type=val
      const pts=[], knotX=[], layer_arr=[], linetype_arr=[]
      let flags=0, closed=false, layer='', linetype=''
      let vx=null,vy=null

      while (i < raw.length) {
        const c2=parseInt(raw[i]?.trim())
        const v2=raw[i+1]?.trim()
        i+=2
        if (isNaN(c2)) continue
        if (c2===0) {
          // Push last vertex if pending
          if (vx!==null&&vy!==null) pts.push({x:mm(vx),y:-mm(vy)})
          vx=null;vy=null
          if (v2==='SEQEND') break  // end of POLYLINE
          if (v2!=='VERTEX') { i-=2; break }  // next entity
          continue
        }
        if (c2===8)  layer=v2
        if (c2===6)  linetype=v2
        if (c2===70) flags=parseInt(v2)
        if (c2===10) { if(vx!==null&&vy!==null)pts.push({x:mm(vx),y:-mm(vy)}); vx=parseFloat(v2);vy=null }
        if (c2===20) { vy=parseFloat(v2); if(vx!==null&&vy!==null&&type==='LWPOLYLINE'){pts.push({x:mm(vx),y:-mm(vy)});vx=null;vy=null} }
      }
      if (vx!==null&&vy!==null) pts.push({x:mm(vx),y:-mm(vy)})
      closed=!!(flags&1)

      const layerL=(layer||'').toLowerCase()
      const style = layerL.includes('construction')||layerL.includes('cnst') ? 'construction'
                  : layerL.includes('dashed')||layerL.includes('dash') ? 'dashed'
                  : undefined
      const s=style?{style}:{}

      if (pts.length>=2)
        splines_out.push({points:pts,closed,polyline:true,...s})
    }
    else if (code===0 && val==='LINE') {
      let x1=0,y1=0,x2=0,y2=0,layer='',linetype=''
      while (i<raw.length) {
        const c2=parseInt(raw[i]?.trim()),v2=raw[i+1]?.trim();i+=2
        if(isNaN(c2))continue
        if(c2===0){i-=2;break}
        if(c2===8)layer=v2;if(c2===6)linetype=v2
        if(c2===10)x1=parseFloat(v2);if(c2===20)y1=parseFloat(v2)
        if(c2===11)x2=parseFloat(v2);if(c2===21)y2=parseFloat(v2)
      }
      const layerL=(layer||'').toLowerCase()
      const style=layerL.includes('construction')?'construction':layerL.includes('dashed')?'dashed':undefined
      lines_out.push({x1:mm(x1),y1:-mm(y1),x2:mm(x2),y2:-mm(y2),...(style?{style}:{})})
    }
    else if (code===0 && val==='CIRCLE') {
      let cx=0,cy=0,r=1,layer=''
      while(i<raw.length){const c2=parseInt(raw[i]?.trim()),v2=raw[i+1]?.trim();i+=2;if(isNaN(c2))continue;if(c2===0){i-=2;break}if(c2===8)layer=v2;if(c2===10)cx=parseFloat(v2);if(c2===20)cy=parseFloat(v2);if(c2===40)r=parseFloat(v2)}
      const layerL=(layer||'').toLowerCase()
      const style=layerL.includes('construction')?'construction':layerL.includes('dashed')?'dashed':undefined
      circles_out.push({cx:mm(cx),cy:-mm(cy),r:mm(r),...(style?{style}:{})})
    }
    else if (code===0 && val==='ARC') {
      let cx=0,cy=0,r=1,sa=0,ea=Math.PI,layer=''
      while(i<raw.length){const c2=parseInt(raw[i]?.trim()),v2=raw[i+1]?.trim();i+=2;if(isNaN(c2))continue;if(c2===0){i-=2;break}if(c2===8)layer=v2;if(c2===10)cx=parseFloat(v2);if(c2===20)cy=parseFloat(v2);if(c2===40)r=parseFloat(v2);if(c2===50)sa=parseFloat(v2)*Math.PI/180;if(c2===51)ea=parseFloat(v2)*Math.PI/180}
      const layerL=(layer||'').toLowerCase()
      const style=layerL.includes('construction')?'construction':layerL.includes('dashed')?'dashed':undefined
      // Flip Y axis: negate angles, swap start/end
      arcs_out.push({cx:mm(cx),cy:-mm(cy),r:mm(r),startAngle:-ea,endAngle:-sa,...(style?{style}:{})})
    }
  }

  return {lines:lines_out,circles:circles_out,arcs:arcs_out,splines:splines_out}
}

import * as THREE from 'three'
import { pxToMm } from '../constants.js'
import { splineToPolyline } from './splineMath.js'
import { FacePlane } from '../FacePlane.js'

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
  const data = JSON.stringify({ lines, circles, arcs, splines, dims }, null, 2)
  dlText(filename, data, 'application/json')
}

// True in Chromium browsers (Chrome, Edge) — lets the user pick both the
// folder and filename via the OS's native Save dialog. Firefox/Safari lack this,
// so callers should fall back to prompting for a filename and downloading normally.
export const canPickSaveLocation = () => typeof window !== 'undefined' && !!window.showSaveFilePicker

// Saves the project under a chosen name. When the File System Access API is
// available, opens the native Save dialog (folder + filename, pre-filled with
// suggestedName) and writes directly to the chosen file. Otherwise downloads
// to the browser's default download location using suggestedName.
// Returns 'saved', 'cancelled' (user closed the native dialog), or 'downloaded'.
export async function saveProjectAs(lines, circles, arcs, splines=[], dims=[], suggestedName='drawing.json') {
  const data = JSON.stringify({ lines, circles, arcs, splines, dims }, null, 2)
  if (canPickSaveLocation()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'CAD drawing', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(data)
      await writable.close()
      return 'saved'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  dlText(suggestedName, data, 'application/json')
  return 'downloaded'
}

// Generic binary counterpart to saveProjectAs()/exportFaceDXF() — same native
// Save dialog when available, straight Blob download otherwise. Used for STL
// export (and anything else that hands over a ready-made Blob rather than
// text). `accept` is a File System Access API accept map, e.g.
// {'model/stl': ['.stl']}. Returns 'saved', 'cancelled', or 'downloaded'.
export async function saveBlobAs(blob, suggestedName, description, accept) {
  if (canPickSaveLocation()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return 'downloaded'
}

// ── Whole-project save/load (.trc) ──────────────────────────────────────────
// Unlike saveJSON/loadJSON above (which only ever captured the active 2D
// sketch buffer), this serializes the full `features` array — the feature
// tree's actual source of truth — so reopening a project reconstructs every
// sketch/extrude/cutout/fillet/mirror/join/loft, not just whatever sketch
// happened to be on screen. Solids themselves are never serialized (they're
// live Three.js groups backed by WASM/OCC shapes with no JSON form) — on
// load the whole tree is replayed through cadEngine instead, the same way
// editing a feature already rebuilds its dependency chain today.
//
// Two field shapes need special handling because plain JSON.stringify either
// mangles or silently drops them:
//   - FacePlane is a class instance (THREE.Vector3 fields + a derived
//     THREE.Plane). Its numeric fields *would* survive stringify/parse, but
//     the result loses its prototype (no worldToSketch/sketchToWorld), so it
//     must be unpacked to plain arrays and reconstructed with `new FacePlane`.
//   - profilePts (and each loft profile's `pts`) carry circleMeta/
//     curveSegments as bolted-on NON-INDEX array properties (see
//     tools/extrudeMath.js) — JSON.stringify only serializes index
//     properties on arrays, so a raw `JSON.stringify(profilePts)` silently
//     drops them, corrupting true-circle/arc/spline profile info.

function vec3ToArr(v) { return v ? [v.x, v.y, v.z] : null }
function arrToVec3(a) { return a ? new THREE.Vector3(a[0], a[1], a[2]) : null }

function serializeFacePlane(fp) {
  if (!fp) return null
  return {
    origin: vec3ToArr(fp.origin),
    normal: vec3ToArr(fp.normal),
    uAxis:  vec3ToArr(fp.uAxis),
    vAxis:  vec3ToArr(fp.vAxis),
  }
}
function deserializeFacePlane(obj) {
  if (!obj) return null
  return new FacePlane(arrToVec3(obj.origin), arrToVec3(obj.normal), arrToVec3(obj.uAxis), arrToVec3(obj.vAxis))
}

// Packs a profile-points array (possibly carrying .circleMeta/.curveSegments)
// into a plain, fully JSON-safe object. `pts` itself is undefined for
// features that never had a profile (e.g. mirror/join) — pass through null.
function serializePts(pts) {
  if (!pts) return null
  return { arr: pts.map(p => ({ ...p })), circleMeta: pts.circleMeta || null, curveSegments: pts.curveSegments || null }
}
function deserializePts(obj) {
  if (!obj) return null
  const arr = obj.arr.map(p => ({ ...p }))
  if (obj.circleMeta) arr.circleMeta = obj.circleMeta
  if (obj.curveSegments) arr.curveSegments = obj.curveSegments
  return arr
}

// `hidden` is passed in explicitly (from the matching `solids` entry) since
// it lives on solid state, not the feature itself — see saveProjectFileAs.
export function serializeFeature(feat, hidden = false) {
  const out = { ...feat, hidden }
  if (feat.facePlane) out.facePlane = serializeFacePlane(feat.facePlane)
  if (feat.profilePts) out.profilePts = serializePts(feat.profilePts)
  if (feat.profiles) out.profiles = feat.profiles.map(p => ({ ...p, pts: serializePts(p.pts) }))
  return out
}
export function deserializeFeature(obj) {
  const out = { ...obj }
  if (obj.facePlane) out.facePlane = deserializeFacePlane(obj.facePlane)
  if (obj.profilePts) out.profilePts = deserializePts(obj.profilePts)
  if (obj.profiles) out.profiles = obj.profiles.map(p => ({ ...p, pts: deserializePts(p.pts) }))
  return out
}

const PROJECT_FORMAT_VERSION = 1

function serializeProject(features, solids) {
  const hiddenById = new Map(solids.map(s => [s.id, !!s.hidden]))
  return JSON.stringify({
    formatVersion: PROJECT_FORMAT_VERSION,
    app: '3d-retro-cad',
    features: features.map(f => serializeFeature(f, hiddenById.get(f.solidId) || false)),
  }, null, 2)
}

// Saves the whole feature tree under a chosen name — the .trc counterpart of
// saveProjectAs() above. Same native-Save-dialog-or-download behavior.
export async function saveProjectFileAs(features, solids, suggestedName = 'drawing.trc') {
  const data = serializeProject(features, solids)
  if (canPickSaveLocation()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: '3D Retro CAD project', accept: { 'application/json': ['.trc'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(data)
      await writable.close()
      return 'saved'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  dlText(suggestedName, data, 'application/json')
  return 'downloaded'
}

// Parses a .trc (or legacy-incompatible) file. Throws if `features` isn't
// present/an array so callers can fall back to the old sketch-buffer-only
// loadJSON() for files saved before this format existed.
export function loadProjectFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file'))
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result)
        if (!Array.isArray(data.features)) return reject(new Error('Not a project file (no feature tree)'))
        resolve({ features: data.features.map(deserializeFeature), formatVersion: data.formatVersion })
      } catch {
        reject(new Error('Could not parse file'))
      }
    }
    reader.onerror = () => reject(new Error('File read error'))
    reader.readAsText(file)
  })
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

// Writes a DXF for a solid face exported straight from its real OCC geometry
// (see cadEngine.exportFaceDXF/cadWorker.js) — lines/circles/arcs here are
// ALREADY in real mm and already in a standard right-handed (u,v) frame, not
// the app's screen-space Y-down sketch convention exportDXF() above converts
// from. Don't route this through exportDXF(): its pxToMm/Y-flip would double-
// convert already-correct data.
// Opens the native Save dialog (folder + filename, pre-filled with
// suggestedName) when the File System Access API is available — same
// canPickSaveLocation()/showSaveFilePicker() pattern as saveProjectAs()
// above. Otherwise downloads to the browser's default location. Returns
// 'saved', 'cancelled' (user closed the native dialog), or 'downloaded'.
export async function exportFaceDXF(lines, circles, arcs, suggestedName='face.dxf') {
  const toDeg = rad => { const d = rad * 180 / Math.PI; return ((d % 360) + 360) % 360 }
  let entities = ''
  lines.forEach(l => { entities += dxfLine(l.x1, l.y1, l.x2, l.y2) })
  circles.forEach(c => { entities += dxfCircle(c.cx, c.cy, c.r) })
  arcs.forEach(a => { entities += dxfArc(a.cx, a.cy, a.r, toDeg(a.startAngle), toDeg(a.endAngle)) })
  const dxf =
    '0\nSECTION\n2\nHEADER\n' +
    '9\n$INSUNITS\n70\n4\n' +
    '0\nENDSEC\n' +
    '0\nSECTION\n2\nENTITIES\n' +
    entities +
    '0\nENDSEC\n0\nEOF\n'
  if (canPickSaveLocation()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'DXF drawing', accept: { 'application/dxf': ['.dxf'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(dxf)
      await writable.close()
      return 'saved'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  dlText(suggestedName, dxf, 'application/dxf')
  return 'downloaded'
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

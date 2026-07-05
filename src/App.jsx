import { useState, useRef, useEffect, useCallback } from 'react'
import { pxToMm, mmToPx, ALIGN_SNAP_DIST, ACQUIRE_DIST, SELECT_DIST, norm2pi, zoomRef } from './constants.js'
import { angleOnArc, computeAllIntersections } from './geometry/intersections.js'
import { getGeoSnap, getAllSnapPoints, checkAngle, getAngleSnap, applyTracking, computeLiveAngle, getTanPtsOnCircle, getExternalTangentPairs, nearestPt } from './geometry/snap.js'
import { computeTrimPreview, performTrim, computeDeletePreview, distToSeg } from './tools/trimDelete.js'
import { nearestOffsetEntity, computeOffsetPreview, distToEntity } from './tools/offsetMath.js'
import { nearestMirrorEntity, buildMirror } from './tools/mirrorMath.js'
import { nearestMoveCopyEntity, buildCopies, removeSelected } from './tools/moveCopyMath.js'
import { nearestRotateCopyEntity, rotatePoint, buildRotatedCopies } from './tools/rotateCopyMath.js'
import { nearestScaleEntity, buildScaled } from './tools/scaleMath.js'
import { nearestFilletLine, computeFillet } from './tools/filletMath.js'
import { computeExtendPreview } from './tools/extendMath.js'
import { sampleSpline, nearestSpline, computeSplineTrimPreview, performSplineTrim, distToSpline } from './tools/splineMath.js'
import { selectionBBox, getBBoxHandles, hitTestHandles, computeHandleTransform, applySelectionTransform } from './tools/selectMath.js'
import { drawLineIndicator, drawHVIndicator, drawTracks, drawLabel, drawPreviewLine } from './draw/drawHelpers.js'
import { useHistory } from './tools/history.js'
import { saveJSON, loadJSON, exportDXF, parseDXF } from './tools/saveLoad.js'
import TracerPanel from './tools/TracerPanel.jsx'
import TextPanel from './tools/TextPanel.jsx'
import PageSetupPanel from './tools/PageSetupPanel.jsx'
import GuidePanel from './tools/GuidePanel.jsx'
import {
  IconLine, IconCircle, IconTrim, IconDelete, IconExtend, IconOffset,
  IconMirror, IconMoveCopy, IconRotateCopy, IconResize, IconFillet, IconTrace, IconGuide,
  IconUndo, IconRedo, IconFitView, IconSave, IconLoad, IconDXF, IconSpline, IconText, IconSelect, IconJoin, IconDim
} from './draw/ToolIcons.jsx'  // retro sprites 28×36

export default function App() {
  const canvasRef=useRef(null)
  const [tool,setTool]=useState('line')
  const [lines,setLines]=useState([])
  const [circles,setCircles]=useState([])
  const [arcs,setArcs]=useState([])
  const [splines,setSplines]=useState([])
  const [dims,setDims]=useState([])  // dimension annotations

  // Spline in-progress state
  const [splinePoints,setSplinePoints]=useState([])   // [{x,y},...] being placed
  const [splineClosed,setSplineClosed]=useState(false) // C key toggles
  const [startPoint,setStartPoint]=useState(null)
  const [circleCenter,setCircleCenter]=useState(null)
  const [mousePos,setMousePos]=useState(null)
  const [dimInput,setDimInput]=useState('')
  const [dimLocked,setDimLocked]=useState(false)
  const [angleInput,setAngleInput]=useState('')
  const [angleLocked,setAngleLocked]=useState(false)
  const [focusField,setFocusField]=useState('dim')
  const [trackedPts,setTrackedPts]=useState([])
  const [deferredTangent,setDeferredTangent]=useState(null)
  const [trimPreview,setTrimPreview]=useState(null)
  const [deletePreview,setDeletePreview]=useState(null)
  const [offsetEntity,setOffsetEntity]=useState(null)    // locked entity after click
  const [offsetDistInput,setOffsetDistInput]=useState('')
  const [offsetDistLocked,setOffsetDistLocked]=useState(false)
  const [offsetPreview,setOffsetPreview]=useState(null)
  const [offsetHover,setOffsetHover]=useState(null)
  const [mirrorSel,setMirrorSel]=useState([])
  const [mirrorAccepted,setMirrorAccepted]=useState(false)
  const [mirrorHover,setMirrorHover]=useState(null)
  const [mirrorP1,setMirrorP1]=useState(null)
  const [mirrorPreview,setMirrorPreview]=useState(null)

  // Move/Copy tool state
  const [moveCopySel,setMoveCopySel]=useState([])
  const [moveCopyAccepted,setMoveCopyAccepted]=useState(false)
  const [moveCopyMode,setMoveCopyMode]=useState('move')
  const [moveCopyCountInput,setMoveCopyCountInput]=useState('1')
  const [moveCopyHover,setMoveCopyHover]=useState(null)

  // Rotate/Copy tool state
  const [rotateCopySel,setRotateCopySel]=useState([])
  const [rotateCopyAccepted,setRotateCopyAccepted]=useState(false)
  const [rotateCopyMode,setRotateCopyMode]=useState('rotate')
  const [rotateCopyCountInput,setRotateCopyCountInput]=useState('1')
  const [rotateCopyHover,setRotateCopyHover]=useState(null)

  // Resize tool state
  const [resizeSel,setResizeSel]=useState([])
  const [resizeAccepted,setResizeAccepted]=useState(false)
  const [resizeScaleInput,setResizeScaleInput]=useState('')
  const [resizeHover,setResizeHover]=useState(null)

  // Fillet tool state
  const [filletSel,setFilletSel]=useState([])   // up to 2 {kind:'line',idx,clickPt}
  const [filletAccepted,setFilletAccepted]=useState(false)
  const [filletRadiusInput,setFilletRadiusInput]=useState('')
  const [filletHover,setFilletHover]=useState(null)
  const [filletPreview,setFilletPreview]=useState(null)

  // Extend tool state
  const [extendPreview,setExtendPreview]=useState(null)

  // T key toggles tangent snap mode; resets to false after each line is placed or Esc
  const [tKeyDown,setTKeyDown]=useState(false)
  const [pKeyDown,setPKeyDown]=useState(false)
  const [drawStyle,setDrawStyle]=useState(null) // null|'dashed'|'construction'
  const [perpSourceLineIdx,setPerpSourceLineIdx]=useState(null)
  // Trace tool state
  const [traceOpen,setTraceOpen]=useState(false)
  const [traceInsertPt,setTraceInsertPt]=useState(null)

  // Text tool state
  const [textOpen,setTextOpen]=useState(false)
  const [pageSetupOpen,setPageSetupOpen]=useState(false)
  const [pageConfig,setPageConfig]=useState({size:'A4',orientation:'landscape',margin:10,showPage:false})
  const [guideOpen,setGuideOpen]=useState(false)
  const [gridVisible,setGridVisible]=useState(false)
  const [gridSnap,setGridSnap]=useState(false)
  const [gridSizeMm,setGridSizeMm]=useState(5)
  const [textInsertPt,setTextInsertPt]=useState(null)

  const [intersectionPts,setIntersectionPts]=useState([])

  // Dimension tool state
  const [dimToolStep,setDimToolStep]=useState(0)    // 0=idle, 1=got p1, 2=got p2
  const [dimToolPts,setDimToolPts]=useState([])     // clicked points so far
  const [dimToolPreview,setDimToolPreview]=useState(null)  // live preview
  const [dimEditIdx,setDimEditIdx]=useState(null)   // index of dim being edited
  const [dimEditText,setDimEditText]=useState('')   // override text

  // Join tool state
  const [joinFirstPt,setJoinFirstPt]=useState(null)   // {lineIdx, end:'x1y1'|'x2y2', x, y} or spline equiv
  const [joinHover,setJoinHover]=useState(null)        // same structure, for hover highlight

  // Select tool state — full multi-select with bounding box handles
  const [selection,setSelection]=useState([])           // [{kind,idx},...]
  const [selectHover,setSelectHover]=useState(null)     // entity hovered but not selected
  const selectDragHandleRef=useRef(null)                // handle being dragged: null|string
  const selectDragStartRef=useRef(null)                 // world pos where handle drag started
  const selectDragStartScreenRef=useRef(null)           // screen pos where handle drag started (for click detection)
  const selectSnapshotRef=useRef(null)                  // entity snapshot at drag start
  const selectBBoxRef=useRef(null)                      // bbox at drag start
  const [selectLiveGeom,setSelectLiveGeom]=useState(null) // live-transformed geometry during drag
  // Dimension editing state
  const [selectDimField,setSelectDimField]=useState(null)   // currently focused field
  const [selectDimInput,setSelectDimInput]=useState('')      // value being typed in current field
  const [selectDimPending,setSelectDimPending]=useState({}) // {width:'',height:'',length:'',angle:'',radius:''}
  const [selectDimAnchor,setSelectDimAnchor]=useState('mc') // handle id that stays fixed

  // Drag window select — tracks an active selection rectangle
  const [dragSelectRect,setDragSelectRect]=useState(null)
  const dragStartRef=useRef(null)   // screen coords {x,y} where left-button pressed
  const dragRectRef=useRef(null)    // world coords {x1,y1,x2,y2} of current drag rect
  const wasDragRef=useRef(false)    // suppress click event after a completed drag-select

  // ── VIEWPORT ──
  const [viewTransform,setViewTransform]=useState({x:0,y:0,scale:1})
  const [canvasSize,setCanvasSize]=useState({w:window.innerWidth-56,h:window.innerHeight-52})
  const viewTransformRef=useRef({x:0,y:0,scale:1})
  const isPanningRef=useRef(false)
  const lastPanPosRef=useRef({x:0,y:0})

  useEffect(()=>{
    viewTransformRef.current=viewTransform
    zoomRef.scale=viewTransform.scale
  },[viewTransform])

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return
    const onWheel=e=>{
      e.preventDefault()
      const {x:tx,y:ty,scale}=viewTransformRef.current
      const rect=canvas.getBoundingClientRect()
      const sx=e.clientX-rect.left,sy=e.clientY-rect.top
      const factor=e.deltaY<0?1.1:1/1.1
      const newScale=Math.max(0.05,Math.min(200,scale*factor))
      const wx=(sx-tx)/scale,wy=(sy-ty)/scale
      const vt={x:sx-wx*newScale,y:sy-wy*newScale,scale:newScale}
      viewTransformRef.current=vt;zoomRef.scale=newScale;setViewTransform(vt)
    }
    canvas.addEventListener('wheel',onWheel,{passive:false})
    return ()=>canvas.removeEventListener('wheel',onWheel)
  },[])

  useEffect(()=>{
    const onResize=()=>setCanvasSize({w:window.innerWidth-56,h:window.innerHeight-52})
    window.addEventListener('resize',onResize)
    return ()=>window.removeEventListener('resize',onResize)
  },[])

  function screenToWorld(sx,sy){
    const {x:tx,y:ty,scale}=viewTransformRef.current
    return {x:(sx-tx)/scale,y:(sy-ty)/scale}
  }

  function zoomToFit(){
    const canvas=canvasRef.current;if(!canvas)return
    if (!linesRef.current.length&&!circlesRef.current.length&&!arcsRef.current.length) return
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity
    linesRef.current.forEach(l=>{
      minX=Math.min(minX,l.x1,l.x2);maxX=Math.max(maxX,l.x1,l.x2)
      minY=Math.min(minY,l.y1,l.y2);maxY=Math.max(maxY,l.y1,l.y2)
    })
    circlesRef.current.forEach(c=>{
      minX=Math.min(minX,c.cx-c.r);maxX=Math.max(maxX,c.cx+c.r)
      minY=Math.min(minY,c.cy-c.r);maxY=Math.max(maxY,c.cy+c.r)
    })
    arcsRef.current.forEach(a=>{
      minX=Math.min(minX,a.cx-a.r);maxX=Math.max(maxX,a.cx+a.r)
      minY=Math.min(minY,a.cy-a.r);maxY=Math.max(maxY,a.cy+a.r)
    })
    const pad=60,w=canvas.width,h=canvas.height
    const gw=maxX-minX||100,gh=maxY-minY||100
    const sc=Math.min((w-pad*2)/gw,(h-pad*2)/gh,20)
    const vt={x:w/2-(minX+gw/2)*sc,y:h/2-(minY+gh/2)*sc,scale:sc}
    viewTransformRef.current=vt;zoomRef.scale=sc;setViewTransform(vt)
  }

  const { commit, undo, redo, canUndo, canRedo } = useHistory()
  const snapshot = () => ({ lines, circles, arcs, splines })
  const restore = (snap) => { setLines(snap.lines); setCircles(snap.circles); setArcs(snap.arcs); setSplines(snap.splines||[]) }

  const trackedPtsRef=useRef([])
  const splinePointsRef=useRef([])
  const linesRef=useRef([])
  const circlesRef=useRef([])
  const arcsRef=useRef([])
  const splinesRef=useRef([])
  const loadFileRef=useRef(null)
  const [loadError,setLoadError]=useState(null)
  useEffect(()=>{trackedPtsRef.current=trackedPts},[trackedPts])
  useEffect(()=>{splinePointsRef.current=splinePoints},[splinePoints])
  useEffect(()=>{linesRef.current=lines},[lines])
  useEffect(()=>{circlesRef.current=circles},[circles])
  useEffect(()=>{arcsRef.current=arcs},[arcs])
  useEffect(()=>{splinesRef.current=splines},[splines])

  function resetDrawState(){
    setStartPoint(null);setCircleCenter(null)
    setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
    setTrackedPts([]);trackedPtsRef.current=[];setDeferredTangent(null);setTKeyDown(false);setPKeyDown(false);setPerpSourceLineIdx(null)
  }
  function resetSelection(){
    setSelection([]);setSelectHover(null);setSelectLiveGeom(null)
    setSelectDimField(null);setSelectDimPending({});setSelectDimAnchor('mc')
    selectDragHandleRef.current=null;selectDragStartRef.current=null
    selectSnapshotRef.current=null;selectBBoxRef.current=null
  }
  function resetSpline(){
    setSplinePoints([]);setSplineClosed(false)
  }
  function resetOffset(){
    setOffsetEntity(null)
    setOffsetDistInput('');setOffsetDistLocked(false)
    setOffsetPreview(null);setOffsetHover(null)
  }
  function resetMirror(){
    setMirrorSel([]);setMirrorAccepted(false)
    setMirrorHover(null);setMirrorP1(null);setMirrorPreview(null)
  }
  function resetMoveCopy(){
    setMoveCopySel([]);setMoveCopyAccepted(false)
    setMoveCopyMode('move');setMoveCopyCountInput('1')
    setMoveCopyHover(null)
  }
  function resetRotateCopy(){
    setRotateCopySel([]);setRotateCopyAccepted(false)
    setRotateCopyMode('rotate');setRotateCopyCountInput('1')
    setRotateCopyHover(null)
  }
  function resetResize(){
    setResizeSel([]);setResizeAccepted(false)
    setResizeScaleInput('');setResizeHover(null)
  }
  function resetFillet(){
    setFilletSel([]);setFilletAccepted(false)
    setFilletRadiusInput('');setFilletHover(null);setFilletPreview(null)
  }
  function resetTrace(){
    setTraceOpen(false);setTraceInsertPt(null)
  }
  function resetDim(){
    setDimToolStep(0);setDimToolPts([]);setDimToolPreview(null)
    setDimEditIdx(null);setDimEditText('')
  }
  function resetJoin(){
    setJoinFirstPt(null);setJoinHover(null)
  }
  function resetText(){
    setTextOpen(false);setTextInsertPt(null)
  }

  // Returns true when we're in a selection phase that supports drag-window select
  function inSelPhase(){
    return (tool==='mirror'&&!mirrorAccepted)||
           (tool==='movecopy'&&!moveCopyAccepted)||
           (tool==='rotatecopy'&&!rotateCopyAccepted)||
           (tool==='resize'&&!resizeAccepted)||
           (tool==='fillet'&&!filletAccepted)
  }

  // Execute a drag-window select: add all entities with any point inside rect to current tool's selection
  function executeDragSelect(rect){
    const minX=Math.min(rect.x1,rect.x2),maxX=Math.max(rect.x1,rect.x2)
    const minY=Math.min(rect.y1,rect.y2),maxY=Math.max(rect.y1,rect.y2)
    const ptIn=(x,y)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY
    const hits=[]
    linesRef.current.forEach((l,idx)=>{
      if(ptIn(l.x1,l.y1)||ptIn(l.x2,l.y2)) hits.push({kind:'line',idx})
    })
    circlesRef.current.forEach((c,idx)=>{
      if(ptIn(c.cx,c.cy)||ptIn(c.cx+c.r,c.cy)||ptIn(c.cx-c.r,c.cy)) hits.push({kind:'circle',idx})
    })
    arcsRef.current.forEach((arc,idx)=>{
      const p1x=arc.cx+arc.r*Math.cos(arc.startAngle),p1y=arc.cy+arc.r*Math.sin(arc.startAngle)
      const p2x=arc.cx+arc.r*Math.cos(arc.endAngle),p2y=arc.cy+arc.r*Math.sin(arc.endAngle)
      if(ptIn(arc.cx,arc.cy)||ptIn(p1x,p1y)||ptIn(p2x,p2y)) hits.push({kind:'arc',idx})
    })
    splinesRef.current.forEach((sp,idx)=>{
      if(sp.points.some(p=>ptIn(p.x,p.y))) hits.push({kind:'spline',idx})
    })
    const merge=(prev)=>{
      const m=[...prev]
      hits.forEach(h=>{if(!m.some(p=>p.kind===h.kind&&p.idx===h.idx))m.push(h)})
      return m
    }
    if(tool==='mirror')      setMirrorSel(merge)
    if(tool==='movecopy')    setMoveCopySel(merge)
    if(tool==='rotatecopy')  setRotateCopySel(merge)
    if(tool==='resize')      setResizeSel(merge)
    if(tool==='fillet'){
      // fillet only uses lines, max 2
      const lineHits=hits.filter(h=>h.kind==='line')
      setFilletSel(prev=>{
        const m=[...prev]
        lineHits.forEach(h=>{
          if(!m.some(p=>p.kind===h.kind&&p.idx===h.idx)&&m.length<2)
            m.push({...h,clickPt:{x:(lines[h.idx].x1+lines[h.idx].x2)/2,y:(lines[h.idx].y1+lines[h.idx].y2)/2}})
        })
        return m
      })
    }
  }

  function computeEnd(start,raw,tracked){
    if (!dimLocked&&!angleLocked){
      const geo=getGeoSnap(raw,lines,circles,arcs,start,false,splines,intersectionPts)
      if (geo&&geo.type!=='tan') return{x:geo.x,y:geo.y,snapType:geo.type,angleSnap:checkAngle(start,geo),tracks:[]}
    }
    const{snapped,tracks}=applyTracking(raw,tracked)
    let endX=snapped.x,endY=snapped.y,angleSnap=null
    if (angleLocked){
      const θ=parseFloat(angleInput)*Math.PI/180,dir={x:Math.cos(θ),y:-Math.sin(θ)}
      const dx=snapped.x-start.x,dy=snapped.y-start.y
      const t=Math.max(5,dx*dir.x+dy*dir.y)
      endX=start.x+t*dir.x;endY=start.y+t*dir.y
    } else {
      const a=getAngleSnap(start,snapped);endX=a.x;endY=a.y;angleSnap=a.angleSnap
    }
    if (dimLocked){
      const px=mmToPx(parseFloat(dimInput)||0)
      const dx=endX-start.x,dy=endY-start.y,len=Math.hypot(dx,dy)
      if (len>0) return{x:start.x+(dx/len)*px,y:start.y+(dy/len)*px,snapType:null,angleSnap:angleLocked?null:angleSnap,tracks}
    }
    return{x:endX,y:endY,snapType:null,angleSnap:angleLocked?null:angleSnap,tracks}
  }

  const updateTracking=useCallback((pos)=>{
    const sc=viewTransformRef.current.scale
    const allPts=getAllSnapPoints(linesRef.current,circlesRef.current,arcsRef.current,splinesRef.current)
    const current=trackedPtsRef.current
    for (const p of allPts){
      if (Math.hypot(pos.x-p.x,pos.y-p.y)<ACQUIRE_DIST/sc){
        const already=current.some(tp=>Math.hypot(tp.x-p.x,tp.y-p.y)<2/sc)
        if (!already){const next=[...current,p];trackedPtsRef.current=next;setTrackedPts(next)}
        return
      }
    }
    const onAnyTrack=current.some(tp=>Math.abs(pos.y-tp.y)<ALIGN_SNAP_DIST/sc||Math.abs(pos.x-tp.x)<ALIGN_SNAP_DIST/sc)
    if (!onAnyTrack&&current.length>0){trackedPtsRef.current=[];setTrackedPts([])}
  },[])

  useEffect(()=>{
    if (tool==='trim'&&mousePos){
      const prev=computeTrimPreview(mousePos,lines,circles,arcs,splines)
      if (prev){setTrimPreview(prev);return}
      // Check if mouse is near a spline — compute trim region
      const nearest=nearestSpline(mousePos,splines)
      if (nearest){
        const sp=splines[nearest.idx]
        const spPrev=computeSplineTrimPreview(mousePos,nearest.idx,sp,lines,circles,arcs,splines)
        setTrimPreview(spPrev||{kind:'spline',idx:nearest.idx,highlightPts:null})
        return
      }
      // No intersections — fallback to deletewhole if mouse is near any entity
      const delPrev=computeDeletePreview(mousePos,lines,circles,arcs,splines)
      if (delPrev) setTrimPreview({...delPrev,deletewhole:true})
      else setTrimPreview(null)
    } else setTrimPreview(null)
  },[tool,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool==='delete'&&mousePos){
      const prev=computeDeletePreview(mousePos,lines,circles,arcs)
      if (prev){setDeletePreview(prev);return}
      const sp=nearestSpline(mousePos,splines)
      if (sp){setDeletePreview(sp);return}
      // Hit-test dimensions
      const sd=(SELECT_DIST*1.5)/zoomRef.scale
      let bestDim=null,bestDist=sd+1
      dims.forEach((dim,idx)=>{
        let d=sd+1
        if (dim.kind==='linear'&&dim.x1!=null&&dim.x2!=null){
          const len=Math.hypot(dim.x2-dim.x1,dim.y2-dim.y1)||1
          const perpX=-(dim.y2-dim.y1)/len,perpY=(dim.x2-dim.x1)/len
          const off=dim.offset||0
          const d1x=dim.x1+perpX*off,d1y=dim.y1+perpY*off
          const d2x=dim.x2+perpX*off,d2y=dim.y2+perpY*off
          d=Math.min(distToSeg(mousePos.x,mousePos.y,d1x,d1y,d2x,d2y),
                     distToSeg(mousePos.x,mousePos.y,dim.x1,dim.y1,d1x,d1y),
                     distToSeg(mousePos.x,mousePos.y,dim.x2,dim.y2,d2x,d2y))
        } else if ((dim.kind==='diameter'||dim.kind==='radius')&&dim.cx!=null){
          const ex=dim.cx+Math.cos(dim.angle)*(dim.kind==='diameter'?dim.r*2:dim.r)
          const ey=dim.cy+Math.sin(dim.angle)*(dim.kind==='diameter'?dim.r*2:dim.r)
          const sx=dim.kind==='diameter'?dim.cx-Math.cos(dim.angle)*dim.r:dim.cx
          const sy=dim.kind==='diameter'?dim.cy-Math.sin(dim.angle)*dim.r:dim.cy
          d=distToSeg(mousePos.x,mousePos.y,sx,sy,ex,ey)
        }
        if (d<bestDist){bestDist=d;bestDim={kind:'dim',idx}}
      })
      setDeletePreview(bestDim||null)
    } else setDeletePreview(null)
  },[tool,mousePos,lines,circles,arcs,splines,dims])

  useEffect(()=>{
    if (tool==='extend'&&mousePos) setExtendPreview(computeExtendPreview(mousePos,lines,circles,arcs,splines))
    else setExtendPreview(null)
  },[tool,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='offset'||!mousePos||!offsetEntity){setOffsetPreview(null);return}
    let entity
    if (offsetEntity.kind==='line')   entity=lines[offsetEntity.idx]
    if (offsetEntity.kind==='circle') entity=circles[offsetEntity.idx]
    if (offsetEntity.kind==='arc')    entity=arcs[offsetEntity.idx]
    if (offsetEntity.kind==='spline') entity=splines[offsetEntity.idx]
    if (!entity){setOffsetPreview(null);return}
    const distPx=offsetDistLocked
      ? mmToPx(parseFloat(offsetDistInput)||1)
      : distToEntity(mousePos,entity,offsetEntity.kind)
    setOffsetPreview(computeOffsetPreview(entity,offsetEntity.kind,distPx,mousePos))
  },[tool,mousePos,offsetEntity,offsetDistInput,offsetDistLocked,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='offset'||!mousePos){setOffsetHover(null);return}
    setOffsetHover(nearestOffsetEntity(mousePos,lines,circles,arcs,splines))
  },[tool,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='mirror'||mirrorAccepted||!mousePos){setMirrorHover(null);return}
    setMirrorHover(nearestMirrorEntity(mousePos,lines,circles,arcs,splines))
  },[tool,mirrorAccepted,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='mirror'||!mirrorAccepted||!mirrorP1||!mousePos||!mirrorSel.length){setMirrorPreview(null);return}
    const hSnap=getGeoSnap(mousePos,lines,circles,arcs,mirrorP1,false,splines,intersectionPts)
    let endPt
    if (hSnap&&hSnap.type!=='tan'){endPt={x:hSnap.x,y:hSnap.y}}
    else{const{snapped}=applyTracking(mousePos,trackedPts);const angled=getAngleSnap(mirrorP1,snapped);endPt={x:angled.x,y:angled.y}}
    setMirrorPreview(buildMirror(mirrorSel,lines,circles,arcs,splines,mirrorP1.x,mirrorP1.y,endPt.x,endPt.y))
  },[tool,mirrorAccepted,mirrorP1,mousePos,mirrorSel,lines,circles,arcs,trackedPts])

  useEffect(()=>{
    if (tool!=='movecopy'||moveCopyAccepted||!mousePos){setMoveCopyHover(null);return}
    setMoveCopyHover(nearestMoveCopyEntity(mousePos,lines,circles,arcs,splines))
  },[tool,moveCopyAccepted,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='rotatecopy'||rotateCopyAccepted||!mousePos){setRotateCopyHover(null);return}
    setRotateCopyHover(nearestRotateCopyEntity(mousePos,lines,circles,arcs,splines))
  },[tool,rotateCopyAccepted,mousePos,lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='resize'||resizeAccepted||!mousePos){setResizeHover(null);return}
    setResizeHover(nearestScaleEntity(mousePos,lines,circles,arcs,splines))
  },[tool,resizeAccepted,mousePos,lines,circles,arcs,splines])

  // Dim tool — live preview while placing
  useEffect(()=>{
    if (tool!=='dim'||!mousePos){setDimToolPreview(null);return}
    if (dimToolStep===0){
      // Hover: detect if near circle or arc for one-click dim
      let bestCircle=null,bestArc=null,bestDist=SELECT_DIST*2/zoomRef.scale
      circles.forEach((c,idx)=>{
        const d=Math.abs(Math.hypot(mousePos.x-c.cx,mousePos.y-c.cy)-c.r)
        if(d<bestDist){bestDist=d;bestCircle={kind:'circle',idx}}
      })
      if (!bestCircle) arcs.forEach((a,idx)=>{
        const angle=norm2pi(Math.atan2(mousePos.y-a.cy,mousePos.x-a.cx))
        if(!angleOnArc(angle,a.startAngle,a.endAngle)) return
        const d=Math.abs(Math.hypot(mousePos.x-a.cx,mousePos.y-a.cy)-a.r)
        if(d<bestDist){bestDist=d;bestArc={kind:'arc',idx}}
      })
      if (bestCircle){
        const c=circles[bestCircle.idx]
        const ang=Math.atan2(mousePos.y-c.cy,mousePos.x-c.cx)
        setDimToolPreview({kind:'diameter',cx:c.cx,cy:c.cy,r:c.r,angle:ang})
      } else if (bestArc){
        const a=arcs[bestArc.idx]
        const ang=Math.atan2(mousePos.y-a.cy,mousePos.x-a.cx)
        setDimToolPreview({kind:'radius',cx:a.cx,cy:a.cy,r:a.r,angle:ang})
      } else {
        setDimToolPreview(null)
      }
    } else if (dimToolStep===1){
      // Got p1, show linear dim to mouse
      const p1=dimToolPts[0]
      const dx=mousePos.x-p1.x,dy=mousePos.y-p1.y
      const len=Math.hypot(dx,dy)
      if(len>1) setDimToolPreview({kind:'linear',x1:p1.x,y1:p1.y,x2:mousePos.x,y2:mousePos.y,offset:0})
    } else if (dimToolStep===2){
      // Got p1+p2, set offset distance
      const [p1,p2]=dimToolPts
      const dx=p2.x-p1.x,dy=p2.y-p1.y,len=Math.hypot(dx,dy)
      if(len<1) return
      // Perpendicular offset = signed distance from mouse to line p1-p2
      const nx=-dy/len,ny=dx/len
      const offset=(mousePos.x-p1.x)*nx+(mousePos.y-p1.y)*ny
      setDimToolPreview({kind:'linear',x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,offset})
    }
  },[tool,mousePos,dimToolStep,dimToolPts,circles,arcs])

  // Join tool hover — find nearest line/spline endpoint within snap distance
  useEffect(()=>{
    if (tool!=='join'||!mousePos){setJoinHover(null);return}
    const sd=SELECT_DIST*1.5/zoomRef.scale
    let best=null,bestDist=sd+1
    lines.forEach((l,lineIdx)=>{
      [{end:'x1y1',x:l.x1,y:l.y1},{end:'x2y2',x:l.x2,y:l.y2}].forEach(p=>{
        const d=Math.hypot(mousePos.x-p.x,mousePos.y-p.y)
        if(d<bestDist){bestDist=d;best={kind:'line',lineIdx,end:p.end,x:p.x,y:p.y}}
      })
    })
    splines.forEach((sp,splineIdx)=>{
      if(sp.points.length<2||sp.closed) return
      [{end:'first',x:sp.points[0].x,y:sp.points[0].y},
       {end:'last', x:sp.points[sp.points.length-1].x,y:sp.points[sp.points.length-1].y}
      ].forEach(p=>{
        const d=Math.hypot(mousePos.x-p.x,mousePos.y-p.y)
        if(d<bestDist){bestDist=d;best={kind:'spline',splineIdx,end:p.end,x:p.x,y:p.y}}
      })
    })
    setJoinHover(best)
  },[tool,mousePos,lines,splines])

  useEffect(()=>{
    if (tool!=='select'||!mousePos){setSelectHover(null);return}
    if (selectDragHandleRef.current) return
    // Skip hover when over a handle of the current selection
    const curLines   = selectLiveGeom?.lines   || lines
    const curCircles = selectLiveGeom?.circles || circles
    const curArcs    = selectLiveGeom?.arcs    || arcs
    const curSplines = selectLiveGeom?.splines || splines
    const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)
    if (bbox){
      const handles=getBBoxHandles(bbox)
      if (hitTestHandles(mousePos,handles,12/viewTransform.scale)){setSelectHover(null);return}
    }
    const sd=SELECT_DIST/zoomRef.scale
    let best=null,bestDist=sd+1
    lines.forEach((l,idx)=>{const d=distToSeg(mousePos.x,mousePos.y,l.x1,l.y1,l.x2,l.y2);if(d<bestDist){bestDist=d;best={kind:'line',idx}}})
    circles.forEach((c,idx)=>{const d=Math.abs(Math.hypot(mousePos.x-c.cx,mousePos.y-c.cy)-c.r);if(d<bestDist){bestDist=d;best={kind:'circle',idx}}})
    arcs.forEach((arc,idx)=>{
      const angle=norm2pi(Math.atan2(mousePos.y-arc.cy,mousePos.x-arc.cx))
      if (!angleOnArc(angle,arc.startAngle,arc.endAngle)) return
      const d=Math.abs(Math.hypot(mousePos.x-arc.cx,mousePos.y-arc.cy)-arc.r)
      if (d<bestDist){bestDist=d;best={kind:'arc',idx}}
    })
    splines.forEach((sp,idx)=>{
      if (sp.points.length<2) return
      const d=distToSpline(mousePos.x,mousePos.y,sp.points,sp.closed)
      if (d<bestDist){bestDist=d;best={kind:'spline',idx}}
    })
    // Hit-test dimensions — check proximity to dim line and extension lines
    dims.forEach((dim,idx)=>{
      let d=sd+1
      if (dim.kind==='linear'&&dim.x1!=null&&dim.x2!=null){
        const len=Math.hypot(dim.x2-dim.x1,dim.y2-dim.y1)||1
        const perpX=-(dim.y2-dim.y1)/len,perpY=(dim.x2-dim.x1)/len
        const off=dim.offset||0
        const d1x=dim.x1+perpX*off,d1y=dim.y1+perpY*off
        const d2x=dim.x2+perpX*off,d2y=dim.y2+perpY*off
        d=Math.min(distToSeg(mousePos.x,mousePos.y,d1x,d1y,d2x,d2y),
                   distToSeg(mousePos.x,mousePos.y,dim.x1,dim.y1,d1x,d1y),
                   distToSeg(mousePos.x,mousePos.y,dim.x2,dim.y2,d2x,d2y))
      } else if ((dim.kind==='diameter'||dim.kind==='radius')&&dim.cx!=null){
        const ex=dim.cx+Math.cos(dim.angle)*(dim.kind==='diameter'?dim.r*2:dim.r)
        const ey=dim.cy+Math.sin(dim.angle)*(dim.kind==='diameter'?dim.r*2:dim.r)
        const sx=dim.kind==='diameter'?dim.cx-Math.cos(dim.angle)*dim.r:dim.cx
        const sy=dim.kind==='diameter'?dim.cy-Math.sin(dim.angle)*dim.r:dim.cy
        d=distToSeg(mousePos.x,mousePos.y,sx,sy,ex,ey)
      }
      if (d<bestDist){bestDist=d;best={kind:'dim',idx}}
    })
    setSelectHover(best)
  },[tool,mousePos,lines,circles,arcs,splines,dims,selection,selectLiveGeom,viewTransform.scale])

  useEffect(()=>{
    setIntersectionPts(computeAllIntersections(lines,circles,arcs,splines))
  },[lines,circles,arcs,splines])

  useEffect(()=>{
    if (tool!=='fillet'||filletAccepted||!mousePos){setFilletHover(null);return}
    setFilletHover(nearestFilletLine(mousePos,lines))
  },[tool,filletAccepted,mousePos,lines])

  useEffect(()=>{
    if (tool!=='fillet'||!filletAccepted||filletSel.length<2){setFilletPreview(null);return}
    const r=mmToPx(parseFloat(filletRadiusInput)||0)
    if (r<=0){setFilletPreview(null);return}
    const l1=lines[filletSel[0].idx],l2=lines[filletSel[1].idx]
    setFilletPreview(computeFillet(l1,l2,r,filletSel[0].clickPt,filletSel[1].clickPt))
  },[tool,filletAccepted,filletSel,filletRadiusInput,lines])


  // ── PERP SNAP — completely separate algorithm, no tangent code ──────────────
  // Foot of perpendicular from point (px,py) onto infinite line through (x1,y1)→(x2,y2)
  function calcPerpFoot(px, py, x1, y1, x2, y2, clamp=false) {
    const dx=x2-x1, dy=y2-y1, len2=dx*dx+dy*dy
    if (len2<1e-10) return {x:x1, y:y1}
    let t=((px-x1)*dx+(py-y1)*dy)/len2
    if (clamp) t=Math.max(0,Math.min(1,t))
    return {x:x1+t*dx, y:y1+t*dy}
  }
  // Distance from point to infinite line
  function distToInfiniteLine(px, py, x1, y1, x2, y2) {
    const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy)
    if (len<1e-10) return Math.hypot(px-x1,py-y1)
    return Math.abs((py-y1)*dx-(px-x1)*dy)/len
  }
  // Find nearest line to cursor within threshold (pixels).
  // Uses SELECT_DIST (generous) so user doesn't need pixel-perfect aim.
  function findNearestLineForPerp(mouse, lines, excludeIdx=null) {
    const threshold = SELECT_DIST * 3 / zoomRef.scale
    let best=null, bestIdx=-1, bestDist=threshold+1
    lines.forEach((l,idx)=>{
      if (idx===excludeIdx) return   // skip source line
      const d=distToInfiniteLine(mouse.x,mouse.y,l.x1,l.y1,l.x2,l.y2)
      if (d<bestDist) { bestDist=d; best=l; bestIdx=idx }
    })
    if (!best) return null
    // Foot clamped to segment so indicator stays on the visible line
    return { line:best, idx:bestIdx, foot:calcPerpFoot(mouse.x,mouse.y,best.x1,best.y1,best.x2,best.y2,true) }
  }
  // Draw the perp indicator — right-angle square + PERP label (no circles, no arc symbols)
  function drawPerpIndicator(ctx, x, y, sc) {
    ctx.save()
    ctx.translate(x,y); ctx.scale(1/sc,1/sc)
    ctx.strokeStyle='#00BCD4'; ctx.lineWidth=2.5; ctx.lineCap='round'
    const s=10
    ctx.beginPath()
    ctx.moveTo(-s, s); ctx.lineTo(-s,-s); ctx.lineTo(s,-s)
    ctx.stroke()
    // Corner square
    ctx.beginPath()
    ctx.moveTo(-s, s-6); ctx.lineTo(-s+6, s-6); ctx.lineTo(-s+6, s)
    ctx.stroke()
    ctx.fillStyle='#00BCD4'; ctx.font='bold 11px monospace'
    ctx.fillText('PERP', s+4, -s+8)
    ctx.restore()
  }

  // Apply entity style to canvas context
  function applyEntityStyle(ctx, entity, sc, baseColor, baseLineWidth) {
    const s = entity?.style
    if (s==='construction') {
      ctx.strokeStyle = baseColor==='#222' ? '#aaa' : baseColor
      ctx.lineWidth = Math.min(baseLineWidth, 0.8/sc)
      ctx.setLineDash([])
    } else if (s==='dashed') {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = baseLineWidth
      ctx.setLineDash([8/sc, 4/sc])
    } else {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = baseLineWidth
      ctx.setLineDash([])
    }
  }

  // ── MAIN DRAW ──
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return
    const ctx=canvas.getContext('2d')
    const {x:vtx,y:vty,scale:sc}=viewTransform

    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,canvas.width,canvas.height)
    ctx.setTransform(sc,0,0,sc,vtx,vty)

    // Page border
    if (pageConfig.showPage){
      const PAPER={A4:[210,297],A3:[297,420],A2:[420,594],A1:[594,841],A0:[841,1189]}
      let [pw,ph]=PAPER[pageConfig.size]||[210,297]
      if (pageConfig.orientation==='landscape')[pw,ph]=[ph,pw]
      const m=pageConfig.margin
      const pwPx=mmToPx(pw),phPx=mmToPx(ph)
      // Page centred on origin
      const px0=-pwPx/2,py0=-phPx/2
      ctx.save()
      ctx.fillStyle='rgba(255,255,255,0.03)'
      ctx.fillRect(px0,py0,pwPx,phPx)
      ctx.strokeStyle='rgba(100,149,237,0.4)';ctx.lineWidth=1/sc;ctx.setLineDash([4/sc,2/sc])
      ctx.strokeRect(px0,py0,pwPx,phPx)
      ctx.setLineDash([])
      // Margin box
      ctx.strokeStyle='rgba(100,149,237,0.2)';ctx.lineWidth=0.5/sc;ctx.setLineDash([2/sc,2/sc])
      ctx.strokeRect(px0+mmToPx(m),py0+mmToPx(m),mmToPx(pw-m*2),mmToPx(ph-m*2))
      ctx.setLineDash([])
      // Size label
      ctx.save();ctx.scale(1/sc,1/sc);ctx.fillStyle='rgba(100,149,237,0.5)';ctx.font='11px monospace'
      ctx.fillText(`${pageConfig.size} ${pageConfig.orientation==='landscape'?'⟵':'↑'}  ${pw}×${ph}mm`,
        (px0+4/sc)*sc/1,(py0+14/sc)*sc/1)
      ctx.restore()
      ctx.restore()
    }

    // Grid dots — drawn in world space, no transform switching
    if (gridVisible){
      const gPx=mmToPx(gridSizeMm)
      const screenGap=gPx*sc
      let drawGPx=gPx
      if (screenGap<8) drawGPx=gPx*Math.ceil(8/screenGap)
      const wx0=(-vtx)/sc, wy0=(-vty)/sc
      const wx1=wx0+canvasSize.w/sc, wy1=wy0+canvasSize.h/sc
      const startX=Math.floor(wx0/drawGPx)*drawGPx
      const startY=Math.floor(wy0/drawGPx)*drawGPx
      const dotHalf=0.6/sc  // smaller, subtle dots
      ctx.fillStyle='rgba(60,100,220,0.35)'
      for (let gx=startX;gx<=wx1+drawGPx;gx+=drawGPx){
        for (let gy=startY;gy<=wy1+drawGPx;gy+=drawGPx){
          ctx.fillRect(gx-dotHalf,gy-dotHalf,dotHalf*2,dotHalf*2)
        }
      }
    }

    // Use live-transformed geometry during select handle drag
    const drawLines   = selectLiveGeom?.lines   || lines
    const drawCircles = selectLiveGeom?.circles || circles
    const drawArcs    = selectLiveGeom?.arcs    || arcs
    const drawSplines = selectLiveGeom?.splines || splines

    drawLines.forEach((line,idx)=>{
      const isDelTarget=deletePreview?.kind==='line'&&deletePreview.idx===idx
      const isOffSel=offsetEntity?.kind==='line'&&offsetEntity.idx===idx
      const isOffHov=offsetHover?.kind==='line'&&offsetHover.idx===idx&&!isOffSel
      const isMirSel=mirrorSel.some(e=>e.kind==='line'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='line'&&mirrorHover.idx===idx&&!isMirSel
      const isMCSel=moveCopySel.some(e=>e.kind==='line'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='line'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='line'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='line'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='line'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='line'&&resizeHover.idx===idx&&!isRzSel
      const isFiSel=filletSel.some(e=>e.kind==='line'&&e.idx===idx)
      const isFiHov=filletHover?.kind==='line'&&filletHover.idx===idx&&!isFiSel
      const color=isDelTarget?'#F44336':isOffSel||isMirSel||isMCSel||isRCSel||isRzSel||isFiSel?'#FF9800':isOffHov||isMirHov||isMCHov||isRCHov||isRzHov||isFiHov?'#FFD600':'#222'
      const baseLW=(isDelTarget||isOffSel||isMirSel||isMCSel||isRCSel||isRzSel||isFiSel?3:isOffHov||isMirHov||isMCHov||isRCHov||isRzHov||isFiHov?2:1.5)/sc
      applyEntityStyle(ctx,line,sc,color,baseLW)
      ctx.beginPath();ctx.moveTo(line.x1,line.y1);ctx.lineTo(line.x2,line.y2);ctx.stroke();ctx.setLineDash([])
      ;[{x:line.x1,y:line.y1},{x:line.x2,y:line.y2}].forEach(p=>{
        ctx.beginPath();ctx.arc(p.x,p.y,3/sc,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()
      })
    })

    drawCircles.forEach((c,idx)=>{
      const isDelTarget=deletePreview?.kind==='circle'&&deletePreview.idx===idx
      const isMirSel=mirrorSel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='circle'&&mirrorHover.idx===idx&&!isMirSel
      const isMCSel=moveCopySel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='circle'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='circle'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='circle'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='circle'&&resizeHover.idx===idx&&!isRzSel
      ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2)
      const cColor=isDelTarget?'#F44336':isMirSel||isMCSel||isRCSel||isRzSel?'#FF9800':isMirHov||isMCHov||isRCHov||isRzHov?'#FFD600':'#222'
      const cLW=(isDelTarget||isMirSel||isMCSel||isRCSel||isRzSel?3:isMirHov||isMCHov||isRCHov||isRzHov?2:1.5)/sc
      applyEntityStyle(ctx,c,sc,cColor,cLW);ctx.stroke();ctx.setLineDash([])
      ctx.beginPath();ctx.arc(c.cx,c.cy,2/sc,0,Math.PI*2)
      ctx.fillStyle=isDelTarget?'#F44336':isMirSel||isMCSel||isRCSel||isRzSel?'#FF9800':isMirHov||isMCHov||isRCHov||isRzHov?'#FFD600':'#222';ctx.fill()
    })

    drawArcs.forEach((arc,idx)=>{
      const isDelTarget=deletePreview?.kind==='arc'&&deletePreview.idx===idx
      const isOffSel=offsetEntity?.kind==='arc'&&offsetEntity.idx===idx
      const isOffHov=offsetHover?.kind==='arc'&&offsetHover.idx===idx&&!isOffSel
      const isMirSel=mirrorSel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='arc'&&mirrorHover.idx===idx&&!isMirSel
      const isMCSel=moveCopySel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='arc'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='arc'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='arc'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='arc'&&resizeHover.idx===idx&&!isRzSel
      const color=isDelTarget?'#F44336':isOffSel||isMirSel||isMCSel||isRCSel||isRzSel?'#FF9800':isOffHov||isMirHov||isMCHov||isRCHov||isRzHov?'#FFD600':'#222'
      ctx.beginPath();ctx.arc(arc.cx,arc.cy,arc.r,arc.startAngle,arc.endAngle,false)
      const aLW=(isDelTarget||isOffSel||isMirSel||isMCSel||isRCSel||isRzSel?3:isOffHov||isMirHov||isMCHov||isRCHov||isRzHov?2:1.5)/sc
      applyEntityStyle(ctx,arc,sc,color,aLW);ctx.stroke();ctx.setLineDash([])
      ;[arc.startAngle,arc.endAngle].forEach(a=>{
        ctx.beginPath();ctx.arc(arc.cx+arc.r*Math.cos(a),arc.cy+arc.r*Math.sin(a),3/sc,0,Math.PI*2)
        ctx.fillStyle=color;ctx.fill()
      })
    })

    // Draw committed splines
    drawSplines.forEach((sp,idx)=>{
      if (sp.points.length<2) return
      const isDelTarget=deletePreview?.kind==='spline'&&deletePreview.idx===idx
      const isMirSel=mirrorSel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isMirHov=mirrorHover?.kind==='spline'&&mirrorHover.idx===idx&&!isMirSel
      const isMCSel=moveCopySel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isMCHov=moveCopyHover?.kind==='spline'&&moveCopyHover.idx===idx&&!isMCSel
      const isRCSel=rotateCopySel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isRCHov=rotateCopyHover?.kind==='spline'&&rotateCopyHover.idx===idx&&!isRCSel
      const isRzSel=resizeSel.some(e=>e.kind==='spline'&&e.idx===idx)
      const isRzHov=resizeHover?.kind==='spline'&&resizeHover.idx===idx&&!isRzSel
      const isOffSel=offsetEntity?.kind==='spline'&&offsetEntity.idx===idx
      const isOffHov=offsetHover?.kind==='spline'&&offsetHover.idx===idx&&!isOffSel
      const color=isDelTarget?'#F44336':isMirSel||isMCSel||isRCSel||isRzSel||isOffSel?'#FF9800':isMirHov||isMCHov||isRCHov||isRzHov||isOffHov?'#FFD600':'#222'
      const lw=(isDelTarget||isMirSel||isMCSel||isRCSel||isRzSel||isOffSel?3:isMirHov||isMCHov||isRCHov||isRzHov||isOffHov?2:1.5)/sc
      // Polyline (text/trimmed) splines use points directly — no Catmull-Rom resampling
      const sampled=sp.polyline ? sp.points : sampleSpline(sp.points,sp.closed,16)
      ctx.beginPath()
      ctx.moveTo(sampled[0].x,sampled[0].y)
      sampled.slice(1).forEach(p=>ctx.lineTo(p.x,p.y))
      applyEntityStyle(ctx,sp,sc,color,lw);ctx.stroke();ctx.setLineDash([])
      // Polyline splines (text): no dots — they have hundreds of points
      // Smooth splines: show control point dots
      if (!sp.polyline){
        sp.points.forEach(p=>{
          ctx.beginPath();ctx.arc(p.x,p.y,3/sc,0,Math.PI*2)
          ctx.fillStyle=color==='#222'?'#888':color;ctx.fill()
        })
      }
    })

    // Draw in-progress spline
    if (tool==='spline'&&splinePoints.length>0&&mousePos){
      const previewPts=[...splinePoints,mousePos]
      const showClosed=splineClosed&&previewPts.length>=3
      const sampled=previewPts.length>=2?sampleSpline(previewPts,showClosed,16):previewPts
      ctx.save()
      ctx.strokeStyle='#ff9800';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      ctx.beginPath()
      ctx.moveTo(sampled[0].x,sampled[0].y)
      sampled.slice(1).forEach(p=>ctx.lineTo(p.x,p.y))
      ctx.stroke();ctx.setLineDash([])
      // Placed control points
      splinePoints.forEach((p,i)=>{
        ctx.save();ctx.translate(p.x,p.y);ctx.scale(1/sc,1/sc)
        ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2)
        ctx.fillStyle=i===0?'#f97316':'#ff9800';ctx.fill()
        ctx.restore()
      })
      // Snap indicator for current mouse — include splines so we snap to existing curves
      const geo=getGeoSnap(mousePos,lines,circles,arcs,splinePoints[splinePoints.length-1],false,splines,intersectionPts)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
      // Closed badge
      if (showClosed){
        ctx.save();ctx.translate(splinePoints[0].x,splinePoints[0].y);ctx.scale(1/sc,1/sc)
        ctx.beginPath();ctx.arc(0,0,6,0,Math.PI*2)
        ctx.strokeStyle='#ff9800';ctx.lineWidth=2;ctx.stroke()
        ctx.restore()
      }
      ctx.restore()
    } else if (tool==='spline'&&splinePoints.length>0){
      // No mouse pos yet — draw placed points
      splinePoints.forEach((p,i)=>{
        ctx.save();ctx.translate(p.x,p.y);ctx.scale(1/sc,1/sc)
        ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2)
        ctx.fillStyle=i===0?'#f97316':'#ff9800';ctx.fill()
        ctx.restore()
      })
    }

    // Trim highlight
    if (tool==='trim'&&trimPreview){
      ctx.save()
      if (trimPreview.deletewhole){
        // Full entity — highlight red, signal delete
        ctx.strokeStyle='#F44336';ctx.lineWidth=3/sc
        if (trimPreview.kind==='line'){const l=lines[trimPreview.idx];if(l){ctx.beginPath();ctx.moveTo(l.x1,l.y1);ctx.lineTo(l.x2,l.y2);ctx.stroke()}}
        else if (trimPreview.kind==='circle'){const c=circles[trimPreview.idx];if(c){ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke()}}
        else if (trimPreview.kind==='arc'){const a=arcs[trimPreview.idx];if(a){ctx.beginPath();ctx.arc(a.cx,a.cy,a.r,a.startAngle,a.endAngle,false);ctx.stroke()}}
        else if (trimPreview.kind==='spline'){const sp=splines[trimPreview.idx];if(sp?.points.length>=2){const s2=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16);ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y);s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()}}
        drawLabel(ctx,'click to delete',mousePos.x,mousePos.y-20/sc,'#F44336',sc)
      } else {
        ctx.strokeStyle='#FF5722';ctx.lineWidth=5/sc
        if (trimPreview.kind==='line'){
          ctx.beginPath();ctx.moveTo(trimPreview.hx1,trimPreview.hy1);ctx.lineTo(trimPreview.hx2,trimPreview.hy2);ctx.stroke()
        } else if (trimPreview.kind==='spline'){
          if (trimPreview.highlightPts&&trimPreview.highlightPts.length>=2){
            ctx.beginPath();ctx.moveTo(trimPreview.highlightPts[0].x,trimPreview.highlightPts[0].y)
            trimPreview.highlightPts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()
          } else {
            const sp=splines[trimPreview.idx]
            if (sp?.points.length>=2){
              const s2=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16)
              ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y);s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()
            }
          }
        } else {
          ctx.setLineDash([5/sc,3/sc]);ctx.beginPath();ctx.arc(trimPreview.cx,trimPreview.cy,trimPreview.r,trimPreview.arcStart,trimPreview.arcEnd,false);ctx.stroke();ctx.setLineDash([])
        }
      }
      ctx.restore()
    }

    // Extend preview — dashed extension line in cyan, endpoint dot at boundary
    if (tool==='extend'&&extendPreview){
      ctx.save()
      ctx.strokeStyle='#00BCD4';ctx.lineWidth=2/sc;ctx.setLineDash([6/sc,3/sc])
      ctx.beginPath();ctx.moveTo(extendPreview.extStart.x,extendPreview.extStart.y);ctx.lineTo(extendPreview.extEnd.x,extendPreview.extEnd.y);ctx.stroke()
      ctx.setLineDash([])
      ctx.translate(extendPreview.extEnd.x,extendPreview.extEnd.y);ctx.scale(1/sc,1/sc)
      ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fillStyle='#00BCD4';ctx.fill()
      ctx.restore()
    }

    // Offset preview
    if (tool==='offset'&&offsetPreview&&mousePos){
      ctx.save();ctx.strokeStyle='#4CAF50';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      const p=offsetPreview
      if (p.kind==='line'){ctx.beginPath();ctx.moveTo(p.x1,p.y1);ctx.lineTo(p.x2,p.y2);ctx.stroke()}
      else if (p.kind==='circle'){ctx.beginPath();ctx.arc(p.cx,p.cy,p.r,0,Math.PI*2);ctx.stroke()}
      else if (p.kind==='arc'){ctx.beginPath();ctx.arc(p.cx,p.cy,p.r,p.startAngle,p.endAngle,false);ctx.stroke()}
      else if (p.kind==='spline'&&p.points?.length>=2){
        const s2=p.polyline?p.points:sampleSpline(p.points,p.closed,16)
        ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y);s2.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.stroke()
      }
      ctx.setLineDash([]);ctx.restore()
      const distMm=offsetDistLocked?parseFloat(offsetDistInput)||0:
        (offsetEntity&&mousePos?pxToMm(distToEntity(mousePos,
          offsetEntity.kind==='line'?drawLines[offsetEntity.idx]:
          offsetEntity.kind==='circle'?drawCircles[offsetEntity.idx]:
          offsetEntity.kind==='arc'?drawArcs[offsetEntity.idx]:drawSplines[offsetEntity.idx],
          offsetEntity.kind)):0)
      drawLabel(ctx,(offsetDistLocked?'🔒 ':'')+distMm.toFixed(1)+' mm · click to place',mousePos.x,mousePos.y-24/sc,'#4CAF50',sc)
    }

    // Mirror axis + preview
    if (tool==='mirror'&&mirrorAccepted&&mirrorP1&&mousePos){
      ctx.save()
      const hSnap=getGeoSnap(mousePos,lines,circles,arcs,mirrorP1,false,splines,intersectionPts)
      let endPt,snapType=null,angleSnap=null,tracks=[]
      if (hSnap&&hSnap.type!=='tan'&&hSnap.type!=='oncircle'){
        endPt={x:hSnap.x,y:hSnap.y};snapType=hSnap.type;angleSnap=checkAngle(mirrorP1,hSnap)
      } else {
        const{snapped,tracks:tr}=applyTracking(mousePos,trackedPts)
        tracks=tr
        const angled=getAngleSnap(mirrorP1,snapped)
        endPt={x:angled.x,y:angled.y};angleSnap=angled.angleSnap
      }
      if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)
      ctx.strokeStyle='#9C27B0';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      ctx.beginPath();ctx.moveTo(mirrorP1.x,mirrorP1.y);ctx.lineTo(endPt.x,endPt.y);ctx.stroke()
      ctx.setLineDash([])
      ctx.save();ctx.translate(mirrorP1.x,mirrorP1.y);ctx.scale(1/sc,1/sc)
      ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#9C27B0';ctx.fill()
      ctx.restore()
      if (angleSnap&&!snapType) drawHVIndicator(ctx,endPt.x,endPt.y,angleSnap,false,sc)
      if (angleSnap&&snapType)  drawHVIndicator(ctx,endPt.x,endPt.y,angleSnap,true,sc)
      if (snapType) drawLineIndicator(ctx,endPt.x,endPt.y,snapType,sc)
      ctx.restore()
      if (mirrorPreview){
        ctx.save();ctx.strokeStyle='#CE93D8';ctx.lineWidth=1.5/sc;ctx.setLineDash([4/sc,3/sc])
        mirrorPreview.newLines.forEach(l=>{if(l.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.moveTo(l.x1,l.y1);ctx.lineTo(l.x2,l.y2);ctx.stroke();ctx.setLineDash([])})
        mirrorPreview.newCircles.forEach(c=>{if(c.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([])})
        mirrorPreview.newArcs.forEach(a=>{if(a.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.arc(a.cx,a.cy,a.r,a.startAngle,a.endAngle,false);ctx.stroke();ctx.setLineDash([])})
        ;(mirrorPreview.newSplines||[]).forEach(sp=>{
          if(sp.points.length<2)return
          const s2=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16)
          ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y)
          s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()
        })
        ctx.setLineDash([]);ctx.restore()
      }
    }

    // Mirror first-point snap indicator (before mirrorP1 is set)
    if (tool==='mirror'&&mirrorAccepted&&!mirrorP1&&mousePos){
      const geo=getGeoSnap(mousePos,lines,circles,arcs,null,false,splines,intersectionPts)
      const{tracks}=applyTracking(mousePos,trackedPts)
      if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
    }

    // Move/Copy preview
    if (tool==='movecopy'&&moveCopyAccepted&&startPoint&&mousePos){
      const end=computeEnd(startPoint,mousePos,trackedPts)
      const dx=end.x-startPoint.x,dy=end.y-startPoint.y
      const dist=Math.hypot(dx,dy)
      const count=Math.max(1,parseInt(moveCopyCountInput)||1)
      const previewColor=moveCopyMode==='copy'?'#2196F3':'#4CAF50'
      ctx.save()
      ctx.strokeStyle='#88888866';ctx.lineWidth=1/sc;ctx.setLineDash([4/sc,4/sc])
      ctx.beginPath();ctx.moveTo(startPoint.x,startPoint.y);ctx.lineTo(end.x,end.y);ctx.stroke()
      ctx.setLineDash([])
      ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc)
      ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#888';ctx.fill()
      ctx.restore()
      if (end.tracks?.length) drawTracks(ctx,end.tracks,trackedPts,sc)
      if (end.angleSnap&&!end.snapType) drawHVIndicator(ctx,end.x,end.y,end.angleSnap,false,sc)
      if (end.angleSnap&&end.snapType)  drawHVIndicator(ctx,end.x,end.y,end.angleSnap,true,sc)
      if (end.snapType) drawLineIndicator(ctx,end.x,end.y,end.snapType,sc)
      const midX=(startPoint.x+end.x)/2,midY=(startPoint.y+end.y)/2
      drawLabel(ctx,(dimLocked?'🔒 ':'')+(dimInput||pxToMm(dist).toFixed(1))+' mm',midX,midY-2/sc,dimLocked?'#FF9800':focusField==='dim'?'#1565C0':'#2196F3',sc)
      drawLabel(ctx,(angleLocked?'🔒 ':'')+(angleInput||computeLiveAngle(startPoint,end).toFixed(1))+'°',midX,midY+22/sc,angleLocked?'#FF9800':focusField==='angle'?'#6A1B9A':'#9C27B0',sc)
      ctx.save()
      ctx.strokeStyle=previewColor;ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      for (let i=1;i<=count;i++){
        const tdx=dx*i,tdy=dy*i
        moveCopySel.forEach(e=>{
          if (e.kind==='line'){const l=lines[e.idx];if(l.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.moveTo(l.x1+tdx,l.y1+tdy);ctx.lineTo(l.x2+tdx,l.y2+tdy);ctx.stroke();ctx.setLineDash([])}
          if (e.kind==='circle'){const c=circles[e.idx];if(c.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.arc(c.cx+tdx,c.cy+tdy,c.r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([])}
          if (e.kind==='arc'){const a=arcs[e.idx];if(a.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.arc(a.cx+tdx,a.cy+tdy,a.r,a.startAngle,a.endAngle,false);ctx.stroke();ctx.setLineDash([])}
          if (e.kind==='spline'){
            const sp=splines[e.idx];if(!sp)return
            const pts=sp.points.map(p=>({x:p.x+tdx,y:p.y+tdy}))
            const s2=sp.polyline?pts:sampleSpline(pts,sp.closed,16)
            ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y)
            s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()
          }
        })
      }
      ctx.setLineDash([]);ctx.restore()
    }

    // Rotate/Copy preview
    if (tool==='rotatecopy'&&rotateCopyAccepted&&startPoint&&mousePos){
      const dx=mousePos.x-startPoint.x,dy=mousePos.y-startPoint.y
      let displayDeg=angleLocked?(parseFloat(angleInput)||0):(Math.atan2(dy,dx)*180/Math.PI)
      if (!angleLocked&&displayDeg<0) displayDeg+=360
      const rotRad=displayDeg*Math.PI/180
      const count=Math.max(1,parseInt(rotateCopyCountInput)||1)
      const previewColor=rotateCopyMode==='copy'?'#2196F3':'#4CAF50'
      ctx.save()
      ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc)
      ctx.strokeStyle='#888';ctx.lineWidth=1.5
      ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.stroke()
      ctx.beginPath();ctx.moveTo(-10,0);ctx.lineTo(10,0);ctx.moveTo(0,-10);ctx.lineTo(0,10);ctx.stroke()
      ctx.restore()
      ctx.save()
      ctx.strokeStyle='#88888866';ctx.lineWidth=1/sc;ctx.setLineDash([4/sc,4/sc])
      ctx.beginPath();ctx.moveTo(startPoint.x,startPoint.y);ctx.lineTo(mousePos.x,mousePos.y);ctx.stroke()
      ctx.setLineDash([]);ctx.restore()
      drawLabel(ctx,(angleLocked?'🔒 ':'')+(angleInput||displayDeg.toFixed(1))+'°',mousePos.x,mousePos.y-14/sc,angleLocked?'#FF9800':'#9C27B0',sc)
      ctx.save()
      ctx.strokeStyle=previewColor;ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
      for (let i=1;i<=count;i++){
        const rad=rotRad*i
        rotateCopySel.forEach(e=>{
          if (e.kind==='line'){const l=lines[e.idx];const p1=rotatePoint(l.x1,l.y1,startPoint.x,startPoint.y,rad);const p2=rotatePoint(l.x2,l.y2,startPoint.x,startPoint.y,rad);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke()}
          if (e.kind==='circle'){const c=circles[e.idx];const cp=rotatePoint(c.cx,c.cy,startPoint.x,startPoint.y,rad);ctx.beginPath();ctx.arc(cp.x,cp.y,c.r,0,Math.PI*2);ctx.stroke()}
          if (e.kind==='arc'){const a=arcs[e.idx];const cp=rotatePoint(a.cx,a.cy,startPoint.x,startPoint.y,rad);ctx.beginPath();ctx.arc(cp.x,cp.y,a.r,a.startAngle+rad,a.endAngle+rad,false);ctx.stroke()}
          if (e.kind==='spline'){
            const sp=splines[e.idx];if(!sp)return
            const pts=sp.points.map(p=>rotatePoint(p.x,p.y,startPoint.x,startPoint.y,rad))
            const s2=sp.polyline?pts:sampleSpline(pts,sp.closed,16)
            ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y)
            s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()
          }
        })
      }
      ctx.setLineDash([]);ctx.restore()
    }

    // Resize preview — ghost geometry scaled around mouse as potential anchor
    if (tool==='resize'&&resizeAccepted&&mousePos&&resizeSel.length){
      const s=parseFloat(resizeScaleInput)
      if (s>0){
        const geo=getGeoSnap(mousePos,lines,circles,arcs,null,false,splines,intersectionPts)
        const anchor=geo?{x:geo.x,y:geo.y}:mousePos
        const preview=buildScaled(resizeSel,lines,circles,arcs,splines,anchor.x,anchor.y,s)
        ctx.save();ctx.strokeStyle='#FF9800';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc])
        preview.newLines.forEach(l=>{if(l.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.moveTo(l.x1,l.y1);ctx.lineTo(l.x2,l.y2);ctx.stroke();ctx.setLineDash([])})
        preview.newCircles.forEach(c=>{if(c.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([])})
        preview.newArcs.forEach(a=>{if(a.style==='dashed')ctx.setLineDash([8/sc,4/sc]);ctx.beginPath();ctx.arc(a.cx,a.cy,a.r,a.startAngle,a.endAngle,false);ctx.stroke();ctx.setLineDash([])})
        ;(preview.newSplines||[]).forEach(sp=>{if(sp.points.length<2)return;const s2=sp.polyline?sp.points:sampleSpline(sp.points,sp.closed,16);ctx.beginPath();ctx.moveTo(s2[0].x,s2[0].y);s2.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke()})
        ctx.setLineDash([]);ctx.restore()
        // Anchor marker
        ctx.save();ctx.translate(anchor.x,anchor.y);ctx.scale(1/sc,1/sc)
        ctx.strokeStyle='#FF9800';ctx.lineWidth=1.5
        ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.stroke()
        ctx.beginPath();ctx.moveTo(-8,0);ctx.lineTo(8,0);ctx.moveTo(0,-8);ctx.lineTo(0,8);ctx.stroke()
        ctx.restore()
        if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
        drawLabel(ctx,(resizeScaleInput||'—')+'×',anchor.x,anchor.y-18/sc,'#FF9800',sc)
      }
    }

    // Draw committed dimensions
    dims.forEach((dim,di)=>{
      ctx.save()
      ctx.strokeStyle='#222';ctx.fillStyle='#222'
      const LW=0.8/sc, ARR=6/sc, FS=11/sc
      ctx.lineWidth=LW
      if (dim.kind==='linear'){
        const dx=dim.x2-dim.x1,dy=dim.y2-dim.y1,len=Math.hypot(dx,dy)
        if(len<1){ctx.restore();return}
        const ux=dx/len,uy=dy/len,nx=-uy,ny=ux
        const off=dim.offset
        // Extension lines from endpoints to dim line
        const ext=ARR*1.5
        ctx.beginPath()
        ctx.moveTo(dim.x1,dim.y1)
        ctx.lineTo(dim.x1+nx*(off+Math.sign(off)*ext),dim.y1+ny*(off+Math.sign(off)*ext))
        ctx.moveTo(dim.x2,dim.y2)
        ctx.lineTo(dim.x2+nx*(off+Math.sign(off)*ext),dim.y2+ny*(off+Math.sign(off)*ext))
        ctx.stroke()
        // Dimension line with arrows
        const d1x=dim.x1+nx*off,d1y=dim.y1+ny*off
        const d2x=dim.x2+nx*off,d2y=dim.y2+ny*off
        ctx.beginPath();ctx.moveTo(d1x,d1y);ctx.lineTo(d2x,d2y);ctx.stroke()
        // Arrow heads
        ;[[d1x,d1y,ux,uy],[d2x,d2y,-ux,-uy]].forEach(([ax,ay,ax2,ay2])=>{
          ctx.beginPath()
          ctx.moveTo(ax,ay)
          ctx.lineTo(ax+ax2*ARR-ay2*ARR*0.35,ay+ay2*ARR+ax2*ARR*0.35)
          ctx.lineTo(ax+ax2*ARR+ay2*ARR*0.35,ay+ay2*ARR-ax2*ARR*0.35)
          ctx.closePath();ctx.fill()
        })
        // Text
        const txt=dim.text||pxToMm(len).toFixed(2)+' mm'
        const mx=(d1x+d2x)/2,my=(d1y+d2y)/2
        ctx.save();ctx.translate(mx,my);ctx.scale(1/sc,1/sc)
        let ang=Math.atan2(uy,ux)
        if(ang>Math.PI/2||ang<-Math.PI/2) ang+=Math.PI
        ctx.rotate(ang)
        ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='bottom'
        ctx.fillStyle='#222';ctx.fillText(txt,0,-3)
        ctx.restore()
      } else if (dim.kind==='diameter'){
        const {cx,cy,r,angle}=dim
        const cos=Math.cos(angle),sin=Math.sin(angle)
        const p1x=cx-r*cos,p1y=cy-r*sin
        const p2x=cx+r*cos,p2y=cy+r*sin
        ctx.beginPath();ctx.moveTo(p1x,p1y);ctx.lineTo(p2x,p2y);ctx.stroke()
        ;[[p1x,p1y,cos,sin],[p2x,p2y,-cos,-sin]].forEach(([ax,ay,ax2,ay2])=>{
          ctx.beginPath()
          ctx.moveTo(ax,ay)
          ctx.lineTo(ax+ax2*ARR-ay2*ARR*0.35,ay+ay2*ARR+ax2*ARR*0.35)
          ctx.lineTo(ax+ax2*ARR+ay2*ARR*0.35,ay+ay2*ARR-ax2*ARR*0.35)
          ctx.closePath();ctx.fill()
        })
        const txt=dim.text||'⌀'+pxToMm(r*2).toFixed(2)+' mm'
        ctx.save();ctx.translate(cx,cy);ctx.scale(1/sc,1/sc)
        let a=angle;if(a>Math.PI/2||a<-Math.PI/2) a+=Math.PI
        ctx.rotate(a);ctx.font=`${FS*sc}px sans-serif`
        ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,0,-3)
        ctx.restore()
      } else if (dim.kind==='radius'){
        const {cx,cy,r,angle}=dim
        const ex=cx+r*Math.cos(angle),ey=cy+r*Math.sin(angle)
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ex,ey);ctx.stroke()
        const cos=Math.cos(angle),sin=Math.sin(angle)
        ctx.beginPath()
        ctx.moveTo(ex,ey)
        ctx.lineTo(ex-cos*ARR-sin*ARR*0.35,ey-sin*ARR+cos*ARR*0.35)
        ctx.lineTo(ex-cos*ARR+sin*ARR*0.35,ey-sin*ARR-cos*ARR*0.35)
        ctx.closePath();ctx.fill()
        const txt=dim.text||'R'+pxToMm(r).toFixed(2)+' mm'
        ctx.save();ctx.translate(cx,cy);ctx.scale(1/sc,1/sc)
        let a=angle;if(a>Math.PI/2||a<-Math.PI/2) a+=Math.PI
        ctx.rotate(a);ctx.font=`${FS*sc}px sans-serif`
        ctx.textAlign='center';ctx.textBaseline='bottom'
        ctx.fillText(txt,(r/2*sc/sc)*(a===angle?1:-1),-3)
        ctx.restore()
      }
      ctx.restore()
    })

    // Draw dim tool preview
    if (tool==='dim'&&dimToolPreview&&mousePos){
      ctx.save();ctx.strokeStyle='#E91E63';ctx.fillStyle='#E91E63';ctx.lineWidth=0.8/sc;ctx.setLineDash([4/sc,2/sc])
      const LW=0.8/sc,ARR=6/sc,FS=11/sc
      const p=dimToolPreview
      if (p.kind==='linear'){
        const dx=p.x2-p.x1,dy=p.y2-p.y1,len=Math.hypot(dx,dy)
        if(len>1){
          const ux=dx/len,uy=dy/len,nx=-uy,ny=ux,off=p.offset
          ctx.beginPath()
          ctx.moveTo(p.x1,p.y1);ctx.lineTo(p.x1+nx*(off+Math.sign(off||1)*ARR*1.5),p.y1+ny*(off+Math.sign(off||1)*ARR*1.5))
          ctx.moveTo(p.x2,p.y2);ctx.lineTo(p.x2+nx*(off+Math.sign(off||1)*ARR*1.5),p.y2+ny*(off+Math.sign(off||1)*ARR*1.5))
          ctx.moveTo(p.x1+nx*off,p.y1+ny*off);ctx.lineTo(p.x2+nx*off,p.y2+ny*off)
          ctx.stroke()
          const txt=pxToMm(len).toFixed(2)+' mm'
          const mx=(p.x1+p.x2)/2+nx*off,my=(p.y1+p.y2)/2+ny*off
          ctx.save();ctx.translate(mx,my);ctx.scale(1/sc,1/sc)
          let a=Math.atan2(uy,ux);if(a>Math.PI/2||a<-Math.PI/2) a+=Math.PI
          ctx.rotate(a);ctx.setLineDash([]);ctx.font=`${FS*sc}px sans-serif`
          ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,0,-3)
          ctx.restore()
        }
      } else if (p.kind==='diameter'){
        const cos=Math.cos(p.angle),sin=Math.sin(p.angle)
        ctx.beginPath();ctx.moveTo(p.cx-p.r*cos,p.cy-p.r*sin);ctx.lineTo(p.cx+p.r*cos,p.cy+p.r*sin);ctx.stroke()
        ctx.setLineDash([]);ctx.save();ctx.translate(p.cx,p.cy);ctx.scale(1/sc,1/sc)
        ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='bottom'
        ctx.fillText('⌀'+pxToMm(p.r*2).toFixed(2)+' mm',0,-3)
        ctx.restore()
      } else if (p.kind==='radius'){
        const ex=p.cx+p.r*Math.cos(p.angle),ey=p.cy+p.r*Math.sin(p.angle)
        ctx.beginPath();ctx.moveTo(p.cx,p.cy);ctx.lineTo(ex,ey);ctx.stroke()
        ctx.setLineDash([]);ctx.save();ctx.translate(ex,ey);ctx.scale(1/sc,1/sc)
        ctx.font=`${FS*sc}px sans-serif`;ctx.textAlign='left';ctx.textBaseline='bottom'
        ctx.fillText('R'+pxToMm(p.r).toFixed(2)+' mm',4,-3)
        ctx.restore()
      }
      // First point dot
      if (dimToolPts.length>0){
        ctx.setLineDash([]);ctx.beginPath();ctx.arc(dimToolPts[0].x,dimToolPts[0].y,4/sc,0,Math.PI*2);ctx.fill()
      }
      if (dimToolPts.length>1){
        ctx.beginPath();ctx.arc(dimToolPts[1].x,dimToolPts[1].y,4/sc,0,Math.PI*2);ctx.fill()
      }
      ctx.restore()
    }

    // Join tool draw
    if (tool==='join'&&mousePos){
      ctx.save()
      // Draw hover endpoint highlight
      const hov=joinFirstPt||joinHover
      if (hov){
        const isFirst=!!joinFirstPt
        ctx.beginPath();ctx.arc(hov.x,hov.y,8/sc,0,Math.PI*2)
        ctx.strokeStyle=isFirst?'#FF9800':'#26C6DA';ctx.lineWidth=2/sc;ctx.stroke()
        ctx.beginPath();ctx.arc(hov.x,hov.y,3/sc,0,Math.PI*2)
        ctx.fillStyle=isFirst?'#FF9800':'#26C6DA';ctx.fill()
      }
      // Draw rubber-band line from first point to mouse
      if (joinFirstPt){
        const snap=getGeoSnap(mousePos,lines,circles,arcs,{x:joinFirstPt.x,y:joinFirstPt.y},false,splines,intersectionPts)
        const snapPt=snap||mousePos
        ctx.beginPath();ctx.moveTo(joinFirstPt.x,joinFirstPt.y)
        ctx.lineTo(snapPt.x,snapPt.y)
        ctx.strokeStyle='#FF980066';ctx.lineWidth=1/sc;ctx.setLineDash([6/sc,3/sc]);ctx.stroke()
        ctx.setLineDash([])
        if (snap) drawLineIndicator(ctx,snap.x,snap.y,snap.type,sc)
        // Also highlight hover endpoint on second click target
        if (joinHover&&joinHover!==joinFirstPt){
          ctx.beginPath();ctx.arc(joinHover.x,joinHover.y,8/sc,0,Math.PI*2)
          ctx.strokeStyle='#26C6DA';ctx.lineWidth=2/sc;ctx.stroke()
        }
      }
      ctx.restore()
    }

    // Select tool — bounding box, handles, hover highlight, dimension info
    if (tool==='select'){
      const curLines   = selectLiveGeom?.lines   || lines
      const curCircles = selectLiveGeom?.circles || circles
      const curArcs    = selectLiveGeom?.arcs    || arcs
      const curSplines = selectLiveGeom?.splines || splines

      // Highlight hovered entity
      if (selectHover&&!selection.some(s=>s.kind===selectHover.kind&&s.idx===selectHover.idx)){
        ctx.save();ctx.strokeStyle='#64B5F6';ctx.lineWidth=2/sc
        if (selectHover.kind==='line'){const l=lines[selectHover.idx];if(l){ctx.beginPath();ctx.moveTo(l.x1,l.y1);ctx.lineTo(l.x2,l.y2);ctx.stroke()}}
        if (selectHover.kind==='circle'){const c=circles[selectHover.idx];if(c){ctx.beginPath();ctx.arc(c.cx,c.cy,c.r,0,Math.PI*2);ctx.stroke()}}
        if (selectHover.kind==='arc'){const a=arcs[selectHover.idx];if(a){ctx.beginPath();ctx.arc(a.cx,a.cy,a.r,a.startAngle,a.endAngle,false);ctx.stroke()}}
        ctx.restore()
      }

      // Bounding box and handles for selection
      if (selection.length>0){
        const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)
        if (bbox){
          ctx.save()
          // Dashed bounding box
          ctx.strokeStyle='#2196F3';ctx.lineWidth=1/sc;ctx.setLineDash([6/sc,3/sc])
          ctx.strokeRect(bbox.x1,bbox.y1,bbox.w,bbox.h)
          ctx.setLineDash([])
          // Handles
          const handles=getBBoxHandles(bbox)
          const handleR=6/sc
          const hovHandle=mousePos?hitTestHandles(mousePos,handles,12/sc):null
          Object.values(handles).forEach(h=>{
            ctx.save();ctx.translate(h.x,h.y);ctx.scale(1/sc,1/sc)
            const isHov=hovHandle===h.id
            if (h.id==='mc'){
              ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2)
              ctx.fillStyle=isHov?'#2196F3':'#fff';ctx.fill()
              ctx.strokeStyle='#2196F3';ctx.lineWidth=2;ctx.stroke()
            } else {
              ctx.fillStyle=isHov?'#2196F3':'#fff'
              ctx.fillRect(-5,-5,10,10)
              ctx.strokeStyle='#2196F3';ctx.lineWidth=1.5;ctx.strokeRect(-5,-5,10,10)
            }
            ctx.restore()
          })

          // Dimension info — interactive editing labels
          const activeColor='#FF9800'
          if (selection.length===1){
            const e0=selection[0]
            const activeColor='#FF9800'
            const inactiveColor='#2196F3'
            if (e0.kind==='line'){
              const l=curLines[e0.idx];if(l){
                const len=pxToMm(Math.hypot(l.x2-l.x1,l.y2-l.y1))
                let ang=Math.atan2(-(l.y2-l.y1),l.x2-l.x1)*180/Math.PI;if(ang<0)ang+=360
                const lenActive=selectDimField==='length'
                const angActive=selectDimField==='angle'
                const lenText=(lenActive&&selectDimPending.length?selectDimPending.length:len.toFixed(2))+' mm'
                const angText=(angActive&&selectDimPending.angle?selectDimPending.angle:ang.toFixed(1))+'°'
                const bx=(bbox.x1+bbox.x2)/2
                drawLabel(ctx,(lenActive?'✏ ':'')+lenText,bx,bbox.y1-36/sc,lenActive?activeColor:inactiveColor,sc)
                drawLabel(ctx,(angActive?'✏ ':'')+angText,bx,bbox.y1-18/sc,angActive?activeColor:inactiveColor,sc)
                if (!selectDimField) drawLabel(ctx,'Tab to edit',bx,bbox.y1-54/sc,'#444',sc)
              // 3x3 anchor grid — above bbox, centred
              {
                const gx=(bbox.x1+bbox.x2)/2,gy=bbox.y1-80/sc
                const gridIds=[['tl','tc','tr'],['ml','mc','mr'],['bl','bc','br']]
                const cell=14/sc
                ctx.save()
                // Background pill
                const pw=cell*4,ph=cell*4
                ctx.fillStyle='rgba(0,0,0,0.55)'
                ctx.beginPath();ctx.roundRect(gx-pw/2-2/sc,gy-ph/2-2/sc,pw+4/sc,ph+4/sc,4/sc)
                ctx.fill()
                gridIds.forEach((row,ri)=>row.forEach((id,ci)=>{
                  const px=gx+(ci-1)*cell*1.6,py=gy+(ri-1)*cell*1.6
                  const isAnchor=id===selectDimAnchor
                  const r=isAnchor?6/sc:3.5/sc
                  ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2)
                  ctx.fillStyle=isAnchor?'#FFD600':'#90CAF9';ctx.fill()
                  if(isAnchor){ctx.strokeStyle='#fff';ctx.lineWidth=1.5/sc;ctx.stroke()}
                }))
                ctx.restore()
              }
              }
            } else if (e0.kind==='circle'){
              const c=curCircles[e0.idx];if(c){
                const r=pxToMm(c.r)
                const radActive=selectDimField==='radius'
                const rText='R '+(radActive&&selectDimInput?selectDimInput:r.toFixed(2))+' mm'
                drawLabel(ctx,(radActive?'✏ ':'')+rText,(bbox.x1+bbox.x2)/2,bbox.y1-18/sc,radActive?activeColor:inactiveColor,sc)
                if (!selectDimField) drawLabel(ctx,'Tab to edit',(bbox.x1+bbox.x2)/2,bbox.y1-36/sc,'#444',sc)
                else drawLabel(ctx,'click dot=anchor',(bbox.x1+bbox.x2)/2,bbox.y1-36/sc,'#FFD600',sc)
                // 3x3 anchor grid — above bbox, centred
                {
                  const gx=(bbox.x1+bbox.x2)/2,gy=bbox.y1-80/sc
                  const gridIds=[['tl','tc','tr'],['ml','mc','mr'],['bl','bc','br']]
                  const cell=14/sc
                  ctx.save()
                  ctx.fillStyle='rgba(0,0,0,0.55)'
                  ctx.beginPath();ctx.roundRect(gx-cell*2.4-2/sc,gy-cell*2.4-2/sc,cell*4.8+4/sc,cell*4.8+4/sc,4/sc)
                  ctx.fill()
                  gridIds.forEach((row,ri)=>row.forEach((id,ci)=>{
                    const px=gx+(ci-1)*cell*1.6,py=gy+(ri-1)*cell*1.6
                    const isAnchor=id===selectDimAnchor
                    ctx.beginPath();ctx.arc(px,py,isAnchor?6/sc:3.5/sc,0,Math.PI*2)
                    ctx.fillStyle=isAnchor?'#FFD600':'#90CAF9';ctx.fill()
                    if(isAnchor){ctx.strokeStyle='#fff';ctx.lineWidth=1.5/sc;ctx.stroke()}
                  }))
                  ctx.restore()
                }
              }
            } else if (e0.kind==='arc'){
              const a=curArcs[e0.idx];if(a){
                const r=pxToMm(a.r)
                const span=norm2pi(a.endAngle-a.startAngle)*180/Math.PI
                const radActive=selectDimField==='radius'
                const angActive=selectDimField==='angle'
                const rText='R '+(radActive&&selectDimPending.radius?selectDimPending.radius:r.toFixed(2))+' mm'
                const aText=(angActive&&selectDimPending.angle?selectDimPending.angle:span.toFixed(1))+'°'
                const bx=(bbox.x1+bbox.x2)/2
                drawLabel(ctx,(radActive?'✏ ':'')+rText,bx,bbox.y1-36/sc,radActive?activeColor:inactiveColor,sc)
                drawLabel(ctx,(angActive?'✏ ':'')+aText,bx,bbox.y1-18/sc,angActive?activeColor:inactiveColor,sc)
                if (!selectDimField) drawLabel(ctx,'Tab to edit',bx,bbox.y1-54/sc,'#444',sc)
              // 3x3 anchor grid — above bbox, centred
              {
                const gx=(bbox.x1+bbox.x2)/2,gy=bbox.y1-80/sc
                const gridIds=[['tl','tc','tr'],['ml','mc','mr'],['bl','bc','br']]
                const cell=14/sc
                ctx.save()
                // Background pill
                const pw=cell*4,ph=cell*4
                ctx.fillStyle='rgba(0,0,0,0.55)'
                ctx.beginPath();ctx.roundRect(gx-pw/2-2/sc,gy-ph/2-2/sc,pw+4/sc,ph+4/sc,4/sc)
                ctx.fill()
                gridIds.forEach((row,ri)=>row.forEach((id,ci)=>{
                  const px=gx+(ci-1)*cell*1.6,py=gy+(ri-1)*cell*1.6
                  const isAnchor=id===selectDimAnchor
                  const r=isAnchor?6/sc:3.5/sc
                  ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2)
                  ctx.fillStyle=isAnchor?'#FFD600':'#90CAF9';ctx.fill()
                  if(isAnchor){ctx.strokeStyle='#fff';ctx.lineWidth=1.5/sc;ctx.stroke()}
                }))
                ctx.restore()
              }
              }
            } else {
              drawLabel(ctx,`${selection.length} selected`,(bbox.x1+bbox.x2)/2,bbox.y1-18/sc,'#64B5F6',sc)
            }
          } else if (selection.length>1){
            const wActive=selectDimField==='width'
            const hActive=selectDimField==='height'
            const wText='W '+(wActive&&selectDimPending.width?selectDimPending.width:pxToMm(bbox.w).toFixed(2))+' mm'
            const hText='H '+(hActive&&selectDimPending.height?selectDimPending.height:pxToMm(bbox.h).toFixed(2))+' mm'
            const bx=(bbox.x1+bbox.x2)/2
            drawLabel(ctx,(wActive?'✏ ':'')+wText,bx,bbox.y1-36/sc,wActive?activeColor:'#64B5F6',sc)
            drawLabel(ctx,(hActive?'✏ ':'')+hText,bx,bbox.y1-18/sc,hActive?activeColor:'#64B5F6',sc)
            if (!selectDimField) drawLabel(ctx,`${selection.length} entities · Tab to edit`,bx,bbox.y1-54/sc,'#444',sc)
            // 3x3 anchor grid — above bbox
            {
              const gx=(bbox.x1+bbox.x2)/2,gy=bbox.y1-80/sc
              const gridIds=[['tl','tc','tr'],['ml','mc','mr'],['bl','bc','br']]
              const cell=14/sc
              ctx.save()
              ctx.fillStyle='rgba(0,0,0,0.55)'
              ctx.beginPath();ctx.roundRect(gx-cell*2.4-2/sc,gy-cell*2.4-2/sc,cell*4.8+4/sc,cell*4.8+4/sc,4/sc)
              ctx.fill()
              gridIds.forEach((row,ri)=>row.forEach((id,ci)=>{
                const px=gx+(ci-1)*cell*1.6,py=gy+(ri-1)*cell*1.6
                const isAnchor=id===selectDimAnchor
                ctx.beginPath();ctx.arc(px,py,isAnchor?6/sc:3.5/sc,0,Math.PI*2)
                ctx.fillStyle=isAnchor?'#FFD600':'#90CAF9';ctx.fill()
                if(isAnchor){ctx.strokeStyle='#fff';ctx.lineWidth=1.5/sc;ctx.stroke()}
              }))
              ctx.restore()
            }
          }
          ctx.restore()
        }
      }
    }

    // Drag window select rectangle
    if (dragSelectRect){
      const {x1,y1,x2,y2}=dragSelectRect
      const rx=Math.min(x1,x2),ry=Math.min(y1,y2),rw=Math.abs(x2-x1),rh=Math.abs(y2-y1)
      ctx.save()
      ctx.fillStyle='rgba(33,150,243,0.06)';ctx.fillRect(rx,ry,rw,rh)
      ctx.strokeStyle='#2196F3';ctx.lineWidth=1/sc;ctx.setLineDash([4/sc,4/sc])
      ctx.strokeRect(rx,ry,rw,rh)
      ctx.setLineDash([]);ctx.restore()
    }

    // Fillet preview
    if (tool==='fillet'&&filletAccepted&&filletPreview){
      if (filletPreview.tooLarge){
        // Radius too large — show in red
        if (mousePos) drawLabel(ctx,'Radius too large',mousePos.x,mousePos.y-20/sc,'#F44336',sc)
      } else {
        ctx.save();ctx.setLineDash([6/sc,3/sc])
        // Trimmed lines preview (green)
        ctx.strokeStyle='#4CAF50';ctx.lineWidth=2/sc
        const{newL1,newL2,arc,T1,T2}=filletPreview
        ctx.beginPath();ctx.moveTo(newL1.x1,newL1.y1);ctx.lineTo(newL1.x2,newL1.y2);ctx.stroke()
        ctx.beginPath();ctx.moveTo(newL2.x1,newL2.y1);ctx.lineTo(newL2.x2,newL2.y2);ctx.stroke()
        // Arc preview
        ctx.strokeStyle='#4CAF50';ctx.lineWidth=2/sc
        ctx.beginPath();ctx.arc(arc.cx,arc.cy,arc.r,arc.startAngle,arc.endAngle,false);ctx.stroke()
        ctx.setLineDash([])
        // Tangent point markers
        ;[T1,T2].forEach(t=>{
          ctx.save();ctx.translate(t.x,t.y);ctx.scale(1/sc,1/sc)
          ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2)
          ctx.fillStyle='#4CAF50';ctx.fill()
          ctx.restore()
        })
        const r=mmToPx(parseFloat(filletRadiusInput)||0)
        drawLabel(ctx,'R '+pxToMm(r).toFixed(1)+' mm · Enter or click to apply',arc.cx,arc.cy-arc.r/sc-18/sc,'#4CAF50',sc)
        ctx.restore()
      }
    }

    if (!mousePos) return

    if (tool==='line'&&deferredTangent){
      const dc=deferredTangent
      const hSnap=getGeoSnap(mousePos,lines,circles,arcs,null,tKeyDown,splines,intersectionPts)
      if (hSnap?.type==='tan'&&hSnap.circleIdx!==undefined&&dc.circleIdx!==undefined&&hSnap.circleIdx!==dc.circleIdx){
        const c2=circles[hSnap.circleIdx],pairs=getExternalTangentPairs(dc,c2)
        pairs.forEach(p=>drawPreviewLine(ctx,p.t1.x,p.t1.y,p.t2.x,p.t2.y,'#2196F3',0.25,sc))
        const best=pairs.length?pairs.reduce((a,b)=>Math.hypot(a.t1.x-startPoint.x,a.t1.y-startPoint.y)<Math.hypot(b.t1.x-startPoint.x,b.t1.y-startPoint.y)?a:b):null
        if (best){drawPreviewLine(ctx,best.t1.x,best.t1.y,best.t2.x,best.t2.y,'#2196F3',1,sc);drawLineIndicator(ctx,best.t1.x,best.t1.y,'tan',sc);drawLineIndicator(ctx,best.t2.x,best.t2.y,'tan',sc)}
      } else {
        const endPt=(hSnap&&hSnap.type!=='tan')?{x:hSnap.x,y:hSnap.y}:mousePos
        const tanPts=getTanPtsOnCircle(endPt.x,endPt.y,dc.cx,dc.cy,dc.r)
        tanPts.forEach(tp=>drawPreviewLine(ctx,tp.x,tp.y,endPt.x,endPt.y,'#2196F3',0.25,sc))
        const best=nearestPt(tanPts,startPoint)
        if (best){drawPreviewLine(ctx,best.x,best.y,endPt.x,endPt.y,'#2196F3',1,sc);drawLineIndicator(ctx,best.x,best.y,'tan',sc);if(hSnap&&hSnap.type!=='tan')drawLineIndicator(ctx,endPt.x,endPt.y,hSnap.type,sc)}
      }
    } else if (tool==='line'&&startPoint){
      // PERP mode: completely bypass tangent/snap system
      if (pKeyDown) {
        let endPt
        if (perpSourceLineIdx!==null && lines[perpSourceLineIdx]) {
          // FROM mode: direction is locked perpendicular to source line
          // Project mouse onto the perpendicular ray from startPoint
          const sl=lines[perpSourceLineIdx]
          const dx=sl.x2-sl.x1, dy=sl.y2-sl.y1, len=Math.hypot(dx,dy)
          if (len>1e-10) {
            // Perpendicular direction to source line
            const px=-dy/len, py=dx/len
            // Project mouse onto this ray from startPoint
            const t=(mousePos.x-startPoint.x)*px+(mousePos.y-startPoint.y)*py
            endPt={x:startPoint.x+t*px, y:startPoint.y+t*py}
          } else {
            endPt=mousePos
          }
          drawPreviewLine(ctx,startPoint.x,startPoint.y,endPt.x,endPt.y,'#00BCD4',1,sc)
          ctx.save();ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc)
          ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#00BCD4';ctx.fill()
          ctx.restore()
          drawPerpIndicator(ctx,endPt.x,endPt.y,sc)
        } else {
          // TO mode: snap end to perp foot on nearest target line
          const hit=findNearestLineForPerp(mousePos,lines,perpSourceLineIdx)
          endPt=hit
            ? calcPerpFoot(startPoint.x,startPoint.y,hit.line.x1,hit.line.y1,hit.line.x2,hit.line.y2,true)
            : mousePos
          drawPreviewLine(ctx,startPoint.x,startPoint.y,endPt.x,endPt.y,'#00BCD4',1,sc)
          ctx.save();ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc)
          ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#00BCD4';ctx.fill()
          ctx.restore()
          if (hit) drawPerpIndicator(ctx,endPt.x,endPt.y,sc)
        }
        const lenMm=pxToMm(Math.hypot(endPt.x-startPoint.x,endPt.y-startPoint.y))
        const midX=(startPoint.x+endPt.x)/2,midY=(startPoint.y+endPt.y)/2
        drawLabel(ctx,lenMm.toFixed(1)+' mm',midX,midY-2/sc,'#00BCD4',sc)
      } else {
      const hSnap=getGeoSnap(mousePos,lines,circles,arcs,startPoint,tKeyDown,splines,intersectionPts)
      let endPt,isTanEnd=false
      if (hSnap?.type==='tan'){
        const c=hSnap.circleIdx!==undefined?circles[hSnap.circleIdx]:{cx:hSnap.cx,cy:hSnap.cy,r:hSnap.r}
        const tanPts=getTanPtsOnCircle(startPoint.x,startPoint.y,c.cx,c.cy,c.r)
        tanPts.forEach(tp=>drawPreviewLine(ctx,startPoint.x,startPoint.y,tp.x,tp.y,'#2196F3',0.25,sc))
        endPt=nearestPt(tanPts,mousePos)||hSnap;isTanEnd=true
      } else {
        const comp=computeEnd(startPoint,mousePos,trackedPts);endPt=comp
        if (comp.tracks?.length) drawTracks(ctx,comp.tracks,trackedPts,sc)
        if (comp.angleSnap&&!comp.snapType) drawHVIndicator(ctx,endPt.x,endPt.y,comp.angleSnap,false,sc)
        if (comp.angleSnap&&comp.snapType)  drawHVIndicator(ctx,endPt.x,endPt.y,comp.angleSnap,true,sc)
        if (comp.snapType) drawLineIndicator(ctx,endPt.x,endPt.y,comp.snapType,sc)
      }
      const lenMm=pxToMm(Math.hypot(endPt.x-startPoint.x,endPt.y-startPoint.y))
      const midX=(startPoint.x+endPt.x)/2,midY=(startPoint.y+endPt.y)/2
      drawPreviewLine(ctx,startPoint.x,startPoint.y,endPt.x,endPt.y,'#2196F3',1,sc)
      ctx.save();ctx.translate(startPoint.x,startPoint.y);ctx.scale(1/sc,1/sc)
      ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#2196F3';ctx.fill()
      ctx.restore()
      drawLabel(ctx,(dimLocked?'🔒 ':'')+(dimInput||lenMm.toFixed(1))+' mm',midX,midY-2/sc,dimLocked?'#FF9800':focusField==='dim'?'#1565C0':'#2196F3',sc)
      if (!isTanEnd) drawLabel(ctx,(angleLocked?'🔒 ':'')+(angleInput||computeLiveAngle(startPoint,endPt).toFixed(1))+'°',midX,midY+22/sc,angleLocked?'#FF9800':focusField==='angle'?'#6A1B9A':'#9C27B0',sc)
      if (isTanEnd) drawLineIndicator(ctx,endPt.x,endPt.y,'tan',sc)
      } // end !pKeyDown

    } else if (tool==='circle'&&circleCenter){
      const geo=!dimLocked?getGeoSnap(mousePos,lines,circles,arcs,circleCenter,tKeyDown,splines,intersectionPts):null
      const {tracks}=applyTracking(mousePos,trackedPts)
      if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)

      let r, tanTarget=null, lineTanPt=null

      if (dimLocked){
        r=mmToPx(parseFloat(dimInput)||1)
      } else if (tKeyDown&&geo?.type==='tan'){
        // Tangent to circle/arc: radius = distance between centres minus target radius
        const tc=geo.circleIdx!==undefined?circles[geo.circleIdx]:{cx:geo.cx,cy:geo.cy,r:geo.r}
        const d=Math.hypot(circleCenter.x-tc.cx,circleCenter.y-tc.cy)
        r=Math.max(1,Math.abs(d-tc.r))
        tanTarget=geo
      } else if (tKeyDown){
        // Tangent to nearest line: radius = perpendicular distance from centre to line
        const ld=12/sc
        let bestLineDist=ld+1, bestLine=null
        lines.forEach(l=>{
          const dx=l.x2-l.x1,dy=l.y2-l.y1,len=Math.hypot(dx,dy)
          if(len<1e-10)return
          const d=Math.abs((mousePos.x-l.x1)*dy-(mousePos.y-l.y1)*dx)/len
          if(d<bestLineDist){bestLineDist=d;bestLine=l}
        })
        if(bestLine){
          const{x1,y1,x2,y2}=bestLine
          const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)
          // Perp distance from circle CENTRE to the line
          r=Math.max(1,Math.abs((circleCenter.x-x1)*dy-(circleCenter.y-y1)*dx)/len)
          // Foot of perpendicular from centre to line (the tangent point)
          const t=((circleCenter.x-x1)*dx+(circleCenter.y-y1)*dy)/(len*len)
          lineTanPt={x:x1+t*dx,y:y1+t*dy}
        } else {
          const edgePt=geo&&geo.type!=='tan'?{x:geo.x,y:geo.y}:mousePos
          r=Math.max(1,Math.hypot(edgePt.x-circleCenter.x,edgePt.y-circleCenter.y))
        }
      } else {
        const edgePt=geo&&geo.type!=='tan'?{x:geo.x,y:geo.y}:mousePos
        r=Math.max(1,Math.hypot(edgePt.x-circleCenter.x,edgePt.y-circleCenter.y))
      }

      ctx.beginPath();ctx.arc(circleCenter.x,circleCenter.y,r,0,Math.PI*2)
      ctx.strokeStyle='#2196F3';ctx.lineWidth=1.5/sc;ctx.setLineDash([6/sc,3/sc]);ctx.stroke();ctx.setLineDash([])
      ctx.beginPath();ctx.moveTo(circleCenter.x,circleCenter.y);ctx.lineTo(circleCenter.x+r,circleCenter.y)
      ctx.strokeStyle='#2196F355';ctx.lineWidth=1/sc;ctx.setLineDash([3/sc,3/sc]);ctx.stroke();ctx.setLineDash([])
      drawLineIndicator(ctx,circleCenter.x,circleCenter.y,'center',sc)
      drawLabel(ctx,(dimLocked?'🔒 R ':'R ')+(dimInput||pxToMm(r).toFixed(1))+' mm',circleCenter.x+r/2,circleCenter.y-14/sc,dimLocked?'#FF9800':'#2196F3',sc)
      if (tanTarget) drawLineIndicator(ctx,tanTarget.x,tanTarget.y,'tan',sc)
      else if (lineTanPt) drawLineIndicator(ctx,lineTanPt.x,lineTanPt.y,'tan',sc)
      else if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)

    } else if (tool!=='trim'&&tool!=='delete'&&tool!=='offset'&&tool!=='mirror'&&tool!=='movecopy'&&tool!=='rotatecopy'&&tool!=='resize'&&tool!=='trace'){
      if (tool==='line'&&pKeyDown){
        // PERP mode idle — show perp foot on nearest line
        const hit=findNearestLineForPerp(mousePos,lines,null)
        if (hit) drawPerpIndicator(ctx,hit.foot.x,hit.foot.y,sc)
        // No normal snap indicators — perp only
      } else {
        const{tracks}=applyTracking(mousePos,trackedPts)
        if (tracks.length) drawTracks(ctx,tracks,trackedPts,sc)
        const geo=getGeoSnap(mousePos,lines,circles,arcs,null,tKeyDown,splines,intersectionPts)
        if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
      }
    }

    // Snap indicator when movecopy/rotatecopy accepted but base/centre not yet clicked
    if ((tool==='movecopy'&&moveCopyAccepted||tool==='rotatecopy'&&rotateCopyAccepted)&&!startPoint){
      const geo=getGeoSnap(mousePos,lines,circles,arcs,null,false,splines,intersectionPts)
      if (geo) drawLineIndicator(ctx,geo.x,geo.y,geo.type,sc)
    }

  },[lines,circles,arcs,splines,selection,selectHover,selectLiveGeom,selectDimField,selectDimPending,selectDimAnchor,splinePoints,splineClosed,startPoint,circleCenter,mousePos,dimInput,dimLocked,angleInput,angleLocked,focusField,trackedPts,tool,deferredTangent,trimPreview,deletePreview,extendPreview,offsetEntity,offsetPreview,offsetDistInput,offsetDistLocked,offsetHover,mirrorSel,mirrorAccepted,mirrorPreview,mirrorP1,mirrorHover,moveCopySel,moveCopyAccepted,moveCopyMode,moveCopyCountInput,moveCopyHover,rotateCopySel,rotateCopyAccepted,rotateCopyMode,rotateCopyCountInput,rotateCopyHover,resizeSel,resizeAccepted,resizeScaleInput,resizeHover,filletSel,filletAccepted,filletRadiusInput,filletHover,filletPreview,dragSelectRect,viewTransform,canvasSize,tKeyDown,pKeyDown,perpSourceLineIdx,drawStyle,intersectionPts,joinHover,joinFirstPt,pageConfig,dims,dimToolPreview,dimToolPts,gridVisible,gridSizeMm])

  function handleMouseDown(e){
    if (e.button===1){e.preventDefault();isPanningRef.current=true;lastPanPosRef.current={x:e.clientX,y:e.clientY}}
    if (e.button===0){
      const rect=canvasRef.current.getBoundingClientRect()
      const sx=e.clientX-rect.left,sy=e.clientY-rect.top
      const worldPos=screenToWorld(sx,sy)

      // Select tool: check handle hit first, then start drag-window
      if (tool==='select'){
        const curLines   = selectLiveGeom?.lines   || lines
        const curCircles = selectLiveGeom?.circles || circles
        const curArcs    = selectLiveGeom?.arcs    || arcs
        const curSplines = selectLiveGeom?.splines || splines
        const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)
        if (bbox&&selection.length>0){
          const handles=getBBoxHandles(bbox)
          const hit=hitTestHandles(worldPos,handles,12/viewTransform.scale)
          if (hit){
            // Drag always starts on handle hit — anchor set by 3x3 grid widget separately
            selectDragHandleRef.current=hit
            selectDragStartRef.current=worldPos
            selectDragStartScreenRef.current={x:sx,y:sy}
            // Auto-set anchor to opposite of dragged handle
            const oppositeMap={tl:'br',tc:'bc',tr:'bl',ml:'mr',mc:'mc',mr:'ml',bl:'tr',bc:'tc',br:'tl'}
            setSelectDimAnchor(oppositeMap[hit]||'mc')
            selectBBoxRef.current=bbox
            selectSnapshotRef.current={lines,circles,arcs,splines}
            return
          }
        }
        // Start drag-window for select tool too
        dragStartRef.current={x:sx,y:sy}
        return
      }

      if (inSelPhase()){
        dragStartRef.current={x:sx,y:sy}
      }
    }
  }

  function handleMouseUp(e){
    if (e.button===1) isPanningRef.current=false
    if (e.button===0){
      // Commit handle drag
      if (tool==='select'&&selectDragHandleRef.current){
        if (!selectLiveGeom){
          selectDragHandleRef.current=null
          selectDragStartRef.current=null
          selectDragStartScreenRef.current=null
          return
        }
        commit(snapshot())
        setLines(selectLiveGeom.lines)
        setCircles(selectLiveGeom.circles)
        setArcs(selectLiveGeom.arcs)
        setSplines(selectLiveGeom.splines)
        setSelectLiveGeom(null)
        selectDragHandleRef.current=null
        selectDragStartRef.current=null
        selectDragStartScreenRef.current=null
        selectSnapshotRef.current=null
        selectBBoxRef.current=null
        wasDragRef.current=true
        return
      }
      if (dragStartRef.current){
        if (dragRectRef.current){
          if (tool==='select'){
            // Select tool drag window — builds selection
            const rect=dragRectRef.current
            const minX=Math.min(rect.x1,rect.x2),maxX=Math.max(rect.x1,rect.x2)
            const minY=Math.min(rect.y1,rect.y2),maxY=Math.max(rect.y1,rect.y2)
            const ptIn=(x,y)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY
            const hits=[]
            linesRef.current.forEach((l,idx)=>{if(ptIn(l.x1,l.y1)||ptIn(l.x2,l.y2))hits.push({kind:'line',idx})})
            circlesRef.current.forEach((c,idx)=>{if(ptIn(c.cx-c.r,c.cy)||ptIn(c.cx+c.r,c.cy)||ptIn(c.cx,c.cy-c.r)||ptIn(c.cx,c.cy+c.r))hits.push({kind:'circle',idx})})
            arcsRef.current.forEach((arc,idx)=>{if(ptIn(arc.cx,arc.cy))hits.push({kind:'arc',idx})})
            splinesRef.current.forEach((sp,idx)=>{if(sp.points.some(p=>ptIn(p.x,p.y)))hits.push({kind:'spline',idx})})
            setSelection(hits)
            wasDragRef.current=true
          } else {
            executeDragSelect(dragRectRef.current)
            wasDragRef.current=true
          }
        }
        dragStartRef.current=null
        dragRectRef.current=null
        setDragSelectRect(null)
      }
    }
  }

  function snapToGrid(pt){
    if (!gridSnap) return pt
    const gPx=mmToPx(gridSizeMm)
    return {x:Math.round(pt.x/gPx)*gPx, y:Math.round(pt.y/gPx)*gPx}
  }

  function handleClick(e){
    // Suppress click if this mouseup followed a drag-select
    if (wasDragRef.current){wasDragRef.current=false;return}

    const rect=canvasRef.current.getBoundingClientRect()
    const rawWorld=screenToWorld(e.clientX-rect.left,e.clientY-rect.top)
    const raw=gridSnap?snapToGrid(rawWorld):rawWorld

    if (tool==='trace'){
      setTraceInsertPt(raw);setTraceOpen(true);return
    }
    if (tool==='text'){
      setTextInsertPt(raw);setTextOpen(true);return
    }

    if (tool==='select'){
      const curLines   = selectLiveGeom?.lines   || lines
      const curCircles = selectLiveGeom?.circles || circles
      const curArcs    = selectLiveGeom?.arcs    || arcs
      const curSplines = selectLiveGeom?.splines || splines
      const bbox=selectionBBox(selection,curLines,curCircles,curArcs,curSplines)

      // Hit-test 3x3 anchor grid widget — must match draw code exactly (cell=14/sc, spacing=cell*1.6)
      if (bbox&&selection.length>0){
        const sc=viewTransform.scale
        const gx=(bbox.x1+bbox.x2)/2
        const gy=bbox.y1-80/sc
        const cell=14/sc
        const hitR=cell*1.0   // generous hit radius around each dot
        const gridIds=[['tl','tc','tr'],['ml','mc','mr'],['bl','bc','br']]
        for (let ri=0;ri<3;ri++) for (let ci=0;ci<3;ci++){
          const px=gx+(ci-1)*cell*1.6,py=gy+(ri-1)*cell*1.6
          if (Math.hypot(raw.x-px,raw.y-py)<hitR){
            setSelectDimAnchor(gridIds[ri][ci])
            return
          }
        }
      }

      if (bbox){
        const handles=getBBoxHandles(bbox)
        if (hitTestHandles(raw,handles,12/viewTransform.scale)) return
      }
      if (selectHover){
        if (e.shiftKey){
          const already=selection.findIndex(s=>s.kind===selectHover.kind&&s.idx===selectHover.idx)
          if (already>=0) setSelection(p=>p.filter((_,i)=>i!==already))
          else setSelection(p=>[...p,selectHover])
        } else {
          const sole=selection.length===1&&selection[0].kind===selectHover.kind&&selection[0].idx===selectHover.idx
          setSelection(sole?[]:[selectHover])
          setSelectDimField(null);setSelectDimPending({});setSelectDimAnchor('mc')
        }
      } else if (!e.shiftKey){
        setSelection([])
      }
      return
    }

    if (tool==='dim'){
      const snap=getGeoSnap(raw,lines,circles,arcs,null,false,splines,intersectionPts)
      const pt=snap?{x:snap.x,y:snap.y}:raw

      // Circle / arc: one click places dim
      if (dimToolPreview?.kind==='diameter'){
        const p=dimToolPreview
        commit(snapshot())
        setDims(d=>[...d,{kind:'diameter',cx:p.cx,cy:p.cy,r:p.r,angle:p.angle,text:''}])
        resetDim();return
      }
      if (dimToolPreview?.kind==='radius'){
        const p=dimToolPreview
        commit(snapshot())
        setDims(d=>[...d,{kind:'radius',cx:p.cx,cy:p.cy,r:p.r,angle:p.angle,text:''}])
        resetDim();return
      }
      // Linear: click 1=p1, 2=p2, 3=offset
      if (dimToolStep===0){
        setDimToolPts([pt]);setDimToolStep(1)
      } else if (dimToolStep===1){
        setDimToolPts([dimToolPts[0],pt]);setDimToolStep(2)
      } else if (dimToolStep===2&&dimToolPreview){
        commit(snapshot())
        setDims(d=>[...d,{...dimToolPreview,text:''}])
        resetDim()
      }
      return
    }

    if (tool==='join'){
      if (!joinFirstPt){
        // First click — pick the free endpoint to move
        if (joinHover) setJoinFirstPt(joinHover)
      } else {
        // Second click — move free endpoint to snap/click position
        const snap=getGeoSnap(raw,lines,circles,arcs,{x:joinFirstPt.x,y:joinFirstPt.y},false,splines,intersectionPts)
        const targetPt=snap?{x:snap.x,y:snap.y}:raw
        commit(snapshot())
        if (joinFirstPt.kind==='line'){
          setLines(p=>p.map((l,i)=>{
            if(i!==joinFirstPt.lineIdx) return l
            if(joinFirstPt.end==='x1y1') return {...l,x1:targetPt.x,y1:targetPt.y}
            return {...l,x2:targetPt.x,y2:targetPt.y}
          }))
        } else if (joinFirstPt.kind==='spline'){
          setSplines(p=>p.map((sp,i)=>{
            if(i!==joinFirstPt.splineIdx) return sp
            const pts=[...sp.points]
            if(joinFirstPt.end==='first') pts[0]={x:targetPt.x,y:targetPt.y}
            else pts[pts.length-1]={x:targetPt.x,y:targetPt.y}
            return {...sp,points:pts}
          }))
        }
        setJoinFirstPt(null)  // ready for next join, stay in join tool
      }
      return
    }

    if (tool==='trim'){
      if (e.detail > 1) return
      // deletewhole — no intersections, delete entire entity
      if (trimPreview?.deletewhole){
        commit(snapshot())
        if (trimPreview.kind==='line')   setLines(p=>p.filter((_,i)=>i!==trimPreview.idx))
        if (trimPreview.kind==='circle') setCircles(p=>p.filter((_,i)=>i!==trimPreview.idx))
        if (trimPreview.kind==='arc')    setArcs(p=>p.filter((_,i)=>i!==trimPreview.idx))
        if (trimPreview.kind==='spline') setSplines(p=>p.filter((_,i)=>i!==trimPreview.idx))
        setTrimPreview(null);return
      }
      // Normal trim — Ignore second click of a double-click — prevents trim executing twice
      if (trimPreview){
        if (trimPreview.kind==='spline'){
          if (trimPreview.highlightPts&&trimPreview.highlightPts.length>=2){
            // Proper region trim
            commit(snapshot())
            setSplines(performSplineTrim(trimPreview,splines))
          } else {
            // No intersections — delete whole spline
            commit(snapshot());setSplines(p=>p.filter((_,i)=>i!==trimPreview.idx))
          }
        } else {
          commit(snapshot());const r=performTrim(trimPreview,lines,circles,arcs);setLines(r.lines);setCircles(r.circles);setArcs(r.arcs)
        }
      }
      return
    }
    if (tool==='delete'){
      if (deletePreview){
        commit(snapshot())
        if (deletePreview.kind==='line') setLines(p=>p.filter((_,i)=>i!==deletePreview.idx))
        if (deletePreview.kind==='circle') setCircles(p=>p.filter((_,i)=>i!==deletePreview.idx))
        if (deletePreview.kind==='arc') setArcs(p=>p.filter((_,i)=>i!==deletePreview.idx))
        if (deletePreview.kind==='spline') setSplines(p=>p.filter((_,i)=>i!==deletePreview.idx))
        if (deletePreview.kind==='dim') setDims(p=>p.filter((_,i)=>i!==deletePreview.idx))
      }
      return
    }

    if (tool==='spline'){
      if (e.detail > 1) return  // ignore second click of double-click — handled by handleDoubleClick
      const geo=getGeoSnap(raw,lines,circles,arcs,splinePoints.length?splinePoints[splinePoints.length-1]:null,false,splines,intersectionPts)
      const pt=geo&&geo.type!=='tan'&&geo.type!=='oncircle'?{x:geo.x,y:geo.y}:raw
      const newPts=[...splinePoints,pt]
      splinePointsRef.current=newPts
      setSplinePoints(newPts)
      return
    }

    if (tool==='extend'){
      if (extendPreview){
        commit(snapshot())
        setLines(p=>p.map((l,i)=>i===extendPreview.idx?extendPreview.newLine:l))
      }
      return
    }

    if (tool==='offset'){
      if (!offsetEntity){
        // First click — lock the hovered entity
        const hit=nearestOffsetEntity(raw,lines,circles,arcs,splines)
        if (hit) setOffsetEntity(hit)
      } else {
        // Second click — place the offset
        if (!offsetPreview) return
        commit(snapshot())
        if (offsetPreview.kind==='line')   setLines(p=>[...p,{x1:offsetPreview.x1,y1:offsetPreview.y1,x2:offsetPreview.x2,y2:offsetPreview.y2,...(offsetPreview.style?{style:offsetPreview.style}:{})}])
        if (offsetPreview.kind==='circle') setCircles(p=>[...p,{cx:offsetPreview.cx,cy:offsetPreview.cy,r:offsetPreview.r,...(offsetPreview.style?{style:offsetPreview.style}:{})}])
        if (offsetPreview.kind==='arc')    setArcs(p=>[...p,{cx:offsetPreview.cx,cy:offsetPreview.cy,r:offsetPreview.r,startAngle:offsetPreview.startAngle,endAngle:offsetPreview.endAngle,...(offsetPreview.style?{style:offsetPreview.style}:{})}])
        if (offsetPreview.kind==='spline') setSplines(p=>[...p,{points:offsetPreview.points,closed:offsetPreview.closed,polyline:offsetPreview.polyline,...(offsetPreview.style?{style:offsetPreview.style}:{})}])
        resetOffset()
      }
      return
    }

    if (tool==='mirror'){
      if (!mirrorAccepted){
        const hit=nearestMirrorEntity(raw,lines,circles,arcs,splines);if(!hit)return
        const already=mirrorSel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
        if (already>=0) setMirrorSel(p=>p.filter((_,i)=>i!==already))
        else setMirrorSel(p=>[...p,hit])
      } else {
        if (!mirrorP1){
          const geo=getGeoSnap(raw,lines,circles,arcs,null,false,splines,intersectionPts)
          const pt=geo&&geo.type!=='tan'&&geo.type!=='oncircle'?{x:geo.x,y:geo.y}:raw
          setMirrorP1(pt)
          // Seed tracking from first mirror point
          setTrackedPts([]);trackedPtsRef.current=[]
        } else {
          if (!mirrorPreview) return
          const hSnap=getGeoSnap(raw,lines,circles,arcs,mirrorP1,false,splines,intersectionPts)
          let endPt
          if (hSnap&&hSnap.type!=='tan'&&hSnap.type!=='oncircle'){
            endPt={x:hSnap.x,y:hSnap.y}
          } else {
            const{snapped}=applyTracking(raw,trackedPts)
            const angled=getAngleSnap(mirrorP1,snapped)
            endPt={x:angled.x,y:angled.y}
          }
          const finalMirror=buildMirror(mirrorSel,lines,circles,arcs,splines,mirrorP1.x,mirrorP1.y,endPt.x,endPt.y)
          commit(snapshot());setLines(p=>[...p,...finalMirror.newLines]);setCircles(p=>[...p,...finalMirror.newCircles]);setArcs(p=>[...p,...finalMirror.newArcs]);setSplines(p=>[...p,...finalMirror.newSplines]);resetMirror()
        }
      }
      return
    }

    if (tool==='movecopy'){
      if (!moveCopyAccepted){
        const hit=nearestMoveCopyEntity(raw,lines,circles,arcs,splines);if(!hit)return
        const already=moveCopySel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
        if (already>=0) setMoveCopySel(p=>p.filter((_,i)=>i!==already))
        else setMoveCopySel(p=>[...p,hit])
      } else if (!startPoint){
        const geo=getGeoSnap(raw,lines,circles,arcs,null,false,splines,intersectionPts)
        setStartPoint(geo?{x:geo.x,y:geo.y}:raw)
        setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
        setTrackedPts([]);trackedPtsRef.current=[]
      } else {
        const end=computeEnd(startPoint,raw,trackedPts)
        const dx=end.x-startPoint.x,dy=end.y-startPoint.y
        const count=Math.max(1,parseInt(moveCopyCountInput)||1)
        commit(snapshot())
        const copies=buildCopies(moveCopySel,lines,circles,arcs,splines,dx,dy,count)
        if (moveCopyMode==='move'){const pruned=removeSelected(moveCopySel,lines,circles,arcs,splines);setLines([...pruned.lines,...copies.newLines]);setCircles([...pruned.circles,...copies.newCircles]);setArcs([...pruned.arcs,...copies.newArcs]);setSplines([...pruned.splines,...copies.newSplines])}
        else{setLines(p=>[...p,...copies.newLines]);setCircles(p=>[...p,...copies.newCircles]);setArcs(p=>[...p,...copies.newArcs]);setSplines(p=>[...p,...copies.newSplines])}
        resetMoveCopy();resetDrawState()
      }
      return
    }

    if (tool==='rotatecopy'){
      if (!rotateCopyAccepted){
        const hit=nearestRotateCopyEntity(raw,lines,circles,arcs,splines);if(!hit)return
        const already=rotateCopySel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
        if (already>=0) setRotateCopySel(p=>p.filter((_,i)=>i!==already))
        else setRotateCopySel(p=>[...p,hit])
      } else if (!startPoint){
        const geo=getGeoSnap(raw,lines,circles,arcs,null,false,splines,intersectionPts)
        setStartPoint(geo?{x:geo.x,y:geo.y}:raw)
        setAngleInput('');setAngleLocked(false);setTrackedPts([]);trackedPtsRef.current=[]
      } else {
        const dx=raw.x-startPoint.x,dy=raw.y-startPoint.y
        let angleDeg=angleLocked?(parseFloat(angleInput)||0):(Math.atan2(dy,dx)*180/Math.PI)
        if (!angleLocked&&angleDeg<0) angleDeg+=360
        const count=Math.max(1,parseInt(rotateCopyCountInput)||1)
        commit(snapshot())
        const copies=buildRotatedCopies(rotateCopySel,lines,circles,arcs,splines,startPoint.x,startPoint.y,angleDeg,count)
        if (rotateCopyMode==='rotate'){const pruned=removeSelected(rotateCopySel,lines,circles,arcs,splines);setLines([...pruned.lines,...copies.newLines]);setCircles([...pruned.circles,...copies.newCircles]);setArcs([...pruned.arcs,...copies.newArcs]);setSplines([...pruned.splines,...copies.newSplines])}
        else{setLines(p=>[...p,...copies.newLines]);setCircles(p=>[...p,...copies.newCircles]);setArcs(p=>[...p,...copies.newArcs]);setSplines(p=>[...p,...copies.newSplines])}
        resetRotateCopy();resetDrawState()
      }
      return
    }

    if (tool==='resize'){
      if (!resizeAccepted){
        const hit=nearestScaleEntity(raw,lines,circles,arcs,splines);if(!hit)return
        const already=resizeSel.findIndex(s=>s.kind===hit.kind&&s.idx===hit.idx)
        if (already>=0) setResizeSel(p=>p.filter((_,i)=>i!==already))
        else setResizeSel(p=>[...p,hit])
      } else {
        const s=parseFloat(resizeScaleInput);if(!s||s<=0)return
        const geo=getGeoSnap(raw,lines,circles,arcs,null,false,splines,intersectionPts)
        const anchor=geo?{x:geo.x,y:geo.y}:raw
        commit(snapshot())
        const scaled=buildScaled(resizeSel,lines,circles,arcs,splines,anchor.x,anchor.y,s)
        const pruned=removeSelected(resizeSel,lines,circles,arcs,splines)
        setLines([...pruned.lines,...scaled.newLines])
        setCircles([...pruned.circles,...scaled.newCircles])
        setArcs([...pruned.arcs,...scaled.newArcs])
        setSplines([...pruned.splines,...scaled.newSplines])
        resetResize()
      }
      return
    }

    if (tool==='fillet'){
      if (!filletAccepted){
        const hit=nearestFilletLine(raw,lines)
        if (!hit) return
        const already=filletSel.findIndex(s=>s.idx===hit.idx)
        if (already>=0) setFilletSel(p=>p.filter((_,i)=>i!==already))
        else if (filletSel.length<2) setFilletSel(p=>[...p,hit])
      } else {
        // Click applies the fillet (same as Enter)
        if (!filletPreview||filletPreview.tooLarge) return
        const{newL1,newL2,arc}=filletPreview
        // Carry style from source lines through fillet
        const s1=lines[filletSel[0].idx]?.style
        const s2=lines[filletSel[1].idx]?.style
        commit(snapshot())
        setLines(p=>[...p.filter((_,i)=>!filletSel.some(s=>s.idx===i)),
          s1?{...newL1,style:s1}:newL1,
          s2?{...newL2,style:s2}:newL2])
        setArcs(p=>[...p,arc])
        resetFillet()
      }
      return
    }

    if (tool==='line'){
      if (!startPoint&&!deferredTangent){
        if (pKeyDown) {
          // PERP: start at foot on nearest line, store its index to exclude later
          const hit=findNearestLineForPerp(raw,lines,null)
          const pt=hit?hit.foot:raw
          setPerpSourceLineIdx(hit?hit.idx:null)
          setStartPoint({x:pt.x,y:pt.y})
          setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
          setTrackedPts([]);trackedPtsRef.current=[]
          return
        }
        const geo=getGeoSnap(raw,lines,circles,arcs,null,tKeyDown,splines,intersectionPts)
        if (geo?.type==='tan'){
          const circData=geo.circleIdx!==undefined?{...circles[geo.circleIdx],circleIdx:geo.circleIdx}:{cx:geo.cx,cy:geo.cy,r:geo.r,arcIdx:geo.arcIdx}
          setDeferredTangent(circData);setStartPoint({x:geo.x,y:geo.y})
        } else setStartPoint(geo?{x:geo.x,y:geo.y}:raw)
        setDimInput('');setDimLocked(false);setAngleInput('');setAngleLocked(false);setFocusField('dim')
        setTrackedPts([]);trackedPtsRef.current=[]
      } else if (deferredTangent){
        const dc=deferredTangent,geo=getGeoSnap(raw,lines,circles,arcs,null,tKeyDown,splines,intersectionPts)
        if (geo?.type==='tan'&&geo.circleIdx!==undefined&&dc.circleIdx!==undefined&&geo.circleIdx!==dc.circleIdx){
          const pairs=getExternalTangentPairs(dc,circles[geo.circleIdx])
          const best=pairs.length?pairs.reduce((a,b)=>Math.hypot(a.t1.x-startPoint.x,a.t1.y-startPoint.y)<Math.hypot(b.t1.x-startPoint.x,b.t1.y-startPoint.y)?a:b):null
          if(best){commit(snapshot());setLines(p=>[...p,{x1:best.t1.x,y1:best.t1.y,x2:best.t2.x,y2:best.t2.y,...(drawStyle?{style:drawStyle}:{})}])}
        } else {
          const endPt=(geo&&geo.type!=='tan')?{x:geo.x,y:geo.y}:raw
          const tanPts=getTanPtsOnCircle(endPt.x,endPt.y,dc.cx,dc.cy,dc.r)
          const best=nearestPt(tanPts,startPoint)
          if(best){commit(snapshot());setLines(p=>[...p,{x1:best.x,y1:best.y,x2:endPt.x,y2:endPt.y,...(drawStyle?{style:drawStyle}:{})}])}
        }
        resetDrawState()
      } else {
        if (pKeyDown) {
          let endPt
          if (perpSourceLineIdx!==null && lines[perpSourceLineIdx]) {
            // FROM mode: direction locked perpendicular to source line
            const sl=lines[perpSourceLineIdx]
            const dx=sl.x2-sl.x1, dy=sl.y2-sl.y1, len=Math.hypot(dx,dy)
            if (len>1e-10) {
              const px=-dy/len, py=dx/len
              const t=(raw.x-startPoint.x)*px+(raw.y-startPoint.y)*py
              endPt={x:startPoint.x+t*px, y:startPoint.y+t*py}
            } else { endPt=raw }
          } else {
            // TO mode: snap to perp foot on nearest line
            const hit=findNearestLineForPerp(raw,lines,perpSourceLineIdx)
            endPt=hit
              ? calcPerpFoot(startPoint.x,startPoint.y,hit.line.x1,hit.line.y1,hit.line.x2,hit.line.y2,true)
              : raw
          }
          commit(snapshot());setLines(p=>[...p,{x1:startPoint.x,y1:startPoint.y,x2:endPt.x,y2:endPt.y,...(drawStyle?{style:drawStyle}:{})}])
          resetDrawState()
          return
        }
        const geo=getGeoSnap(raw,lines,circles,arcs,startPoint,tKeyDown,splines,intersectionPts)
        if (geo?.type==='tan'){
          const c=geo.circleIdx!==undefined?circles[geo.circleIdx]:{cx:geo.cx,cy:geo.cy,r:geo.r}
          const tanPts=getTanPtsOnCircle(startPoint.x,startPoint.y,c.cx,c.cy,c.r)
          const best=nearestPt(tanPts,raw)
          if(best){commit(snapshot());setLines(p=>[...p,{x1:startPoint.x,y1:startPoint.y,x2:best.x,y2:best.y}])}
        } else {
          const end=computeEnd(startPoint,raw,trackedPts)
          commit(snapshot());setLines(p=>[...p,{x1:startPoint.x,y1:startPoint.y,x2:end.x,y2:end.y,...(drawStyle?{style:drawStyle}:{})}])
        }
        resetDrawState()
      }
    } else if (tool==='circle'){
      if (!circleCenter){
        const geo=getGeoSnap(raw,lines,circles,arcs,null,false,splines,intersectionPts)
        setCircleCenter(geo?{x:geo.x,y:geo.y}:raw)
        setDimInput('');setDimLocked(false);setTrackedPts([]);trackedPtsRef.current=[]
      } else {
        let r
        if (dimLocked){
          r=mmToPx(parseFloat(dimInput)||1)
        } else {
          const geo=getGeoSnap(raw,lines,circles,arcs,circleCenter,tKeyDown,splines,intersectionPts)
          if (tKeyDown&&geo?.type==='tan'){
            // Tangent to circle/arc
            const tc=geo.circleIdx!==undefined?circles[geo.circleIdx]:{cx:geo.cx,cy:geo.cy,r:geo.r}
            const d=Math.hypot(circleCenter.x-tc.cx,circleCenter.y-tc.cy)
            r=Math.max(1,Math.abs(d-tc.r))
          } else if (tKeyDown){
            // Tangent to nearest line — perp distance from centre to line
            const ld=12/zoomRef.scale
            let bestLineDist=ld+1,bestLine=null
            lines.forEach(l=>{
              const dx=l.x2-l.x1,dy=l.y2-l.y1,len=Math.hypot(dx,dy)
              if(len<1e-10)return
              const d=Math.abs((raw.x-l.x1)*dy-(raw.y-l.y1)*dx)/len
              if(d<bestLineDist){bestLineDist=d;bestLine=l}
            })
            if(bestLine){
              const{x1,y1,x2,y2}=bestLine
              const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)
              r=Math.max(1,Math.abs((circleCenter.x-x1)*dy-(circleCenter.y-y1)*dx)/len)
            } else {
              const edgePt=geo&&geo.type!=='tan'?{x:geo.x,y:geo.y}:raw
              r=Math.max(1,Math.hypot(edgePt.x-circleCenter.x,edgePt.y-circleCenter.y))
            }
          } else {
            const edgePt=geo&&geo.type!=='tan'?{x:geo.x,y:geo.y}:raw
            r=Math.max(1,Math.hypot(edgePt.x-circleCenter.x,edgePt.y-circleCenter.y))
          }
        }
        commit(snapshot());setCircles(p=>[...p,{cx:circleCenter.x,cy:circleCenter.y,r,...(drawStyle?{style:drawStyle}:{})}]);resetDrawState()
      }
    }
  }

  function finishSpline(pts){
    if (!pts||pts.length<2) return
    commit(snapshot())
    setSplines(p=>[...p,{points:pts,closed:splineClosed,...(drawStyle?{style:drawStyle}:{})}])
    resetSpline()
  }

  function handleDoubleClick(e){
    if (tool!=='spline') return
    e.preventDefault()
    // Get current points directly from ref to avoid StrictMode double-call issue
    const pts=splinePointsRef?.current||splinePoints
    const trimmed=pts.length>1?pts.slice(0,-1):pts
    if (trimmed.length>=2){
      commit(snapshot())
      setSplines(p=>[...p,{points:trimmed,closed:splineClosed,...(drawStyle?{style:drawStyle}:{})}])
    }
    resetSpline()
  }

  function handleContextMenu(e){
    e.preventDefault()
    if (tool==='spline'&&splinePoints.length>=2){finishSpline(splinePoints);return}
    if (tool==='mirror'&&!mirrorAccepted&&mirrorSel.length>0) setMirrorAccepted(true)
    if (tool==='movecopy'&&!moveCopyAccepted&&moveCopySel.length>0) setMoveCopyAccepted(true)
    if (tool==='rotatecopy'&&!rotateCopyAccepted&&rotateCopySel.length>0) setRotateCopyAccepted(true)
    if (tool==='resize'&&!resizeAccepted&&resizeSel.length>0) setResizeAccepted(true)
    if (tool==='fillet'&&!filletAccepted&&filletSel.length===2) setFilletAccepted(true)
  }

  function handleMouseMove(e){
    const rect=canvasRef.current.getBoundingClientRect()
    const sx=e.clientX-rect.left,sy=e.clientY-rect.top

    // Middle mouse pan
    if (isPanningRef.current){
      const dx=e.clientX-lastPanPosRef.current.x,dy=e.clientY-lastPanPosRef.current.y
      lastPanPosRef.current={x:e.clientX,y:e.clientY}
      const vt={x:viewTransformRef.current.x+dx,y:viewTransformRef.current.y+dy,scale:viewTransformRef.current.scale}
      viewTransformRef.current=vt;zoomRef.scale=vt.scale;setViewTransform(vt)
      setMousePos({x:(sx-vt.x)/vt.scale,y:(sy-vt.y)/vt.scale})
      return
    }

    const worldPos=screenToWorld(sx,sy)

    // Handle drag for select tool
    if (tool==='select'&&selectDragHandleRef.current&&selectDragStartRef.current&&(e.buttons&1)){
      const xform=computeHandleTransform(selectDragHandleRef.current,selectBBoxRef.current,selectDragStartRef.current,worldPos)
      const snap=selectSnapshotRef.current
      const result=applySelectionTransform(selection,snap.lines,snap.circles,snap.arcs,snap.splines,xform.anchor,xform.sx,xform.sy,xform.dx,xform.dy)
      setSelectLiveGeom(result)
      setMousePos(worldPos)
      return
    }

    // Drag window select tracking
    if (dragStartRef.current&&(e.buttons&1)){
      const dx=sx-dragStartRef.current.x,dy=sy-dragStartRef.current.y
      if (Math.hypot(dx,dy)>8){
        const p1=screenToWorld(dragStartRef.current.x,dragStartRef.current.y)
        const p2=screenToWorld(sx,sy)
        const r={x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y}
        dragRectRef.current=r
        setDragSelectRect(r)
      }
    }

    // Apply grid snap to mouse position during drawing
    const snappedWorld=(gridSnap&&(tool==='line'||tool==='circle'||tool==='spline'||tool==='dim'))
      ? snapToGrid(worldPos)
      : worldPos
    setMousePos(snappedWorld);updateTracking(snappedWorld)
  }

  function handleKeyDown(e){
    if ((e.key==='t'||e.key==='T')&&!e.ctrlKey&&!e.shiftKey&&(tool==='line'||tool==='circle')){setTKeyDown(p=>!p);return}
    if ((e.key==='p'||e.key==='P')&&!e.ctrlKey&&!e.shiftKey&&tool==='line'){setPKeyDown(p=>!p);return}
    if ((e.key==='h'||e.key==='H')&&!e.ctrlKey&&!e.shiftKey){
      if (tool==='select'&&selection.length>0){
        // Toggle dashed on selected entities
        const newStyle=(lines[selection.find(s=>s.kind==='line')?.idx]?.style==='dashed')?null:'dashed'
        commit(snapshot())
        setLines(p=>p.map((l,i)=>selection.some(s=>s.kind==='line'&&s.idx===i)?{...l,style:newStyle||undefined}:l))
        setCircles(p=>p.map((c,i)=>selection.some(s=>s.kind==='circle'&&s.idx===i)?{...c,style:newStyle||undefined}:c))
        setArcs(p=>p.map((a,i)=>selection.some(s=>s.kind==='arc'&&s.idx===i)?{...a,style:newStyle||undefined}:a))
        setSplines(p=>p.map((sp,i)=>selection.some(s=>s.kind==='spline'&&s.idx===i)?{...sp,style:newStyle||undefined}:sp))
        return
      }
      else {setDrawStyle(p=>p==='dashed'?null:'dashed');return}
      }
    if ((e.key==='d'||e.key==='D')&&!e.ctrlKey&&!e.shiftKey){
      if (tool==='select'&&selection.length>0){
        // Toggle construction on selected entities
        const newStyle=(lines[selection.find(s=>s.kind==='line')?.idx]?.style==='construction')?null:'construction'
        commit(snapshot())
        setLines(p=>p.map((l,i)=>selection.some(s=>s.kind==='line'&&s.idx===i)?{...l,style:newStyle||undefined}:l))
        setCircles(p=>p.map((c,i)=>selection.some(s=>s.kind==='circle'&&s.idx===i)?{...c,style:newStyle||undefined}:c))
        setArcs(p=>p.map((a,i)=>selection.some(s=>s.kind==='arc'&&s.idx===i)?{...a,style:newStyle||undefined}:a))
        setSplines(p=>p.map((sp,i)=>selection.some(s=>s.kind==='spline'&&s.idx===i)?{...sp,style:newStyle||undefined}:sp))
        return
      }
      else {setDrawStyle(p=>p==='construction'?null:'construction');return}
      }
    if (e.ctrlKey&&e.key==='z'){e.preventDefault();undo(snapshot(),restore);return}
    if (e.ctrlKey&&e.key==='y'){e.preventDefault();redo(snapshot(),restore);return}
    if (e.ctrlKey&&e.key==='s'){e.preventDefault();saveJSON(lines,circles,arcs,splines,dims);return}
    if ((e.key==='f'||e.key==='F')&&!e.ctrlKey){zoomToFit();return}

    if (tool==='trim'||tool==='delete'||tool==='extend'||tool==='trace'||tool==='text'||tool==='select'||tool==='join'){if(e.key==='Escape'){resetText();resetSelection();resetJoin();resetDim();setTool('line');return}}

    if (tool==='select'&&selection.length>0){
      // Delete selected entities
      if (e.key==='Delete'&&!selectDimField){
        commit(snapshot())
        setLines(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='line'&&s.idx===i)))
        setCircles(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='circle'&&s.idx===i)))
        setArcs(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='arc'&&s.idx===i)))
        setSplines(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='spline'&&s.idx===i)))
        setDims(p=>p.filter((_,i)=>!selection.some(s=>s.kind==='dim'&&s.idx===i)))
        resetSelection();return
      }

      // Tab: cycle field, save current input to pending dict, restore any previous value
      if (e.key==='Tab'){
        e.preventDefault()
        // Save current typed value to pending before moving
        if (selectDimField && selectDimInput) {
          setSelectDimPending(p=>({...p,[selectDimField]:selectDimInput}))
        }
        // Determine field list
        let fields=[]
        if (selection.length===1){
          const e0=selection[0]
          if (e0.kind==='line') fields=['length','angle']
          else if (e0.kind==='circle') fields=['radius']
          else if (e0.kind==='arc') fields=['radius','angle']
        } else {
          fields=['width','height']
        }
        if (!fields.length) return
        const idx=fields.indexOf(selectDimField)
        const nextField=fields[(idx+1)%fields.length]
        setSelectDimField(nextField)
        // Restore any previously typed value for this field
        setSelectDimInput(p=>{
          // We use a functional update so we read from pending via closure below
          return ''
        })
        // Restore pending value for next field after state settles
        setTimeout(()=>{
          setSelectDimPending(pending=>{
            setSelectDimInput(pending[nextField]||'')
            return pending
          })
        },0)
        return
      }

      // Typing when a field is active
      if (selectDimField){
        if (e.key==='Backspace'){
          e.preventDefault()
          setSelectDimInput(p=>{
            const n=p.slice(0,-1)
            setSelectDimPending(pd=>({...pd,[selectDimField]:n}))
            return n
          })
          return
        }
        if (/^[0-9.]$/.test(e.key)){
          setSelectDimInput(p=>{
            const n=p+e.key
            setSelectDimPending(pd=>({...pd,[selectDimField]:n}))
            return n
          })
          return
        }
        if (e.key==='Enter'||e.key==='Return'){
          e.preventDefault()
          // Save current input to pending first
          const finalPending = selectDimField
            ? {...selectDimPending,[selectDimField]:selectDimInput}
            : selectDimPending
          // Apply all pending values in one commit
          commit(snapshot())
          if (selection.length===1){
            const ent=selection[0]
            if (ent.kind==='line'){
              const l=lines[ent.idx]
              const dx=l.x2-l.x1,dy=l.y2-l.y1
              const oldLen=Math.hypot(dx,dy)
              let newLen=oldLen,newAngleRad=Math.atan2(dy,dx)
              if (finalPending.length&&parseFloat(finalPending.length)>0)
                newLen=mmToPx(parseFloat(finalPending.length))
              if (finalPending.angle&&parseFloat(finalPending.angle)>=0)
                newAngleRad=(360-parseFloat(finalPending.angle))*Math.PI/180
              const nx=Math.cos(newAngleRad),ny=Math.sin(newAngleRad)
              // Determine fixed point from anchor handle
              const bbox2=selectionBBox(selection,lines,circles,arcs,splines)
              const handles2=bbox2?getBBoxHandles(bbox2):null
              const anchorPt=handles2?handles2[selectDimAnchor]||handles2['mc']:null
              if (!anchorPt||selectDimAnchor==='mc'){
                // Anchor = midpoint
                const mx=(l.x1+l.x2)/2,my=(l.y1+l.y2)/2
                setLines(p=>p.map((ln,i)=>i===ent.idx?{...ln,x1:mx-nx*newLen/2,y1:my-ny*newLen/2,x2:mx+nx*newLen/2,y2:my+ny*newLen/2}:ln))
              } else {
                // Find which endpoint is closest to anchor handle — that end stays fixed
                const d1=Math.hypot(l.x1-anchorPt.x,l.y1-anchorPt.y)
                const d2=Math.hypot(l.x2-anchorPt.x,l.y2-anchorPt.y)
                if (d1<=d2){
                  // x1,y1 stays fixed — x2,y2 moves
                  setLines(p=>p.map((ln,i)=>i===ent.idx?{...ln,x2:l.x1+nx*newLen,y2:l.y1+ny*newLen}:ln))
                } else {
                  // x2,y2 stays fixed — x1,y1 moves
                  setLines(p=>p.map((ln,i)=>i===ent.idx?{...ln,x1:l.x2-nx*newLen,y1:l.y2-ny*newLen}:ln))
                }
              }
            } else if (ent.kind==='circle'&&finalPending.radius&&parseFloat(finalPending.radius)>0){
              const c=circles[ent.idx]
              const newR=mmToPx(parseFloat(finalPending.radius))
              const bbox2=selectionBBox(selection,lines,circles,arcs,splines)
              const handles2=bbox2?getBBoxHandles(bbox2):null
              const anchorPt=handles2?handles2[selectDimAnchor]||handles2['mc']:null
              if (!anchorPt||selectDimAnchor==='mc'){
                // Centre stays fixed
                setCircles(p=>p.map((ci,i)=>i===ent.idx?{...ci,r:newR}:ci))
              } else {
                // Anchor point stays fixed — shift centre
                // The anchor handle is on the circle's bbox edge
                // New centre = anchor + offset scaled to new radius
                const ocx=c.cx,ocy=c.cy,or=c.r
                const fromAnchorX=ocx-anchorPt.x,fromAnchorY=ocy-anchorPt.y
                const dist=Math.hypot(fromAnchorX,fromAnchorY)||1
                const newCx=anchorPt.x+(fromAnchorX/dist)*newR
                const newCy=anchorPt.y+(fromAnchorY/dist)*newR
                setCircles(p=>p.map((ci,i)=>i===ent.idx?{...ci,cx:newCx,cy:newCy,r:newR}:ci))
              }
            } else if (ent.kind==='arc'&&(finalPending.radius||finalPending.angle)){
              const a=arcs[ent.idx]
              let r=a.r,span=norm2pi(a.endAngle-a.startAngle)
              if (finalPending.radius&&parseFloat(finalPending.radius)>0) r=mmToPx(parseFloat(finalPending.radius))
              if (finalPending.angle&&parseFloat(finalPending.angle)>0) span=parseFloat(finalPending.angle)*Math.PI/180
              if (finalPending.radius&&parseFloat(finalPending.radius)>0){
                const bbox2=selectionBBox(selection,lines,circles,arcs,splines)
                const handles2=bbox2?getBBoxHandles(bbox2):null
                const anchorPt=handles2?handles2[selectDimAnchor]||handles2['mc']:null
                if (anchorPt&&selectDimAnchor!=='mc'){
                  const fromAnchorX=a.cx-anchorPt.x,fromAnchorY=a.cy-anchorPt.y
                  const dist=Math.hypot(fromAnchorX,fromAnchorY)||1
                  const newCx=anchorPt.x+(fromAnchorX/dist)*r
                  const newCy=anchorPt.y+(fromAnchorY/dist)*r
                  const mid=(a.startAngle+a.endAngle)/2
                  setArcs(p=>p.map((ar,i)=>i===ent.idx?{...ar,cx:newCx,cy:newCy,r,startAngle:mid-span/2,endAngle:mid+span/2}:ar))
                } else {
                  const mid=(a.startAngle+a.endAngle)/2
                  setArcs(p=>p.map((ar,i)=>i===ent.idx?{...ar,r,startAngle:mid-span/2,endAngle:mid+span/2}:ar))
                }
              } else {
                const mid=(a.startAngle+a.endAngle)/2
                setArcs(p=>p.map((ar,i)=>i===ent.idx?{...ar,r,startAngle:mid-span/2,endAngle:mid+span/2}:ar))
              }
            }
          } else {
            // Multi-select: apply W and/or H independently
            const bbox2=selectionBBox(selection,lines,circles,arcs,splines)
            if (bbox2){
              // Determine anchor world point from anchor handle id
              const handles=getBBoxHandles(bbox2)
              const anchorH=handles[selectDimAnchor]||handles['mc']
              let sx=1,sy=1
              if (finalPending.width&&parseFloat(finalPending.width)>0)
                sx=mmToPx(parseFloat(finalPending.width))/bbox2.w
              if (finalPending.height&&parseFloat(finalPending.height)>0)
                sy=mmToPx(parseFloat(finalPending.height))/bbox2.h
              const result=applySelectionTransform(selection,lines,circles,arcs,splines,{x:anchorH.x,y:anchorH.y},sx,sy,0,0)
              setLines(result.lines);setCircles(result.circles);setArcs(result.arcs);setSplines(result.splines)
            }
          }
          setSelectDimField(null);setSelectDimPending({});setSelectDimAnchor('mc')
          setSelectDimInput('')
          return
        }
        if (e.key==='Escape'){setSelectDimField(null);setSelectDimPending({});setSelectDimInput('');return}
      }
    }

    if (tool==='spline'){
      if (e.key==='Escape'){resetSpline();return}
      if (e.key==='c'||e.key==='C'){setSplineClosed(p=>!p);return}
      if ((e.key==='Enter'||e.key==='Return')&&splinePoints.length>=2){
        e.preventDefault();finishSpline(splinePoints);return
      }
      return
    }

    if (tool==='offset'){
      if (e.key==='Escape'){resetOffset();return}
      if (offsetEntity){
        if (e.key==='Tab'){e.preventDefault();if(offsetDistInput&&parseFloat(offsetDistInput)>0)setOffsetDistLocked(p=>!p);return}
        if (e.key==='Backspace'){setOffsetDistInput(p=>p.slice(0,-1));setOffsetDistLocked(false);return}
        if (/^[0-9.]$/.test(e.key)){setOffsetDistLocked(false);setOffsetDistInput(p=>p+e.key);return}
      }
      return
    }

    if (tool==='mirror'){
      if (e.key==='Escape'){resetMirror();return}
      if (e.key==='Tab'){e.preventDefault();if(!mirrorAccepted&&mirrorSel.length>0)setMirrorAccepted(true);return}
      return
    }

    if (tool==='movecopy'){
      if (e.key==='Escape'){resetMoveCopy();resetDrawState();return}
      if (!startPoint){
        if ((e.key==='m'||e.key==='M')&&!e.ctrlKey){setMoveCopyMode('move');return}
        if ((e.key==='c'||e.key==='C')&&!e.ctrlKey){setMoveCopyMode('copy');return}
        if (e.key==='Tab'){e.preventDefault();if(!moveCopyAccepted&&moveCopySel.length>0)setMoveCopyAccepted(true);return}
        if (moveCopyMode==='copy'&&moveCopyAccepted){
          if (e.key==='Backspace'){setMoveCopyCountInput(p=>p.length>1?p.slice(0,-1):'1');return}
          if (/^[0-9]$/.test(e.key)){setMoveCopyCountInput(p=>{const next=p==='1'?e.key:p+e.key;const n=parseInt(next)||1;return String(Math.min(100,n));});return}
        }
        return
      }
      if (e.key==='Tab'){e.preventDefault();if(focusField==='dim'){if(dimInput&&parseFloat(dimInput)>0)setDimLocked(true);setFocusField('angle')}else{if(angleInput&&parseFloat(angleInput)>=0)setAngleLocked(true);setFocusField('dim')};return}
      if (e.key==='Backspace'){if(focusField==='angle'){setAngleInput(p=>p.slice(0,-1));setAngleLocked(false)}else{setDimInput(p=>p.slice(0,-1));setDimLocked(false)};return}
      if (/^[0-9.]$/.test(e.key)){if(focusField==='angle'){setAngleLocked(false);setAngleInput(p=>p+e.key)}else{setDimLocked(false);setDimInput(p=>p+e.key)}}
      return
    }

    if (tool==='rotatecopy'){
      if (e.key==='Escape'){resetRotateCopy();resetDrawState();return}
      if (!startPoint){
        if ((e.key==='r'||e.key==='R')&&!e.ctrlKey){setRotateCopyMode('rotate');return}
        if ((e.key==='c'||e.key==='C')&&!e.ctrlKey){setRotateCopyMode('copy');return}
        if (e.key==='Tab'){e.preventDefault();if(!rotateCopyAccepted&&rotateCopySel.length>0)setRotateCopyAccepted(true);return}
        if (rotateCopyMode==='copy'&&rotateCopyAccepted){
          if (e.key==='Backspace'){setRotateCopyCountInput(p=>p.length>1?p.slice(0,-1):'1');return}
          if (/^[0-9]$/.test(e.key)){setRotateCopyCountInput(p=>{const next=p==='1'?e.key:p+e.key;const n=parseInt(next)||1;return String(Math.min(100,n));});return}
        }
        return
      }
      if (e.key==='Tab'){e.preventDefault();if(angleInput)setAngleLocked(true);return}
      if (e.key==='Backspace'){setAngleInput(p=>p.slice(0,-1));setAngleLocked(false);return}
      if (/^[0-9.-]$/.test(e.key)){setAngleLocked(false);setAngleInput(p=>p===''&&e.key==='-'?'-':p+e.key)}
      return
    }

    if (tool==='resize'){
      if (e.key==='Escape'){resetResize();return}
      if (!resizeAccepted){
        if (e.key==='Tab'){e.preventDefault();if(resizeSel.length>0)setResizeAccepted(true);return}
        return
      }
      // Accepted — type scale factor
      if (e.key==='Backspace'){setResizeScaleInput(p=>p.slice(0,-1));return}
      if (/^[0-9.]$/.test(e.key)){setResizeScaleInput(p=>p+e.key);return}
      return
    }

    if (tool==='fillet'){
      if (e.key==='Escape'){resetFillet();return}
      if (!filletAccepted){
        if (e.key==='Tab'){e.preventDefault();if(filletSel.length===2)setFilletAccepted(true);return}
        return
      }
      // Accepted — type radius then Enter/click to apply
      if (e.key==='Enter'){
        e.preventDefault()
        if (!filletPreview||filletPreview.tooLarge) return
        const{newL1,newL2,arc}=filletPreview
        // Carry style from source lines through fillet
        const s1=lines[filletSel[0].idx]?.style
        const s2=lines[filletSel[1].idx]?.style
        commit(snapshot())
        setLines(p=>[...p.filter((_,i)=>!filletSel.some(s=>s.idx===i)),
          s1?{...newL1,style:s1}:newL1,
          s2?{...newL2,style:s2}:newL2])
        setArcs(p=>[...p,arc])
        resetFillet()
        return
      }
      if (e.key==='Backspace'){setFilletRadiusInput(p=>p.slice(0,-1));return}
      if (/^[0-9.]$/.test(e.key)){setFilletRadiusInput(p=>p+e.key);return}
      return
    }

    if (!startPoint&&!circleCenter&&!deferredTangent) return
    if (e.key==='Escape'){resetDrawState();return}
    if (e.key==='Tab'){
      e.preventDefault()
      if (tool==='line'){
        if (focusField==='dim'){if(dimInput&&parseFloat(dimInput)>0)setDimLocked(true);setFocusField('angle')}
        else{if(angleInput&&parseFloat(angleInput)>=0)setAngleLocked(true);setFocusField('dim')}
      } else {if(dimInput&&parseFloat(dimInput)>0)setDimLocked(true)}
      return
    }
    if (e.key==='Backspace'){
      if(focusField==='angle'&&tool==='line'){setAngleInput(p=>p.slice(0,-1));setAngleLocked(false)}
      else{setDimInput(p=>p.slice(0,-1));setDimLocked(false)}
      return
    }
    if (/^[0-9.]$/.test(e.key)){
      if(focusField==='angle'&&tool==='line'){setAngleLocked(false);setAngleInput(p=>p+e.key)}
      else{setDimLocked(false);setDimInput(p=>p+e.key)}
    }
  }

  const drawing=startPoint||circleCenter||deferredTangent

  // ── Status bar prompt builder ─────────────────────────────────────────────
  // Returns { step, total, color, action, hints:[{k,l}] }
  // k = key label (shown as badge), l = description (shown as plain text after)
  const getStatusPrompt = () => {
    const C = {
      select:'#64B5F6', line:'#64B5F6', circle:'#2196F3', spline:'#FFB74D',
      mirror:'#CE93D8', movecopy:'#FFB74D', rotatecopy:'#80DEEA',
      resize:'#F48FB1', fillet:'#80CBC4', offset:'#A5D6A7',
      dim:'#F48FB1',    trim:'#FFAB91',   extend:'#80DEEA',
      delete:'#EF9A9A', join:'#26C6DA',   text:'#FFB74D',  trace:'#B0BEC5',
    }
    const c = C[tool] || '#aaa'
    const K = (k,l='') => ({k,l})

    if (tool==='select') {
      if (selectDimField) return { step:3, total:3, color:c,
        action:`✏ ${selectDimField}: ${selectDimInput||'_'}`,
        hints:[K('Tab','next field'), K('Enter','apply'), K('Esc')] }
      if (selection.length>0) return { step:2, total:3, color:c,
        action:`${selection.length} selected`,
        hints:[K('Tab','edit dims'), K('H','dash'), K('D','construction'), K('Del','delete')] }
      return { step:1, total:3, color:c,
        action:'Click to select',
        hints:[K('Shift+click','add'), K('drag','window')] }
    }

    if (tool==='line') {
      if (drawing) {
        if (deferredTangent) return { step:null, total:null, color:'#F48FB1',
          action:'TAN — click end point',
          hints:[K('T','toggle off'), K('Esc')] }
        return { step:null, total:null, color:c,
          action:`${dimLocked?'🔒 ':''}${dimInput||'—'} mm  ·  ${angleLocked?'🔒 ':''}${angleInput||'—'}°`,
          hints:[K('Tab','toggle field'), K('Enter','lock'), K('T','tangent'), K('Esc')] }
      }
      return { step:null, total:null, color:c,
        action:'Click first point',
        hints:[K('T','tangent'), K('P','perpendicular')] }
    }

    if (tool==='circle') {
      if (circleCenter) return { step:2, total:2, color:c,
        action:`${dimLocked?'🔒 R ':'R '}${dimInput||'—'} mm`,
        hints:[K('type + Enter','exact radius'), K('T','tangent'), K('Esc')] }
      return { step:1, total:2, color:c,
        action:'Click centre point',
        hints:[] }
    }

    if (tool==='spline') {
      if (splinePoints.length===0) return { step:1, total:3, color:c,
        action:'Click first point',
        hints:[K('Esc','cancel')] }
      return { step:2, total:3, color:c,
        action:`${splinePoints.length} pts placed`,
        hints:[K('C',splineClosed?'closed':'open'), K('dbl-click','finish'), K('Esc')] }
    }

    if (tool==='offset') {
      if (!offsetEntity) return { step:1, total:3, color:c,
        action: offsetHover ? `Click to select ${offsetHover.kind}` : 'Hover entity to select',
        hints:[] }
      const d = offsetDistLocked ? parseFloat(offsetDistInput)||0
        : (mousePos ? pxToMm(distToEntity(mousePos,
            offsetEntity.kind==='line'?lines[offsetEntity.idx]:
            offsetEntity.kind==='circle'?circles[offsetEntity.idx]:
            offsetEntity.kind==='arc'?arcs[offsetEntity.idx]:splines[offsetEntity.idx],
            offsetEntity.kind)) : 0)
      return { step:'2+3', total:3, color:c,
        action:`Move to side · ${d.toFixed(1)} mm`,
        hints: offsetDistLocked
          ? [K('Tab','unlock dist'), K('click','place'), K('Esc')]
          : [K('type + Enter','lock dist'), K('click','place'), K('Esc')] }
    }

    if (tool==='dim') {
      if (dimToolStep===0) return { step:1, total:3, color:c,
        action:'Hover arc/circle or click pt 1',
        hints:[] }
      if (dimToolStep===1) return { step:2, total:3, color:c,
        action:'Click second point',
        hints:[K('Esc')] }
      return { step:3, total:3, color:c,
        action:'Click to place dim line',
        hints:[K('Esc')] }
    }

    if (tool==='mirror') {
      if (!mirrorAccepted) {
        if (mirrorSel.length===0) return { step:1, total:4, color:c,
          action:'Click or drag to select',
          hints:[K('Tab','accept')] }
        return { step:2, total:4, color:c,
          action:`${mirrorSel.length} selected`,
          hints:[K('Tab','accept'), K('Esc')] }
      }
      if (!mirrorP1) return { step:3, total:4, color:c,
        action:'Click mirror line pt 1',
        hints:[K('Esc')] }
      return { step:4, total:4, color:c,
        action:'Click mirror line pt 2',
        hints:[K('Esc')] }
    }

    if (tool==='movecopy') {
      const count = Math.max(1, parseInt(moveCopyCountInput)||1)
      const modeLabel = moveCopyMode==='move' ? 'MOVE' : `COPY ×${count}`
      if (!moveCopyAccepted) {
        if (moveCopySel.length===0) return { step:1, total:5, color:c,
          action:'Click or drag to select',
          hints:[K('M','move'), K('C','copy'), K('Tab','accept')] }
        return { step:2, total:5, color:c,
          action:`${moveCopySel.length} selected  [${modeLabel}]`,
          hints:[K('C','switch to copy'), K('Tab','accept'), K('Esc')] }
      }
      if (!startPoint) return { step: moveCopyMode==='copy' ? '3+4' : '4', total:5, color:c,
        action:`Click base point  [${modeLabel}]`,
        hints: moveCopyMode==='copy'
          ? [K('C #','change count'), K('Esc')]
          : [K('C','switch to copy'), K('Esc')] }
      return { step:5, total:5, color:c,
        action:`${dimLocked?'🔒':''}${dimInput||'—'} mm  ·  ${angleLocked?'🔒':''}${angleInput||'—'}°`,
        hints:[K('Tab','next field'), K('Esc')] }
    }

    if (tool==='rotatecopy') {
      const count = Math.max(1, parseInt(rotateCopyCountInput)||1)
      const modeLabel = rotateCopyMode==='rotate' ? 'ROTATE' : `COPY ×${count}`
      if (!rotateCopyAccepted) {
        if (rotateCopySel.length===0) return { step:1, total:5, color:c,
          action:'Click or drag to select',
          hints:[K('R','rotate'), K('C','copy'), K('Tab','accept')] }
        return { step:2, total:5, color:c,
          action:`${rotateCopySel.length} selected  [${modeLabel}]`,
          hints:[K('C','switch to copy'), K('Tab','accept'), K('Esc')] }
      }
      if (!startPoint) return { step: rotateCopyMode==='copy' ? '3+4' : '4', total:5, color:c,
        action:`Click centre point  [${modeLabel}]`,
        hints: rotateCopyMode==='copy'
          ? [K('C #','change count'), K('Esc')]
          : [K('C','switch to copy'), K('Esc')] }
      return { step:5, total:5, color:c,
        action:`${angleLocked?'🔒 ':''}${angleInput||'—'}°`,
        hints:[K('Tab','lock angle'), K('Esc')] }
    }

    if (tool==='resize') {
      if (!resizeAccepted) {
        if (resizeSel.length===0) return { step:1, total:3, color:c,
          action:'Click or drag to select',
          hints:[K('Tab','accept')] }
        return { step:2, total:3, color:c,
          action:`${resizeSel.length} selected`,
          hints:[K('Tab','accept'), K('Esc')] }
      }
      const s = parseFloat(resizeScaleInput)
      return { step:3, total:3, color:c,
        action:'⇲ Scale: '+(resizeScaleInput||'—')+(s>0?'  ('+(s<1?'shrink':'grow')+')':''),
        hints:[K('type','scale factor'), K('click','anchor point'), K('Esc')] }
    }

    if (tool==='fillet') {
      if (!filletAccepted) {
        if (filletSel.length===0) return { step:1, total:3, color:c,
          action:'Click first line',
          hints:[] }
        if (filletSel.length===1) return { step:2, total:3, color:c,
          action:'Click second line',
          hints:[K('Esc')] }
        return { step:2, total:3, color:c,
          action:'2 lines selected',
          hints:[K('Tab','accept'), K('Esc')] }
      }
      if (filletPreview?.tooLarge) return { step:3, total:3, color:'#EF9A9A',
        action:`R ${filletRadiusInput} mm — too large`,
        hints:[K('type','smaller radius')] }
      return { step:3, total:3, color:c,
        action: filletRadiusInput ? `R ${filletRadiusInput} mm` : 'Type fillet radius',
        hints:[K('Enter','apply')] }
    }

    if (tool==='trim') return { step:null, total:null, color:c,
      action: trimPreview?.kind==='spline'&&!trimPreview.highlightPts
        ? 'No intersections' : 'Hover segment to preview',
      hints:[K('click','trim'), K('Esc','exit')] }

    if (tool==='extend') return { step:null, total:null, color:c,
      action: extendPreview ? 'Click to extend' : 'Hover near endpoint',
      hints:[K('click','extend'), K('Esc','exit')] }

    if (tool==='delete') return { step:null, total:null, color:c,
      action:'Hover entity to preview',
      hints:[K('click','delete'), K('Esc','exit')] }

    if (tool==='join') return { step:null, total:null, color:c,
      action: joinFirstPt ? 'Click target point to connect' : 'Click an endpoint to move',
      hints:[K('Esc','cancel')] }

    if (tool==='text') return { step:null, total:null, color:c,
      action:'Click for text start point',
      hints:[] }

    if (tool==='trace') return { step:null, total:null, color:c,
      action:'Click for image insert point',
      hints:[] }

    return { step:null, total:null, color:'#666', action:'', hints:[] }
  }

    const toolConfig=[
    ['select',     IconSelect,     'Select / Info',  '#64B5F6'],
    ['line',       IconLine,       'Line',           '#2196F3'],
    ['circle',     IconCircle,     'Circle',         '#2196F3'],
    ['spline',     IconSpline,     'Spline',         '#FF6F00'],
    ['fillet',     IconFillet,     'Fillet',         '#26A69A'],
    ['text',       IconText,       'Text',           '#FF9800'],
    ['offset',     IconOffset,     'Offset',         '#4CAF50'],
    ['dim',        IconDim,        'Dimension',      '#E91E63'],
    ['trace',      IconTrace,      'Trace Image',    '#607D8B'],
  ]

  const editConfig=[
    ['trim',       IconTrim,       'Trim',           '#FF5722'],
    ['delete',     IconDelete,     'Delete',         '#F44336'],
    ['extend',     IconExtend,     'Extend',         '#00ACC1'],
    ['join',       IconJoin,       'Join / Connect', '#76FF03'],
  ]

  const modifyConfig=[
    ['movecopy',   IconMoveCopy,   'Move / Copy',    '#FF9800'],
    ['rotatecopy', IconRotateCopy, 'Rotate / Copy',  '#00BCD4'],
    ['resize',     IconResize,     'Resize / Scale', '#E91E63'],
    ['mirror',     IconMirror,     'Mirror',         '#9C27B0'],
  ]

  const btnBase={border:'none',borderRadius:5,cursor:'pointer',padding:4,display:'flex',alignItems:'center',justifyContent:'center',width:68,height:68,transition:'background 0.1s'}
  const zoomPct=Math.round(viewTransform.scale*100)

  return (
    <div style={{display:'flex',height:'100vh',outline:'none'}} tabIndex={0} onKeyDown={handleKeyDown}>
      <div style={{width:72,background:'#1e1e1e',display:'flex',flexDirection:'column',padding:'8px 4px',gap:4,overflowY:'hidden'}}>
        {toolConfig.map(([t,Icon,title,activeColor])=>(
          <button key={t}
            onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
            title={title}
            style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
              outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
            <Icon active={tool===t} />
          </button>
        ))}
      </div>

      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        {/* ── Top toolbar: Edit + Modify + Guide ── */}
        <div style={{background:'#1e1e1e',display:'flex',alignItems:'center',padding:'0 8px',gap:4,flexShrink:0,borderBottom:'1px solid #333',flexWrap:'wrap'}}>
          {/* Edit group */}
          <span style={{color:'#555',fontFamily:'monospace',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>Edit</span>
          {editConfig.map(([t,Icon,title,activeColor])=>(
            <button key={t}
              onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
              title={title}
              style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
              <Icon active={tool===t}/>
            </button>
          ))}
          {/* Divider */}
          <div style={{width:1,height:48,background:'#333',margin:'0 6px'}}/>
          {/* Modify group */}
          <span style={{color:'#555',fontFamily:'monospace',fontSize:9,textTransform:'uppercase',letterSpacing:'0.1em',marginRight:2}}>Modify</span>
          {modifyConfig.map(([t,Icon,title,activeColor])=>(
            <button key={t}
              onClick={()=>{setTool(t);resetDrawState();resetOffset();resetMirror();resetMoveCopy();resetRotateCopy();resetResize();resetFillet();resetTrace();resetSpline();resetText();resetSelection();resetJoin();resetDim()}}
              title={title}
              style={{...btnBase,background:tool===t?activeColor+'33':'transparent',
                outline:tool===t?`2px solid ${activeColor}`:'none',outlineOffset:'-2px'}}>
              <Icon active={tool===t}/>
            </button>
          ))}
          {/* Divider */}
          <div style={{width:1,height:48,background:'#333',margin:'0 6px'}}/>
          {/* Guide toggle */}
          <button
            onClick={()=>setGuideOpen(p=>!p)}
            title="Toggle Guide Panel"
            style={{...btnBase,
              background:guideOpen?'#f7fb0422':'transparent',
              outline:guideOpen?'2px solid #f7fb04':'none',
              outlineOffset:'-2px'}}>
            <IconGuide active={guideOpen}/>
          </button>
        </div>
        {/* ── Canvas + Guide side by side ── */}
        <div style={{flex:1,display:'flex',minHeight:0}}>
          <div style={{flex:1,overflow:'hidden',minWidth:0}}>
          <canvas ref={canvasRef}
          width={canvasSize.w} height={canvasSize.h}
          style={{background:'white',cursor:isPanningRef.current?'grabbing':tool==='select'?(selectDragHandleRef.current?'grabbing':selectHover?'pointer':'default'):'crosshair',display:'block'}}
          onClick={handleClick} onDoubleClick={handleDoubleClick} onContextMenu={handleContextMenu}
          onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}
        />
          </div>
          {guideOpen && <GuidePanel tool={tool} toolState={{
            // selection-phase tools
            mirrorSel, mirrorAccepted, mirrorP1,
            moveCopySel, moveCopyAccepted, moveCopyMode,
            rotateCopySel, rotateCopyAccepted, rotateCopyMode,
            resizeSel, resizeAccepted,
            filletSel, filletAccepted, filletRadiusInput,
            // draw tools
            startPoint, circleCenter, splinePoints,
            // single-action tools
            offsetEntity, offsetDistLocked, offsetPreview,
            trimPreview, extendPreview, deletePreview,
            joinFirstPt,
            // dim tool
            dimToolStep,
            // select
            selection, selectDimField,
          }}/>}
        </div>
        <div style={{height:52,background:'#16162a',display:'flex',alignItems:'center',padding:'0 8px',gap:4,flexShrink:0,borderTop:'2px solid #2a2a4a'}}>
          <button onClick={()=>undo(snapshot(),restore)} title="Undo (Ctrl+Z)" disabled={!canUndo}
            style={{...btnBase,opacity:canUndo?1:0.3,background:'transparent',border:'none',cursor:canUndo?'pointer':'default'}}>
            <IconUndo active={canUndo}/>
          </button>
          <button onClick={()=>redo(snapshot(),restore)} title="Redo (Ctrl+Y)" disabled={!canRedo}
            style={{...btnBase,opacity:canRedo?1:0.3,background:'transparent',border:'none',cursor:canRedo?'pointer':'default'}}>
            <IconRedo active={canRedo}/>
          </button>
          <button onClick={zoomToFit} title="Zoom to fit (F)" style={{...btnBase,background:'transparent',border:'none'}}>
            <IconFitView/>
          </button>
          <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
          <button onClick={()=>saveJSON(lines,circles,arcs,splines,dims)} title="Save (Ctrl+S)" style={{...btnBase,background:'transparent',border:'none'}}>
            <IconSave/>
          </button>
          <button onClick={()=>loadFileRef.current.click()} title="Load drawing" style={{...btnBase,background:'transparent',border:'none'}}>
            <IconLoad/>
          </button>
          <button onClick={()=>setPageSetupOpen(true)} title="Page Setup & Export PDF" style={{...btnBase,background:'transparent',border:'none'}}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="2" width="13" height="18" rx="1.5" stroke="#aaa" strokeWidth="1.5"/><line x1="6" y1="7" x2="13" y2="7" stroke="#aaa" strokeWidth="1.2"/><line x1="6" y1="10" x2="13" y2="10" stroke="#aaa" strokeWidth="1.2"/><line x1="6" y1="13" x2="11" y2="13" stroke="#aaa" strokeWidth="1.2"/><rect x="12" y="13" width="7" height="7" rx="1" fill="#E53935"/><text x="13.5" y="19" fontSize="5" fill="white" fontFamily="monospace">PDF</text></svg>
          </button>
          <label title="Import DXF file" style={{...btnBase,background:'transparent',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="2" width="11" height="15" rx="1" stroke="#aaa" strokeWidth="1.5"/>
              <path d="M10 2v5h4" stroke="#aaa" strokeWidth="1.2" fill="none"/>
              <text x="3.5" y="19" fontSize="5" fill="#4CAF50" fontFamily="monospace" fontWeight="bold">DXF</text>
              <path d="M16 13l3 3-3 3" stroke="#4CAF50" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
            </svg>
            <input type="file" accept=".dxf" style={{display:'none'}} onChange={async e=>{
              const file=e.target.files?.[0];if(!file)return
              try{
                const text=await file.text()
                const result=parseDXF(text,2)
                commit(snapshot())
                setLines(p=>[...p,...result.lines])
                setCircles(p=>[...p,...result.circles])
                setArcs(p=>[...p,...result.arcs])
                setSplines(p=>[...p,...result.splines])
                const total=result.lines.length+result.circles.length+result.arcs.length+result.splines.length
                setLoadError(null)
                alert(`DXF imported: ${total} entities (${result.lines.length} lines, ${result.circles.length} circles, ${result.arcs.length} arcs, ${result.splines.length} polylines)`)
              }catch(err){
                setLoadError('DXF import failed: '+err.message)
              }
              e.target.value=''
            }}/>
          </label>
          <button onClick={()=>exportDXF(lines,circles,arcs,splines)} title="Export DXF" style={{...btnBase,background:'transparent',border:'none'}}>
            <IconDXF/>
          </button>
          <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
          {/* Grid toggle */}
          <button
            onClick={()=>setGridVisible(p=>!p)}
            title={gridVisible?'Hide grid':'Show grid'}
            style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
              background:gridVisible?'#3949AB44':'#1a1a2e',
              border:`2px solid ${gridVisible?'#5C6BC0':'#3a3a5a'}`,
              color:gridVisible?'#9FA8DA':'#666',
              borderRadius:5,padding:'3px 8px',cursor:'pointer',gap:1}}>
            <span style={{fontSize:14,lineHeight:1}}>⊞</span>
            <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em'}}>GRID</span>
          </button>
          {/* Grid size */}
          <select
            value={gridSizeMm}
            onChange={e=>setGridSizeMm(Number(e.target.value))}
            title="Grid size"
            style={{background:'#1a1a2e',border:'2px solid #3a3a5a',color:'#9FA8DA',
              borderRadius:5,padding:'4px 6px',fontFamily:'monospace',fontSize:11,cursor:'pointer',height:36}}>
            {[0.5,1,2,5,10,25,50].map(v=><option key={v} value={v}>{v}mm</option>)}
          </select>
          {/* Snap toggle */}
          <button
            onClick={()=>setGridSnap(p=>!p)}
            title={gridSnap?'Snap to grid ON':'Snap to grid OFF'}
            style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
              background:gridSnap?'#00695C44':'#1a1a2e',
              border:`2px solid ${gridSnap?'#26A69A':'#3a3a5a'}`,
              color:gridSnap?'#80CBC4':'#666',
              borderRadius:5,padding:'3px 8px',cursor:'pointer',gap:1}}>
            <span style={{fontSize:14,lineHeight:1}}>⊠</span>
            <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em'}}>SNAP</span>
          </button>
          <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
          {/* Line style buttons */}
          {[
            {s:null,        label:'FIRM',    title:'Normal line',        color:'#aaa',    line:'——'},
            {s:'dashed',    label:'DASH',    title:'Dashed line (H)',    color:'#FF9800', line:'- -'},
            {s:'construction',label:'CONST', title:'Construction (D)',   color:'#9E9E9E', line:'···'},
          ].map(({s,label,title,color,line})=>(
            <button key={s||'normal'} onClick={()=>setDrawStyle(s)} title={title}
              style={{
                display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                background: drawStyle===s?color+'33':'#1a1a2e',
                border:`2px solid ${drawStyle===s?color:'#3a3a5a'}`,
                color: drawStyle===s?color:'#666',
                borderRadius:5,padding:'3px 8px',cursor:'pointer',gap:1,
              }}>
              <span style={{fontSize:11,fontFamily:'monospace',letterSpacing:'0.1em',lineHeight:1}}>{line}</span>
              <span style={{fontSize:8,fontFamily:'monospace',letterSpacing:'0.05em'}}>{label}</span>
            </button>
          ))}
          <div style={{width:1,height:28,background:'#2a2a4a',margin:'0 4px'}}/>
          {(()=>{
            const p = getStatusPrompt()
            if (!p) return <div style={{flex:1}}/>
            return (
              <div style={{flex:1,display:'flex',alignItems:'center',gap:8,overflow:'hidden',minWidth:0}}>
                {/* Step badge */}
                {p.step!==null && p.total!==null && (
                  <div style={{
                    flexShrink:0,
                    background: p.color+'22',
                    border:`1px solid ${p.color}66`,
                    borderRadius:4,
                    padding:'2px 7px',
                    fontFamily:'monospace',
                    fontSize:10,
                    fontWeight:'bold',
                    color: p.color,
                    letterSpacing:'0.05em',
                    whiteSpace:'nowrap',
                  }}>
                    {typeof p.step==='string'?p.step:`${p.step}/${p.total}`}
                  </div>
                )}
                {/* Action text */}
                <span style={{
                  flexShrink:0,
                  fontFamily:'monospace',
                  fontSize:13,
                  fontWeight:'bold',
                  color: p.color,
                  whiteSpace:'nowrap',
                }}>
                  {p.action}
                </span>
                {/* Key badges */}
                {p.hints && p.hints.length>0 && <>
                  <span style={{color:'#2a2a4a',fontSize:11,flexShrink:0}}>·</span>
                  <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'nowrap',overflow:'hidden'}}>
                    {p.hints.map(({k,l},i)=>(
                      <span key={i} style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                        <span style={{
                          display:'inline-flex',alignItems:'center',justifyContent:'center',
                          fontFamily:'monospace',fontSize:11,fontWeight:500,
                          padding:'2px 7px',
                          borderRadius:4,
                          background:'#333',
                          border:'1px solid #888',
                          color:'#fff',
                          whiteSpace:'nowrap',
                        }}>{k}</span>
                        {l && <span style={{
                          fontFamily:'monospace',fontSize:10,color:'#999',whiteSpace:'nowrap',
                        }}>{l}</span>}
                      </span>
                    ))}
                  </div>
                </>}
              </div>
            )
          })()}
          <div style={{color:'#777',fontFamily:'monospace',fontSize:11,paddingLeft:8,borderLeft:'1px solid #2a2a4a'}}>{zoomPct}%</div>
        </div>
      </div>

      {/* Hidden file input */}
      <input ref={loadFileRef} type="file" accept=".json" style={{display:'none'}}
        onChange={async e=>{
          const file=e.target.files[0];e.target.value=''
          if (!file) return
          try {
            const data=await loadJSON(file)
            if (data.dims) setDims(data.dims)
            commit(snapshot())
            setLines(data.lines);setCircles(data.circles);setArcs(data.arcs);setSplines(data.splines||[])
            resetDrawState()
          } catch(err) {setLoadError(err.message);setTimeout(()=>setLoadError(null),3000)}
        }}
      />
      {loadError&&<div style={{position:'fixed',top:10,left:'50%',transform:'translateX(-50%)',background:'#b71c1c',color:'white',padding:'6px 16px',borderRadius:4,fontFamily:'monospace',fontSize:12,pointerEvents:'none'}}>⚠ {loadError}</div>}
      {tKeyDown&&(tool==='line'||tool==='circle')&&<div style={{position:'fixed',top:10,right:10,background:'#E91E6399',color:'white',padding:'3px 10px',borderRadius:4,fontFamily:'monospace',fontSize:11,fontWeight:'bold',pointerEvents:'none'}}>TAN</div>}
      {pKeyDown&&tool==='line'&&<div style={{position:'fixed',top:10,right:60,background:'#00BCD499',color:'white',padding:'3px 10px',borderRadius:4,fontFamily:'monospace',fontSize:11,fontWeight:'bold',pointerEvents:'none'}}>PERP</div>}


      {traceOpen&&traceInsertPt&&(
        <TracerPanel
          insertPt={traceInsertPt}
          onImport={({lines:iLines,circles:iCircles,arcs:iArcs})=>{
            commit(snapshot())
            setLines(p=>[...p,...iLines])
            setCircles(p=>[...p,...iCircles])
            setArcs(p=>[...p,...iArcs])
            resetTrace();setTool('select')
          }}
          onClose={()=>{resetTrace();setTool('select')}}
        />
      )}

      {pageSetupOpen&&(
        <PageSetupPanel
          lines={lines} circles={circles} arcs={arcs} splines={splines} dims={dims}
          pxToMm={pxToMm} mmToPx={mmToPx}
          pageConfig={pageConfig} setPageConfig={setPageConfig}
          onClose={()=>setPageSetupOpen(false)}
        />
      )}
      {textOpen&&(
        <TextPanel
          insertPt={textInsertPt}
          mmToPx={mmToPx}
          onImport={newSplines=>{
            commit(snapshot());setSplines(p=>[...p,...newSplines])
            resetText();setTool('line')
          }}
          onClose={()=>{resetText();setTool('line')}}
        />
      )}
    </div>
  )
}

import { TRIM_DIST, DELETE_DIST, norm2pi, zoomRef } from '../constants.js'
import { angleOnArc, lineIntersections, circleIntersectionAngles, arcIntersectionAngles } from '../geometry/intersections.js'

export function distToSeg(px,py,x1,y1,x2,y2) {
  const dx=x2-x1,dy=y2-y1,len2=dx*dx+dy*dy
  if (!len2) return Math.hypot(px-x1,py-y1)
  const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/len2))
  return Math.hypot(px-x1-t*dx,py-y1-t*dy)
}

export function tOnSeg(px,py,x1,y1,x2,y2) {
  const dx=x2-x1,dy=y2-y1,len2=dx*dx+dy*dy
  if (!len2) return 0
  return Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/len2))
}

// Now accepts optional splines so crossings with splines are treated as trim boundaries
export function computeTrimPreview(mouse,lines,circles,arcs,splines=[]) {
  const td=TRIM_DIST/zoomRef.scale
  let bestDist=td+1,target=null
  lines.forEach((l,idx)=>{const d=distToSeg(mouse.x,mouse.y,l.x1,l.y1,l.x2,l.y2);if(d<bestDist){bestDist=d;target={kind:'line',idx}}})
  circles.forEach((c,idx)=>{const d=Math.abs(Math.hypot(mouse.x-c.cx,mouse.y-c.cy)-c.r);if(d<bestDist){bestDist=d;target={kind:'circle',idx}}})
  arcs.forEach((arc,idx)=>{
    const angle=norm2pi(Math.atan2(mouse.y-arc.cy,mouse.x-arc.cx))
    if (!angleOnArc(angle,arc.startAngle,arc.endAngle)) return
    const d=Math.abs(Math.hypot(mouse.x-arc.cx,mouse.y-arc.cy)-arc.r)
    if (d<bestDist){bestDist=d;target={kind:'arc',idx}}
  })
  if (!target) return null

  if (target.kind==='line') {
    const l=lines[target.idx]
    const pts=lineIntersections(target.idx,lines,circles,arcs,splines)
    if (!pts.length) return null
    const t=tOnSeg(mouse.x,mouse.y,l.x1,l.y1,l.x2,l.y2),tv=[0,...pts.map(p=>p.t),1]
    let tS=0,tE=1
    for (let i=0;i<tv.length-1;i++){if(t>=tv[i]-1e-8&&t<=tv[i+1]+1e-8){tS=tv[i];tE=tv[i+1];break}}
    const dx=l.x2-l.x1,dy=l.y2-l.y1
    return {kind:'line',idx:target.idx,hx1:l.x1+tS*dx,hy1:l.y1+tS*dy,hx2:l.x1+tE*dx,hy2:l.y1+tE*dy,tStart:tS,tEnd:tE}
  }
  if (target.kind==='circle') {
    const c=circles[target.idx],angles=circleIntersectionAngles(target.idx,lines,circles,arcs,splines)
    if (angles.length<2) return null
    const θ=norm2pi(Math.atan2(mouse.y-c.cy,mouse.x-c.cx))
    let arcS=angles[angles.length-1],arcE=angles[0]
    for (let i=0;i<angles.length-1;i++){if(θ>=angles[i]-1e-8&&θ<=angles[i+1]+1e-8){arcS=angles[i];arcE=angles[i+1];break}}
    return {kind:'circle',idx:target.idx,cx:c.cx,cy:c.cy,r:c.r,arcStart:arcS,arcEnd:arcE,allAngles:angles}
  }
  if (target.kind==='arc') {
    const arc=arcs[target.idx],intAngles=arcIntersectionAngles(target.idx,lines,circles,arcs,splines)
    if (!intAngles.length) return null
    const splitAngles=[norm2pi(arc.startAngle),...intAngles,norm2pi(arc.endAngle)].sort((a,b)=>a-b)
    const θ=norm2pi(Math.atan2(mouse.y-arc.cy,mouse.x-arc.cx))
    let arcS=splitAngles[0],arcE=splitAngles[1]
    for (let i=0;i<splitAngles.length-1;i++){if(angleOnArc(θ,splitAngles[i],splitAngles[i+1])){arcS=splitAngles[i];arcE=splitAngles[i+1];break}}
    return {kind:'arc',idx:target.idx,cx:arc.cx,cy:arc.cy,r:arc.r,arcStart:arcS,arcEnd:arcE}
  }
  return null
}

export function performTrim(preview,lines,circles,arcs) {
  if (!preview) return {lines,circles,arcs}
  let nl=[...lines],nc=[...circles],na=[...arcs]
  if (preview.kind==='line') {
    const l=lines[preview.idx],dx=l.x2-l.x1,dy=l.y2-l.y1
    nl=lines.filter((_,i)=>i!==preview.idx)
    // Spread l to preserve plane, style, and any other metadata
    if (preview.tStart>1e-8) nl.push({...l,x1:l.x1,y1:l.y1,x2:l.x1+preview.tStart*dx,y2:l.y1+preview.tStart*dy})
    if (preview.tEnd<1-1e-8) nl.push({...l,x1:l.x1+preview.tEnd*dx,y1:l.y1+preview.tEnd*dy,x2:l.x2,y2:l.y2})
  }
  if (preview.kind==='circle') {
    const {cx,cy,r,arcStart,arcEnd,allAngles}=preview
    const orig=circles[preview.idx]  // spread to preserve plane, style, etc.
    nc=circles.filter((_,i)=>i!==preview.idx)
    const n=allAngles.length
    for (let i=0;i<n;i++) {
      const aS=allAngles[i],aE=allAngles[(i+1)%n]
      if (Math.abs(aS-arcStart)<1e-8&&Math.abs(aE-arcEnd)<1e-8) continue
      na.push({...orig,startAngle:aS,endAngle:aE})
    }
  }
  if (preview.kind==='arc') {
    const arc=arcs[preview.idx]
    na=arcs.filter((_,i)=>i!==preview.idx)
    if (Math.abs(norm2pi(arc.startAngle)-preview.arcStart)>1e-8) na.push({...arc,endAngle:preview.arcStart})
    if (Math.abs(preview.arcEnd-norm2pi(arc.endAngle))>1e-8) na.push({...arc,startAngle:preview.arcEnd})
  }
  return {lines:nl,circles:nc,arcs:na}
}

export function computeDeletePreview(mouse,lines,circles,arcs) {
  const dd=DELETE_DIST/zoomRef.scale
  let best=null,bestDist=dd+1
  lines.forEach((l,idx)=>{const d=distToSeg(mouse.x,mouse.y,l.x1,l.y1,l.x2,l.y2);if(d<bestDist){bestDist=d;best={kind:'line',idx}}})
  circles.forEach((c,idx)=>{const d=Math.abs(Math.hypot(mouse.x-c.cx,mouse.y-c.cy)-c.r);if(d<bestDist){bestDist=d;best={kind:'circle',idx}}})
  arcs.forEach((arc,idx)=>{
    const angle=norm2pi(Math.atan2(mouse.y-arc.cy,mouse.x-arc.cx))
    if (!angleOnArc(angle,arc.startAngle,arc.endAngle)) return
    const d=Math.abs(Math.hypot(mouse.x-arc.cx,mouse.y-arc.cy)-arc.r)
    if (d<bestDist){bestDist=d;best={kind:'arc',idx}}
  })
  return best
}

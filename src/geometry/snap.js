import { SNAP_DIST, LINE_SNAP_DIST, ALIGN_SNAP_DIST, SNAP_ANGLE, ACQUIRE_DIST, norm2pi, zoomRef } from '../constants.js'
import { angleOnArc } from './intersections.js'

export function nearestOnSegment(px,py,x1,y1,x2,y2) {
  const dx=x2-x1,dy=y2-y1,lenSq=dx*dx+dy*dy
  if (!lenSq) return {dist:Math.hypot(px-x1,py-y1),x:x1,y:y1,t:0}
  const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/lenSq))
  return {dist:Math.hypot(px-x1-t*dx,py-y1-t*dy),x:x1+t*dx,y:y1+t*dy,t}
}

// Inline Catmull-Rom sample (avoids circular import with splineMath.js)
function sampleSplineInline(pts, closed, n=16) {
  if (pts.length<2) return pts.slice()
  const result=[]
  const count=pts.length
  const ext=closed
    ? [pts[count-1],...pts,pts[0],pts[1]]
    : [pts[0],...pts,pts[count-1]]
  const segs=closed?count:count-1
  for (let i=0;i<segs;i++){
    const p0=ext[i],p1=ext[i+1],p2=ext[i+2],p3=ext[i+3]
    for (let j=0;j<n;j++){
      const t=j/n,t2=t*t,t3=t2*t
      result.push({
        x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
      })
    }
  }
  result.push(closed?result[0]:pts[count-1])
  return result
}

// getGeoSnap: accepts optional splines array.
// Auto-upgrade: when cursor is within QD_UPGRADE_DIST of a quadrant point,
// oncircle snap is replaced by quadrant snap automatically — no key needed.
export function getGeoSnap(pos,lines,circles,arcs,excludePt,allowTan=false,splines=[],intersectionPts=[]) {
  const sd=SNAP_DIST/zoomRef.scale
  const ld=LINE_SNAP_DIST/zoomRef.scale
  const qd=sd*1.5   // quadrant snaps from slightly further than normal endpoints
  const excl=2/zoomRef.scale
  let best=null,bestDist=Infinity

  // Intersection snap — checked first so endpoints can still override if closer
  const intDist=sd*1.2
  intersectionPts.forEach(p=>{
    if (excludePt&&Math.hypot(p.x-excludePt.x,p.y-excludePt.y)<excl) return
    const d=Math.hypot(pos.x-p.x,pos.y-p.y)
    if (d<intDist&&d<bestDist){bestDist=d;best={x:p.x,y:p.y,type:'intersect'}}
  })

  lines.forEach(line=>{
    const pts=[
      {x:line.x1,y:line.y1,type:'endpoint'},
      {x:line.x2,y:line.y2,type:'endpoint'},
      {x:(line.x1+line.x2)/2,y:(line.y1+line.y2)/2,type:'midpoint'}
    ]
    for (const pt of pts) {
      if (excludePt&&Math.hypot(pt.x-excludePt.x,pt.y-excludePt.y)<excl) continue
      const d=Math.hypot(pos.x-pt.x,pos.y-pt.y)
      if (d<sd&&d<bestDist){bestDist=d;best={...pt}}
    }
    if (bestDist>sd) {
      const n=nearestOnSegment(pos.x,pos.y,line.x1,line.y1,line.x2,line.y2)
      if (n.dist<ld&&n.dist<bestDist&&n.t>0.05&&n.t<0.95&&Math.abs(n.t-0.5)>0.05)
        {bestDist=n.dist;best={x:n.x,y:n.y,type:'online'}}
    }
  })

  for (let idx=0;idx<circles.length;idx++) {
    const c=circles[idx]
    const quadPts=[
      {x:c.cx+c.r,y:c.cy,type:'quadrant',circleIdx:idx},
      {x:c.cx-c.r,y:c.cy,type:'quadrant',circleIdx:idx},
      {x:c.cx,y:c.cy-c.r,type:'quadrant',circleIdx:idx},
      {x:c.cx,y:c.cy+c.r,type:'quadrant',circleIdx:idx}
    ]
    const ctrPt={x:c.cx,y:c.cy,type:'center',circleIdx:idx}
    // Check centre first
    if (!(excludePt&&Math.hypot(ctrPt.x-excludePt.x,ctrPt.y-excludePt.y)<excl)) {
      const d=Math.hypot(pos.x-ctrPt.x,pos.y-ctrPt.y)
      if (d<sd&&d<bestDist){bestDist=d;best={...ctrPt}}
    }
    // Check quadrant points with enlarged radius
    for (const pt of quadPts) {
      if (excludePt&&Math.hypot(pt.x-excludePt.x,pt.y-excludePt.y)<excl) continue
      const d=Math.hypot(pos.x-pt.x,pos.y-pt.y)
      if (d<qd&&d<bestDist){bestDist=d;best={...pt}}
    }
    // On-circle snap — only if we're NOT near a quadrant point
    const nearQD=quadPts.some(pt=>Math.hypot(pos.x-pt.x,pos.y-pt.y)<qd*1.2)
    if (!nearQD) {
      const dte=Math.abs(Math.hypot(pos.x-c.cx,pos.y-c.cy)-c.r)
      if (dte<ld&&dte<bestDist) {
        const angle=Math.atan2(pos.y-c.cy,pos.x-c.cx)
        const sx=c.cx+c.r*Math.cos(angle),sy=c.cy+c.r*Math.sin(angle)
        bestDist=dte
        best=allowTan
          ? {x:sx,y:sy,type:'tan',circleIdx:idx,cx:c.cx,cy:c.cy,r:c.r}
          : {x:sx,y:sy,type:'oncircle',circleIdx:idx}
      }
    }
  }

  arcs.forEach((arc,idx)=>{
    const ePts=[
      {x:arc.cx+arc.r*Math.cos(arc.startAngle),y:arc.cy+arc.r*Math.sin(arc.startAngle),type:'endpoint'},
      {x:arc.cx+arc.r*Math.cos(arc.endAngle),y:arc.cy+arc.r*Math.sin(arc.endAngle),type:'endpoint'},
      {x:arc.cx,y:arc.cy,type:'center'}
    ]
    for (const pt of ePts) {
      if (excludePt&&Math.hypot(pt.x-excludePt.x,pt.y-excludePt.y)<excl) continue
      const d=Math.hypot(pos.x-pt.x,pos.y-pt.y)
      if (d<sd&&d<bestDist){bestDist=d;best={...pt}}
    }
    const angle=norm2pi(Math.atan2(pos.y-arc.cy,pos.x-arc.cx))
    if (angleOnArc(angle,arc.startAngle,arc.endAngle)) {
      const dte=Math.abs(Math.hypot(pos.x-arc.cx,pos.y-arc.cy)-arc.r)
      if (dte<ld&&dte<bestDist) {
        const sx=arc.cx+arc.r*Math.cos(angle),sy=arc.cy+arc.r*Math.sin(angle)
        bestDist=dte
        best=allowTan
          ? {x:sx,y:sy,type:'tan',arcIdx:idx,cx:arc.cx,cy:arc.cy,r:arc.r}
          : {x:sx,y:sy,type:'oncircle'}
      }
    }
  })

  // Spline snaps
  splines.forEach((sp)=>{
    if (!sp||sp.points.length<2) return
    const n=sp.points.length

    // Endpoint snap: first and last control point of open splines
    const endPts=sp.closed
      ? []
      : [{x:sp.points[0].x,y:sp.points[0].y,type:'endpoint'},
         {x:sp.points[n-1].x,y:sp.points[n-1].y,type:'endpoint'}]
    for (const pt of endPts) {
      if (excludePt&&Math.hypot(pt.x-excludePt.x,pt.y-excludePt.y)<excl) continue
      const d=Math.hypot(pos.x-pt.x,pos.y-pt.y)
      if (d<sd&&d<bestDist){bestDist=d;best={...pt}}
    }

    // Nodepoint snap: intermediate control points (not first/last)
    // Skip for polyline splines (text/trimmed) — they have hundreds of points
    if (!sp.polyline){
      const start=sp.closed?0:1
      const end=sp.closed?n:n-1
      for (let i=start;i<end;i++){
        const p=sp.points[i]
        if (excludePt&&Math.hypot(p.x-excludePt.x,p.y-excludePt.y)<excl) continue
        const d=Math.hypot(pos.x-p.x,pos.y-p.y)
        if (d<sd&&d<bestDist){bestDist=d;best={x:p.x,y:p.y,type:'nodepoint'}}
      }
    }

    // On-curve snap: polyline splines use points directly; smooth splines use Catmull-Rom
    const sampled=sp.polyline?sp.points:sampleSplineInline(sp.points,sp.closed,16)
    for (let i=0;i<sampled.length-1;i++){
      const nb=nearestOnSegment(pos.x,pos.y,sampled[i].x,sampled[i].y,sampled[i+1].x,sampled[i+1].y)
      if (nb.dist<ld&&nb.dist<bestDist&&nb.t>0&&nb.t<1){
        // Don't show 'online' if we're near an endpoint or nodepoint
        const nearSpecial=[...endPts,...(sp.polyline?[]:sp.points)].some(p=>Math.hypot(nb.x-p.x,nb.y-p.y)<sd*1.5)
        if (!nearSpecial){bestDist=nb.dist;best={x:nb.x,y:nb.y,type:'online'}}
      }
    }
  })

  return best
}

// getAllSnapPoints: includes spline endpoints for alignment tracking
export function getAllSnapPoints(lines, circles, arcs, splines=[]) {
  const pts=[],seen=new Set()
  const add=(x,y)=>{const k=`${Math.round(x)},${Math.round(y)}`;if(!seen.has(k)){seen.add(k);pts.push({x,y})}}
  lines.forEach(l=>{add(l.x1,l.y1);add(l.x2,l.y2);add((l.x1+l.x2)/2,(l.y1+l.y2)/2)})
  circles.forEach(c=>{add(c.cx,c.cy);add(c.cx+c.r,c.cy);add(c.cx-c.r,c.cy);add(c.cx,c.cy-c.r);add(c.cx,c.cy+c.r)})
  arcs.forEach(arc=>{
    add(arc.cx+arc.r*Math.cos(arc.startAngle),arc.cy+arc.r*Math.sin(arc.startAngle))
    add(arc.cx+arc.r*Math.cos(arc.endAngle),arc.cy+arc.r*Math.sin(arc.endAngle))
    add(arc.cx,arc.cy)
  })
  splines.forEach(sp=>{
    if (sp.points.length>0){
      add(sp.points[0].x,sp.points[0].y)
      add(sp.points[sp.points.length-1].x,sp.points[sp.points.length-1].y)
    }
  })
  return pts
}

export function checkAngle(from,to) {
  const angle=Math.abs(Math.atan2(to.y-from.y,to.x-from.x)*180/Math.PI)
  if (angle<SNAP_ANGLE||angle>180-SNAP_ANGLE) return 'horizontal'
  if (Math.abs(angle-90)<SNAP_ANGLE) return 'vertical'
  return null
}

export function getAngleSnap(start,end) {
  const snap=checkAngle(start,end)
  if (snap==='horizontal') return {x:end.x,y:start.y,angleSnap:'horizontal'}
  if (snap==='vertical') return {x:start.x,y:end.y,angleSnap:'vertical'}
  return {...end,angleSnap:null}
}

export function applyTracking(raw,trackedPts) {
  const ad=ALIGN_SNAP_DIST/zoomRef.scale
  let snappedX=raw.x,snappedY=raw.y
  const activeH=[],activeV=[]
  for (const tp of trackedPts) {
    if (Math.abs(raw.y-tp.y)<ad){snappedY=tp.y;activeH.push(tp)}
    if (Math.abs(raw.x-tp.x)<ad){snappedX=tp.x;activeV.push(tp)}
  }
  const tracks=[]
  for (const tp of activeH) tracks.push({fromX:tp.x,fromY:tp.y,toX:snappedX,toY:tp.y})
  for (const tp of activeV) tracks.push({fromX:tp.x,fromY:tp.y,toX:tp.x,toY:snappedY})
  return {snapped:{x:snappedX,y:snappedY},tracks}
}

export function computeLiveAngle(start,end) {
  let deg=Math.atan2(-(end.y-start.y),end.x-start.x)*180/Math.PI
  if (deg<0) deg+=360
  return deg
}

export function getTanPtsOnCircle(px,py,cx,cy,r) {
  const dx=px-cx,dy=py-cy,d=Math.hypot(dx,dy)
  if (d<=r+0.5) return []
  const phi=Math.atan2(dy,dx),gamma=Math.acos(Math.min(1,r/d))
  return [
    {x:cx+r*Math.cos(phi-gamma),y:cy+r*Math.sin(phi-gamma)},
    {x:cx+r*Math.cos(phi+gamma),y:cy+r*Math.sin(phi+gamma)}
  ]
}

export function getExternalTangentPairs(c1,c2) {
  const dx=c2.cx-c1.cx,dy=c2.cy-c1.cy,d=Math.hypot(dx,dy)
  if (d<0.001||d<Math.abs(c1.r-c2.r)) return []
  const cosArg=(c2.r-c1.r)/d
  if (Math.abs(cosArg)>1) return []
  const phi=Math.atan2(dy,dx),delta=Math.acos(cosArg)
  return [1,-1].map(sign=>{
    const beta=phi+sign*delta,nx=Math.cos(beta),ny=Math.sin(beta)
    return {t1:{x:c1.cx-c1.r*nx,y:c1.cy-c1.r*ny},t2:{x:c2.cx-c2.r*nx,y:c2.cy-c2.r*ny}}
  })
}

export function nearestPt(pts,ref) {
  if (!pts.length) return null
  return pts.reduce((a,b)=>Math.hypot(a.x-ref.x,a.y-ref.y)<Math.hypot(b.x-ref.x,b.y-ref.y)?a:b)
}

export { ACQUIRE_DIST, ALIGN_SNAP_DIST }

import { norm2pi } from '../constants.js'

export function segSegIntersect(x1,y1,x2,y2,x3,y3,x4,y4) {
  const dx1=x2-x1,dy1=y2-y1,dx2=x4-x3,dy2=y4-y3
  const d=dx1*dy2-dy1*dx2
  if (Math.abs(d)<1e-10) return null
  const t=((x3-x1)*dy2-(y3-y1)*dx2)/d
  const s=((x3-x1)*dy1-(y3-y1)*dx1)/d
  if (t<1e-10||t>1-1e-10||s<1e-10||s>1-1e-10) return null
  return {t,x:x1+t*dx1,y:y1+t*dy1}
}

export function segCircleIntersect(x1,y1,x2,y2,cx,cy,r) {
  const dx=x2-x1,dy=y2-y1,fx=x1-cx,fy=y1-cy
  const a=dx*dx+dy*dy,b=2*(fx*dx+fy*dy),c=fx*fx+fy*fy-r*r
  const disc=b*b-4*a*c
  if (disc<0) return []
  return [-1,1].map(s=>(-b+s*Math.sqrt(disc))/(2*a))
    .filter(t=>t>1e-10&&t<1-1e-10)
    .map(t=>({t,x:x1+t*dx,y:y1+t*dy,angle:norm2pi(Math.atan2(y1+t*dy-cy,x1+t*dx-cx))}))
}

export function circleCircleIntersect(cx1,cy1,r1,cx2,cy2,r2) {
  const dx=cx2-cx1,dy=cy2-cy1,d=Math.hypot(dx,dy)
  if (d<1e-6||d>r1+r2+1e-6||d<Math.abs(r1-r2)-1e-6) return []
  const a=(r1*r1-r2*r2+d*d)/(2*d)
  const h=Math.sqrt(Math.max(0,r1*r1-a*a))
  const mx=cx1+a*dx/d,my=cy1+a*dy/d
  const pts=[{x:mx+h*dy/d,y:my-h*dx/d},{x:mx-h*dy/d,y:my+h*dx/d}]
  return pts.filter((p,i)=>i===0||Math.hypot(pts[0].x-p.x,pts[0].y-p.y)>1e-6)
    .map(p=>({x:p.x,y:p.y,
      angle1:norm2pi(Math.atan2(p.y-cy1,p.x-cx1)),
      angle2:norm2pi(Math.atan2(p.y-cy2,p.x-cx2))}))
}

export function angleOnArc(θ,start,end) {
  θ=norm2pi(θ);start=norm2pi(start);end=norm2pi(end)
  if (start<=end) return θ>=start-1e-8&&θ<=end+1e-8
  return θ>=start-1e-8||θ<=end+1e-8
}

export function pointOnSegT(px,py,x1,y1,x2,y2,tol=4) {
  const dx=x2-x1,dy=y2-y1,len2=dx*dx+dy*dy
  if (!len2) return null
  const t=((px-x1)*dx+(py-y1)*dy)/len2
  if (t<-1e-8||t>1+1e-8) return null
  const nx=x1+t*dx,ny=y1+t*dy
  if (Math.hypot(px-nx,py-ny)>tol) return null
  return Math.max(0,Math.min(1,t))
}

// Find t-value on segment (x1,y1)→(x2,y2) where a sampled polyline crosses it.
// Returns all crossing t-values.
function segSplineIntersections(x1,y1,x2,y2,polyPts) {
  const results=[]
  for (let i=0;i<polyPts.length-1;i++){
    const h=segSegIntersect(x1,y1,x2,y2,polyPts[i].x,polyPts[i].y,polyPts[i+1].x,polyPts[i+1].y)
    if (h) results.push(h.t)
  }
  return results
}

// lineIntersections now accepts an optional splines array.
// Splines are sampled into polylines and crossed against the line.
export function lineIntersections(idx,lines,circles,arcs,splines=[]) {
  const {x1,y1,x2,y2}=lines[idx]
  const tSet=new Set()
  const add=(t)=>{if(t!==null&&t>1e-6&&t<1-1e-6)tSet.add(Math.round(t*1e6)/1e6)}
  lines.forEach((l,i)=>{
    if(i===idx)return
    const h=segSegIntersect(x1,y1,x2,y2,l.x1,l.y1,l.x2,l.y2)
    if(h)add(h.t)
    add(pointOnSegT(l.x1,l.y1,x1,y1,x2,y2))
    add(pointOnSegT(l.x2,l.y2,x1,y1,x2,y2))
  })
  arcs.forEach(arc=>{
    add(pointOnSegT(arc.cx+arc.r*Math.cos(arc.startAngle),arc.cy+arc.r*Math.sin(arc.startAngle),x1,y1,x2,y2))
    add(pointOnSegT(arc.cx+arc.r*Math.cos(arc.endAngle),arc.cy+arc.r*Math.sin(arc.endAngle),x1,y1,x2,y2))
  })
  circles.forEach(c=>segCircleIntersect(x1,y1,x2,y2,c.cx,c.cy,c.r).forEach(p=>add(p.t)))
  arcs.forEach(arc=>segCircleIntersect(x1,y1,x2,y2,arc.cx,arc.cy,arc.r)
    .filter(p=>angleOnArc(p.angle,arc.startAngle,arc.endAngle)).forEach(p=>add(p.t)))
  // Spline crossings — sample each spline and find segment-segment intersections
  splines.forEach(sp=>{
    if (!sp||sp.points.length<2) return
    // Inline sample to avoid circular import — 20 samples per segment is sufficient for trim
    const n=sp.points.length
    const ext=sp.closed
      ? [sp.points[n-1],...sp.points,sp.points[0],sp.points[1]]
      : [sp.points[0],...sp.points,sp.points[n-1]]
    const segCount=sp.closed?n:n-1
    const poly=[]
    for (let i=0;i<segCount;i++){
      const p0=ext[i],p1=ext[i+1],p2=ext[i+2],p3=ext[i+3]
      for (let j=0;j<20;j++){
        const t=j/20,t2=t*t,t3=t2*t
        poly.push({
          x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
        })
      }
    }
    if (poly.length) poly.push(sp.closed?poly[0]:sp.points[n-1])
    segSplineIntersections(x1,y1,x2,y2,poly).forEach(t=>add(t))
  })
  const ts=Array.from(tSet).map(Number).sort((a,b)=>a-b)
  const dx=x2-x1,dy=y2-y1
  return ts.map(t=>({t,x:x1+t*dx,y:y1+t*dy}))
}

export function circleIntersectionAngles(idx,lines,circles,arcs,splines=[]) {
  const c=circles[idx];const angles=[]
  lines.forEach(l=>{
    segCircleIntersect(l.x1,l.y1,l.x2,l.y2,c.cx,c.cy,c.r).forEach(p=>angles.push(p.angle))
    ;[[l.x1,l.y1],[l.x2,l.y2]].forEach(([px,py])=>{
      if (Math.abs(Math.hypot(px-c.cx,py-c.cy)-c.r)<1)
        angles.push(norm2pi(Math.atan2(py-c.cy,px-c.cx)))
    })
  })
  arcs.forEach(arc=>{
    const ePts=[
      {x:arc.cx+arc.r*Math.cos(arc.startAngle),y:arc.cy+arc.r*Math.sin(arc.startAngle)},
      {x:arc.cx+arc.r*Math.cos(arc.endAngle),  y:arc.cy+arc.r*Math.sin(arc.endAngle)}
    ]
    ePts.forEach(({x:px,y:py})=>{
      if (Math.abs(Math.hypot(px-c.cx,py-c.cy)-c.r)<1)
        angles.push(norm2pi(Math.atan2(py-c.cy,px-c.cx)))
    })
  })
  circles.forEach((o,i)=>{if(i===idx)return;circleCircleIntersect(c.cx,c.cy,c.r,o.cx,o.cy,o.r).forEach(p=>angles.push(p.angle1))})
  arcs.forEach(arc=>circleCircleIntersect(c.cx,c.cy,c.r,arc.cx,arc.cy,arc.r)
    .filter(p=>angleOnArc(p.angle2,arc.startAngle,arc.endAngle)).forEach(p=>angles.push(p.angle1)))
  // Spline crossings — sample each spline and find where it crosses the circle
  splines.forEach(sp=>{
    if (!sp||sp.points.length<2) return
    const n=sp.points.length
    const ext=sp.closed?[sp.points[n-1],...sp.points,sp.points[0],sp.points[1]]:[sp.points[0],...sp.points,sp.points[n-1]]
    const segs=sp.closed?n:n-1
    for (let i=0;i<segs;i++){
      const p0=ext[i],p1=ext[i+1],p2=ext[i+2],p3=ext[i+3]
      const poly=[]
      for (let j=0;j<=16;j++){
        const t=j/16,t2=t*t,t3=t2*t
        poly.push({
          x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
        })
      }
      for (let k=0;k<poly.length-1;k++){
        segCircleIntersect(poly[k].x,poly[k].y,poly[k+1].x,poly[k+1].y,c.cx,c.cy,c.r)
          .forEach(p=>angles.push(p.angle))
      }
    }
  })
  const uniq=[]
  angles.forEach(a=>{if(!uniq.some(b=>Math.abs(b-a)<1e-4))uniq.push(a)})
  return uniq.sort((a,b)=>a-b)
}

export function arcIntersectionAngles(arcIdx,lines,circles,arcs,splines=[]) {
  const arc=arcs[arcIdx];const angles=[]
  lines.forEach(l=>segCircleIntersect(l.x1,l.y1,l.x2,l.y2,arc.cx,arc.cy,arc.r)
    .filter(p=>angleOnArc(p.angle,arc.startAngle,arc.endAngle)).forEach(p=>angles.push(p.angle)))
  circles.forEach(c=>circleCircleIntersect(arc.cx,arc.cy,arc.r,c.cx,c.cy,c.r)
    .filter(p=>angleOnArc(p.angle1,arc.startAngle,arc.endAngle)).forEach(p=>angles.push(p.angle1)))
  arcs.forEach((other,i)=>{
    if(i===arcIdx)return
    circleCircleIntersect(arc.cx,arc.cy,arc.r,other.cx,other.cy,other.r)
      .filter(p=>angleOnArc(p.angle1,arc.startAngle,arc.endAngle)&&angleOnArc(p.angle2,other.startAngle,other.endAngle))
      .forEach(p=>angles.push(p.angle1))
  })
  // Spline crossings against this arc
  splines.forEach(sp=>{
    if (!sp||sp.points.length<2) return
    const n=sp.points.length
    const ext=sp.closed?[sp.points[n-1],...sp.points,sp.points[0],sp.points[1]]:[sp.points[0],...sp.points,sp.points[n-1]]
    const segs=sp.closed?n:n-1
    for (let i=0;i<segs;i++){
      const p0=ext[i],p1=ext[i+1],p2=ext[i+2],p3=ext[i+3]
      const poly=[]
      for (let j=0;j<=16;j++){
        const t=j/16,t2=t*t,t3=t2*t
        poly.push({
          x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
        })
      }
      for (let k=0;k<poly.length-1;k++){
        segCircleIntersect(poly[k].x,poly[k].y,poly[k+1].x,poly[k+1].y,arc.cx,arc.cy,arc.r)
          .filter(p=>angleOnArc(p.angle,arc.startAngle,arc.endAngle))
          .forEach(p=>angles.push(p.angle))
      }
    }
  })
  const uniq=[]
  angles.forEach(a=>{if(!uniq.some(b=>Math.abs(b-a)<1e-8))uniq.push(a)})
  return uniq.sort((a,b)=>a-b)
}

// ── Pre-compute all pairwise intersections ────────────────────────────────────
// Called once when geometry changes. Returns flat array of {x,y} points.
// Used by snap system for intersection snap indicator.
function sampleSplineForIntersect(sp) {
  if (!sp || sp.points.length < 2) return []
  if (sp.polyline) return sp.points
  const pts = sp.points, n = pts.length
  const ext = sp.closed
    ? [pts[n-1], ...pts, pts[0], pts[1]]
    : [pts[0], ...pts, pts[n-1]]
  const segs = sp.closed ? n : n-1
  const result = []
  for (let i = 0; i < segs; i++) {
    const p0=ext[i],p1=ext[i+1],p2=ext[i+2],p3=ext[i+3]
    for (let j = 0; j < 12; j++) {
      const t=j/12,t2=t*t,t3=t2*t
      result.push({
        x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
      })
    }
  }
  if (sp.closed) result.push(result[0])
  else result.push(pts[n-1])
  return result
}

function addUnique(pts, x, y, tol=2) {
  if (!pts.some(p => Math.hypot(p.x-x, p.y-y) < tol)) pts.push({x,y})
}

export function computeAllIntersections(lines=[], circles=[], arcs=[], splines=[]) {
  const pts = []

  // Line × Line
  for (let i = 0; i < lines.length; i++)
    for (let j = i+1; j < lines.length; j++) {
      const h = segSegIntersect(lines[i].x1,lines[i].y1,lines[i].x2,lines[i].y2,
                                lines[j].x1,lines[j].y1,lines[j].x2,lines[j].y2)
      if (h) addUnique(pts, h.x, h.y)
    }

  // Line × Circle
  lines.forEach(l => circles.forEach(c =>
    segCircleIntersect(l.x1,l.y1,l.x2,l.y2,c.cx,c.cy,c.r)
      .forEach(p => addUnique(pts, p.x, p.y))
  ))

  // Line × Arc
  lines.forEach(l => arcs.forEach(a =>
    segCircleIntersect(l.x1,l.y1,l.x2,l.y2,a.cx,a.cy,a.r)
      .filter(p => angleOnArc(p.angle, a.startAngle, a.endAngle))
      .forEach(p => addUnique(pts, p.x, p.y))
  ))

  // Circle × Circle
  for (let i = 0; i < circles.length; i++)
    for (let j = i+1; j < circles.length; j++)
      circleCircleIntersect(circles[i].cx,circles[i].cy,circles[i].r,
                            circles[j].cx,circles[j].cy,circles[j].r)
        .forEach(p => addUnique(pts, p.x, p.y))

  // Circle × Arc
  circles.forEach(c => arcs.forEach(a =>
    circleCircleIntersect(c.cx,c.cy,c.r,a.cx,a.cy,a.r)
      .filter(p => angleOnArc(p.angle2, a.startAngle, a.endAngle))
      .forEach(p => addUnique(pts, p.x, p.y))
  ))

  // Arc × Arc
  for (let i = 0; i < arcs.length; i++)
    for (let j = i+1; j < arcs.length; j++)
      circleCircleIntersect(arcs[i].cx,arcs[i].cy,arcs[i].r,
                            arcs[j].cx,arcs[j].cy,arcs[j].r)
        .filter(p => angleOnArc(p.angle1,arcs[i].startAngle,arcs[i].endAngle)
                  && angleOnArc(p.angle2,arcs[j].startAngle,arcs[j].endAngle))
        .forEach(p => addUnique(pts, p.x, p.y))

  // Spline × everything — sample splines to polylines then seg-seg
  splines.forEach((sp, si) => {
    const poly = sampleSplineForIntersect(sp)
    if (poly.length < 2) return

    // Spline × Line
    lines.forEach(l => {
      for (let k = 0; k < poly.length-1; k++) {
        const h = segSegIntersect(poly[k].x,poly[k].y,poly[k+1].x,poly[k+1].y,l.x1,l.y1,l.x2,l.y2)
        if (h) addUnique(pts, h.x, h.y)
      }
    })

    // Spline × Circle
    circles.forEach(c => {
      for (let k = 0; k < poly.length-1; k++)
        segCircleIntersect(poly[k].x,poly[k].y,poly[k+1].x,poly[k+1].y,c.cx,c.cy,c.r)
          .forEach(p => addUnique(pts, p.x, p.y))
    })

    // Spline × Arc
    arcs.forEach(a => {
      for (let k = 0; k < poly.length-1; k++)
        segCircleIntersect(poly[k].x,poly[k].y,poly[k+1].x,poly[k+1].y,a.cx,a.cy,a.r)
          .filter(p => angleOnArc(p.angle, a.startAngle, a.endAngle))
          .forEach(p => addUnique(pts, p.x, p.y))
    })

    // Spline × other Splines
    splines.forEach((sp2, sj) => {
      if (sj <= si) return
      const poly2 = sampleSplineForIntersect(sp2)
      for (let k = 0; k < poly.length-1; k++)
        for (let m = 0; m < poly2.length-1; m++) {
          const h = segSegIntersect(poly[k].x,poly[k].y,poly[k+1].x,poly[k+1].y,
                                    poly2[m].x,poly2[m].y,poly2[m+1].x,poly2[m+1].y)
          if (h) addUnique(pts, h.x, h.y)
        }
    })
  })

  return pts
}

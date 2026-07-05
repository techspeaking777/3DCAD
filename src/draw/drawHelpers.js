export function drawLineIndicator(ctx, x, y, type, viewScale=1) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1/viewScale, 1/viewScale)
  if (type==='endpoint'){
    ctx.strokeStyle='#FFD600';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.stroke()
    ctx.fillStyle='#FFD600';ctx.font='10px sans-serif';ctx.fillText('END',13,-5)
  } else if (type==='midpoint'){
    ctx.strokeStyle='#FF9800';ctx.lineWidth=2
    ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(9,0);ctx.lineTo(0,9);ctx.lineTo(-9,0);ctx.closePath();ctx.stroke()
    ctx.fillStyle='#FF9800';ctx.font='10px sans-serif';ctx.fillText('MID',13,-5)
  } else if (type==='online'){
    ctx.strokeStyle='#4CAF50';ctx.lineWidth=2
    ctx.beginPath();ctx.moveTo(-7,-7);ctx.lineTo(7,7);ctx.moveTo(7,-7);ctx.lineTo(-7,7);ctx.stroke()
    ctx.fillStyle='#4CAF50';ctx.font='10px sans-serif';ctx.fillText('ON',11,-5)
  } else if (type==='oncircle'){
    // Snap to circle/arc edge without tangent — teal circle outline + ON label
    ctx.strokeStyle='#00BCD4';ctx.lineWidth=2
    ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.stroke()
    ctx.beginPath();ctx.moveTo(-11,0);ctx.lineTo(11,0);ctx.stroke()
    ctx.beginPath();ctx.moveTo(0,-11);ctx.lineTo(0,11);ctx.stroke()
    ctx.fillStyle='#00BCD4';ctx.font='10px sans-serif';ctx.fillText('ON',13,-5)
  } else if (type==='center'){
    ctx.strokeStyle='#2196F3';ctx.lineWidth=1.5
    ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.stroke()
    ctx.beginPath();ctx.moveTo(-13,0);ctx.lineTo(13,0);ctx.stroke()
    ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(0,13);ctx.stroke()
    ctx.fillStyle='#2196F3';ctx.font='10px sans-serif';ctx.fillText('CTR',16,-5)
  } else if (type==='quadrant'){
    ctx.strokeStyle='#9C27B0';ctx.lineWidth=2
    ctx.beginPath();ctx.moveTo(-7,0);ctx.lineTo(7,0);ctx.stroke()
    ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(0,7);ctx.stroke()
    ctx.fillStyle='#9C27B0';ctx.font='10px sans-serif';ctx.fillText('QD',11,-5)
  } else if (type==='intersect'){
    // Intersection snap — lime × symbol + INT label
    ctx.strokeStyle='#CDDC39';ctx.lineWidth=2.5
    ctx.beginPath();ctx.moveTo(-7,-7);ctx.lineTo(7,7);ctx.moveTo(7,-7);ctx.lineTo(-7,7);ctx.stroke()
    ctx.fillStyle='#CDDC39';ctx.font='10px sans-serif';ctx.fillText('INT',11,-5)
    // Spline node/control point — filled orange square
    ctx.fillStyle='#FF9800'
    ctx.fillRect(-5,-5,10,10)
    ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.strokeRect(-5,-5,10,10)
    ctx.fillStyle='#FF9800';ctx.font='10px sans-serif';ctx.fillText('NP',13,-5)
  } else if (type==='tan'){
    ctx.strokeStyle='#E91E63';ctx.lineWidth=2
    ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.stroke()
    ctx.beginPath();ctx.moveTo(-11,-9);ctx.lineTo(11,-9);ctx.stroke()
    ctx.fillStyle='#E91E63';ctx.font='10px sans-serif';ctx.fillText('TAN',13,-5)
  }
  ctx.restore()
}

export function drawHVIndicator(ctx, x, y, type, hasLI, viewScale=1) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1/viewScale, 1/viewScale)
  ctx.fillStyle='#29B6F6';ctx.font='bold 14px monospace'
  ctx.fillText(type==='horizontal'?'— HORIZ':'| VERT', 14, hasLI?20:-10)
  ctx.restore()
}

export function drawTracks(ctx, tracks, trackedPts, viewScale=1) {
  ctx.save()
  ctx.strokeStyle='#FF9800';ctx.lineWidth=1/viewScale;ctx.setLineDash([4/viewScale,4/viewScale])
  for (const t of tracks){ctx.beginPath();ctx.moveTo(t.fromX,t.fromY);ctx.lineTo(t.toX,t.toY);ctx.stroke()}
  ctx.setLineDash([])
  for (const tp of trackedPts){
    ctx.save()
    ctx.translate(tp.x,tp.y)
    ctx.scale(1/viewScale,1/viewScale)
    ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fillStyle='#FF9800';ctx.fill()
    ctx.restore()
  }
  ctx.restore()
}

export function drawLabel(ctx, label, cx, cy, color, viewScale=1) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1/viewScale, 1/viewScale)
  ctx.font='bold 12px monospace'
  const tw=ctx.measureText(label).width
  ctx.fillStyle=color
  ctx.beginPath();ctx.roundRect(-tw/2-5,-18,tw+10,20,3);ctx.fill()
  ctx.fillStyle='white';ctx.fillText(label,-tw/2,-3)
  ctx.restore()
}

export function drawPreviewLine(ctx, x1, y1, x2, y2, color='#2196F3', alpha=1, viewScale=1) {
  ctx.save()
  ctx.globalAlpha=alpha
  // White halo behind the dashed line so it stays visible over saturated/dark
  // solid faces, not just the plain white workplane background.
  ctx.strokeStyle='#ffffff';ctx.lineWidth=4/viewScale;ctx.setLineDash([6/viewScale,3/viewScale])
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()
  ctx.strokeStyle=color;ctx.lineWidth=1.5/viewScale
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()
  ctx.setLineDash([]);ctx.restore()
}

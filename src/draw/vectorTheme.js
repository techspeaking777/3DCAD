// vectorTheme.js — 80s vector-arcade look (Star Wars/Battlezone style
// glowing scan lines) shared by the 3D-environment solid-op icons
// (ToolIcons.jsx) and the extrude/cutout live preview overlay
// (App3D.jsx's drawExtrudePreview). Deliberately NOT used by the sketch
// environment, which keeps its own pixel-art theme.

// Strokes pathFn(ctx) twice on a 2D canvas context: once wide/blurred/faint
// for the glow halo, once thin/crisp for the bright core line. pathFn must
// only build the path (beginPath + moveTo/lineTo/etc, no stroke/fill) since
// it gets replayed for both passes.
export function glowStroke(ctx, pathFn, color, lineWidth = 1.5) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = color
  ctx.shadowBlur = 8
  ctx.globalAlpha = 0.5
  ctx.lineWidth = lineWidth * 2.5
  pathFn(ctx); ctx.stroke()
  ctx.shadowBlur = 3
  ctx.globalAlpha = 1
  ctx.lineWidth = lineWidth
  pathFn(ctx); ctx.stroke()
  ctx.restore()
}

// Faint glowing tint fill — used for the extrude preview's cap/base faces
// instead of a flat alpha fill.
export function glowFill(ctx, pathFn, color, alpha = 0.08) {
  ctx.save()
  ctx.fillStyle = color
  ctx.globalAlpha = alpha
  pathFn(ctx); ctx.fill()
  ctx.restore()
}

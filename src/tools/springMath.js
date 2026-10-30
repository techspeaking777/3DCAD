// Spring maths shared by App3D.jsx (live preview, warnings, cut-target box) and
// cadWorker.js (the real build). Pure JS, no React / OpenCascade.
//
// A Spring is sketched like a Revolve: ONE closed wire cross-section plus an axis
// line (a drawn Axis line, or one of the sketch's own origin axes) in the same
// sketch. Everything below works in sketch px (y-down) — the same space the
// profile and axis are stored in.

/**
 * Where the wire profile sits relative to the axis.
 *   profile = { pts, circle }   (circle = {cx,cy,r} for a true circle, else pts)
 *   axis    = { x1,y1,x2,y2 }   reverse flips the way the coil grows along it
 * Returns null with no profile, else px measurements:
 *   ux,uy        unit vector along the axis (the way the coil grows)
 *   nx,ny        unit vector from the axis towards the profile
 *   zPx          the profile centre's distance along the axis from (x1,y1)
 *   radiusPx     the profile centre's distance from the axis (the coil radius)
 *   axialMinPx / axialMaxPx    profile extent along the axis (wire thickness)
 *   radialMinPx / radialMaxPx  profile extent away from the axis
 */
export function springFrame(profile, axis, reverse = false) {
  const { pts, circle } = profile || {}
  if (!circle && !(pts && pts.length)) return null
  let ux = axis.x2 - axis.x1, uy = axis.y2 - axis.y1
  const len = Math.hypot(ux, uy) || 1
  ux /= len; uy /= len
  if (reverse) { ux = -ux; uy = -uy }

  let cx, cy
  if (circle) { cx = circle.cx; cy = circle.cy }
  else {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    cx = (Math.min(...xs) + Math.max(...xs)) / 2
    cy = (Math.min(...ys) + Math.max(...ys)) / 2
  }
  const dx = cx - axis.x1, dy = cy - axis.y1
  const zPx = dx * ux + dy * uy
  // Perpendicular to the axis, pointing at the side the profile is on.
  const side = (ux * dy - uy * dx) >= 0 ? 1 : -1
  const nx = -uy * side, ny = ux * side
  const radiusPx = Math.abs(dx * nx + dy * ny)

  let axialMinPx, axialMaxPx, radialMinPx, radialMaxPx
  if (circle) {
    axialMinPx = zPx - circle.r; axialMaxPx = zPx + circle.r
    radialMinPx = radiusPx - circle.r; radialMaxPx = radiusPx + circle.r
  } else {
    axialMinPx = radialMinPx = Infinity
    axialMaxPx = radialMaxPx = -Infinity
    for (const p of pts) {
      const ax = p.x - axis.x1, ay = p.y - axis.y1
      const a = ax * ux + ay * uy, r = ax * nx + ay * ny
      if (a < axialMinPx) axialMinPx = a
      if (a > axialMaxPx) axialMaxPx = a
      if (r < radialMinPx) radialMinPx = r
      if (r > radialMaxPx) radialMaxPx = r
    }
  }
  return { ux, uy, nx, ny, zPx, radiusPx, axialMinPx, axialMaxPx, radialMinPx, radialMaxPx }
}

/** True when the wire reaches the axis (a coil can't wrap around a shape that touches it). */
export function springProfileTouchesAxis(profile, axis, reverse = false) {
  const f = springFrame(profile, axis, reverse)
  return !!f && f.radialMinPx <= 0.5
}

/**
 * The popup's numbers → the coil's pitch / height / turns.
 *   specBy 'pitch'  — type the pitch, length = pitch × turns
 *   specBy 'length' — type the length, pitch = length ÷ turns
 * Any field that can't be read falls back to a safe default; `ok` is false when
 * the result isn't a buildable coil (so the popup can disable Done).
 */
export function springDims({ specBy = 'pitch', pitchInput, lengthInput, coilsInput }) {
  const coils = parseFloat(coilsInput)
  const turns = coils > 0 ? coils : 0
  let pitchMm, heightMm
  if (specBy === 'length') {
    heightMm = parseFloat(lengthInput) || 0
    pitchMm = turns > 0 ? heightMm / turns : 0
  } else {
    pitchMm = parseFloat(pitchInput) || 0
    heightMm = pitchMm * turns
  }
  return { pitchMm, heightMm, coils: turns, ok: pitchMm > 0 && heightMm > 0 && turns > 0 }
}

// Pure math for Sweep's "Project onto surface" step — shared by App3D.jsx
// (profile-sketch plane, path bounding box) and cadWorker.js (the real
// 3D spine). No React/THREE/OCC here, so both sides compute identical numbers.
//
// A projected path is stored as `pathPts3d`: an array of [x,y,z] points in mm,
// already lying ON the target surface (each sketch-path sample is ray-cast
// along the sketch plane's normal onto the body — see Viewport3D's
// projectPointsOntoSolid). The worker fits a smooth B-spline through them.

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
const len = a => Math.hypot(a[0], a[1], a[2])
const norm = a => { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l] }
const scale = (a, k) => [a[0]*k, a[1]*k, a[2]*k]

// Resamples a 2D polyline (sketch px) at roughly `stepPx` spacing, keeping
// both endpoints. Dense, even samples make the ray-cast projection follow the
// surface instead of cutting corners between sparse line endpoints.
export function resamplePolyline(pts, stepPx) {
  const out = [{ x: pts[0].x, y: pts[0].y }]
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(segLen / stepPx))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

// Start tangent of the projected path, from a 3-point one-sided difference
// (-3p0 + 4p1 - p2) — second-order accurate, much closer to the true spline
// tangent than a single chord.
export function projectedStartTangent(pts) {
  if (pts.length >= 3) {
    const t = [
      -3*pts[0][0] + 4*pts[1][0] - pts[2][0],
      -3*pts[0][1] + 4*pts[1][1] - pts[2][1],
      -3*pts[0][2] + 4*pts[1][2] - pts[2][2],
    ]
    if (len(t) > 1e-9) return norm(t)
  }
  return norm(sub(pts[1], pts[0]))
}

// Profile plane for a projected-path sweep — same recipe as replicad's
// Sketch.sweepSketch (and App3D's computeSweepProfilePlane for flat paths):
// origin = path start, normal = -tangent, xDir = normal × projDir × -1.
// projDir is the direction the path was projected along (the original sketch
// plane's normal). Falls back to any perpendicular if tangent ∥ projDir.
// All arrays in mm; vAxis = normal × uAxis, matching FacePlane's convention.
export function projectedProfilePlane(pts, projDir) {
  const origin = pts[0]
  const normal = scale(projectedStartTangent(pts), -1)
  let xDir = scale(cross(normal, projDir), -1)
  if (len(xDir) < 1e-6) {
    const helper = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    xDir = scale(cross(normal, helper), -1)
  }
  const uAxis = norm(xDir)
  const vAxis = cross(normal, uAxis)
  return { origin, normal, uAxis, vAxis }
}

// Light [1 2 1]/4 smoothing passes (endpoints pinned). Ray-cast hits on a
// tessellated body sit on flat triangles, so the raw projected path has tiny
// facet-sized kinks — enough to make OpenCascade's pipe-shell sweep fail even
// with a small profile. A few passes (~2mm of smoothing at 1.5mm spacing) round
// those off while keeping the path on the surface to well under 0.1mm.
export function smoothPoints3d(pts, passes = 6) {
  let a = pts.map(p => [...p])
  for (let k = 0; k < passes; k++) {
    const b = a.map(p => [...p])
    for (let i = 1; i < a.length - 1; i++)
      for (let d = 0; d < 3; d++) b[i][d] = (a[i-1][d] + 2*a[i][d] + a[i+1][d]) / 4
    a = b
  }
  return a
}

// Drops runs of near-coincident points (OCC's spline fit dislikes zero-length
// spans) — e.g. where several samples hit the same triangle vertex.
export function dedupePoints3d(pts, eps = 0.05) {
  const out = []
  for (const p of pts) {
    const q = out[out.length - 1]
    if (!q || len(sub(p, q)) > eps) out.push(p)
  }
  return out
}

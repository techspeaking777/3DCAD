// smoothMesh.js — PROTOTYPE of the Smooth tool (rounds every edge of a solid by
// a set radius, optionally keeping chosen faces flat), done on a 3D grid instead
// of with CAD fillets so it can't "fail" the way Soften did.
//
// Method (a morphological OPENING by a ball of radius r):
//   1. voxelise the triangle mesh: which grid cells are inside (ray parity along x)
//   2. faces to keep flat: the solid is extended past each one first (so the
//      rounding there happens outside the part) and cut back exactly to the
//      plane at the end — the face stays flat with a crisp edge
//   3. core ("shrink") = points at least r deep. A rough grid distance finds
//      the band near depth r; there the exact depth (nearest triangle, BVH)
//      decides, and each core cell at the edge records exact points of the
//      core surface (nearest-point samples + crossings toward its neighbours)
//   4. f = distance to the core − r ("grow back"): nearest core cell from a
//      feature transform, then its own and its neighbours' exact samples; in
//      the band near f = 0 also an inward walk (step away from the nearest
//      point of the part until r deep, repeat), which lands exactly on the
//      core's edges and corners — the samples only get within a cell of them
//   5. clip with the keep-flat planes
//   6. surface nets on f → a quad/triangle mesh, lightly relaxed (Taubin) to take
//      the voxel steps out
// Outside corners and edges come back rounded by r; flat faces and inside corners
// stay as they were (to within about half a cell).
//
// Pure JS, no OCC. mm in, mm out.

const INF = 1e20
// Math.hypot is several times slower than this in V8, and it runs millions of times.
const len3 = (a, b, c) => Math.sqrt(a * a + b * b + c * c)

// 1D squared-distance transform (lower envelope of parabolas), in place on f.
function edt1d(f, n, v, z, d) {
  let k = 0
  v[0] = 0; z[0] = -INF; z[1] = INF
  for (let q = 1; q < n; q++) {
    let s
    while (true) {
      const p = v[k]
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p)
      if (s <= z[k]) { k--; if (k < 0) { k = 0; break } } else break
    }
    k++
    v[k] = q; z[k] = s; z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const p = v[k]
    d[q] = (q - p) * (q - p) + f[p]
  }
  for (let q = 0; q < n; q++) f[q] = d[q]
}

// Squared distance (in cells) from every cell to the nearest cell where seed=1.
function edt3d(seed, nx, ny, nz) {
  const N = nx * ny * nz
  const g = new Float64Array(N)
  for (let i = 0; i < N; i++) g[i] = seed[i] ? 0 : INF
  return edt3dInit(g, nx, ny, nz)
}
// Same, starting from given squared distances g (cells²) — min over y of |x−y|² + g(y).
function edt3dInit(g, nx, ny, nz) {
  const m = Math.max(nx, ny, nz)
  const f = new Float64Array(m), d = new Float64Array(m), z = new Float64Array(m + 1)
  const v = new Int32Array(m)
  // x
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const o = (k * ny + j) * nx
    for (let i = 0; i < nx; i++) f[i] = g[o + i]
    edt1d(f, nx, v, z, d)
    for (let i = 0; i < nx; i++) g[o + i] = f[i]
  }
  // y
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = g[(k * ny + j) * nx + i]
    edt1d(f, ny, v, z, d)
    for (let j = 0; j < ny; j++) g[(k * ny + j) * nx + i] = f[j]
  }
  // z
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) f[k] = g[(k * ny + j) * nx + i]
    edt1d(f, nz, v, z, d)
    for (let k = 0; k < nz; k++) g[(k * ny + j) * nx + i] = f[k]
  }
  return g
}

// Nearest seed cell (by cell centre) for every cell — the separable
// Felzenszwalb–Huttenlocher transform carrying the winning index along.
function nearestSeed(seed, nx, ny, nz) {
  const N = nx * ny * nz
  const g = new Float64Array(N), I = new Int32Array(N)
  for (let c = 0; c < N; c++) { g[c] = seed[c] ? 0 : INF; I[c] = seed[c] ? c : -1 }
  const m = Math.max(nx, ny, nz)
  const f = new Float64Array(m), d = new Float64Array(m), z = new Float64Array(m + 1), ii = new Int32Array(m), io = new Int32Array(m)
  const v = new Int32Array(m)
  const pass = (n, at) => {
    for (let q = 0; q < n; q++) { const c = at(q); f[q] = g[c]; ii[q] = I[c] }
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < n; q++) {
      let s
      while (true) {
        const p = v[k]
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p)
        if (s <= z[k]) { k--; if (k < 0) { k = 0; break } } else break
      }
      k++
      v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      const p = v[k]
      d[q] = (q - p) * (q - p) + f[p]; io[q] = ii[p]
    }
    for (let q = 0; q < n; q++) { const c = at(q); g[c] = d[q]; I[c] = io[q] }
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const o = (k * ny + j) * nx; pass(nx, i => o + i) }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) pass(ny, j => (k * ny + j) * nx + i)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pass(nz, k => (k * ny + j) * nx + i)
  return I
}

// Inside/outside for every cell centre, by counting crossings along +x rays.
function voxelise(pos, tri, x0, y0, z0, h, nx, ny, nz) {
  const inside = new Uint8Array(nx * ny * nz)
  const rows = new Array(ny * nz)
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3
    const ay = pos[a + 1], az = pos[a + 2], by = pos[b + 1], bz = pos[b + 2], cy = pos[c + 1], cz = pos[c + 2]
    const jmin = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / h - 0.5))
    const jmax = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / h - 0.5))
    const kmin = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) / h - 0.5))
    const kmax = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / h - 0.5))
    if (jmin > jmax || kmin > kmax) continue
    const ax = pos[a], bx = pos[b], cx = pos[c]
    // Barycentric in the (y,z) projection.
    const det = (by - ay) * (cz - az) - (cy - ay) * (bz - az)
    if (Math.abs(det) < 1e-14) continue
    for (let k = kmin; k <= kmax; k++) {
      const pz = z0 + (k + 0.5) * h
      for (let j = jmin; j <= jmax; j++) {
        const py = y0 + (j + 0.5) * h
        // Tiny fixed nudge so a ray never runs exactly along a shared edge.
        const qy = py + 1.234e-7, qz = pz + 2.345e-7
        const u = ((qy - ay) * (cz - az) - (cy - ay) * (qz - az)) / det
        const w = ((by - ay) * (qz - az) - (qy - ay) * (bz - az)) / det
        if (u < 0 || w < 0 || u + w > 1) continue
        const x = ax + u * (bx - ax) + w * (cx - ax)
        const r = k * ny + j
        ;(rows[r] || (rows[r] = [])).push(x)
      }
    }
  }
  for (let r = 0; r < rows.length; r++) {
    const xs = rows[r]
    if (!xs || xs.length < 2) continue
    xs.sort((p, q) => p - q)
    const o = r * nx
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((xs[s] - x0) / h - 0.5))
      const i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - x0) / h - 0.5))
      for (let i = i0; i <= i1; i++) inside[o + i] = 1
    }
  }
  return inside
}

// Closest-point distance from p to triangle abc (Ericson).
const CP = [0, 0, 0]      // closest point found by the last distPointTri call
const BEST = [0, 0, 0]    // closest point found by the last bvhDist call
function distPointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz
  let qx, qy, qz
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz }
    else {
      const vc = d1 * d4 - d3 * d2
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz }
      else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz }
        else {
          const vb = d5 * d2 - d1 * d6
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz }
          else {
            const va = d3 * d6 - d5 * d4
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz) }
            else { const den = 1 / (va + vb + vc); const v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w }
          }
        }
      }
    }
  }
  CP[0] = qx; CP[1] = qy; CP[2] = qz
  return len3(px - qx, py - qy, pz - qz)
}


// Surface nets on the scalar field f (negative inside) → {positions, indices}.
function surfaceNets(f, nx, ny, nz, x0, y0, z0, h) {
  const idx = new Int32Array(nx * ny * nz).fill(-1)
  const P = []
  const at = (i, j, k) => f[(k * ny + j) * nx + i]
  const E = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]]
  const v = new Float64Array(8)
  // One vertex per cell (cube between 8 cell centres) that the surface crosses.
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let sx = 0, sy = 0, sz = 0, n = 0, neg = 0
    for (let c = 0; c < 8; c++) { const val = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)); v[c] = val; if (val < 0) neg++ }
    if (neg === 0 || neg === 8) continue
    for (const [a, b] of E) {
      if ((v[a] < 0) === (v[b] < 0)) continue
      const t = v[a] / (v[a] - v[b])
      sx += (a & 1) + t * ((b & 1) - (a & 1))
      sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1))
      sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1))
      n++
    }
    idx[(k * ny + j) * nx + i] = P.length / 3
    P.push(x0 + (i + 0.5 + sx / n) * h, y0 + (j + 0.5 + sy / n) * h, z0 + (k + 0.5 + sz / n) * h)
  }
  const T = []
  const cell = (i, j, k) => idx[(k * ny + j) * nx + i]
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) T.push(a, c, b, a, d, c); else T.push(a, b, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = at(i, j, k) < 0
    if (i + 1 < nx && v0 !== (at(i + 1, j, k) < 0))   // x edge: cells around it in y,z
      quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !v0)
    if (j + 1 < ny && v0 !== (at(i, j + 1, k) < 0))
      quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !v0)
    if (k + 1 < nz && v0 !== (at(i, j, k + 1) < 0))
      quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !v0)
  }
  return { positions: new Float32Array(P), indices: new Uint32Array(T) }
}

// Taubin smoothing (shrink-free): takes out the voxel steps. Vertices on a
// keep-flat plane are only allowed to slide within it.
function taubin(pos, tri, iters, planes) {
  const n = pos.length / 3
  const nb = Array.from({ length: n }, () => new Set())
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2]
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b)
  }
  const onPlane = new Int16Array(n).fill(-1)
  planes.forEach((pl, pi) => {
    for (let v = 0; v < n; v++) {
      const s = pos[v * 3] * pl.n[0] + pos[v * 3 + 1] * pl.n[1] + pos[v * 3 + 2] * pl.n[2] - pl.d
      if (Math.abs(s) < pl.tol) onPlane[v] = pi
    }
  })
  const tmp = new Float32Array(pos.length)
  const step = lam => {
    for (let v = 0; v < n; v++) {
      let sx = 0, sy = 0, sz = 0, c = 0
      for (const u of nb[v]) { sx += pos[u * 3]; sy += pos[u * 3 + 1]; sz += pos[u * 3 + 2]; c++ }
      if (!c) { tmp[v * 3] = pos[v * 3]; tmp[v * 3 + 1] = pos[v * 3 + 1]; tmp[v * 3 + 2] = pos[v * 3 + 2]; continue }
      let dx = sx / c - pos[v * 3], dy = sy / c - pos[v * 3 + 1], dz = sz / c - pos[v * 3 + 2]
      const pi = onPlane[v]
      if (pi >= 0) { const pn = planes[pi].n; const dd = dx * pn[0] + dy * pn[1] + dz * pn[2]; dx -= dd * pn[0]; dy -= dd * pn[1]; dz -= dd * pn[2] }
      tmp[v * 3] = pos[v * 3] + lam * dx; tmp[v * 3 + 1] = pos[v * 3 + 1] + lam * dy; tmp[v * 3 + 2] = pos[v * 3 + 2] + lam * dz
    }
    pos.set(tmp)
  }
  for (let i = 0; i < iters; i++) { step(0.5); step(-0.53) }
}


// ── Nearest-triangle search (bounding-volume tree) ──────────────────────────
// Exact distance from a point to the mesh, used where accuracy matters (the
// layer at the rounding depth, and right at the surface).
function buildBVH(pos, tri, triIds) {
  const box = ids => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (const t of ids) for (let v = 0; v < 3; v++) {
      const o = tri[t * 3 + v] * 3
      for (let a = 0; a < 3; a++) { const x = pos[o + a]; if (x < lo[a]) lo[a] = x; if (x > hi[a]) hi[a] = x }
    }
    return { lo, hi }
  }
  const cen = (t, a) => (pos[tri[t * 3] * 3 + a] + pos[tri[t * 3 + 1] * 3 + a] + pos[tri[t * 3 + 2] * 3 + a]) / 3
  const make = ids => {
    const node = box(ids)
    if (ids.length <= 4) { node.ids = ids; return node }
    const ext = [0, 1, 2].map(a => node.hi[a] - node.lo[a])
    const ax = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : (ext[1] > ext[2] ? 1 : 2)
    const sorted = ids.map(t => [cen(t, ax), t]).sort((p, q) => p[0] - q[0]).map(p => p[1])
    const m = sorted.length >> 1
    node.l = make(sorted.slice(0, m)); node.r = make(sorted.slice(m))
    return node
  }
  return make(triIds)
}
function boxDist(n, x, y, z) {
  const dx = Math.max(n.lo[0] - x, 0, x - n.hi[0]), dy = Math.max(n.lo[1] - y, 0, y - n.hi[1]), dz = Math.max(n.lo[2] - z, 0, z - n.hi[2])
  return len3(dx, dy, dz)
}
function bvhDist(root, pos, tri, x, y, z, limit = Infinity) {
  let best = limit
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (boxDist(n, x, y, z) >= best) continue
    if (n.ids) {
      for (const t of n.ids) {
        const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3
        const d = distPointTri(x, y, z, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2])
        if (d < best) { best = d; BEST[0] = CP[0]; BEST[1] = CP[1]; BEST[2] = CP[2] }
      }
    } else {
      const dl = boxDist(n.l, x, y, z), dr = boxDist(n.r, x, y, z)
      if (dl < dr) stack.push(n.r, n.l); else stack.push(n.l, n.r)
    }
  }
  return best
}

// mesh: {positions: Float32Array (mm), indices: Uint32Array} — a closed solid.
// opts: radius (mm); cell (mm, default radius/5 within a cell budget);
//       keepFlat: [{n:[x,y,z] outward unit normal, d}] faces (planes n·p = d) to
//       hold flat — they are ignored when measuring how deep a point is, so the
//       part acts as if it carried on through them, and the result is cut back
//       exactly at the plane (flat face, crisp edge).
export function smoothSolidMesh(mesh, { radius, cell = null, maxCells = 12e6, keepFlat: keepFlatIn = [], relax = 4, debug = null } = {}) {
  const t0 = performance.now()
  const pos = mesh.positions, tri = mesh.indices
  const nTri = tri.length / 3
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pos[i + a]); mx[a] = Math.max(mx[a], pos[i + a]) }
  const diag = len3(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])
  const pad = radius + 3
  const size = [0, 1, 2].map(a => mx[a] - mn[a] + 2 * pad)
  let h = cell || radius / 3.5
  while (Math.ceil(size[0] / h) * Math.ceil(size[1] / h) * Math.ceil(size[2] / h) > maxCells) h *= 1.15
  if (h > radius / 2) return { error: 'small', message: 'The radius is too small for a part this size — try a bigger radius.' }
  const [nx, ny, nz] = size.map(s => Math.ceil(s / h) + 1)
  const [x0, y0, z0] = [mn[0] - pad, mn[1] - pad, mn[2] - pad]
  const N = nx * ny * nz
  const cx = i => x0 + (i + 0.5) * h, cy = j => y0 + (j + 0.5) * h, cz = k => z0 + (k + 0.5) * h
  const planeS = (pl, x, y, z) => x * pl.n[0] + y * pl.n[1] + z * pl.n[2] - pl.d

  const inside = voxelise(pos, tri, x0, y0, z0, h, nx, ny, nz)
  // Triangles lying on a keep-flat face are left out of the depth measure.
  const planeTol = Math.max(0.01, 1e-4 * diag)
  const onPlane = (pl, t) => [0, 1, 2].every(v => {
    const o = tri[t * 3 + v] * 3
    return Math.abs(planeS(pl, pos[o], pos[o + 1], pos[o + 2])) < planeTol
  })
  // A keep-flat plane that no longer lies on any face of the part (the body
  // was moved or re-shaped since it was picked) is dropped — that face just
  // gets rounded like the rest, rather than the part being sliced by a plane.
  const keepFlat = keepFlatIn.map(pl => { const l = len3(pl.n[0], pl.n[1], pl.n[2]); return { n: pl.n.map(v => v / l), d: pl.d / l } })
    .filter(pl => { for (let t = 0; t < nTri; t++) if (onPlane(pl, t)) return true; return false })
  const onKeep = t => keepFlat.some(pl => onPlane(pl, t))
  const depthTris = [], allTris = []
  for (let t = 0; t < nTri; t++) { allTris.push(t); if (!onKeep(t)) depthTris.push(t) }
  const bvhDepth = buildBVH(pos, tri, depthTris)
  const tVox = performance.now()

  // Past a keep-flat plane the part carries straight on: a point there is
  // treated as the point on the plane it projects to (the face's outline
  // pushed out along the normal, like an extrude), for both inside-ness and depth.
  const PJ = [0, 0, 0]
  const project = (x, y, z) => {
    PJ[0] = x; PJ[1] = y; PJ[2] = z
    for (const pl of keepFlat) {
      const s = planeS(pl, PJ[0], PJ[1], PJ[2])
      if (s > 0) { PJ[0] -= s * pl.n[0]; PJ[1] -= s * pl.n[1]; PJ[2] -= s * pl.n[2] }
    }
    return PJ
  }
  const beyondAny = (x, y, z) => { for (const pl of keepFlat) if (planeS(pl, x, y, z) > 0) return true; return false }
  // Rough depth of every cell (grid distance to the outside).
  const outside = new Uint8Array(N)
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = (k * ny + j) * nx + i
    if (inside[c]) continue
    if (keepFlat.length && beyondAny(cx(i), cy(j), cz(k))) {
      // Inside-ness of the cell just inside the plane where this one projects.
      project(cx(i), cy(j), cz(k))
      let qx = PJ[0], qy = PJ[1], qz = PJ[2]
      for (const pl of keepFlat) { qx -= 0.5 * h * pl.n[0]; qy -= 0.5 * h * pl.n[1]; qz -= 0.5 * h * pl.n[2] }
      const a = Math.round((qx - x0) / h - 0.5), b = Math.round((qy - y0) / h - 0.5), e = Math.round((qz - z0) / h - 0.5)
      const ins = a >= 0 && b >= 0 && e >= 0 && a < nx && b < ny && e < nz && inside[(e * ny + b) * nx + a]
      outside[c] = ins ? 0 : 1
    } else outside[c] = 1
  }
  const T = { start: performance.now() }
  const dRough = edt3d(outside, nx, ny, nz)
  T.rough = performance.now()   // squared cells to the nearest outside cell
  // The shrunk core = cells at least r deep. Each core cell near the core's
  // edge also records the exact point of the core surface beside it (from the
  // cell, r short of the nearest point of the part), so the grow-back distance
  // is measured to the true core surface, not to cell centres.
  const isCore = new Uint8Array(N)
  const corePt = new Map()
  const depthOf = new Float32Array(N).fill(NaN)   // exact depth, shell cells only
  let core = 0
  const shell = 1.5 * h   // rough depth is within about a cell of the true depth
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = (k * ny + j) * nx + i
    if (outside[c]) continue
    const rough = (Math.sqrt(dRough[c]) - 0.5) * h
    if (rough > radius + shell) { isCore[c] = 1; core++; continue }
    if (rough < radius - shell) continue
    const x = cx(i), y = cy(j), z = cz(k)
    project(x, y, z)
    const depth = bvhDist(bvhDepth, pos, tri, PJ[0], PJ[1], PJ[2], radius + shell + 2 * h)
    depthOf[c] = depth
    if (depth < radius) continue
    isCore[c] = 1; core++
    if (depth < radius + shell + 2 * h) {
      // (Measured from the projected point; past a keep plane the core goes
      // straight on too, so the sample is carried back out along the normal.)
      const t = (depth - radius) / depth, px = PJ[0], py = PJ[1], pz = PJ[2]
      corePt.set(c, [x + t * (BEST[0] - px), y + t * (BEST[1] - py), z + t * (BEST[2] - pz)])
    }
  }
  T.shell = performance.now()
  // Plus, toward each non-core neighbour, where depth crosses r along the line
  // between the two cells — these catch the core's own edges and corners,
  // which the nearest-point samples above miss.
  const nxy0 = nx * ny
  for (const [c, p0] of corePt) {
    const dc = depthOf[c]
    const pts = [p0]
    for (const o of [1, -1, nx, -nx, nxy0, -nxy0]) {
      const n = c + o
      if (n < 0 || n >= N || isCore[n]) continue
      const dn = depthOf[n]
      if (!(dn < dc)) continue   // NaN (not measured) or not shallower
      // Depth has kinks (it's a min over faces), so the crossing is found on
      // the true depth rather than by interpolating.
      const ci = c % nx, cj = Math.floor(c / nx) % ny, ck = Math.floor(c / nxy0)
      const ni = n % nx, nj = Math.floor(n / nx) % ny, nk = Math.floor(n / nxy0)
      const ax = cx(ci), ay = cy(cj), az = cz(ck), bx = cx(ni) - ax, by = cy(nj) - ay, bz = cz(nk) - az
      // Regula falsi (Illinois): depth is straight along the line except at a
      // kink, so this usually lands within one or two evaluations.
      let lo = 0, hi = 1, flo = dc - radius, fhi = dn - radius, t = 0, side = 0
      for (let it = 0; it < 5; it++) {
        t = (lo * fhi - hi * flo) / (fhi - flo)
        project(ax + t * bx, ay + t * by, az + t * bz)
        const ft = bvhDist(bvhDepth, pos, tri, PJ[0], PJ[1], PJ[2], radius + h) - radius
        if (Math.abs(ft) < 0.005 * h) break
        if (ft > 0) { lo = t; flo = ft; if (side === 1) fhi /= 2; side = 1 } else { hi = t; fhi = ft; if (side === -1) flo /= 2; side = -1 }
      }
      pts.push(ax + t * bx, ay + t * by, az + t * bz)
    }
    corePt.set(c, pts.length === 1 ? p0 : [...p0, ...pts.slice(1)])
  }
  T.cross = performance.now()
  // Flatten the samples into typed arrays (Map lookups in the hot loop below
  // cost more than the maths).
  const ptStart = new Int32Array(N).fill(-1), ptCount = new Uint8Array(N)
  let poolLen = 0
  for (const q of corePt.values()) poolLen += q.length
  const pool = new Float64Array(poolLen)
  poolLen = 0
  for (const [c, q] of corePt) { ptStart[c] = poolLen; ptCount[c] = q.length / 3; pool.set(q, poolLen); poolLen += q.length }
  if (!core) return { error: 'thin', message: 'The part is thinner than twice the radius everywhere — nothing would be left.' }
  const near = nearestSeed(isCore, nx, ny, nz)
  T.near = performance.now()
  const f = new Float32Array(N)
  const nxy = nx * ny
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = (k * ny + j) * nx + i
    if (isCore[c]) { f[c] = -radius; continue }
    const s = near[c]
    const x = cx(i), y = cy(j), z = cz(k)
    const si = s % nx, sj = ((s / nx) | 0) % ny, sk = (s / nxy) | 0
    const dCentre = len3(x - cx(si), y - cy(sj), z - cz(sk))
    // Far from the core the cell-centre distance is plenty (only the sign of f
    // matters out there); near it, measure to the exact core-surface points of
    // the nearest core cell and its neighbours.
    if (Math.abs(dCentre - radius) > 2 * h) { f[c] = dCentre - radius; continue }
    let best = Infinity
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = si + di, b = sj + dj, e = sk + dk
      if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) continue
      const n = (e * ny + b) * nx + a
      if (!isCore[n]) continue
      const st = ptStart[n]
      if (st < 0) { const d = len3(x - cx(a), y - cy(b), z - cz(e)); if (d < best) best = d; continue }
      for (let t = st, end = st + 3 * ptCount[n]; t < end; t += 3) {
        const d = len3(x - pool[t], y - pool[t + 1], z - pool[t + 2])
        if (d < best) best = d
      }
    }
    f[c] = best - radius
  }
  T.grow = performance.now()
  // Near the result's surface, also follow the part inward from the cell: step
  // straight away from the nearest point of the part until r deep, again from
  // there, … — on a rounded edge or corner that walks onto the core's own edge
  // or corner exactly, which the samples above only approach to within a cell.
  // Both are distances to real core points, so the smaller one wins.
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = (k * ny + j) * nx + i
    if (outside[c] || isCore[c] || f[c] > 1.2 * h || f[c] < -1.2 * h) continue
    const x = cx(i), y = cy(j), z = cz(k)
    let px = x, py = y, pz = z, ok = false
    for (let it = 0; it < 6; it++) {
      project(px, py, pz)
      const qx = PJ[0], qy = PJ[1], qz = PJ[2]
      const d = bvhDist(bvhDepth, pos, tri, qx, qy, qz, radius + h)
      if (d >= radius - 1e-4 * h) { ok = true; break }
      const ux = qx - BEST[0], uy = qy - BEST[1], uz = qz - BEST[2], ul = len3(ux, uy, uz)
      if (ul < 1e-9) break
      const step = (radius - d) / ul
      px += step * ux; py += step * uy; pz += step * uz
    }
    if (!ok) continue
    const dd = len3(x - px, y - py, z - pz) - radius
    if (dd < f[c]) f[c] = dd
  }
  // Cut back exactly at each keep-flat plane.
  for (const pl of keepFlat) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = (k * ny + j) * nx + i
    const s = planeS(pl, cx(i), cy(j), cz(k))
    if (s > f[c]) f[c] = s
  }
  if (debug) Object.assign(debug, { shellCount: depthOf.reduce((a, d) => a + (d === d ? 1 : 0), 0), samples: corePt.size, f, x0, y0, z0, h, nx, ny, nz })
  const tField = performance.now()
  const out = surfaceNets(f, nx, ny, nz, x0, y0, z0, h)
  taubin(out.positions, out.indices, relax, keepFlat.map(pl => ({ ...pl, tol: h * 0.6 })))
  for (const pl of keepFlat) {
    const P = out.positions
    for (let v = 0; v < P.length; v += 3) {
      const s = planeS(pl, P[v], P[v + 1], P[v + 2])
      if (Math.abs(s) < h * 0.6) { P[v] -= s * pl.n[0]; P[v + 1] -= s * pl.n[1]; P[v + 2] -= s * pl.n[2] }
    }
  }
  return { ...out, keptFlat: keepFlat.length, cell: h, grid: [nx, ny, nz], ms: { voxelise: Math.round(tVox - t0), field: Math.round(tField - tVox), rough: Math.round(T.rough - T.start), shell: Math.round(T.shell - T.rough), cross: Math.round(T.cross - T.shell), near: Math.round(T.near - T.cross), grow: Math.round(T.grow - T.near), walk: Math.round(tField - T.grow), mesh: Math.round(performance.now() - tField) } }
}

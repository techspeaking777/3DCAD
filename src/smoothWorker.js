// smoothWorker.js — runs the Smooth tool's mesh rounding (tools/smoothMesh.js)
// off the main thread, so the view keeps turning while a part is smoothed
// (a few seconds on a typical school part). No OpenCascade here: Smooth works
// on the body's display mesh and its result is only ever a mesh.

import { smoothSolidMesh } from './tools/smoothMesh.js'

self.onmessage = e => {
  const { id, positions, indices, opts } = e.data
  try {
    const r = smoothSolidMesh({ positions, indices }, opts)
    if (r.error) { self.postMessage({ id, error: r.message || r.error }); return }
    self.postMessage({ id, positions: r.positions, indices: r.indices, keptFlat: r.keptFlat, ms: r.ms },
      [r.positions.buffer, r.indices.buffer])
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) })
  }
}

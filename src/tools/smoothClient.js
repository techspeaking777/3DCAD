// smoothClient.js — promise API over smoothWorker.js (one worker, started on
// first use; jobs run one after another in the order asked).

let worker = null
let nextId = 1
const pending = new Map()

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../smoothWorker.js', import.meta.url), { type: 'module' })
  worker.onmessage = e => {
    const job = pending.get(e.data.id)
    if (!job) return
    pending.delete(e.data.id)
    if (e.data.error) job.reject(new Error(e.data.error))
    else job.resolve(e.data)
  }
  worker.onerror = e => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'Smooth stopped unexpectedly.'))
    pending.clear()
    worker = null
  }
  return worker
}

// positions in mm. Resolves {positions, indices, keptFlat, ms}.
export function smoothMeshAsync(positions, indices, opts) {
  const w = ensureWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, positions, indices, opts })
  })
}

export function smoothJobsPending() {
  return pending.size
}

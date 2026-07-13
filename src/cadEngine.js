/**
 * cadEngine.js — Main thread interface to the CAD worker
 *
 * Usage:
 *   import { cadEngine } from './cadEngine.js'
 *   const { faces, edges } = await cadEngine.extrude({ pts, depthMm, planeId })
 *
 * The engine lazily starts the worker on first use.
 * Subsequent calls reuse the same worker (OCC stays loaded).
 */

class CadEngine {
  constructor() {
    this._worker  = null
    this._ready   = false
    this._pending = new Map()   // id → { resolve, reject }
    this._readyPromise = null
    this._idCounter = 0
  }

  // ── Lazy worker init ────────────────────────────────────────────────────────

  _ensureWorker() {
    if (this._worker) return this._readyPromise

    this._readyPromise = new Promise((resolve, reject) => {
      this._worker = new Worker(
        new URL('./cadWorker.js', import.meta.url),
        { type: 'module' }
      )

      this._worker.onmessage = (e) => {
        const { type, id, faces, edges, stlBlob, message } = e.data

        if (type === 'ready') {
          this._ready = true
          resolve()
          return
        }

        if (type === 'error' && id === null) {
          // OCC failed to initialize (cadWorker.js's initOC().catch posts this
          // with id:null since there's no per-request id yet). Without this,
          // _readyPromise never resolves OR rejects — every _send() call
          // awaits it forever with no visible error, just a silent hang.
          reject(new Error(message || 'CAD worker failed to initialize'))
          return
        }

        const pending = this._pending.get(id)
        if (!pending) return
        this._pending.delete(id)

        if (type === 'result') {
          // Most operations return mesh data for Three.js; exportSTL returns a
          // Blob instead — pass through whichever fields are actually present.
          pending.resolve(stlBlob ? { stlBlob } : { faces, edges })
        } else if (type === 'error') {
          pending.reject(new Error(message || 'CAD operation failed'))
        }
      }

      this._worker.onerror = (err) => {
        console.error('CAD worker error:', err)
        reject(new Error(err.message))
      }
    })

    return this._readyPromise
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async _send(type, params) {
    await this._ensureWorker()
    const id = ++this._idCounter
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject })
      this._worker.postMessage({ type, id, params })
    })
  }

  /** Extrude a 2D profile to a solid. Returns { faces, edges } mesh data. */
  async extrude(params) {
    return this._send('extrude', params)
  }

  /** Same as extrude but marks the result as a cutout operation. */
  async cutout(params) {
    return this._send('cutout', params)
  }

  /** Round one or more edges of an existing solid — params: {solidId, edgePoints:[[x,y,z],...] (mm), radius, base?}. */
  async fillet3d(params) {
    return this._send('fillet3d', params)
  }

  /** Revolve a 2D profile around an axis line (drawn in the same sketch) to a solid. */
  async revolve(params) {
    return this._send('revolve', params)
  }

  /**
   * Loft a solid through 2+ profiles sketched on parallel planes that share
   * one normal/uAxis basis. params: {solidId, profiles:[{pts,circle,offsetMm},...],
   * normal, origin, uAxis, ruled?}.
   */
  async loft(params) {
    return this._send('loft', params)
  }

  /** Rebuild a base extrude and subtract one or more cut volumes. */
  async subtract(params) {
    return this._send('subtract', params)
  }

  /**
   * Mirror a solid's full rebuilt chain across a plane — cold-rebuilds the
   * source fresh every time rather than trusting any cache (this is the
   * app's first cross-solid dependency). params: {solidId, base, ops,
   * plane: {kind:'workplane', planeId} | {kind:'face', origin, normal, uAxis}}.
   */
  async mirrorShape(params) {
    return this._send('mirrorShape', params)
  }

  /**
   * Boolean-union several existing solids into one new solid. params:
   * {solidId, members: [{solidId, base, ops}, ...]} — base/ops are the same
   * shape buildBaseWorkerParams()/buildSolidOpsForWorker() already produce,
   * used only as a cold-rebuild fallback if a member isn't in shapeStore.
   */
  async joinShapes(params) {
    return this._send('joinShapes', params)
  }

  /**
   * Fuse every top-level solid (cutouts already baked in) into one body and
   * export it as a single STL Blob — for 3D printing, which needs one
   * continuous manifold mesh, not several independently-overlapping bodies.
   * params.solids: [{ solidId, base: {...extrude/revolve params}, ops: [{type:'cut',params}|{type:'fillet',radius,edgePoint}] }]
   */
  async exportSTL(params) {
    return this._send('exportSTL', params)
  }

  /** True once OpenCascade has finished loading. */
  get isReady() { return this._ready }
}

// Singleton — one worker for the whole app
export const cadEngine = new CadEngine()

export const SCALE = 2
export const SNAP_ANGLE = 10
export const SNAP_DIST = 12
export const LINE_SNAP_DIST = 8
export const ALIGN_SNAP_DIST = 14
export const ACQUIRE_DIST = 12
export const TRIM_DIST = 12
export const DELETE_DIST = 12
export const SELECT_DIST = 10

export const pxToMm = px => px / SCALE
export const mmToPx = mm => mm * SCALE
export const norm2pi = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

// Mutable zoom reference — updated by App whenever the viewport scale changes.
// Snap/select functions divide their pixel thresholds by zoomRef.scale so they
// feel the same in screen pixels at any zoom level.
export const zoomRef = { scale: 1 }

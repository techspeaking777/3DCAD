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

// Alignment-tracking distances (ACQUIRE_DIST, ALIGN_SNAP_DIST) additionally
// shrink once zoomed in past TRACKING_ZOOM_BASELINE, on top of the normal
// 1/scale conversion every other distance already gets. A plain
// pixel-constant tolerance still reads as "basically the whole part" once
// you're zoomed in far enough on a small feature — the tracking system ends
// up acquiring (and lingering on) nearby points the user never meant to
// align to. TRACKING_TIGHTEN_LEVEL is a 1 (gentle, close to the old flat
// behavior) to 10 (aggressive, tolerance drops fast past the baseline) knob —
// tune by feel, not derived from anything. Deliberately scoped to the
// tracking system only; plain point/edge snapping (SNAP_DIST,
// LINE_SNAP_DIST) is untouched.
export const TRACKING_TIGHTEN_LEVEL = 4
const TRACKING_ZOOM_BASELINE = 8
export function trackingDist(basePx, scale) {
  const extra = scale > TRACKING_ZOOM_BASELINE
    ? 1 + (TRACKING_TIGHTEN_LEVEL / 10) * (scale / TRACKING_ZOOM_BASELINE - 1)
    : 1
  return (basePx / scale) / extra
}

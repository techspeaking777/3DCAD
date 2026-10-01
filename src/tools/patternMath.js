// Pure step-then-loop transform generators for Rectangular/Circular Pattern.
// Mirrors rotateCopyMath.js's buildRotatedCopies shape (a step value + a
// count, looping to produce one entry per copy) but emits plain-number
// transform descriptors for a 3D rigid-body copy instead of mutating 2D
// sketch entities directly. App3D.jsx's commitPattern3D turns each entry
// into the same {workerParams, newTransform} shape a single Move/Copy
// commit already builds, composing with the source's prior transform via
// the rotationToQuat/quatToAxisAngle helpers already defined there — kept
// out of this module so it stays free of a THREE.js dependency, matching
// this app's existing "math in tools/, wiring (and any THREE use) in
// App3D.jsx" split.

// dir1/dir2: {x,y,z} unit vectors, or null (that direction is unused, i.e.
// its count is forced to 1). Returns an array of {dx,dy,dz} mm translation
// offsets relative to the source's own current position — index 0 is
// always {dx:0,dy:0,dz:0} (the source's own spot), since the source body
// stays put; callers skip index 0 and only create copies for the rest.
export function buildRectangularOffsets(dir1, count1, spacing1, dir2, count2, spacing2) {
  const n1 = Math.max(1, Math.floor(count1) || 1)
  const n2 = dir2 ? Math.max(1, Math.floor(count2) || 1) : 1
  const offsets = []
  for (let j = 0; j < n2; j++) {
    for (let i = 0; i < n1; i++) {
      const dx = (dir1 ? dir1.x * i * spacing1 : 0) + (dir2 ? dir2.x * j * spacing2 : 0)
      const dy = (dir1 ? dir1.y * i * spacing1 : 0) + (dir2 ? dir2.y * j * spacing2 : 0)
      const dz = (dir1 ? dir1.z * i * spacing1 : 0) + (dir2 ? dir2.z * j * spacing2 : 0)
      offsets.push({ dx, dy, dz })
    }
  }
  return offsets
}

// Returns an array of step angles in degrees, index 0 always 0 (the
// source's own current orientation; callers skip it same as above).
// `reversed` flips every step's sign, for a partial (non-360°) pattern that
// needs to sweep the other way around the same pivot/axis.
export function buildCircularAngles(count, stepAngleDeg, reversed = false) {
  const n = Math.max(1, Math.floor(count) || 1)
  const sign = reversed ? -1 : 1
  const angles = []
  for (let i = 0; i < n; i++) angles.push(i * stepAngleDeg * sign)
  return angles
}

// "Specify via" conversion shared by the panel and the commit function —
// Total Angle mode spreads `count` copies evenly across the given span
// (360° full-circle default), Step Angle mode uses the typed step directly.
export function circularStepAngleDeg(specifyVia, count, stepAngleDeg, totalAngleDeg) {
  if (specifyVia === 'total') {
    const n = Math.max(1, Math.floor(count) || 1)
    return totalAngleDeg / n
  }
  return stepAngleDeg
}

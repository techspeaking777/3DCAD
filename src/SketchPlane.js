/**
 * SketchPlane.js  —  Phase 2 Step 3
 *
 * Coordinate transforms between the flat 2D sketch canvas space
 * and 3D world space for each work plane.
 *
 * Camera orientations (match PLANE_VIEWS in Viewport3D.jsx)
 * ──────────────────────────────────────────────────────────
 *  XY: camera at (0,0,800),  up=(0,1,0),  looking -Z
 *      right=+worldX,  screenUp=+worldY
 *      sketch.x = worldX,  sketch.y = -worldY
 *
 *  XZ: camera at (0,-800,0), up=(0,0,1),  looking +Y
 *      right=+worldX,  screenUp=+worldZ
 *      sketch.x = worldX,  sketch.y = -worldZ
 *
 *  YZ: camera at (800,0,0),  up=(0,0,1),  looking -X
 *      right=+worldY,  screenUp=+worldZ
 *      sketch.x = worldY,  sketch.y = -worldZ
 */

import * as THREE from 'three'

// THREE.Plane for each work plane — used for raycasting from camera
export const SKETCH_PLANES = {
  XY: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),   // z=0
  XZ: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),   // y=0
  YZ: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),   // x=0
}

/** 3D world Vector3 → 2D sketch {x, y} */
export function worldToSketch(v, planeId) {
  switch (planeId) {
    case 'XZ': return { x:  v.x, y: -v.z }
    case 'YZ': return { x:  v.y, y: -v.z }
    default:   return { x:  v.x, y: -v.y }   // XY
  }
}

/** 2D sketch {x, y} → 3D world Vector3 */
export function sketchToWorld(sx, sy, planeId) {
  switch (planeId) {
    case 'XZ': return new THREE.Vector3(sx,   0, -sy)
    case 'YZ': return new THREE.Vector3(0,   sx, -sy)
    default:   return new THREE.Vector3(sx, -sy,   0)   // XY
  }
}

/** Axis labels for status bar */
export function planeAxisLabels(planeId) {
  switch (planeId) {
    case 'XZ': return { h: 'X →', v: 'Z ↑' }
    case 'YZ': return { h: 'Y →', v: 'Z ↑' }
    default:   return { h: 'X →', v: 'Y ↑' }
  }
}

/** Border colour for UI highlights */
export function planeColor(planeId) {
  switch (planeId) {
    case 'XY': return '#2255ff'
    case 'XZ': return '#ff3333'
    case 'YZ': return '#22cc55'
    default:   return '#aaaaaa'
  }
}

/**
 * WorkPlanes.js  —  Phase 2 Step 1
 *
 * Creates and manages the three standard work plane rectangles shown in the
 * 3D viewport: XY (top), XZ (front), YZ (side).
 *
 * Each plane is:
 *  • A semi-transparent filled mesh (THREE.PlaneGeometry)
 *  • A solid border (LineLoop)
 *  • A text label sprite (Canvas texture)
 *
 * Colours match conventional CAD colour coding:
 *   XY — blue   (ground / top plane)
 *   XZ — red    (front plane)
 *   YZ — green  (side plane)
 *
 * Usage
 * ─────
 *   import { createWorkPlanes, hitTestPlanes, setPlaneHover, setPlaneActive } from './WorkPlanes.js'
 *
 *   const planes = createWorkPlanes(scene)
 *   // in mouse handler:
 *   const hit = hitTestPlanes(raycaster, planes)
 *   if (hit) setPlaneHover(planes, hit.id)
 *   // when clicked:
 *   setPlaneActive(planes, hit.id)
 */

import * as THREE from 'three'

// ── constants ─────────────────────────────────────────────────────────────────

const PLANE_SIZE = 300   // half-size of each plane rectangle in world units

export const PLANES = {
  XY: {
    id:    'XY',
    label: 'XY  Top',
    color: 0x2255ff,
    normal: new THREE.Vector3(0, 0, 1),
    // rotation to apply to a default XY PlaneGeometry (already in XY — no rotation)
    rotation: new THREE.Euler(0, 0, 0),
    // world-space position of plane origin
    position: new THREE.Vector3(0, 0, 0),
  },
  XZ: {
    id:    'XZ',
    label: 'XZ  Front',
    color: 0xff3333,
    normal: new THREE.Vector3(0, 1, 0),
    // rotate around X by -90° to stand up vertically (XZ plane in Three.js Y-up)
    rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
    position: new THREE.Vector3(0, 0, 0),
  },
  YZ: {
    id:    'YZ',
    label: 'YZ  Side',
    color: 0x22cc55,
    normal: new THREE.Vector3(1, 0, 0),
    // rotate around Y by 90° to face along X
    rotation: new THREE.Euler(0, Math.PI / 2, 0),
    position: new THREE.Vector3(0, 0, 0),
  },
}

// ── label sprite ──────────────────────────────────────────────────────────────

function makeLabel(text, color) {
  const W = 256, H = 64
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  // Background pill
  ctx.fillStyle = `rgba(0,0,0,0.55)`
  ctx.beginPath(); ctx.roundRect(4, 8, W-8, H-16, 10); ctx.fill()
  // Text
  ctx.font = 'bold 28px monospace'
  ctx.fillStyle = `#${color.toString(16).padStart(6,'0')}`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, W/2, H/2)
  const tex = new THREE.CanvasTexture(cv)
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(120, 30, 1)
  return sprite
}

// ── build one plane entry ─────────────────────────────────────────────────────

function buildPlane(def) {
  const group = new THREE.Group()
  group.userData.planeId = def.id
  group.renderOrder = 2

  const S = PLANE_SIZE

  // Filled mesh — semi-transparent
  const fillGeo = new THREE.PlaneGeometry(S * 2, S * 2)
  const fillMat = new THREE.MeshBasicMaterial({
    color: def.color,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const fill = new THREE.Mesh(fillGeo, fillMat)
  fill.userData.isFill = true
  group.add(fill)

  // Border — solid coloured LineLoop
  const corners = [
    new THREE.Vector3(-S, -S, 0),
    new THREE.Vector3( S, -S, 0),
    new THREE.Vector3( S,  S, 0),
    new THREE.Vector3(-S,  S, 0),
    new THREE.Vector3(-S, -S, 0),  // close
  ]
  const borderGeo = new THREE.BufferGeometry().setFromPoints(corners)
  const borderMat = new THREE.LineBasicMaterial({
    color: def.color,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
  })
  const border = new THREE.Line(borderGeo, borderMat)
  border.userData.isBorder = true
  group.add(border)

  // Label sprite — offset toward viewer so it doesn't clip the plane
  const label = makeLabel(def.label, def.color)
  label.position.set(S * 0.65, S * 0.75, 2)
  label.userData.isLabel = true
  group.add(label)

  // Apply rotation and position
  group.rotation.copy(def.rotation)
  group.position.copy(def.position)

  return group
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Create all three work planes, add them to the scene.
 * Returns a map: { XY: {group, def, mesh}, XZ: {...}, YZ: {...} }
 */
export function createWorkPlanes(scene) {
  const result = {}
  for (const def of Object.values(PLANES)) {
    const group = buildPlane(def)
    scene.add(group)
    // Keep a ref to the fill mesh for raycasting
    const mesh = group.children.find(c => c.userData.isFill)
    result[def.id] = { group, def, mesh }
  }
  return result
}

/**
 * Hit-test a raycaster against all plane fill meshes.
 * Returns { id, point } of the nearest hit, or null.
 */
export function hitTestPlanes(raycaster, planes) {
  const meshes = Object.values(planes).map(p => p.mesh)
  const hits = raycaster.intersectObjects(meshes, false)
  if (!hits.length) return null
  const hit = hits[0]
  const entry = Object.values(planes).find(p => p.mesh === hit.object)
  return entry ? { id: entry.def.id, point: hit.point, def: entry.def } : null
}

/**
 * Set hover highlight on a plane (pass null to clear all).
 */
export function setPlaneHover(planes, hoveredId) {
  for (const { group, def } of Object.values(planes)) {
    const isHov = def.id === hoveredId
    const fill   = group.children.find(c => c.userData.isFill)
    const border = group.children.find(c => c.userData.isBorder)
    if (fill)   fill.material.opacity   = isHov ? 0.14 : 0.06
    if (border) border.material.opacity = isHov ? 0.90 : 0.45
  }
}

/**
 * Set active (selected) state on a plane (shown brighter, stays highlighted).
 * Pass null to clear.
 */
export function setPlaneActive(planes, activeId) {
  for (const { group, def } of Object.values(planes)) {
    const isActive = def.id === activeId
    const fill   = group.children.find(c => c.userData.isFill)
    const border = group.children.find(c => c.userData.isBorder)
    if (fill)   fill.material.opacity   = isActive ? 0.18 : 0.06
    if (border) {
      border.material.opacity = isActive ? 1.0 : 0.45
      border.material.color.set(isActive ? 0xffffff : def.color)
    }
  }
}

/**
 * Show or hide all work planes.
 */
export function setWorkPlanesVisible(planes, visible) {
  for (const { group } of Object.values(planes)) {
    group.visible = visible
  }
}

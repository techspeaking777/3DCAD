/**
 * cadMesh.js — Convert replicad mesh data to Three.js objects
 *
 * replicad returns { faces, edges } from shape.mesh() / shape.meshEdges()
 * This module converts those to THREE.BufferGeometry objects.
 */

import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

const SCALE = 2   // replicad outputs mm; scene is in px (1mm = 2px)

// Shared, mutable Vector2 — every solid-edge LineMaterial references this same object
// at construction (its resolution setter copies the value in), so Viewport3D updates
// it once on resize; see the matching LINE_RESOLUTION singleton in Viewport3D.jsx for
// why a plain module-level Vector2 is used instead of prop drilling.
export const EDGE_LINE_RESOLUTION = new THREE.Vector2(800, 600)

export function replicadMeshToThree(meshData, color = '#3a7bd5') {
  const { faces, edges } = meshData
  const group = new THREE.Group()
  group.userData.isReplicadSolid = true

  // ── Face mesh ──────────────────────────────────────────────────────────────
  if (faces) {
    const faceGeo = new THREE.BufferGeometry()

    if (faces.vertices && faces.vertices.length > 0) {
      // Scale mm → scene px
      const verts = new Float32Array(faces.vertices)
      for (let i = 0; i < verts.length; i++) verts[i] *= SCALE
      faceGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    }
    if (faces.normals && faces.normals.length > 0) {
      // Normals don't need scaling — they're unit vectors
      faceGeo.setAttribute('normal',
        new THREE.BufferAttribute(new Float32Array(faces.normals), 3))
    }
    if (faces.triangles && faces.triangles.length > 0) {
      faceGeo.setIndex(
        new THREE.BufferAttribute(new Uint32Array(faces.triangles), 1))
    }
    faceGeo.computeBoundingSphere()

    const faceMat = new THREE.MeshPhongMaterial({
      color,
      transparent: true,
      opacity: 0.90,
      side: THREE.DoubleSide,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    })
    const faceMesh = new THREE.Mesh(faceGeo, faceMat)
    faceMesh.renderOrder = 3
    group.add(faceMesh)
  }

  // ── Edge lines ─────────────────────────────────────────────────────────────
  // replicad's shape.meshEdges() returns { lines: number[], edgeGroups: [...] } —
  // `lines` is ALREADY a flat array of consecutive point-pairs (6 numbers per
  // segment: x,y,z,x,y,z), the exact format LineSegmentsGeometry wants. edgeGroups
  // only matters if you need per-edge identity (e.g. hover/pick a single edge),
  // which isn't needed here. (Previously this assumed `edges` was an array of
  // {vertices:[...]} objects, which never matched — edges silently never rendered.)
  if (edges?.lines?.length > 0) {
    const edgePoints = edges.lines.map(v => v * SCALE)
    // Plain THREE.LineSegments ignores linewidth on most GPUs/browsers (the same
    // WebGL limitation worked around for sketch geometry) — Fusion 360's crisp bold
    // "Shaded with Visible Edges" outline needs the Line2/LineMaterial fat-line
    // module for real pixel-width control.
    const edgeGeo = new LineSegmentsGeometry()
    edgeGeo.setPositions(edgePoints)
    const edgeMat = new LineMaterial({
      color: 0x000000, linewidth: 1.3, worldUnits: false,
      transparent: true, opacity: 1.0, depthTest: true,
      resolution: EDGE_LINE_RESOLUTION,
    })
    const edgeLines = new LineSegments2(edgeGeo, edgeMat)
    edgeLines.renderOrder = 5
    // LineSegments2 extends THREE.Mesh (isMesh===true) and implements its own
    // raycast() for the thick screen-space line quads. Face-click/hover picking
    // filters hits with `h.object.isMesh`, so without this the edge overlay could
    // shadow the real face mesh underneath it. Edges were never meant to be
    // clickable, so just disable raycasting on this object entirely.
    edgeLines.raycast = () => {}
    group.add(edgeLines)
  }
  return group
}

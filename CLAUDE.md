# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server (hot reload)
npm run build     # Production build
npm run preview   # Preview production build locally
```

No test suite is configured. ESLint is available via `eslint.config.js`.

## Architecture Overview

This is a browser-based parametric 3D CAD application built with React + Vite. The entry point is `src/main.jsx` → `src/App3D.jsx`.

### Two app variants

- **`src/App3D.jsx`** — Active entry point. 3D mode: Three.js viewport, work planes, feature tree, extrude tool, all 2D sketch tools.
- **`src/App.jsx`** — Legacy 2D-only mode (flat canvas, no 3D). Shares the same tool math but is not mounted in `main.jsx`.

### Rendering layers (App3D)

The 3D view uses two superimposed layers:

1. **Three.js WebGLRenderer** (`src/Viewport3D.jsx`) — renders solids, work plane grids, and committed sketch geometry as 3D objects.
2. **Transparent overlay `<canvas>`** — 2D tool overlays (snap indicators, rubber-band lines, selection boxes, dimension labels, live previews). The overlay is obtained via `viewport3dRef.getOverlayCtx(activePlane)` and redrawn every time `viewTransform` changes.

### CAD solid modeling

Solid extrusion runs entirely in a Web Worker to keep the UI responsive:

- **`src/cadEngine.js`** — Singleton `cadEngine` class. Promise-based API wrapping postMessage. Lazily starts the worker on first call (`_ensureWorker()`).
- **`src/cadWorker.js`** — Worker that loads OpenCascade.js WASM via replicad. Handles `extrude`, `cutout`, and `fillet` messages. Returns raw mesh buffers.
- **`src/cadMesh.js`** — Converts replicad mesh output into Three.js `BufferGeometry`.

The worker takes ~3–5 seconds to initialize on first load. `App3D` calls `cadEngine._ensureWorker()` eagerly on mount so OCC is ready before the user tries to extrude.

### Coordinate systems

- **Sketch space (2D)**: pixels, y-down. `SCALE = 2` means 1 mm = 2 px.
- `pxToMm(px)` / `mmToPx(mm)` — defined in `src/Constants.js`.
- `zoomRef.scale` — mutable singleton updated whenever the camera zoom changes; snap/select thresholds divide by this value so they stay constant in screen pixels.
- **Three.js world space**: y-up. `w2t(x,y)` converts sketch → Three.js (`y` flipped), `t2w(v)` is the inverse.
- **Plane transforms**: `src/SketchPlane.js` handles XY/XZ/YZ coordinate mapping. `src/FacePlane.js` handles picking and sketching on solid faces.

### Sketch state pattern

All sketch state lives in React (`useState`) for rendering, but event handlers (mouse move/click) read from `useRef` mirrors to avoid stale closures. The pattern is pervasive: every array like `lines`, `circles`, `arcs`, `splines` has a paired `linesRef`, `circlesRef`, etc. that is kept in sync via `useEffect`.

### Feature tree

`App3D` maintains a `features` array — an ordered list of `{type:'sketch'|'extrude', id, name, ...}`. Sketches store their own geometry. Working arrays (`lines`, `circles`, `arcs`, `splines`) are the active sketch buffer. The `FeatureTree` component (defined inline in `App3D.jsx`) renders the feature list in the right sidebar.

### Tool modules

All tool mathematics is in pure JS (no React), importable anywhere:

| Path | Responsibility |
|---|---|
| `src/tools/history.js` | Undo/redo hook (`useHistory`) |
| `src/tools/saveLoad.js` | JSON save/load, DXF export/import |
| `src/tools/extrudeMath.js` | Profile detection (closed loop finder), 3D solid building |
| `src/tools/trimDelete.js` | Trim and delete operations |
| `src/tools/offsetMath.js` | Parallel offset of lines/circles/arcs/splines |
| `src/tools/filletMath.js` | Fillet between two lines |
| `src/tools/mirrorMath.js` | Mirror geometry across an axis |
| `src/tools/moveCopyMath.js` | Move and copy operations |
| `src/tools/rotateCopyMath.js` | Rotate and copy operations |
| `src/tools/scaleMath.js` | Scale/resize geometry |
| `src/tools/splineMath.js` | Catmull-Rom spline sampling, trim, distance |
| `src/tools/selectMath.js` | Bounding box, handle hit testing, transform application |
| `src/tools/extendMath.js` | Extend line/arc to nearest intersection |
| `src/geometry/snap.js` | Geometric snap (endpoint, midpoint, tangent, perpendicular, tracking) |
| `src/geometry/intersections.js` | All-pairs intersection computation |
| `src/draw/drawHelpers.js` | Canvas drawing utilities (labels, track lines, HV indicators) |
| `src/draw/ToolIcons.jsx` | SVG tool icons as React components |

### Panel components

`TracerPanel`, `TextPanel`, `PageSetupPanel`, `GuidePanel` are standalone React components in `src/tools/` for their respective overlay dialogs.

### Work planes

`src/WorkPlanes.js` creates Three.js meshes for XY/XZ/YZ click targets. Clicking a plane sets `activePlane` in `App3D`, triggers a camera tween in `Viewport3D` to snap to that plane's orthographic view, and enters sketch mode. `src/SketchPlane.js` exports `SKETCH_PLANES` (plane definitions) and `sketchToWorld()` for coordinate projection.

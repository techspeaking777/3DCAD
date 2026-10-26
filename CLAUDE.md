# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server (hot reload)
npm run build     # Production build
npm run preview   # Preview production build locally
npm run lint      # ESLint over src/ — must stay at 0 errors (warnings are mostly intentional hook-dependency notes)
```

No test suite is configured. `eslint.config.js` documents every rule override (the React Compiler readiness rules are off on purpose).

## Architecture Overview

This is a browser-based parametric 3D CAD application built with React + Vite. The entry point is `src/main.jsx` → `src/AppShell.jsx`, which hosts two apps behind a top-bar tab switch.

### Two apps, both live

- **`src/App3D.jsx`** — The "3D MODEL" tab. Three.js viewport, work planes, feature tree, all solid tools, and the 2D sketch tools used inside a sketch.
- **`src/App.jsx`** — The "DRAWING" tab: a standalone flat 2D drawing app (DXF/PDF output). It is **not** legacy — it is mounted by `AppShell.jsx` — but it carries its own copy of the 2D sketch engine: all 44 of its functions (`handleMouseMove`, `computeEnd`, `resetDrawState`, …) also exist in `App3D.jsx`. **A fix to a sketch tool usually has to be made in both files** (the VERT/HORIZ tracking fix was).

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
| `src/tools/patternMath.js` | Rectangular offsets / circular angles for the Pattern tool |
| `src/tools/sweepProject.js` | Projecting a Sweep path onto a body: resampling, smoothing, profile plane (shared by `App3D.jsx` and `cadWorker.js`) |
| `src/tools/orthoViewsMath.js` | Converts worker ortho-view output into 2D drawing entities |
| `src/tools/cloudSave.js` | Classroom cloud save/load via the website's `/api` (same-origin; unavailable in standalone dev) |
| `src/tools/extendMath.js` | Extend line/arc to nearest intersection |
| `src/geometry/snap.js` | Geometric snap (endpoint, midpoint, tangent, perpendicular, tracking) |
| `src/geometry/intersections.js` | All-pairs intersection computation |
| `src/draw/drawHelpers.js` | Canvas drawing utilities (labels, track lines, HV indicators) |
| `src/draw/ToolIcons.jsx` | SVG tool icons as React components |

### Panel components

`TracerPanel`, `TextPanel`, `PageSetupPanel`, `GuidePanel`, `PatternPanel`, `SpringPanel` and the other `*Panel.jsx` files are standalone React components in `src/tools/` for their respective overlay dialogs. `ViewCube.jsx` is the clickable orientation cube (with Home button and edge arrows) drawn over the 3D viewport.

### Work planes

`src/WorkPlanes.js` creates Three.js meshes for XY/XZ/YZ click targets. Clicking a plane sets `activePlane` in `App3D`, triggers a camera tween in `Viewport3D` to snap to that plane's orthographic view, and enters sketch mode. `src/SketchPlane.js` exports `SKETCH_PLANES` (plane definitions) and `sketchToWorld()` for coordinate projection.

### Things that aren't obvious from the file list

- **Sidebar Add/Cut flyouts** — Extrude, Revolve, Loft, Sweep and Spring each have ONE sidebar button; clicking opens a fixed-position `+ add / − cut` flyout (`SHAPE_OPS` and `opFlyout` in `App3D.jsx`). The underlying tool ids (`extrude`/`cutout`, `revolve`/`revolvecut`, `loft3d`/`loftcutout`, `sweep3d`/`sweepcut`, `spring3d`/`springcut`) and their `activate*()` functions are unchanged; `activateSolidTool(id)` maps id → activator. Simple mode hides each advanced *button* (`ADVANCED_SOLID_TOOL_IDS`).
- **Face sketch frame** — hovering a face draws its bounding frame with a green base line and a yellow dot (`drawSketchFrame` in `Viewport3D.jsx`), computed by `faceHitToPlane(hit, overrideEdge, {frameOnly:true})` so the preview matches the click exactly. The sketch **origin is that frame's bottom-left corner** (round faces keep the centre). `FacePlane.viewCenter` is where the camera looks — keep it when copying/offsetting a `FacePlane` (see the offset-plane helpers and loft/sweep/spring basis code).
- **Projected Sweep** — a Sweep path projected onto a body is stored as `pathPts3d` (+ `projDir`) instead of `pathPts`; `buildSweepProjected` in `cadWorker.js` fits a cubic B-spline. Anything keyed on `pathPts` (rebuild params, cutout params, tree flags) must also handle `pathPts3d`. Ray-cast points are smoothed first (`smoothPoints3d`) — raw mesh-facet points make OpenCascade's pipe-shell sweep fail.
- **Pattern** — body copies come from `createTransformedCopy` and inherit the source feature's `groupId`, so the Feature Tree shows one "× N" row. A *cutout* pattern stores `patternXform` (translate/rotate ops) on each copy feature; `cadWorker.js`'s `applyCutXform` applies it to the built cut shape. Copies get their own `patterngroup-` id and hide the edit buttons.
- **Errors** — the worker turns raw OpenCascade failures (often a bare number) into plain-English reasons in `friendlyCadMessage`; callers prefix them ("Cutout failed: …"). Full details still go to the console.
- **Step-bar hints** — each tool's `SmartStepBar` `hint` is a short verb-first sentence per step; keep that voice when adding tools.
- **X-ray** — `xray` state in `App3D` (button in the always-visible pinned slot at the top right, key **X**) is passed to `Viewport3D`, whose effect fades each replicad solid's face material (opacity 0.12, no depth write) and turns off depth testing on its edge `LineMaterial`. View-only: never saved, no model change.
- **Autosave** — an effect in `App3D.jsx` (after `handleCloudProjectPicked`) re-writes the project ~3 s (local file) / ~10 s (cloud) after `features`/`solids` stop changing, but ONLY once a file handle (`projectFileHandleRef`) or `cloudProjectIdRef` exists — it never opens a picker. `autosaveBaseRef` holds the last text written per destination so unchanged projects aren't rewritten; manual saves must call `markSaved(kind)`. On/off is `localStorage['retrocad.autosave']`; status text is pushed to `AppShell` via `onAutosaveStatus`.
- **Dev gotcha** — editing `cadWorker.js` reloads the whole page (the worker restarts), losing in-memory work.
- **Offset planes** — Extrude/Cutout, Mirror, Sweep and Spring each offer "+ Offset Plane" at step 1. The maths is shared: module-level `resolveOffsetBasis` / `offsetFacePlane`, and in `App3D` `dragOffsetDistance`, `syncOffsetPlanePreview`, `pickOffsetPlane` (on top of `offsetPlaneDragDistanceMm`, which handles vertex/midpoint/centre snapping). Each tool keeps only its own state (`xOffsetBase`, `xOffsetDistInput`, `xOffsetDistLocked`), its gate in the drag handler, and its commit step. Loft uses a different (drag-armed) mechanism and is separate.

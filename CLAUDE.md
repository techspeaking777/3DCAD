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
- **Spline point editing** — with the Select tool and exactly one hand-drawn spline selected, its points show as dots: drag one, double-click the curve to add one, pick one + Delete to remove it (`splineNodeSel`/`splineNodeDragRef` state, handled in `handleMouseDown/Move/Up/DoubleClick/KeyDown` of **both** `App3D.jsx` and `App.jsx`). The pure maths is `src/tools/splineEdit.js` (`isEditableSpline` excludes `polyline` and `ghostRef` splines). A drag uses `selectLiveGeom` and commits one undo step on mouse-up. No tangent handles — a spline is a Catmull-Rom curve through its points.
- **Include Edge** — `edgeToSketchGeometry` in `App3D.jsx` turns one solid edge into a line, circle, arc, or (anything else) one fitted spline from `src/tools/splineFit.js`; the flyout's FIRM | CONSTR. switch (key **C**) decides whether it counts toward profiles (`includedEdge`) or is pure reference. The circle/arc test is deliberately tight so gentle curves aren't mistaken for arcs.
- **Soften** — its own sidebar tool (`soften3d`, state `soften3d*` in `App3D.jsx`). Three steps: (1) pick the body (a lone body is auto-picked), (2) choose what to round via `soften3dMode` — `'face'` Keep Face Flat (face click = keep that face's outline sharp, several allowed, `soften3dKeepFaces`), `'all'` All Edges, `'edges'` Pick Edges (hover raycast + click toggle, the same `raycastSolidEdges` Fillet uses, orange via `setSelectedEdges`) — (3) type the radius. Face and All modes fill `soften3dSel` through the worker message `softenEdges` (`listSoftenEdges`: every eligible edge except the kept faces' outlines), so commit always sends an explicit edge list. The face-pick pipeline is armed only in face mode. Esc/Start over clears the mode and picks. The work is the worker message `softenAll` (`softenShape` in `cadWorker.js`, `edges:[{edgeId, point}]` resolved by hash then nearest-edge): a one-edge-at-a-time pass finds the biggest rung of the radius ladder (target, /2, /4 … 0.4 mm) each edge takes, then each rung is applied to its edges (re-measured on the current shape) with a split-in-half retry (`softenRound`). Every rung comes back as `{radius, edgePoints}` and is saved as an ordinary `type:'fillet'` feature named "Soften N", so rebuild/replay/edit need no special case. Edges that wouldn't round come back as `leftover:[{edgeId, point}]` and stay selected for another go. **Every result is checked** (`softenLooksRight`): OpenCascade can return a *valid* but wrong rounding (spikes, notches) when a big radius meets its neighbours, so a result is rejected if it grows past the old bounding box or removes far more volume than the edge's length and bend explain AND that volume doesn't scale with radius² (re-run at half the radius). Don't swap that for a plain volume cap — OCC also rounds along smooth chains, so legitimate roundings can remove 3–5× the one-edge estimate. Edges already smooth (<2° between faces) and seams are skipped. Cost is ~30–100 ms per trial fillet, so a 90-edge plate takes ~30 s (60 s budget, then `timedOut`).
- **Fillet** — no Lock step: `fillet3dAccepted` is derived (`fillet3dSel.length>0`), so the radius popup appears as soon as something is picked. A click means an *edge or a face*: `handleFillet3DClick` asks the worker (`cadEngine.filletEdges`) which edges that click stands for — a face gives all its roundable edges (`facePoint`), an edge gives itself plus the tangent-continuous chain flowing into it (`tangentChain` in `cadWorker.js`) unless the Smooth Chain switch (`fillet3dChain`) is off. `toggleFilletEdges` adds them, or removes them if all were already picked. If the radius fails, `commitFillet3D` calls `cadEngine.filletMaxRadius` (bisection, floored to 0.1 mm), keeps the picks, pre-fills the largest working radius and shows `fillet3dNote` — the user just presses Enter. Picked edges are yellow, hover orange (shared with Soften; measure mode stays blue) with a dark casing so they read on any solid. While editing an existing fillet (`editingFeatureId`) picking is disabled and failures keep the old error banner.
- **Subtract** — the cut variant of the Join sidebar button (`SHAPE_OPS.join3d`, tool id `subtract3d`, state `subtract*` in `App3D.jsx`). Pick the body to cut, then one or more hole bodies (position them first with Move/Copy); `commitSubtract` sends `cadEngine.joinShapes({members, mode:'subtract'})` (target first) and stores a normal Join result — `operation:'join'` plus `booleanOp:'subtract'` — so locking (`joinedInto`), delete = restore, `rebuildJoinBaseMesh` and project load all reuse the Join code. The worker cuts each hole body with `cutTolerant` and refuses a hole body that overlaps nothing / removes nothing. `rebuildJoinBaseMesh` pre-builds any member with a `transform` through `rebuildFeatureSolid` (base+ops alone would put a moved body back where it was drawn) and re-sorts members into pick order for a subtract (target must stay first). Hole bodies glow red, the target light blue (`highlightJoinMembers` takes `{solidId, color}` entries).
- **Cuts that silently do nothing** — a cut tool tangent to a wall of the solid (e.g. a circle sketched flush against an end wall) can make OpenCascade return a *valid, error-free* result that removed almost nothing, with an overlap of 0 at the normal fuzzy value (0.05 mm). `cutTolerant` in `cadWorker.js` re-measures the overlap at 0.5 mm when a cut removes <2% of the body and redoes it there only if that removes the matching volume. Don't raise the normal fuzzy value to fix this — it swallows deliberately thin walls.
- **Shift guide-lock (Line / Axis)** — hold Shift while an alignment guide shows and the end point stays on it. `alignLock` state `{axis:'x'|'y', value, from, angleSnap}` is captured in `handleKeyDown` by `captureAlignLock` (the line's own H/V wins, else the first alignment track) and honoured at the top of `computeEnd`, so preview and click commit agree (it also skips tangent snaps). Cleared on Shift keyup, window blur, or any `startPoint`/`tool` change. Typed length/angle locks take priority. Present in **both** `App3D.jsx` and `App.jsx` (Line only there).
- **Cutout (finite depth, no target step)** — a new cutout is always a finite depth (`extentMode:'value'`); the Through All button only shows when editing an OLD through-all cutout (engine support for `extentMode:'through'` is kept so old files rebuild). There is no pick-target step: `commitExtrude` cuts every *visible* solid the swept volume touches (`cutTargetSolids` + `linearCutBoxPx`, module-level in `App3D.jsx`) — hidden bodies are skipped, which is how a user protects one (e.g. a pin in a hole). During the depth step an effect glows those bodies red (`highlightJoinMembers`, same helper) so the effect is visible before committing. `defaultCutDepth` seeds the depth with the sketched-on body's thickness along the face normal.
- **Extrude depth step** — four things sit on top of the plain drag/type depth. (1) **Live 3D preview**: `buildExtrudePrismGeometry` (module-level, world px) builds a translucent prism from the picked profile (holes included, straight walls — draft isn't shown) and an effect hands it to `Viewport3D.showExtrudeSolidPreview`, which keeps it in the scene (NOT `solidsGroup`, so it is never picked). The canvas ghost still draws the arrow and label. (2) **One way / Both ways / Flip** (`directionToggle`): Flip pins the side with `directionLocked` so mouse position stops overriding it; clicking One way hands it back. All extrude-state writes from buttons go through `updateExtrudeState`, which also writes `extrudeStateRef` synchronously (Enter right after a click must not read the old value). (3) **New body | Join to body**, only when the sketch sits on a body face (`joinableBodyId`, from `facePlane.solidId`): `commitExtrude` calls `joinMembers` (shared with the Join tool, target body listed first so it keeps its colour). If the union fails the extrude stays as its own body and an error says so. (4) **To face** (`extrudeState.toFace`): the depth follows the surface under the cursor (`extrudeFaceSnap`, via `signedDepthTo`) and a click on it accepts and commits; Esc/the button leaves the mode and restores the previous depth and side (`preToFace`).
- **Dev gotcha** — editing `cadWorker.js` reloads the whole page (the worker restarts), losing in-memory work.
- **Offset planes** — Extrude/Cutout, Mirror, Sweep and Spring each offer "+ Offset Plane" at step 1. The maths is shared: module-level `resolveOffsetBasis` / `offsetFacePlane`, and in `App3D` `dragOffsetDistance`, `syncOffsetPlanePreview`, `pickOffsetPlane` (on top of `offsetPlaneDragDistanceMm`, which handles vertex/midpoint/centre snapping). Each tool keeps only its own state (`xOffsetBase`, `xOffsetDistInput`, `xOffsetDistLocked`), its gate in the drag handler, and its commit step. Loft uses a different (drag-armed) mechanism and is separate.

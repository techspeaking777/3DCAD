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

Browser-based parametric 3D CAD app, React + Vite. Entry: `src/main.jsx` → `src/AppShell.jsx`, which hosts two apps behind a top-bar tab switch.

### Two apps, both live

- **`src/App3D.jsx`** — the "3D MODEL" tab: Three.js viewport, work planes, feature tree, all solid tools, and the 2D sketch tools used inside a sketch.
- **`src/App.jsx`** — the "DRAWING" tab: a standalone flat 2D drawing app (DXF/PDF output). Not legacy, but it carries its own copy of the 2D sketch engine (`handleMouseMove`, `computeEnd`, `resetDrawState`, … all exist in both). **A fix to a sketch tool usually has to be made in both files.**

### Rendering layers (App3D)

1. **Three.js WebGLRenderer** (`src/Viewport3D.jsx`) — solids, work plane grids, committed sketch geometry.
2. **Transparent overlay `<canvas>`** — tool overlays (snaps, rubber bands, selection boxes, dimension labels, previews), from `viewport3dRef.getOverlayCtx(activePlane)`, redrawn whenever `viewTransform` changes.

### CAD solid modeling

All OpenCascade work runs in a Web Worker:

- **`src/cadEngine.js`** — singleton, promise API over postMessage, lazily starts the worker (`_ensureWorker()`; App3D calls it on mount because OCC takes ~3–5 s to load).
- **`src/cadWorker.js`** — loads OpenCascade.js WASM via replicad; handles every solid operation; keeps built shapes in `shapeStore` (keyed by solidId) and returns mesh buffers. Calls without a `solidId` (live previews) store nothing.
- **`src/cadMesh.js`** — replicad mesh → Three.js `BufferGeometry`.

### Coordinate systems

- **Sketch space (2D)**: pixels, y-down. `SCALE = 2` (1 mm = 2 px); `pxToMm` / `mmToPx` in `src/constants.js`.
- `zoomRef.scale` — mutable camera zoom; snap/select thresholds divide by it to stay constant on screen.
- **Three.js world**: y-up. `w2t(x,y)` sketch → Three.js (y flipped), `t2w(v)` inverse.
- `src/SketchPlane.js` — XY/XZ/YZ mapping (`SKETCH_PLANES`, `sketchToWorld()`); `src/FacePlane.js` — picking and sketching on solid faces. `src/WorkPlanes.js` builds the clickable plane meshes; clicking one sets `activePlane`, tweens the camera and enters sketch mode.

### State patterns

- Sketch state lives in `useState` for rendering, but event handlers read `useRef` mirrors (`linesRef`, `circlesRef`, …, synced by `useEffect`) to avoid stale closures.
- `features` (App3D) is the ordered feature list `{type, id, name, ...}`; sketches store their own geometry; `lines`/`circles`/`arcs`/`splines` are the active sketch buffer. `FeatureTree` is defined inline in `App3D.jsx`.

### Tool modules (pure JS, no React)

| Path | Responsibility |
|---|---|
| `src/tools/history.js` | Undo/redo hook (`useHistory`) |
| `src/tools/saveLoad.js` | JSON save/load, DXF export/import |
| `src/tools/extrudeMath.js` | Profile detection (closed loop finder), 3D solid building |
| `src/tools/trimDelete.js` / `extendMath.js` | Trim, delete, extend |
| `src/tools/offsetMath.js` | Parallel offset of lines/circles/arcs/splines |
| `src/tools/filletMath.js` | 2D fillet between two lines |
| `src/tools/mirrorMath.js`, `moveCopyMath.js`, `rotateCopyMath.js`, `scaleMath.js` | 2D mirror / move-copy / rotate-copy / scale |
| `src/tools/splineMath.js`, `splineEdit.js`, `splineFit.js` | Catmull-Rom sampling/trim/distance, point editing, fitting |
| `src/tools/selectMath.js` | Bounding box, handle hit testing, transforms |
| `src/tools/patternMath.js` | Rectangular offsets / circular angles for Pattern |
| `src/tools/sweepProject.js` | Sweep path projected onto a body (shared with the worker) |
| `src/tools/springMath.js` | `springFrame` / `springDims` (shared with the worker) |
| `src/tools/orthoViewsMath.js` | Ortho-view output → drawing entities (tidy, scale, centre lines, labels) |
| `src/tools/strokeFont.js` | Single-stroke capital font → line entities |
| `src/tools/dimGeometry.js` | Drawing-tab dimensions → lines/arcs/arrows (one source for canvas, PDF, DXF) |
| `src/tools/cloudSave.js` | Classroom cloud save/load via the site's `/api` (unavailable in standalone dev) |
| `src/geometry/snap.js`, `intersections.js` | Geometric snapping, all-pairs intersections |
| `src/draw/drawHelpers.js`, `ToolIcons.jsx` | Canvas drawing helpers, tool icons |

`*Panel.jsx` files in `src/tools/` are the overlay dialogs; `ViewCube.jsx` is the orientation cube over the 3D viewport.

## Things that aren't obvious

### General

- **Dev gotcha** — editing `cadWorker.js` reloads the whole page (the worker restarts), losing in-memory work.
- **replicad transforms free their input** — `mirror`, `translate`, `rotate` (and `scale`) call `this.delete()` on the shape they are called on. **Never call one on a shape taken from `shapeStore`: `.clone()` it first** (`mirrorShape` and `transformShape`'s Copy branch do). Otherwise the source body's cached shape is freed and every later operation on it fails with "has been deleted" — and a reload replays the same step, so the file looks permanently broken.
- **Errors** — the worker turns raw OpenCascade failures (often a bare number) into plain English in `friendlyCadMessage`; callers prefix them ("Cutout failed: …").
- **Step-bar hints** — each `SmartStepBar` `hint` is a short verb-first sentence; keep that voice.
- **Sidebar Add/Cut flyouts** — Extrude, Revolve, Loft, Sweep, Spring and Join each have ONE button opening a `+ add / − cut` flyout (`SHAPE_OPS`, `opFlyout`); the tool ids (`extrude`/`cutout`, `revolve`/`revolvecut`, `loft3d`/`loftcutout`, `sweep3d`/`sweepcut`, `spring3d`/`springcut`, `join3d`/`subtract3d`) are mapped by `activateSolidTool(id)`. Simple mode hides `ADVANCED_SOLID_TOOL_IDS`.
- **Shared live preview** — Extrude, Revolve, Loft, Sweep and Spring all show their translucent preview through ONE slot, `Viewport3D.showExtrudeSolidPreview` (kept out of `solidsGroup`, so never picked). An effect may only hide it when it owns the current session, or it wipes another tool's preview. Cut variants are red and glow their targets red (`highlightJoinMembers`, which takes `{solidId, color}`).
- **Cut targets** — Cutout, Revolve/Loft/Sweep/Spring Cut cut every *visible* body the swept box touches (`cutTargetSolids` + `linearCutBoxPx`); hidden bodies are skipped, which is how a user protects one.
- **Move gizmo size** — `Viewport3D.showMoveGizmo` builds the arrows/rotate rings once at a FIXED world size (`SHAFT_LEN`/`RING_R` etc., halved 2026-11-10 at the user's request; thickness kept a bit over half so handles stay easy to hit). It doesn't scale with zoom or body size. The handles are picked by click-then-move, not drag.
- **Face vs work plane picking** — `Viewport3D.handleMouseMoveInternal`'s `faceWins`: a body face under the cursor beats a work plane, even when the plane is nearer (the planes stand through the model, so nearest-wins kept opening sketches on the plane). A plane is still pickable where it sticks out past the bodies. **Mirror's Pick Plane keeps nearest-wins** (`mirrorPlanePickArmedRef`) — picking a plane through the body is its point.
- **No clicks while the camera moves** — `Viewport3D.cameraMoving()` (`tween.active`, `TWEEN_MS` = 420 ms) drops click / double-click / right-click / mouse-down during a camera tween (plane/face pick, view cube, Fit); mouse-up still passes so a drag can't stick.
- **Fit** (`Viewport3D.zoomToFit`, key **F**) — measures every visible vertex in CAMERA space (not a world-axis box), skips hidden bodies, resets the scroll zoom (`camera.zoom = 1`) and slides camera + target together so the view angle stays put.
- **Face DXF** — `projectEdge` (worker) writes lines and view-parallel circles/arcs exactly; any other curve (spline, ellipse, tilted arc) is sampled into ~0.5 mm LINE segments. It used to be ONE start→end chord, which turned spline outlines into a few straight cuts.
- **Top toolbar** (outside a sketch) — FIT, COMPLEX/SIMPLE, MEASURE, FACE DXF, EXPORT STL (moved up from the bottom file bar as the most-used export), X-RAY. STEP export stays in the bottom bar.
- **X-ray** — `xray` state (key **X**) fades solid faces and drops edge depth testing in `Viewport3D`. View-only, never saved.
- **Face sketch frame** — hovering a face draws its frame (`drawSketchFrame`) from `faceHitToPlane(hit, overrideEdge, {frameOnly:true})`, so preview matches click. Sketch origin = the frame's bottom-left corner (round faces: centre). Keep `FacePlane.viewCenter` when copying/offsetting a `FacePlane`.
- **Offset planes** — Extrude/Cutout, Mirror, Sweep and Spring share module-level `resolveOffsetBasis` / `offsetFacePlane` and App3D's `dragOffsetDistance`, `syncOffsetPlanePreview`, `pickOffsetPlane`; each tool keeps only its own `xOffset*` state. Loft uses its own drag-armed mechanism.

### Saving

- **Autosave** — re-writes ~3 s (file) / ~10 s (cloud) after `features`/`solids` settle, ONLY once `projectFileHandleRef` or `cloudProjectIdRef` exists (never opens a picker). `autosaveBaseRef` holds the last text written; manual saves must call `markSaved(kind)`. Toggle: `localStorage['retrocad.autosave']`.
- **Project snapshots (fast open)** — a save is the feature recipe PLUS each body's B-rep (`shape.serialize()`, gzip + base64) in `snapshots:{version, fingerprint, shapes}` (worker `snapshotShapes` / `restoreShapes`). **The recipe is the source of truth; a snapshot is a throwaway cache — any mismatch or failure falls back to full replay, never an error.** Rules: `collectShapeSnapshots` caches per `solid.group` and returns `null` while `cadEngine.pendingCount > 0`; `parseProjectData` accepts snapshots only if `featuresFingerprint` (features minus name/colour/hidden) matches; `saveProjectFileAs` awaits snapshots AFTER the file picker (it needs the click's activation); autosave compares recipe-only text; cloud caps at `CLOUD_SNAPSHOT_BUDGET` (1.5 MB, a guess). **Any new way to change a body must produce a new `solid.group` (go through `replicadMeshToThree`) or the cache goes stale.**

### Classroom website (stem4schools.net)

- **Deploys** — every push to `main` here is built by a GitHub workflow and synced into the website repo (`technically-speaking-website`, served at `/tools/3d-cad/`) about a minute later. Class pages, student pages, imports and the `/api` routes live in that repo, not here.
- **Login prompt** (`AppShell.jsx`) — opening the tool logged out shows Student log in / Continue as guest (+ a teacher link). Guest is remembered per tab in `sessionStorage['retrocad-guest']`; a `?loadProjectId=` link (a teacher's "Open in Retro CAD") skips the prompt. Log in goes to `/student-login?next=…` and returns to the tool; Log out POSTs `/api/auth/logout`. The splash screen ignores Enter/Space while the prompt shows.
- **Cloud save** (`CloudSavePanel.jsx`, `cloudSave.js`) — a student in ONE class always saves to that class (no personal opt-out, so the teacher sees all work); two or more classes get a Save-to dropdown that still offers Personal.
- **Thumbnails** — every cloud write (manual and autosave) attaches `thumbnail` from `Viewport3D.captureThumbnail()` (small JPEG data-URL of the current view; it re-renders first because the WebGL buffer isn't preserved). Returns null on failure and must never block a save. Skipping it on one write would wipe the stored thumbnail.
- **Teacher copy of student work** — when a teacher/admin opens a student's project, App3D enters feedback mode (`feedbackRef` = `{studentId, studentName, sourceId, copyId}`, banner "✎ Editing a copy of X's work" in `AppShell`). Cloud Save then creates a NEW project in the student's folder via `saveFeedbackCopy` (POST `/school-admin/students/:id/projects`, records the source), and later saves/autosave update only that copy (`updateFeedbackCopy`); the student's original is never overwritten. Reopening a copy the teacher made resumes editing it.
- **Account check** — the login cookie is shared by every tab, so another tab logging in as someone else silently changes who saves. `assertSameCloudAccount()` (App3D) compares the logged-in email with `cloudOwnerRef` (who opened/saved the project) before each re-save/autosave and shows a clear "you're now logged in as…" message instead of the server's "Project not found". **Closing the tool and logging back in as the right account fixes it** (confirmed by the user, 2026-11-08).

### Sketch tools

- **Spline point editing** — Select tool + one hand-drawn spline: drag a point, double-click the curve to add, Delete to remove (`splineNodeSel`, `splineNodeDragRef`; in **both** apps). `isEditableSpline` excludes `polyline` and `ghostRef` splines.
- **Shift guide-lock (Line / Axis)** — Shift while an alignment guide shows captures `alignLock` (`captureAlignLock`), honoured at the top of `computeEnd` so preview and commit agree; cleared on Shift up, blur, or `startPoint`/`tool` change. In **both** apps (Line only in App.jsx).
- **Include Edge** — `edgeToSketchGeometry` turns a solid edge into line/circle/arc or one fitted spline (`splineFit.js`); FIRM | CONSTR. (key **C**) decides whether it counts toward profiles. The arc test is deliberately tight. **A curved edge (not LINE/CIRCLE) goes through worker `edgeChain` first**: the edge plus every curved edge flowing smoothly into it (`tangentChain` with an `accept` filter, so lines/circles never join — a rounded rectangle stays lines + arcs), walked end to end and sampled along the TRUE curves, then classified/fitted as one piece (`edgeToSketchGeometry(solidId, edgeId, chainMm)`). Fitting each piece separately from the coarse render-mesh polyline (4–5 points on a gentle curve) left 3–14° kinks between them, and OCC can't fillet an edge that ends at a near-tangent kink — at any radius. Clicks are ignored while the lookup runs (`includeEdgeBusyRef`); all chain edge ids go into `includeEdgeSel`. New worker result fields must also be passed through `cadEngine`'s onmessage (it whitelists them).
- **Finishing Line / Spline** — Enter, double-click or right-click (both apps). In App3D a right-DRAG orbits, so `handleContextMenu` ignores a release >5 px from where the right button went down (`rightDownRef`); that also guards the right-click-to-accept tools.
- **Self-crossing profiles** (App3D) — `profileCrossing(profiles)` finds proper crossings and doubled-back lines (>1 px) within each profile (outer + holes; separate profiles may overlap). `handleFinishSketch` calls `blockCrossingProfile` for Extrude/Cutout/Revolve, Loft, Sweep and Spring: stays in the sketch, rings the spot (`sketchCrossPt`, cleared when the sketch changes) and shows `PROFILE_CROSSING_MSG`; `commitExtrude` re-checks. `detectProfiles` joins segments by endpoints only — it never splits at crossings — so a crossing loop otherwise reaches OCC and fails, and the preview shows hollow walls (caps can't triangulate). Don't tell users to press Esc in the depth step: that discards the sketch.
- **DXF import** — `centreDxfResult(parseDXF(...))` (saveLoad.js) moves the whole drawing's bounding-box centre onto the sketch origin (DXFs usually start at the part's corner), then frames it (`zoomToBox` / `zoomToFit`). Both apps. `parseDXF` reads the header's `$INSUNITS` (`dxfUnits`, `DXF_UNITS` table: inches, feet, cm, m, mils, microns…) and scales to mm; unitless/missing = mm. It returns `units`, and the import alert says when it converted.
- **Dimension to origin axes** (App3D only) — the origin axes aren't entities, so the DIM tool falls back to `originAxisSnap`; near an axis the second point drops perpendicular onto it.

### Solid tools

- **Extrude / Cutout depth step** — live prism preview (`buildExtrudePrismGeometry` over `previewRangeMm`; a cut mirrors `buildExtrude`'s range minus its 1 mm overhang; draft not shown). One way / Both ways / Flip (`directionLocked`). **All button writes go through `updateExtrudeState`, which also sets `extrudeStateRef` synchronously** (Enter right after a click must not read stale state). New body | Join to body when sketched on a body face (`joinableBodyId` → `joinMembers`, target first). To face (`extrudeState.toFace`, `extrudeFaceSnap`; `toFaceOk` keeps a face cut going into the body). New cutouts are always finite depth (Through All only shows when editing an old through-all cut); `defaultCutDepth` seeds the body's thickness.
- **Holes / islands in a profile** — nested loops (`pts.holes`, from `resolveNestedHoles`) are built INTO the extruded face, for Extrude AND Cutout (a ring-shaped cut leaves its island standing): worker `buildExtrude` wraps outline + holes in a replicad `CompoundSketch` and extrudes once (Fusion-style, no boolean cuts). Only a drafted extrude still cuts holes separately afterwards (a draft would taper the hole walls). The rule lives in two places that must agree: worker `holesInFace` and App3D `holesCutSeparately` (used by `rebuildBaseMesh`, both commitExtrude hole loops, and the worker's mirror branch). OCC can't make a face whose hole touches its edge or another hole, so Finish (Extrude and Cutout — `blockCrossingProfile(..., withHoles)`) runs `holeTouching` (< 0.2 px = 0.1 mm) after `profileCrossing`, rings the spot and shows `HOLE_TOUCHING_MSG`; `buildExtrude` rethrows a failed face-with-holes build as the same plain-English reason.
- **Multi-shape cutouts are ONE boolean** — `applyCutoutToTargets` sends every shape touching a body as `subtract({cuts:[...]})`; the worker's `cutTolerant(a, array)` uses OCC's multi-tool cut (`SetArguments`/`SetTools`, copes with overlapping tools) and falls back to one-at-a-time if it fails. `rebuildSolidChain` replays a consecutive run of cutout features sharing a `groupId` the same way (an overridden member goes alone). Still one feature per shape (one tree row via `groupId`). `cutWithFuzzy` refuses a multi-piece result ONLY when nothing was removed (the no-op failure returns target + tool); a through-cut ring legitimately leaves a loose island in the same body.
- **Circle cuts that break OCC are re-cut as arcs** — a true-cylinder cutter (`circle` param → `sketchCircle`, one full-turn face with a seam) can break OCC's boolean: it throws, or reports success but returns a shape whose meshing throws a bare number (seen: holes along a box crossing its bottom face and an end face 0.2 mm off square). The worker's `subtract` checks any cut containing a plain circle cut (`isPlainCircleCut`) with `cutResultUsable` (BRepCheck + a real mesh — cheap, ordinary holes pay only this). On failure it re-cuts the circle in other forms, gentlest first: 2 true arcs, 2 arcs turned 90°, 3, 4 (`circleCutAsArcs` — still exactly round, smooth walls, Fillet follows the rim), last a 96-gon (`circleCutAsPolygon`, faceted walls that make Fillet useless). **No single form is trusted**: the 96-gon multi-tool cut has returned a VALID but wrong body (cut partway, split by a stray face) and disagreed with the round forms on an ordinary edge hole, so a retry is accepted only when two forms remove the same volume (the earlier/smoother of the pair is used; a lone usable form is the last resort). Other cuts skip all of it; replays walk the same ladder. **`SNAPSHOT_FORMAT_VERSION` (saveLoad.js) must be bumped whenever the worker builds a saved recipe differently** (v2 for this), or cached shapes keep the old result.
- **Cuts that silently do nothing** — a cutter tangent to a wall can give a *valid* result that removed ~nothing. `cutTolerant` re-measures overlap at 0.5 mm fuzzy when a cut removes <2% and redoes it only if that removes the matching volume. Don't raise the normal 0.05 mm fuzzy value — it swallows thin walls.
- **Revolve / Revolve Cut** — no axis drawn ⇒ an origin axis the profile doesn't cross (`originRevolveAxis`, stored as `revolveAxis` with `preset`). `profileCrossesAxis` blocks crossings. Direction is the one `revolveReverse` field (`false` CCW, `true` CW, `'both'` centred) — always go through `revolveRangeDeg` / `revolveWorkerDir`.
- **Loft** — NEXT SHAPE chips (`loftState.nextMode` draw/copy/point). Copied/tip profiles scale `pts` directly (`scalePtsAbout`), NOT through `detectProfiles` (its `CLOSE_TOL = 4` px drops tiny loops). `commitLoft(stOverride)` — never pass it straight as an `onClick`. Step 1 has Hide Planes (work planes steal face picks). **Loft Cut from a face negates `normal`, which mirrored the profile in the worker's `Plane(origin, uAxis, normal)`; every loft call therefore sends `viewNormal` (true outward normal) — pass it on any new loft call.** Old files without it use the old path.
- **Sweep** — finishing the profile arms a confirm popup (`sweepState.armed`, preview via `sweepWorkerFields(st)`, Done → `commitSweep(st.path, st.profile)`, "✎ Sketch" → `sweepEditSketch`). A path projected onto a body is stored as `pathPts3d` (+ `projDir`) instead of `pathPts` — anything keyed on `pathPts` must handle both; ray-cast points must be smoothed (`smoothPoints3d`) or the pipe-shell sweep fails. No edit path / Join.
- **Spring / Spring Cut** — sketched like Revolve (wire profile + optional axis line) → popup (`springState.armed`). `springSpec`/`springProblem` feed preview and `commitSpring`; **`springWorkerParams(src)` is the ONE place that builds worker params.** Worker `buildSpringAxial` Frenet-sweeps the profile as drawn along a helix guide (`forceProfileSpineOthogonality:false`). Wire thickness along the axis must be < pitch and the wire may not touch the axis. **Springs saved without `springAxis` rebuild via the old `buildSpringHelixFirst` — keep it.** A spring cut is detected by `pitchMm !== undefined` and its param is `springAxis`, NOT `axis` (which routes to `buildRevolve`). Slow (~5 s build, ~10 s cut). No edit path / Join.
- **Fillet** — no Lock step (`fillet3dAccepted` = `fillet3dSel.length>0`). A click is resolved by the worker (`cadEngine.filletEdges`): a face → all its roundable edges, an edge → itself + its tangent chain (`tangentChain`) unless Smooth Chain is off. On failure `cadEngine.filletMaxRadius` (bisection) pre-fills the largest working radius. Picked = yellow, hover = orange (shared with Soften). Editing an existing fillet disables picking.
- **Soften** — body → mode (`soften3dMode`: `'face'` keep faces flat, `'all'`, `'edges'`) → radius; commit always sends an explicit edge list (`softenEdges` worker message fills it for face/all). Worker `softenAll` finds the biggest rung of a radius ladder (target, /2, /4 … 0.4 mm) per edge and returns rungs saved as ordinary `type:'fillet'` features ("Soften N"); un-roundable edges come back as `leftover`. **Every rounding is checked by `softenLooksRight`** (OCC can return valid-but-wrong spikes): reject if it grows past the old bbox, or removes far more volume than expected AND that doesn't scale with radius². Don't replace it with a plain volume cap — rounding along smooth chains legitimately removes 3–5× more. ~30–100 ms per trial; 60 s budget.
- **Join / Subtract** — Subtract (`subtract3d`) is stored as a Join (`operation:'join'`, `booleanOp:'subtract'`, target first) so locking (`joinedInto`), delete = restore, and rebuild reuse Join code. The worker refuses a hole body that removes nothing. `rebuildJoinBaseMesh` pre-builds members with a `transform` via `rebuildFeatureSolid` and keeps subtract pick order.
- **Mirror** — `cadEngine.mirrorShape` rebuilds a plain source from its sketch (`base`/`ops`), which puts it back where it was DRAWN; the source's Move/Rotate must go along as `sourceTransform` and the worker replays it before mirroring. **That transform is snapshotted on the mirror feature when it is made** (`feature.sourceTransform`, `null` = unmoved) and every rebuild uses `mirrorSourceTransform(mirrorFeat, sourceSolid)` — so moving the source later does NOT drag the mirror (the user wants them independent). Mirrors saved without the key fall back to the source's current transform, and a source Move freezes them at the pre-move transform. Sketch/shape edits of the source still rebuild the mirror (`rebuildDependentMirrors`, which also re-applies the mirror's own `transform`). A Join/Mirror source is read from `shapeStore` (moves already baked in, cloned first).
- **Pattern** — copies come from `createTransformedCopy` and share the source's `groupId` (one "× N" tree row). A cutout pattern stores `patternXform` on each copy; the worker's `applyCutXform` applies it.

### Drawing tab — orthographic views

- `computeOrthoViews` (worker) uses OpenCascade hidden-line removal (`hlrViewEdges`, all bodies in ONE run). **Never put shapeStore shapes in a compound — that deletes them.** Hidden edges come back `style:'dashed'`; flat runs (circles seen edge-on) become lines (`straightRun`). Centre-line axes come from `roundAxes` (cylindrical faces grouped by axis + radius, kept if they wrap ≥180°, so fillets are excluded).
- `OrthoViewsPanel` → `tidyView` (visible beats hidden in the same place, no duplicates) → `layoutOnSheet` at a standard scale (`autoScale` picks the biggest `DRAWING_SCALES` entry fitting the page; 20 mm paper gap), centred on the origin where the page sits. Centre lines are `style:'center'` (a full style alongside `'dashed'`: canvas `applyEntityStyle`, PDF `applyStyle`, DXF CENTER). Labels and the scale note are line entities from `strokeFont.js` with `text:true` (no end dots).
- **Drawing-tab dimensions** — the DIM button's flyout (`DimPanel.jsx`, state `dimMode`: `hv` | `aligned` | `circle` | `angle` | `chain` | `baseline` | `hole` | `note`) makes kinds `ortho` {x1,y1,x2,y2,orient,pos}, `linear` (aligned), `diameter`/`radius`, `angle` {cx,cy,start,sweep,r,reach}, `hole` {cx,cy,r,angle,count} (`holeCount`: same-radius circles in the same `view`), `leader` {x1,y1,x2,y2,text}. Chain/Baseline place ordinary `ortho` dims: after the first one `dimChain` holds the run (`nextRunDim`; baseline steps out by 2× text height + 1 mm), Enter/Esc/FINISH ends it. **Auto sizes** = `overallDimsForViews` (dimGeometry.js): needs the `view` tag that `layoutViews` puts on every generated entity — front gets width (below its label) + height (left), depth once (top view left, else right view below). **All drawing of a dimension goes through `dimPrimitives(dim, dimStyle)` in `src/tools/dimGeometry.js`** → lines (text included, as stroke-font lines), arcs, filled arrows; the canvas, PDF (`drawDimPDF`) and DXF (`exportDXF(..., {dims, dimStyle})`, DIMENSIONS layer) all draw those, and hover/delete use `distToDim`. Sizes are paper mm (`dimStyle.textMm`), so they zoom with the drawing. `dimStyle {decimals, units, textMm}` is sheet-wide and saved with the sheet (default 0 decimals, no units; old sheets with dims load as 2 decimals + mm). The 3D tab's `PageSetupPanel` passes no `dimStyle` → `LEGACY_DIM_STYLE`. In H/V mode the H/V keys lock the direction (handled before H's dashed-line toggle).
- **Dimensions read real size** — view entities carry `viewScale`; the DIM tool copies it to `dim.scale` (from the picked circle/arc, or via `viewScaleNear` for linear dims) and every dim text (canvas, preview, PDF) is `pxToMm(len) / (dim.scale || 1)`, independent of the PDF print scale.

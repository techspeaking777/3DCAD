# Plan: edit any feature, everything after it updates

**Status:** approved 2026-11-15, with the decisions at the end. **Session 1 is done (2026-11-16):**
- broken steps are skipped and marked red, and the body keeps the rest
- the dependency map is in `src/tools/featureDeps.js`
- the "couldn't update" message and busy banner are in
- one-step undo already worked

The downstream rebuild beyond a body's own steps and mirrors (face sketches, patterns, joins) arrives with Sessions 2 and 3. Session 2 is next.

**Why:** students often want to change something they made earlier, like a base size, a sketch line, or a hole position. Today the teacher often goes in and does it for them. The goal is the parametric "change 50 to 60 and the whole model updates" moment from Fusion and Onshape, without Fusion's complexity.

**In scope:**
- **Stage 1:** editing any feature updates everything built after it, and anything that can't update is clearly flagged.
- **Stage 1b:** sketch lines can be resized without wrecking the shape (the "follow-the-corner" rules), and later clickable driving dimensions.

**Not in scope (parked):**
- a Fusion-style rollback bar or timeline
- a full sketch constraint solver (parallel, tangent, equal and so on)

Either can be revisited once 1 and 1b are in students' hands.

---

## Part A — Stage 1: edit history

### A1. What happens today

Audited from the code on 2026-11-15. Items marked *(to confirm)* get checked with real files in step A8 before any changes.

| When a student edits… | What updates now | What doesn't |
|---|---|---|
| A body's sketch or depth (Extrude, Revolve) | The body itself, plus its own cutouts, fillets and shell, replayed in order (`rebuildSolidChain`); mirrors of it (`rebuildDependentMirrors`) | Sketches drawn on its faces stay where the face *was* (a face sketch stores a copy of the plane, not a link to the face). Fillets look for their edges at the old positions *(to confirm: does the body fail, or does the fillet silently drop?)* |
| A cutout's sketch or extent | The body it cuts, replayed | Pattern copies of that cutout keep the old shape: each copy is a full copy of the original feature plus an offset (`patternXform`) |
| A fillet radius, shell thickness, loft | That body | — |
| A body inside a Join or Subtract | — | It can't be edited at all while joined (locked by design) |
| Sweep, Spring | — | No edit path yet |

So the app is already partly parametric. What's missing is that edits don't reach across to other features: face sketches, pattern copies, joins, and fillet edges after something moves.

### A2. How it will work

1. **A dependency map.** For each feature, record what it depends on:
   - its base body
   - the body whose face it was sketched on
   - a mirror's source
   - the members of a Join or Subtract
   - a pattern's original

   All of this can be worked out from data the features already store (`solidId`, `facePlane.solidId`, `sourceSolidId`, `memberFeatureIds`, `groupId`), so no change to the save format is needed for this part.
2. **After an edit is confirmed,** find every feature that depends on it, directly or indirectly, and rebuild them in their original order, reusing the existing rebuild code.
3. **Anything that can't rebuild is never deleted or silently dropped.** It is:
   - marked **broken**: a red row in the Feature Tree with a plain-English reason, such as "Fillet 2 couldn't find its edges after Extrude 1 changed"
   - shown with an ✎ button that opens the right tool to fix it, and a ✕ to delete it

   The rest of the model still builds without it. A message after the edit says how many features couldn't update.
4. **One undo step** reverses the whole edit, the original change plus everything that rebuilt after it.
5. **A busy banner** ("Updating 6 features…") appears if it takes more than a moment. The heavy projects in the replay set take 5 to 13 s.

### A3. Sketches on faces follow their face

Today a face sketch stores a copy of the face's plane. The change:
- also store which body it came from (already there) and a point on the face
- after the parent body rebuilds, find the face again: the face of that body nearest the stored point, facing the same way
- move the sketch plane to it, so the sketch rides along

If no matching face is found, for example because the face was cut away, the sketch is marked broken with "the face this was drawn on has gone — pick a new face".

### A4. Fillets and chamfers find their edges again

Fillets remember their edges by position (`edgePoints`). After an upstream change, they try these in order:
1. the same positions (unchanged edges)
2. the positions moved by however much the face they're on moved
3. the nearest edge of the same kind, line or arc, running the same direction

If none works, the fillet is marked broken, and its ✎ reopens the Fillet tool with the edges it *did* find already picked, so the student just adds the missing ones.

### A5. Pattern copies follow their original

Pattern copies store only their offset from the original, not a full copy of it. Rebuilding a copy takes the original's *current* shape plus the offset. Old files with full copies keep working: they're read as before, then converted the first time the pattern is edited.

### A6. Bodies inside a Join or Subtract can be edited

The ✎ is allowed on a joined member. On confirm, the member and then the Join or Subtract are rebuilt, using the same Join replay that opening a project already uses.

### A7. Sweep and Spring

These have no edit path yet, which is a separate job. Here they only need to rebuild correctly when something they depend on changes. That already happens when a project opens, so the same code is reused.

### A8. Testing

**Before any change:**
- re-run the replay harness and confirm the baseline
- add test projects (built here, not student work) for each dependency kind: face sketch, fillet on an edited body, cutout pattern, mirror, join member, subtract

**After each step:**
- the whole replay set must match the baseline: no body changes shape unless the step is meant to change it
- every test project is edited in the browser, and the rebuilt result is checked with the health readout (Ctrl+Shift+H)

---

## Part B — Stage 1b: change a line without wrecking the shape

### B1. The problem

**Today**, changing the top line of a 100 × 60 rectangle to 120 in the Select panel keeps the line's middle fixed and pulls the joined corners along. The sides tip over, so you get a trapezoid:

```
Today:                 Wanted:
   ________               ________
  /        \             |        |
 /          \            |        |
 ------------            ----------
```

### B2. The "follow-the-corner" rules

1. **Straight lines stay straight.** A line drawn horizontal or vertical (snapped) is tagged H or V, and the tag is kept. A line in an older project that is exactly horizontal or vertical counts as tagged. Dragging a line off-axis removes its tag.
2. **One end stays put.** By default it's the end nearest the sketch origin, so the shape grows away from the origin, like Fusion. If both ends are equally near, the left end stays put (the bottom end for a vertical line). The anchor dots in the Select panel (left, middle or right) can override that.
3. **At each corner the moved end reaches, decide stretch or slide:**
   - **Stretch:** if the move runs along the next line's own direction, that line just stretches, and the change stops there.
   - **Slide:** if the move would tilt an H or V line, the whole line slides sideways and stays straight. Its far end passes the move on to the next corner.
   - **Sloped lines** (no tag) stretch and tilt, as today.
   - **Arcs and rounded corners** slide with the line they're attached to, so a rounded rectangle stays rounded and tangent.
   - **Splines** move their joined end only, as today.
4. **If the change would have to move the fixed end,** for example when the change travels all the way round a closed loop, nothing changes. Instead the panel says: "That would move the fixed corner — choose the other end to stay put."

### B3. Worked examples

- **Rectangle, top line 100 → 120:**
  1. The right corner moves 20 mm right.
  2. The right side would tilt, so it slides 20 mm right.
  3. Its bottom end moving right is along the bottom line, so the bottom stretches.
  4. Result: a 120 × 60 rectangle.
- **L-shape, bottom line longer:** the short right side slides and the step above stretches. The L gets wider at the bottom only.
- **Rounded rectangle:** as for the rectangle, and the rounded corners slide with the sides.
- **Trapezoid with sloped sides:** the sloped sides stretch and tilt, which is the expected result for a shape with no right angles.
- **A line whose both ends are joined into a closed loop, with the fixed end on the loop:** refused with the message above.

### B4. Where it applies

1. **First:** the Select panel's Length and Angle boxes, which students already use. Both the 3D sketch and the Drawing tab get it.
2. **Then (B5):** clickable driving dimensions.
3. **Together with Stage 1:** changing a sketch this way, then confirming, updates the extrude and everything after it.

### B5. Driving dimensions (second half of 1b)

- **Editable values:** the DIM tool's dimensions in a 3D sketch become editable. Click the number, type a new value, and the same follow-the-corner rules move the geometry.
- **Driving or reference:** a dimension the student places is *driving* (normal text). A *reference* dimension (measure only) shows grey in brackets, as in real CAD.
- **Stable ids needed:** dimensions have to point at the lines they measure. Sketch entities are currently identified by their position in a list, which changes when anything is deleted, so each line, arc and circle needs a stable `id`. It's added on load to older sketches. This is the one save-format change in 1b.
- **Changing values that clash:** when two driving dimensions on the same shape would disagree, the new value is refused with a plain message rather than "solved".

---

## Part C — Order of work

Each session ends with lint, browser tests and the replay set matching its baseline, then waits for "commit and push".

| Session | Work | Result students see |
|---|---|---|
| 1 | A8 test projects, A2 dependency map + downstream rebuild + broken marking + one-step undo + busy banner | Editing a body updates its mirrors, cuts and fillets everywhere; failures show in red instead of vanishing |
| 2 | A3 face sketches follow their face, A4 fillets re-find edges | Change a base size: the boss sketched on top and its fillets follow |
| 3 | A5 pattern copies follow, A6 edit joined members | Edit a patterned hole once; edit a body inside a Join |
| 4 | B1–B4 follow-the-corner rules in both tabs | Resize a rectangle's side in the Select panel and it stays a rectangle |
| 5 | B5 driving dimensions + stable ids | Click a dimension, type a value, and the sketch and model update |

## Risks

- **Topological naming** (fillets and face sketches losing their place) is the hardest part. A3 and A4 handle the common cases. The rest become clearly flagged red items rather than wrong geometry.
- **Speed:** heavy projects take 5 to 13 s to rebuild. Session 1 rebuilds only what depends on the edit, not the whole project.
- **Old projects** must open and behave exactly as before. The replay baseline checks this after every step.

## Decisions (agreed 2026-11-15)

1. **Broken features stay in the tree, red and skipped.** The rest of the model still builds, like Fusion. Each broken row has:
   - its ✎ to fix it
   - a ✕ to delete it

   When an edit leaves anything broken, a message says so, for example "2 features couldn't update — they're marked red in the tree".
2. **The fixed end is the end nearest the origin** (decided by Claude). The shape grows away from the origin, as in Fusion, where sketches usually start at the origin. If both ends are the same distance away, the left end stays put (or the bottom end, for a vertical line). The Select panel's anchor dots still override it.
3. **H/V marks are visible.** A small "H" or "V" sits beside each tagged line while sketching, so students can see why lines stay straight. It may become a proper icon later.
4. **Bodies inside a Join or Subtract are editable.** Editing one rebuilds it and then the Join or Subtract it belongs to.

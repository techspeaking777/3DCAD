# Retro CAD

A browser-based 3D CAD tool for students — a bridge between Tinkercad and Fusion 360 ("Depth in Simplicity"). No sign-in, nothing to install: sketch on a plane or a face, then extrude, revolve, loft, sweep, spring, fillet, shell, mirror, pattern and join, with a Simple/Complex toggle to hide the advanced tools. Exports STL, STEP and DXF.

Built with React, Vite, Three.js and [replicad](https://replicad.xyz) (OpenCascade compiled to WebAssembly, running in a Web Worker).

## Getting started

```bash
npm install
npm run dev       # dev server with hot reload (http://localhost:5173)
npm run build     # production build into dist/
npm run preview   # serve the production build locally
npm run lint      # ESLint over src/
```

The CAD engine takes a few seconds to start the first time the page loads. Editing `src/cadWorker.js` restarts the worker and reloads the page.

## Layout

| Path | What it is |
|---|---|
| `src/AppShell.jsx` | Top bar and the two tabs: **3D MODEL** (`App3D.jsx`) and **DRAWING** (`App.jsx`, a flat 2D drawing app) |
| `src/App3D.jsx` | The 3D app: feature tree, sidebar, step bar, all solid and sketch tools |
| `src/Viewport3D.jsx` | The Three.js viewport (solids, work planes, face-hover frame, ViewCube hooks) |
| `src/cadWorker.js`, `cadEngine.js`, `cadMesh.js` | OpenCascade worker, its promise-based wrapper, and mesh → Three.js conversion |
| `src/tools/` | Pure tool maths (offset, mirror, pattern, sweep projection, …) and the overlay panels |
| `src/geometry/`, `src/draw/` | Snapping and intersection maths; canvas helpers and SVG tool icons |

For a deeper tour (coordinate systems, the feature/replay model, gotchas), read [`CLAUDE.md`](./CLAUDE.md).

## Notes

- **Deployment is automatic.** Every push to `main` runs `.github/workflows/deploy.yml`, which builds the app, publishes it to GitHub Pages, and copies the build into the website repo (`technically-speaking-website`, under `public/tools/3d-cad/`). Pushing to `main` therefore updates the live site.
- Cloud save needs the classroom website's `/api` and only works when this app is served from that site; in standalone `npm run dev` it quietly reports "unavailable".

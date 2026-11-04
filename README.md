# STL Viewer

An offline STL viewer for PC, Android and iPad, built with three.js and Vite.

## Status

All 4 planned steps are done: viewer, library, tools, and installable offline app.

## Features so far

- Open an STL with the button or by dragging it onto the window (binary and ASCII)
- Orbit, zoom and pan with mouse or touch, plus Iso / Top / Front / Right views
- Solid, wireframe, X-ray and normals render modes
- Model color, background color, three lighting presets, smooth or faceted shading
- Build plate grid, bounding box, axes, auto-rotate
- Model info: triangle count, X/Y/Z size, volume, surface area, estimated solid PLA weight

## Library

- **Add folder** (Chrome/Edge on PC and Android): pick a folder once and it's remembered. Files stay where they are and subfolders are scanned. After a browser restart you may need to tap **Reconnect** to re-grant read access.
- **Import files / Import a whole folder** (works everywhere, and it's the only option on iPad): files are copied into the app's own storage.
- Thumbnail grid, list, and sortable details views, with search across names and folders
- Thumbnails and stats are generated once in the background and cached

## Tools

- **Measure**: tap two points on the model to get the distance plus ΔX/ΔY/ΔZ. Measurements stay until you clear them.
- **Section cut**: slice along X, Y or Z with a slider. Cut faces show in orange, and you can flip which half is kept.
- **Compare**: in the library hit Compare, pick 2 to 6 files, and they sit side by side on one build plate at true scale, each with its own color and label.
- **Favorites and tags**: star files in the library or viewer, and tag them from the viewer panel. You can filter by favorites or by tag, and search matches tags too.
- **Screenshot**: 📷 saves a PNG. On phones and tablets it opens the share sheet so you can save to Photos.

## Install it (works offline afterwards)

The app has to be opened once from an https address (see Hosting). After that:

- **PC (Chrome/Edge):** click **⬇ Install** in the library toolbar, or the install icon in the address bar. Once installed, you can right-click an `.stl` and pick *Open with → STL Viewer*.
- **Android (Chrome):** tap **⬇ Install**, or use the menu and pick *Add to Home screen*.
- **iPad (Safari):** tap **⬇ Install** for the steps. In short: Share, then *Add to Home Screen*.

Everything (app code, thumbnails, imported files, tags) is stored on the device. When a new version is deployed, the app shows *"A new version is ready"* with an **Update** button.

## Hosting

`.github/workflows/ci.yml` runs the tests and build on every PR. On pushes to `main` it also deploys `dist/` to GitHub Pages. Turn it on under **Settings → Pages → Source: GitHub Actions**. Any other static host (Netlify, Cloudflare Pages) works too: build command `npm run build`, output folder `dist`.

## Develop

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # production build in dist/
```

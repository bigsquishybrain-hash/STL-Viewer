# STL Viewer

An offline STL viewer for PC, Android and iPad, built with three.js and Vite.

## Status

Step 2 of 4: viewer plus file library. Extra tools and offline install come next.

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

## Develop

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # production build in dist/
```

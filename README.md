# STL Viewer

An offline STL viewer for PC, Android and iPad, built with three.js and Vite.

## Status

Step 1 of 4: the 3D viewer. Library browsing (thumbnails, lists), extra tools, and offline install come next.

## Features so far

- Open an STL with the button or by dragging it onto the window (binary and ASCII)
- Orbit, zoom and pan with mouse or touch, plus Iso / Top / Front / Right views
- Solid, wireframe, X-ray and normals render modes
- Model color, background color, three lighting presets, smooth or faceted shading
- Build plate grid, bounding box, axes, auto-rotate
- Model info: triangle count, X/Y/Z size, volume, surface area, estimated solid PLA weight

## Develop

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # production build in dist/
```

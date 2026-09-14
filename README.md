# Isometry

A desktop web app for generating isometric drawings from grid-aligned seed strokes, connections, and solid surfaces. Six algorithms expose repeatable seeds and adjustable density, clustering, direction, branching, loops, and symmetry. Additional controls vary pocket count and contrast, layer spacing, stroke lengths, path complexity, branch reach, and the share of each orientation. City of Walls exposes enclosing bands and clearance. Bridged structures exposes beam count and terminal layers. Sliders redraw the artwork during the drag, with one undo step per adjustment. Reference palettes support flat fills and hatching. Optional ink buildup adds fine grain, darker edges, and corner pooling. A separate paper texture adds faint procedural grain. The finishes start at subtle intensities and carry through to SVG and PNG exports. Depth shading adds local cast shadows and shade inside recesses. Each effect has its own toggle and intensity control. Paper grain sits behind the grid. Export has an independent option to include the grid.

The construction timeline reveals seed lines, connections, solid geometry, and shading. Live shading is optional. Drawings autosave in browser storage and export to SVG or PNG. SVG exports include the recipe in their metadata.

## Run locally

Use Node.js 22.13 or later.

```sh
pnpm install
pnpm dev
```

The development command prints the local URL. The app needs no account or application database. Its saved drawing belongs to that browser and origin.

## Construction model

Seed strokes use integer grid coordinates. Connection rules extend them along the three axes. Each stroke contributes positive-thickness solid cells. Projection resolves visibility on a shared triangular lattice, then merges coplanar fragments into vector face boundaries, including holes and their inner surfaces. Contiguous surfaces with the same plane and rendered material merge across construction and palette groups. Same-colored surfaces at different depths keep their borders.

The Allow islands toggle controls detached structures. Disabling it preserves the seed geometry and adds solid connecting strokes. Each orientation forms a connected structure, and the two orientations meet at a solid junction with a shared depth anchor. Unfinished construction can still contain disconnected lines.

The alternate orientation supports underside reversal, a quarter-turn, or their combination. Both groups share a paper projection. Each group resolves its own visible faces and depth direction around a shared depth anchor. This permits intentionally impossible combinations of upper-facing and underside views. Face family, orientation, and palette region are distinct data. The bridged-structures recipe gives the warm and cool segments one orientation and the neutral crossing wall the other. Shared spatial pockets correlate nearby structures’ positions, proportions, and direction biases. Construction replay reconstructs solid geometry from the operation prefix, so intermediate states follow the same construction data as the completed drawing.

The generator covers automated construction. Direct line editing and lasso-based orientation repair are planned extensions.

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm build
```

The core geometry has been checked with single cubes, merged blocks, thick openings, point-touching face boundaries, and deterministic replay across all algorithms, orientations, and thickness settings. Browser checks cover drawing controls, autosave, playback, and exports.

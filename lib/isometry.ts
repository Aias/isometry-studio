import { z } from "zod";
import { connectedComponents, connectingPaths, hasJoinedOrientations } from "./connectivity";
import { countFreeEnds, resolveFreeEnds, strokeCells } from "./termination";

export const recipeSchema = z.object({
  algorithm: z.enum(["meanders", "combs", "terraces", "frames", "enclosure", "bridge"]),
  seed: z.string().max(80),
  density: z.number().min(10).max(100),
  clustering: z.number().min(0).max(100).default(65),
  allowIslands: z.boolean().default(true),
  pocketCount: z.number().int().min(1).max(8).default(3),
  pocketContrast: z.number().min(0).max(100).default(65),
  layerGap: z.number().int().min(0).max(10).default(3),
  lengthVariation: z.number().min(0).max(100).default(45),
  pathSteps: z.number().int().min(1).max(12).default(5),
  branchReach: z.number().int().min(1).max(10).default(4),
  freeEnds: z.number().int().min(0).max(6).default(2),
  alternateShare: z.number().min(0).max(100).default(50),
  wallBands: z.number().int().min(2).max(9).default(4),
  enclosureMargin: z.number().int().min(1).max(10).default(3),
  bridgeBeams: z.number().int().min(1).max(6).default(2),
  terminalTiers: z.number().int().min(1).max(7).default(3),
  length: z.number().min(2).max(12),
  height: z.number().min(6).max(24),
  spread: z.number().min(10).max(30),
  branching: z.number().min(0).max(100),
  loops: z.number().min(0).max(100),
  irregularity: z.number().min(0).max(100),
  vertical: z.number().min(0).max(100),
  depth: z.number().min(0).max(100),
  symmetry: z.number().min(0).max(100),
  thickness: z.number().int().min(1).max(2),
  orientation: z.enum(["above", "below", "both"]),
  orientationChange: z.enum(["reverse", "turn", "reverse-turn"]).default("reverse-turn"),
});

export type Recipe = z.infer<typeof recipeSchema>;
export type Point = { x: number; y: number; z: number };
export type GridPoint = { u: number; v: number };
export type Orientation = 1 | -1;
export type Family = "x" | "y" | "z";
export type PaletteGroup = "primary" | "secondary" | "neutral";
export type Stroke = { a: Point; b: Point; context: number; paletteGroup: PaletteGroup; kind: "seed" | "connection" };
export type Cell = Point & { born: number; context: number; paletteGroup: PaletteGroup };
export type Context = { viewDirection: Orientation; quarterTurn: boolean; depthOrigin: number; depthOffset: number };
export type Scene = { cells: Cell[]; strokes: Stroke[]; contexts: Context[]; recipe: Recipe; bounds: Bounds; freeEnds: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type Triangle = { points: [GridPoint, GridPoint, GridPoint]; depth: number; receiver: Point; plane: string; family: Family; context: number; paletteGroup: PaletteGroup };
export type Face = { id: string; plane: string; d: string; family: Family; context: number; paletteGroup: PaletteGroup; area: number; rings: GridPoint[][] };
export type Drawing = { faces: Face[]; shadows: { d: string; strength: number }[]; triangles: number; visibleCells: number };

export const unit = 20;
export const defaultRecipe: Recipe = {
  algorithm: "meanders", seed: "ISOMETRY-037", density: 60, clustering: 65, length: 7, height: 17,
  spread: 20, branching: 40, loops: 65, irregularity: 45, vertical: 60, depth: 25,
  allowIslands: true, pocketCount: 3, pocketContrast: 65, layerGap: 3, lengthVariation: 45,
  pathSteps: 5, branchReach: 4, freeEnds: 2, alternateShare: 50, wallBands: 4, enclosureMargin: 3, bridgeBeams: 2, terminalTiers: 3,
  symmetry: 0, thickness: 1, orientation: "above", orientationChange: "reverse-turn",
};

export const algorithms = [
  { id: "meanders", name: "Interwoven paths", description: "Turning strokes, bridges, and open frames." },
  { id: "combs", name: "Vertical combs", description: "Parallel uprights with staggered connections." },
  { id: "terraces", name: "Terraced bands", description: "Long ledges, repeated steps, and narrow slots." },
  { id: "frames", name: "Frame studies", description: "Nested openings and suspended rectangular frames." },
  { id: "enclosure", name: "City of walls", description: "A dense interior held between enclosing walls." },
  { id: "bridge", name: "Bridged structures", description: "Two compact structures joined by long beams across a framed wall." },
];

export function randomSource(seed: string) {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

const cellKey = (point: Point) => `${point.x},${point.y},${point.z}`;
const pointKey = (point: GridPoint) => `${point.u},${point.v}`;
export const screen = (point: GridPoint) => ({ x: point.u * Math.sqrt(3) / 2 * unit, y: point.v / 2 * unit });
export function project(point: Point): GridPoint {
  return { u: point.x - point.y, v: point.x + point.y - 2 * point.z };
}
export function rotatePoint(point: Point, center: Point): Point {
  return { x: center.x + point.y - center.y, y: center.y - point.x + center.x, z: point.z };
}

export function generate(recipe: Recipe): Scene {
  const random = randomSource(recipe.seed);
  const integer = (low: number, high: number) => Math.floor(low + random() * (Math.max(low, high) - low + 1));
  const chance = (percent: number) => random() * 100 < percent;
  const H = Math.round(recipe.height * (recipe.algorithm === "enclosure" ? 1.7 : 1));
  const W = Math.round(recipe.spread * (recipe.algorithm === "enclosure" ? .7 : 1));
  const T = recipe.thickness;
  const alternate: Context = {
    viewDirection: recipe.orientationChange === "turn" ? 1 : -1,
    quarterTurn: recipe.orientationChange !== "reverse", depthOrigin: 0, depthOffset: 0,
  };
  const contexts: Context[] = [
    recipe.orientation === "below" ? { ...alternate } : { viewDirection: 1, quarterTurn: false, depthOrigin: 0, depthOffset: 0 },
    alternate,
  ];
  const rows = Math.max(2, Math.round(recipe.algorithm === "enclosure" ? recipe.density / 22 : 2 + recipe.density / 22));
  const spacing = T + recipe.layerGap;
  const center = { x: Math.round(W / 2), y: Math.round((rows - 1) * spacing / 2), z: 0 };
  const strength = recipe.clustering / 100;
  const blend = (value: number, target: number) => value + (target - value) * strength;
  const clusterCoordinate = (value: number, target: number, extent: number) => Math.max(0, Math.min(extent, Math.round(value + (target - value) * strength * .85)));
  const contrast = recipe.pocketContrast / 100;
  const variedLength = (length: number) => Math.max(T + 1, Math.round(length * (1 + (random() * 2 - 1) * recipe.lengthVariation / 100)));
  const makePocket = () => ({ x: integer(0, W), y: integer(0, (rows - 1) * spacing), z: integer(0, H), scale: 1 + (random() * 2 - 1) * contrast, vertical: 50 + integer(-50, 50) * contrast, fullness: 1 + (random() * 2 - 1) * contrast });
  const firstPocket = makePocket();
  const pockets = [firstPocket, ...Array.from({ length: recipe.pocketCount - 1 }, makePocket)];
  const pocketAt = (index: number) => pockets[index % pockets.length] ?? firstPocket;
  const strokes: Stroke[] = [];
  const occupancy = new Map<string, Cell>();
  function addStroke(a: Point, b: Point, context: number, kind: Stroke["kind"], paletteGroup: PaletteGroup) {
    if (cellKey(a) === cellKey(b)) return;
    const born = strokes.length;
    const stroke = { a, b, context, kind, paletteGroup };
    strokes.push(stroke);
    for (const cell of strokeCells(stroke, T)) {
      const key = `${context}:${cell.x},${cell.y},${cell.z}`;
      if (!occupancy.has(key)) occupancy.set(key, { ...cell, born, context, paletteGroup });
    }
  }
  const seeds: Stroke[] = [];
  const connections: Stroke[] = [];
  function placeLine(a: Point, b: Point, context: number, kind: Stroke["kind"], paletteGroup: PaletteGroup = context === 1 ? "secondary" : "primary") {
    const target = kind === "seed" ? seeds : connections;
    target.push({ a, b, context, kind, paletteGroup });
  }
  function line(a: Point, b: Point, context = 0, kind: Stroke["kind"] = "seed") {
    const turned = contexts[context]?.quarterTurn;
    placeLine(turned ? rotatePoint(a, center) : a, turned ? rotatePoint(b, center) : b, context, kind);
  }
  function wallPath(points: Point[], context = 0) {
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      if (a && b) line(a, b, context, index % 2 ? "seed" : "connection");
    }
  }
  for (let row = 0; row < (recipe.algorithm === "bridge" ? 0 : rows); row++) {
    const rowPocket = pocketAt(Math.floor(row / 2));
    const y = clusterCoordinate(row * spacing, rowPocket.y + row % 2 * (T + 1), (rows - 1) * spacing);
    const context = recipe.orientation === "both" && recipe.algorithm !== "enclosure" && row >= Math.round(rows * (1 - recipe.alternateShare / 100)) ? 1 : 0;
    const count = Math.max(2, Math.round(recipe.density / 16 * blend(1, rowPocket.fullness)));
    if (recipe.algorithm === "combs") {
      const tops: Point[] = [];
      for (let column = 0; column <= count; column++) {
        const pocket = pocketAt(Math.floor(column / 3) + Math.floor(row / 2));
        const x = clusterCoordinate(column * W / count, pocket.x + (column % 3 - 1) * (T + 1), W);
        const height = Math.max(T + 2, Math.round(blend(chance(recipe.irregularity) ? integer(3, H) : H - row % 3 * 2, Math.min(H, pocket.z + recipe.length * pocket.scale))));
        const bottom = Math.min(height - T - 1, Math.max(0, Math.round(blend(chance(recipe.irregularity) ? integer(0, Math.floor(height / 3)) : 0, pocket.z - recipe.length * pocket.scale))));
        line({ x, y, z: bottom }, { x, y, z: height }, context);
        tops.push({ x, y, z: integer(bottom + 1, height) });
      }
      for (let index = 1; index < tops.length; index++) {
        const a = tops[index - 1], b = tops[index];
        if (a && b && Math.abs(a.x - b.x) > recipe.length * 1.5 && chance(recipe.clustering * .8)) continue;
        if (a && b) line(a, { x: b.x, y, z: a.z }, context, "connection");
        if (a && b && chance(recipe.loops)) line({ x: a.x, y, z: Math.max(0, a.z - 3 - T) }, { x: b.x, y, z: Math.max(0, a.z - 3 - T) }, context, "connection");
      }
    } else if (recipe.algorithm === "terraces") {
      for (let level = 0; level < Math.ceil(H / (T + 2)); level++) {
        const pocket = pocketAt(Math.floor(level / 3) + Math.floor(row / 2));
        const z = clusterCoordinate(level * (T + 2), pocket.z + (level % 3 - 1) * (T + 1), H);
        const x = clusterCoordinate(chance(recipe.irregularity) ? integer(0, 5) : level % 3, pocket.x - recipe.length * pocket.scale, W - T - 1);
        const end = Math.min(W, x + Math.max(T + 1, Math.round(variedLength(recipe.length) * blend(1, pocket.scale))));
        line({ x, y, z }, { x: end, y, z }, context);
        line({ x: end, y, z }, { x: end, y, z: z + integer(T + 1, 4) }, context, "connection");
        if (chance(recipe.loops)) line({ x, y, z }, { x, y, z: z + T + 2 }, context, "connection");
        if (chance(recipe.branching)) {
          const branchX = integer(x, end);
          line({ x: branchX, y, z }, { x: branchX, y, z: z + integer(1, recipe.branchReach) }, context);
        }
      }
    } else if (recipe.algorithm === "frames") {
      for (let index = 0; index < count; index++) {
        const pocket = pocketAt(Math.floor(index / 2) + Math.floor(row / 2));
        const x = clusterCoordinate(chance(recipe.irregularity) ? integer(0, Math.max(0, W - recipe.length)) : index * Math.max(1, W - recipe.length) / count, pocket.x + index % 2 * (T + 1), W);
        const z = clusterCoordinate(chance(recipe.irregularity) ? integer(0, Math.max(0, H - recipe.length)) : (index + row) % 3 * Math.max(1, H - recipe.length) / 3, pocket.z + index % 2 * (T + 1), H);
        const width = Math.max(T + 2, Math.round(variedLength(recipe.length + T + 1) * blend(1, pocket.scale)));
        const height = Math.max(T + 2, Math.round(recipe.length * (.6 + recipe.vertical / 80) * blend(1, 1.7 - pocket.scale / 2)));
        wallPath([{ x, y, z }, { x, y, z: z + height }, { x: x + width, y, z: z + height }, { x: x + width, y, z }, { x: x + (chance(recipe.loops) ? 0 : width - T), y, z }], context);
        if (chance(recipe.branching)) line({ x, y, z: z + height }, { x: x - integer(1, recipe.branchReach), y, z: z + height }, context, "connection");
      }
    } else {
      for (let index = 0; index < count; index++) {
        const pocket = pocketAt(Math.floor(index / 2) + Math.floor(row / 2));
        let current: Point = { x: clusterCoordinate(chance(recipe.irregularity) ? integer(0, W) : Math.round(index * W / count), pocket.x, W), y, z: clusterCoordinate(chance(recipe.irregularity) ? integer(0, H - 2) : Math.round((index + row) % count * H / count), pocket.z, H) };
        const beginning = current;
        const steps = integer(Math.max(1, recipe.pathSteps - 2), recipe.pathSteps + 1);
        for (let step = 0; step < steps; step++) {
          const span = Math.max(T + 1, variedLength(recipe.length * blend(1, pocket.scale)));
          const up = chance(Math.max(0, Math.min(100, recipe.vertical + (pocket.vertical - 50) * strength)));
          const direction = chance(50) ? 1 : -1;
          const next = up
            ? { ...current, z: Math.max(0, Math.min(H, current.z + direction * span)) }
            : { ...current, x: Math.max(0, Math.min(W, current.x + direction * span)) };
          line(current, next, context, step % 2 ? "connection" : "seed");
          if (chance(recipe.branching) && step > 0) {
            const branch = { ...current, y: y + integer(1, recipe.branchReach) };
            line(current, branch, context, "connection");
          }
          current = next;
        }
        if (chance(recipe.loops * blend(1, pocket.fullness))) {
          const corner = { x: beginning.x, y, z: current.z };
          line(current, corner, context, "connection");
          line(corner, beginning, context, "connection");
        }
      }
    }
  }
  if (recipe.algorithm === "bridge") {
    const span = W + Math.round(recipe.length * 2);
    const beamHeight = Math.round(H / 2);
    const beamCount = recipe.bridgeBeams;
    const beamSpacing = T + recipe.layerGap;
    const beamPositions = [0];
    for (let beam = 1; beam < beamCount; beam++) beamPositions.push((beamPositions.at(-1) ?? 0) + Math.max(T + 1, Math.round(blend(beamSpacing, integer(T + 1, T + 7)))));
    const beamWidth = beamPositions.at(-1) ?? 0;
    const structureContext = recipe.orientation === "both" ? 1 : 0;
    const size = Math.max(T + 3, Math.round(recipe.length * .8));
    const tiers = recipe.terminalTiers;
    const motif: { a: Point; b: Point; kind: Stroke["kind"] }[] = [];
    const panelWidth = Math.max(T + 1, Math.round(size * (1 - recipe.irregularity / 180)));
    for (let x = -panelWidth; x <= 0; x++) {
      motif.push({ a: { x, y: 0, z: beamHeight - size }, b: { x, y: 0, z: beamHeight + size }, kind: "seed" });
    }
    let tierDepth = 0;
    for (let tier = 0; tier < tiers; tier++) {
      const previousDepth = tierDepth;
      if (tier > 0) tierDepth -= Math.max(T + 1, Math.round(blend(T + recipe.layerGap, integer(T + 1, T + recipe.layerGap + 4))));
      const y = tierDepth;
      const width = variedLength(size);
      const rise = Math.max(T + 2, Math.round(size * (.7 + recipe.vertical / 100) * blend(1, pocketAt(Math.floor(tier / 2)).scale)));
      motif.push({ a: { x: 0, y, z: beamHeight - rise }, b: { x: width, y, z: beamHeight - rise }, kind: "seed" });
      motif.push({ a: { x: width, y, z: beamHeight - rise }, b: { x: width, y, z: beamHeight + rise }, kind: "seed" });
      motif.push({ a: { x: width, y, z: beamHeight + rise }, b: { x: -panelWidth, y, z: beamHeight + rise }, kind: "connection" });
      if (chance(recipe.loops)) motif.push({ a: { x: -panelWidth, y, z: beamHeight + rise }, b: { x: -panelWidth, y, z: beamHeight - rise }, kind: "connection" });
      if (tier > 0) motif.push({ a: { x: width, y, z: beamHeight - rise }, b: { x: width, y: previousDepth, z: beamHeight - rise }, kind: "connection" });
    }
    for (const end of [0, 1]) {
      const anchor: Point = { x: 0, y: end * span, z: 0 };
      const paletteGroup = end === 0 ? "primary" : "secondary";
      const terminalPoint = (point: Point) => {
        const turned = contexts[structureContext]?.quarterTurn ? rotatePoint(point, { x: 0, y: 0, z: 0 }) : point;
        return { x: turned.x, y: anchor.y + (end === 0 ? turned.y : -turned.y), z: turned.z };
      };
      for (const stroke of motif) placeLine(terminalPoint(stroke.a), terminalPoint(stroke.b), structureContext, stroke.kind, paletteGroup);
      placeLine({ x: 0, y: anchor.y, z: beamHeight }, { x: beamWidth, y: anchor.y, z: beamHeight }, structureContext, "connection", paletteGroup);
    }
    const midpoint = Math.round(span / 2);
    for (const [beam, x] of beamPositions.entries()) {
      const start = { x, y: 0, z: beamHeight };
      const middle = { x, y: midpoint, z: beamHeight };
      const end = { x, y: span, z: beamHeight };
      placeLine(start, middle, structureContext, "seed", "primary");
      placeLine(middle, end, structureContext, "connection", "secondary");
      if (beam > 0 && chance(recipe.branching)) placeLine({ x: beamPositions[beam - 1] ?? 0, y: midpoint, z: beamHeight }, middle, structureContext, "connection", "primary");
    }
    const railY = midpoint, railBottom = beamHeight - T - 5, railTop = beamHeight - T - 1;
    const openingStart = beamWidth + T + 2, openingEnd = openingStart + Math.max(T + 2, Math.round(W / 2));
    placeLine({ x: -W, y: railY, z: railBottom }, { x: W + beamWidth, y: railY, z: railBottom }, 0, "seed", "neutral");
    placeLine({ x: -W, y: railY, z: railTop }, { x: W + beamWidth, y: railY, z: railTop }, 0, "seed", "neutral");
    for (let x = -W; x <= W + beamWidth; x++) {
      if (x <= openingStart || x >= openingEnd) placeLine({ x, y: railY, z: railBottom }, { x, y: railY, z: railTop }, 0, "connection", "neutral");
    }
  }
  const initial = [...seeds];
  for (const stroke of recipe.algorithm === "bridge" ? [] : initial) {
    if (recipe.algorithm === "combs" && chance(recipe.branching)) {
      const end = contexts[stroke.context]?.quarterTurn
        ? { ...stroke.b, y: stroke.b.y - integer(1, recipe.branchReach) }
        : { ...stroke.b, x: stroke.b.x + integer(1, recipe.branchReach) };
      placeLine(stroke.b, end, stroke.context, "connection");
    }
    if (chance(recipe.depth)) {
      const end = contexts[stroke.context]?.quarterTurn
        ? { ...stroke.a, x: stroke.a.x + spacing }
        : { ...stroke.a, y: stroke.a.y + spacing };
      placeLine(stroke.a, end, stroke.context, "connection");
    }
    if (chance(recipe.symmetry)) {
      placeLine({ ...stroke.a, x: W - stroke.a.x }, { ...stroke.b, x: W - stroke.b.x }, stroke.context, "seed");
    }
  }
  if (recipe.algorithm === "enclosure") {
    const context = recipe.orientation === "both" ? 1 : 0;
    const interior = [...seeds, ...connections].flatMap(stroke => [stroke.a, stroke.b]);
    const xmin = Math.min(...interior.map(point => point.x)) - T - recipe.enclosureMargin;
    const xmax = Math.max(...interior.map(point => point.x)) + T + recipe.enclosureMargin;
    const ymin = Math.min(...interior.map(point => point.y)) - T - recipe.enclosureMargin;
    const ymax = Math.max(...interior.map(point => point.y)) + T + recipe.enclosureMargin;
    const zmin = Math.min(...interior.map(point => point.z)) - T - recipe.enclosureMargin;
    const zmax = Math.max(...interior.map(point => point.z)) + T + recipe.enclosureMargin;
    const turned = contexts[context]?.quarterTurn;
    const acrossMin = turned ? xmin : ymin, acrossMax = turned ? xmax : ymax;
    const depthMin = turned ? ymin : xmin, depthMax = turned ? ymax : xmax;
    const enclosurePoint = (across: number, depth: number, z: number): Point => turned
      ? { x: across, y: depth, z }
      : { x: depth, y: across, z };
    const bands = recipe.wallBands;
    const bandPositions = Array.from({ length: bands }, (_, band) => {
      if (band === 0) return depthMin;
      if (band === bands - 1) return depthMax;
      const pocket = pocketAt(Math.floor(band / 2));
      const position = blend(band / (bands - 1), pocket.y / Math.max(1, (rows - 1) * spacing));
      return Math.round(depthMin + position * (depthMax - depthMin));
    }).sort((a, b) => a - b);
    for (const [band, depth] of bandPositions.entries()) {
      const inset = chance(recipe.irregularity) ? integer(0, 2) : band % 2;
      const left = acrossMin - inset, right = acrossMax + inset;
      const bottom = zmin - inset, top = zmax + inset;
      const points: Point[] = [
        enclosurePoint(left, depth, bottom), enclosurePoint(left, depth, top),
        enclosurePoint(right, depth, top), enclosurePoint(right, depth, bottom),
        enclosurePoint(left, depth, bottom),
      ];
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1], b = points[index];
        if (a && b) placeLine(a, b, context, index % 2 ? "seed" : "connection");
      }
      if (band > 0) {
        const previousDepth = bandPositions[band - 1] ?? depthMin;
        for (const side of [left, right]) {
          for (let z = bottom + T + 2; z < top - T; z += T + integer(3, 6)) {
            placeLine(enclosurePoint(side, previousDepth, z), enclosurePoint(side, depth, z), context, "connection");
            if (chance(recipe.loops)) placeLine(enclosurePoint(side, previousDepth, z + 1), enclosurePoint(side, depth, z + 1), context, "connection");
          }
        }
      }
    }
  }
  const placed = [...seeds, ...connections].filter(stroke => {
    const differing = Number(stroke.a.x !== stroke.b.x) + Number(stroke.a.y !== stroke.b.y) + Number(stroke.a.z !== stroke.b.z);
    if (differing > 1) throw new Error("A construction stroke must follow one grid axis.");
    return differing === 1;
  });
  for (const stroke of resolveFreeEnds(placed, T, recipe.freeEnds, recipe.branchReach)) addStroke(stroke.a, stroke.b, stroke.context, stroke.kind, stroke.paletteGroup);
  let joint: Point | undefined;
  if (!recipe.allowIslands) {
    function connect(cells: Cell[]) {
      for (const { points, source } of connectingPaths(cells)) {
        for (let index = 1; index < points.length; index++) {
          const a = points[index - 1], b = points[index];
          if (a && b) addStroke(a, b, source.context, "connection", source.paletteGroup);
        }
      }
    }
    for (const context of contexts.keys()) connect([...occupancy.values()].filter(cell => cell.context === context));
    connect([...occupancy.values()]);
    const primary = new Map([...occupancy.values()].filter(cell => cell.context === 0).map(cell => [cellKey(cell), cell]));
    const alternate = [...occupancy.values()].filter(cell => cell.context === 1);
    joint = alternate.find(cell => primary.has(cellKey(cell)));
    if (!joint) {
      for (const cell of alternate) {
        const neighbor = [
          { ...cell, x: cell.x - 1 }, { ...cell, x: cell.x + 1 },
          { ...cell, y: cell.y - 1 }, { ...cell, y: cell.y + 1 },
          { ...cell, z: cell.z - 1 }, { ...cell, z: cell.z + 1 },
        ].find(point => primary.has(cellKey(point)));
        if (neighbor) {
          addStroke(cell, neighbor, cell.context, "connection", cell.paletteGroup);
          joint = neighbor;
          break;
        }
      }
    }
  }
  const cells = [...occupancy.values()];
  const depths = cells.map(cell => cell.x + cell.y + cell.z + 1.5);
  const depthOrigin = joint ? joint.x + joint.y + joint.z + 1.5 : (Math.min(...depths) + Math.max(...depths)) / 2;
  for (const context of contexts) context.depthOrigin = depthOrigin;
  const wallContext = contexts[0];
  if (recipe.algorithm === "bridge" && recipe.orientation === "both" && recipe.allowIslands && wallContext) {
    wallContext.depthOffset = -(Math.max(...depths) - Math.min(...depths) + T * 3 + 3);
  }
  const projected = cells.flatMap(cell => {
    const context = contexts[cell.context];
    if (!context) return [];
    return [screen(project(cell)), screen(project({ x: cell.x + 1, y: cell.y + 1, z: cell.z + 1 }))];
  });
  const xs = projected.map(point => point.x), ys = projected.map(point => point.y);
  const x = Math.min(0, ...xs) - 60, y = Math.min(0, ...ys) - 60;
  return { cells, strokes, contexts, recipe, bounds: { x, y, width: Math.max(0, ...xs) - x + 60, height: Math.max(0, ...ys) - y + 60 }, freeEnds: countFreeEnds(strokes, T) };
}

function signedArea(a: GridPoint, b: GridPoint, c: GridPoint) {
  return (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
}

function depthTranslation(context: Context) {
  return context.viewDirection * (context.depthOffset + (1 - context.viewDirection) * context.depthOrigin);
}
function occupiedKey(point: Point, context: Context) {
  const shift = depthTranslation(context);
  return `${context.viewDirection}:${3 * point.x + shift},${3 * point.y + shift},${3 * point.z + shift}`;
}

export function visibleTriangles(scene: Scene, count = scene.strokes.length): Map<string, Triangle> {
  const cells = scene.cells.filter(cell => cell.born < count);
  const occupied = new Set(cells.flatMap(cell => {
    const context = scene.contexts[cell.context];
    return context ? [occupiedKey(cell, context)] : [];
  }));
  const winners = new Map<string, Triangle>();
  function face(cell: Cell, family: Family, vertices: [Point, Point, Point, Point], coordinate: number, context: Context) {
    const points = vertices.map(vertex => project(vertex));
    const [a, b, c, d] = points;
    if (!a || !b || !c || !d) return;
    const metric = (p: GridPoint, q: GridPoint) => 3 * (p.u - q.u) ** 2 + (p.v - q.v) ** 2;
    const split = metric(a, c) <= metric(b, d) ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
    for (const indices of split) {
      const selected = indices.flatMap(index => {
        const vertex = vertices[index];
        return vertex ? [vertex] : [];
      });
      const [first, second, third] = selected.map(vertex => project(vertex));
      if (!first || !second || !third) continue;
      const ordered: [GridPoint, GridPoint, GridPoint] = signedArea(first, second, third) > 0 ? [first, second, third] : [first, third, second];
      const key = ordered.map(pointKey).sort().join(";");
      const depth = selected.reduce((sum, vertex) => sum + context.depthOffset + context.depthOrigin + context.viewDirection * (vertex.x + vertex.y + vertex.z - context.depthOrigin), 0);
      const old = winners.get(key);
      const receiver = selected.reduce((sum, vertex) => ({ x: sum.x + vertex.x / 3, y: sum.y + vertex.y / 3, z: sum.z + vertex.z / 3 }), { x: 0, y: 0, z: 0 });
      if (!old || depth > old.depth) winners.set(key, { points: ordered, depth, receiver, plane: `${context.viewDirection}:${family}:${3 * coordinate + depthTranslation(context)}`, family, context: cell.context, paletteGroup: cell.paletteGroup });
    }
  }
  for (const cell of cells) {
    const { x, y, z } = cell;
    const context = scene.contexts[cell.context];
    if (!context) continue;
    const direction = context.viewDirection;
    const fx = direction === 1 ? x + 1 : x;
    const fy = direction === 1 ? y + 1 : y;
    const fz = direction === 1 ? z + 1 : z;
    if (!occupied.has(occupiedKey({ x: x + direction, y, z }, context))) {
      face(cell, "x", [{ x: fx, y, z }, { x: fx, y: y + 1, z }, { x: fx, y: y + 1, z: z + 1 }, { x: fx, y, z: z + 1 }], fx, context);
    }
    if (!occupied.has(occupiedKey({ x, y: y + direction, z }, context))) {
      face(cell, "y", [{ x, y: fy, z }, { x, y: fy, z: z + 1 }, { x: x + 1, y: fy, z: z + 1 }, { x: x + 1, y: fy, z }], fy, context);
    }
    if (!occupied.has(occupiedKey({ x, y, z: z + direction }, context))) {
      face(cell, "z", [{ x, y, z: fz }, { x: x + 1, y, z: fz }, { x: x + 1, y: y + 1, z: fz }, { x, y: y + 1, z: fz }], fz, context);
    }
  }
  return winners;
}

type BoundaryEdge = { a: GridPoint; b: GridPoint };
type SurfaceGroup = { sample: Pick<Triangle, "plane" | "family" | "context" | "paletteGroup">; boundary: Map<string, BoundaryEdge>; area: number };

function simplify(ring: GridPoint[]) {
  return ring.filter((point, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length], next = ring[(index + 1) % ring.length];
    return !previous || !next || signedArea(previous, point, next) !== 0;
  });
}

export function mergeTriangles(triangles: Map<string, Triangle>): Face[] {
  const groups = new Map<string, SurfaceGroup>();
  for (const triangle of triangles.values()) {
    const groupKey = `${triangle.plane}:${triangle.paletteGroup}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { sample: triangle, boundary: new Map(), area: 0 };
      groups.set(groupKey, group);
    }
    group.area++;
    for (let index = 0; index < 3; index++) {
      const a = triangle.points[index], b = triangle.points[(index + 1) % 3];
      if (!a || !b) continue;
      const key = `${pointKey(a)}>${pointKey(b)}`, inverse = `${pointKey(b)}>${pointKey(a)}`;
      if (group.boundary.has(inverse)) group.boundary.delete(inverse);
      else group.boundary.set(key, { a, b });
    }
  }
  return traceSurfaces(groups);
}

function traceSurfaces(groups: Map<string, SurfaceGroup>): Face[] {
  return [...groups].map(([id, group]) => {
    const outgoing = new Map<string, Map<string, BoundaryEdge>>();
    for (const [key, edge] of group.boundary) {
      const start = pointKey(edge.a);
      let candidates = outgoing.get(start);
      if (!candidates) { candidates = new Map(); outgoing.set(start, candidates); }
      candidates.set(key, edge);
    }
    const remaining = new Map(group.boundary);
    const rings: GridPoint[][] = [];
    while (remaining.size) {
      const entry = remaining.entries().next().value;
      if (!entry) break;
      let [key, edge] = entry;
      const start = pointKey(edge.a);
      const ring: GridPoint[] = [];
      while (remaining.has(key)) {
        ring.push(edge.a);
        remaining.delete(key);
        outgoing.get(pointKey(edge.a))?.delete(key);
        if (pointKey(edge.b) === start) break;
        const candidates = [...(outgoing.get(pointKey(edge.b))?.entries() ?? [])];
        const incomingAngle = Math.atan2(edge.b.v - edge.a.v, edge.b.u - edge.a.u);
        candidates.sort((left, right) => {
          const angle = (item: BoundaryEdge) => (incomingAngle + Math.PI - Math.atan2(item.b.v - item.a.v, item.b.u - item.a.u) + Math.PI * 2) % (Math.PI * 2);
          return angle(left[1]) - angle(right[1]);
        });
        const next = candidates[0];
        if (!next) break;
        [key, edge] = next;
      }
      if (ring.length >= 3) rings.push(simplify(ring));
    }
    const d = rings.map(ring => ring.map((point, index) => {
      const p = screen(point);
      return `${index ? "L" : "M"}${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    }).join("") + "Z").join("");
    return { id, plane: group.sample.plane, d, family: group.sample.family, context: group.sample.context, paletteGroup: group.sample.paletteGroup, area: group.area, rings };
  });
}

export function mergeSurfaces(faces: Face[], material: (face: Face) => string): Face[] {
  const matching = new Map<string, Face[]>();
  for (const face of faces) {
    const key = `${face.plane}:${material(face)}`;
    const group = matching.get(key);
    if (group) group.push(face);
    else matching.set(key, [face]);
  }
  const singles: Face[] = [];
  const groups = new Map<string, SurfaceGroup>();
  for (const [groupKey, faces] of matching) {
    const first = faces[0];
    if (faces.length === 1 && first) { singles.push({ ...first, id: groupKey }); continue; }
    for (const face of faces) {
      let group = groups.get(groupKey);
      if (!group) {
        group = { sample: face, boundary: new Map(), area: 0 };
        groups.set(groupKey, group);
      }
      group.area += face.area;
      for (const ring of face.rings) for (let index = 0; index < ring.length; index++) {
        const start = ring[index], end = ring[(index + 1) % ring.length];
        if (!start || !end) continue;
        const steps = start.u === end.u ? Math.abs(end.v - start.v) / 2 : Math.abs(end.u - start.u);
        for (let step = 0; step < steps; step++) {
          const at = (step: number) => ({ u: start.u + (end.u - start.u) / steps * step, v: start.v + (end.v - start.v) / steps * step });
          const a = at(step), b = at(step + 1);
          const key = `${pointKey(a)}>${pointKey(b)}`, inverse = `${pointKey(b)}>${pointKey(a)}`;
          if (group.boundary.has(inverse)) group.boundary.delete(inverse);
          else group.boundary.set(key, { a, b });
        }
      }
    }
  }
  return [...singles, ...traceSurfaces(groups)];
}

function shadowSurfaces(scene: Scene, triangles: Map<string, Triangle>, count: number) {
  const occupied = new Set(scene.cells.filter(cell => cell.born < count).map(cell => `${cell.context}:${cellKey(cell)}`));
  const shaded = new Map<string, Triangle>();
  const strengths = new Map<string, number>();
  for (const [key, triangle] of triangles) {
    const direction = scene.contexts[triangle.context]?.viewDirection;
    if (!direction) continue;
    const start = { ...triangle.receiver };
    start[triangle.family] += direction * .02;
    function obstruction(ray: Point, steps: number) {
      for (let step = 1; step <= steps; step++) {
        const point = { x: Math.floor(start.x + ray.x * step * .5), y: Math.floor(start.y + ray.y * step * .5), z: Math.floor(start.z + ray.z * step * .5) };
        if (occupied.has(`${triangle.context}:${cellKey(point)}`)) return step;
      }
      return 0;
    }
    const lights = [{ x: .5, y: .8, z: 1.5 }, { x: .8, y: .65, z: 1.5 }, { x: .65, y: .95, z: 1.5 }];
    const cast = lights.filter(light => obstruction({ x: light.x * direction, y: light.y * direction, z: light.z * direction }, 24)).length / lights.length;
    const axes: Family[] = ["x", "y", "z"];
    let enclosure = 0;
    for (const axis of axes.filter(axis => axis !== triangle.family)) for (const side of [-1, 1]) {
      const ray = { x: 0, y: 0, z: 0 };
      ray[triangle.family] = direction * .45;
      ray[axis] = side;
      const distance = obstruction(ray, 4);
      if (distance) enclosure += (5 - distance) / 16;
    }
    const strength = Math.round((cast * .7 + enclosure * .3) * 8) / 8;
    if (!strength) continue;
    const plane = `${triangle.plane}:shadow-${strength}`;
    shaded.set(key, { ...triangle, plane });
    strengths.set(`${plane}:${triangle.paletteGroup}`, strength);
  }
  return mergeTriangles(shaded).map(face => ({ d: face.d, strength: strengths.get(face.id) ?? 0 }));
}

export function drawScene(scene: Scene, count = scene.strokes.length): Drawing {
  const triangles = visibleTriangles(scene, count);
  return { faces: mergeTriangles(triangles), shadows: shadowSurfaces(scene, triangles, count), triangles: triangles.size, visibleCells: scene.cells.filter(cell => cell.born < count).length };
}

export function strokePath(stroke: Stroke, scene: Scene, fraction = 1) {
  const context = scene.contexts[stroke.context];
  if (!context) return "";
  const a = screen(project(stroke.a)), b = screen(project(stroke.b));
  return `M${a.x},${a.y}L${a.x + (b.x - a.x) * fraction},${a.y + (b.y - a.y) * fraction}`;
}

export function validateScene(scene: Scene) {
  const issues: string[] = [];
  for (const stroke of scene.strokes) {
    const axes = Number(stroke.a.x !== stroke.b.x) + Number(stroke.a.y !== stroke.b.y) + Number(stroke.a.z !== stroke.b.z);
    if (axes !== 1) issues.push("A stroke leaves the grid directions.");
  }
  if (scene.cells.length === 0) issues.push("The drawing contains no solid structure.");
  if (scene.contexts.some(context => context.viewDirection !== 1 && context.viewDirection !== -1)) issues.push("An unsupported orientation is present.");
  if (!scene.recipe.allowIslands) {
    for (const index of scene.contexts.keys()) {
      if (connectedComponents(scene.cells.filter(cell => cell.context === index)).length > 1) issues.push("An orientation contains disconnected islands.");
    }
    if (!hasJoinedOrientations(scene.cells, scene.contexts)) issues.push("The orientations have no solid junction at a shared depth.");
  }
  const triangles = visibleTriangles(scene);
  for (const triangle of triangles.values()) {
    if (Math.abs(signedArea(...triangle.points)) !== 2) issues.push("A projected surface has an invalid grid triangle.");
  }
  return [...new Set(issues)];
}

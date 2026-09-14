import type { Point, Stroke } from "./isometry";

type Axis = "x" | "y" | "z";
type Sign = 1 | -1;
type Direction = { axis: Axis; sign: Sign };
type FreeEnd = { index: number; axis: Axis; sign: Sign; length: number };
type Route = { cost: number; segments: Stroke[] };

const axes: Axis[] = ["x", "y", "z"];
const signs: Sign[] = [1, -1];
const directions: Direction[] = axes.flatMap(axis => signs.map(sign => ({ axis, sign })));
const cellKey = (context: number, point: Point) => `${context}:${point.x},${point.y},${point.z}`;
const neighbors = (point: Point) => directions.map(({ axis, sign }) => ({ ...point, [axis]: point[axis] + sign }));

export function strokeAxis(stroke: Stroke) {
  return axes.find(axis => stroke.a[axis] !== stroke.b[axis]);
}

export function strokeCells(stroke: Stroke, thickness: number): Point[] {
  const cells: Point[] = [];
  for (let x = Math.min(stroke.a.x, stroke.b.x); x < Math.max(stroke.a.x, stroke.b.x) + thickness; x++) {
    for (let y = Math.min(stroke.a.y, stroke.b.y); y < Math.max(stroke.a.y, stroke.b.y) + thickness; y++) {
      for (let z = Math.min(stroke.a.z, stroke.b.z); z < Math.max(stroke.a.z, stroke.b.z) + thickness; z++) cells.push({ x, y, z });
    }
  }
  return cells;
}

function slab(origin: Point, axis: Axis, coordinate: number, thickness: number): Point[] {
  const [m, n] = axes.filter(other => other !== axis);
  if (!m || !n) return [];
  const cells: Point[] = [];
  for (let i = 0; i < thickness; i++) {
    for (let j = 0; j < thickness; j++) cells.push({ ...origin, [axis]: coordinate, [m]: origin[m] + i, [n]: origin[n] + j });
  }
  return cells;
}

function cube(origin: Point, thickness: number): Point[] {
  const cells: Point[] = [];
  for (let x = 0; x < thickness; x++) {
    for (let y = 0; y < thickness; y++) {
      for (let z = 0; z < thickness; z++) cells.push({ x: origin.x + x, y: origin.y + y, z: origin.z + z });
    }
  }
  return cells;
}

function endOrigin(stroke: Stroke, axis: Axis, sign: Sign): Point {
  const coordinate = sign === 1 ? Math.max(stroke.a[axis], stroke.b[axis]) : Math.min(stroke.a[axis], stroke.b[axis]);
  return { ...stroke.a, [axis]: coordinate };
}

function advance(origin: Point, direction: Direction, thickness: number, step: number) {
  return direction.sign === 1 ? origin[direction.axis] + thickness - 1 + step : origin[direction.axis] - step;
}

class Lattice {
  private readonly owners = new Map<string, Set<number>>();
  constructor(readonly strokes: Stroke[], readonly thickness: number) {
    strokes.forEach((stroke, index) => this.claim(index, stroke));
  }
  claim(index: number, stroke: Stroke) {
    for (const cell of strokeCells(stroke, this.thickness)) {
      const key = cellKey(stroke.context, cell);
      const owners = this.owners.get(key);
      if (owners) owners.add(index);
      else this.owners.set(key, new Set([index]));
    }
  }
  release(index: number, stroke: Stroke) {
    for (const cell of strokeCells(stroke, this.thickness)) {
      const key = cellKey(stroke.context, cell);
      const owners = this.owners.get(key);
      owners?.delete(index);
      if (owners?.size === 0) this.owners.delete(key);
    }
  }
  foreign(index: number, context: number, point: Point) {
    const owners = this.owners.get(cellKey(context, point));
    return owners !== undefined && [...owners].some(owner => owner !== index);
  }
  touches(index: number, context: number, cells: Point[]) {
    return cells.some(cell => this.foreign(index, context, cell) || neighbors(cell).some(neighbor => this.foreign(index, context, neighbor)));
  }
  isFree(end: FreeEnd) {
    const stroke = this.strokes[end.index];
    if (!stroke) return false;
    return !this.touches(end.index, stroke.context, cube(endOrigin(stroke, end.axis, end.sign), this.thickness));
  }
  freeEnds(): FreeEnd[] {
    return this.strokes.flatMap((stroke, index) => {
      const axis = strokeAxis(stroke);
      if (!axis) return [];
      const length = Math.abs(stroke.a[axis] - stroke.b[axis]);
      return signs.map(sign => ({ index, axis, sign, length })).filter(end => this.isFree(end));
    });
  }
  route(end: FreeEnd, reach: number): Route | undefined {
    const stroke = this.strokes[end.index];
    if (!stroke) return undefined;
    const origin = endOrigin(stroke, end.axis, end.sign);
    const segment = (a: Point, b: Point): Stroke => ({ a, b, context: stroke.context, kind: "connection", paletteGroup: stroke.paletteGroup });
    let best: Route | undefined;
    const consider = (candidate: Route) => { if (!best || candidate.cost < best.cost) best = candidate; };
    for (const first of directions.filter(direction => direction.axis !== end.axis || direction.sign === end.sign)) {
      for (let firstLength = 1; firstLength <= reach; firstLength++) {
        if (this.touches(end.index, stroke.context, slab(origin, first.axis, advance(origin, first, this.thickness, firstLength), this.thickness))) {
          consider({ cost: firstLength * 10, segments: [segment(origin, { ...origin, [first.axis]: origin[first.axis] + first.sign * firstLength })] });
          break;
        }
        const corner = { ...origin, [first.axis]: origin[first.axis] + first.sign * firstLength };
        for (const second of directions.filter(direction => direction.axis !== first.axis)) {
          for (let secondLength = 1; secondLength <= reach; secondLength++) {
            if (!this.touches(end.index, stroke.context, slab(corner, second.axis, advance(corner, second, this.thickness, secondLength), this.thickness))) continue;
            consider({ cost: (firstLength + secondLength) * 10 + 1, segments: [segment(origin, corner), segment(corner, { ...corner, [second.axis]: corner[second.axis] + second.sign * secondLength })] });
            break;
          }
        }
      }
    }
    return best;
  }
  retract(end: FreeEnd) {
    const stroke = this.strokes[end.index];
    if (!stroke) return;
    const low = Math.min(stroke.a[end.axis], stroke.b[end.axis]), high = Math.max(stroke.a[end.axis], stroke.b[end.axis]);
    const origin = endOrigin(stroke, end.axis, end.sign);
    const candidates = end.sign === 1
      ? Array.from({ length: high - low - 1 }, (_, offset) => high - 1 - offset)
      : Array.from({ length: high - low - 1 }, (_, offset) => low + 1 + offset);
    const coordinate = candidates.find(candidate => this.touches(end.index, stroke.context, cube({ ...origin, [end.axis]: candidate }, this.thickness)));
    if (coordinate === undefined) return;
    this.release(end.index, stroke);
    const point = stroke.a[end.axis] === origin[end.axis] ? "a" : "b";
    stroke[point] = { ...stroke[point], [end.axis]: coordinate };
    this.claim(end.index, stroke);
  }
}

export function countFreeEnds(strokes: Stroke[], thickness: number) {
  return new Lattice(strokes, thickness).freeEnds().length;
}

export function resolveFreeEnds(strokes: Stroke[], thickness: number, budget: number, reach: number): Stroke[] {
  const lattice = new Lattice(strokes.map(stroke => ({ ...stroke })), thickness);
  const ends = lattice.freeEnds().sort((left, right) => right.length - left.length).slice(budget);
  for (const end of ends) {
    if (!lattice.isFree(end)) continue;
    const route = lattice.route(end, reach);
    if (!route) { lattice.retract(end); continue; }
    for (const segment of route.segments) {
      lattice.strokes.push(segment);
      lattice.claim(lattice.strokes.length - 1, segment);
    }
  }
  return lattice.strokes;
}

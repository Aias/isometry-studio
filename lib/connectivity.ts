import type { Cell, Context, Point } from "./isometry";

const key = (point: Point) => `${point.x},${point.y},${point.z}`;
const neighbors = (point: Point): Point[] => [
  { ...point, x: point.x - 1 }, { ...point, x: point.x + 1 },
  { ...point, y: point.y - 1 }, { ...point, y: point.y + 1 },
  { ...point, z: point.z - 1 }, { ...point, z: point.z + 1 },
];

export function connectedComponents(cells: Cell[]): Cell[][] {
  const remaining = new Map(cells.map(cell => [key(cell), cell]));
  const components: Cell[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    if (!first) break;
    const component = [first];
    remaining.delete(key(first));
    for (let index = 0; index < component.length; index++) {
      const cell = component[index];
      if (!cell) continue;
      for (const point of neighbors(cell)) {
        const neighbor = remaining.get(key(point));
        if (neighbor) { remaining.delete(key(point)); component.push(neighbor); }
      }
    }
    components.push(component);
  }
  return components;
}

type Wave = { point: Point; owner: number; source: Cell; parent?: Wave };
export function connectingPaths(cells: Cell[]): { points: Point[]; source: Cell }[] {
  const components = connectedComponents(cells);
  if (components.length < 2) return [];
  const roots = components.map((_, index) => index);
  function root(index: number): number {
    const parent = roots[index];
    if (parent === undefined || parent === index) return index;
    const result = root(parent);
    roots[index] = result;
    return result;
  }
  const queue: Wave[] = components.flatMap((component, owner) => component.map(source => ({ point: source, owner, source })));
  const visited = new Map(queue.map(wave => [key(wave.point), wave]));
  const paths: { points: Point[]; source: Cell }[] = [];
  const trace = (wave: Wave) => {
    const points: Point[] = [];
    let current: Wave | undefined = wave;
    while (current) { points.push(current.point); current = current.parent; }
    return points;
  };
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const cell of cells) {
    min.x = Math.min(min.x, cell.x); min.y = Math.min(min.y, cell.y); min.z = Math.min(min.z, cell.z);
    max.x = Math.max(max.x, cell.x); max.y = Math.max(max.y, cell.y); max.z = Math.max(max.z, cell.z);
  }
  for (let index = 0; index < queue.length && paths.length < components.length - 1; index++) {
    const wave = queue[index];
    if (!wave) continue;
    for (const point of neighbors(wave.point)) {
      if (point.x < min.x || point.x > max.x || point.y < min.y || point.y > max.y || point.z < min.z || point.z > max.z) continue;
      const neighbor = visited.get(key(point));
      if (!neighbor) {
        const next = { point, owner: wave.owner, source: wave.source, parent: wave };
        visited.set(key(point), next);
        queue.push(next);
      } else if (root(wave.owner) !== root(neighbor.owner)) {
        roots[root(neighbor.owner)] = root(wave.owner);
        const points = [...trace(wave).reverse(), ...trace(neighbor)];
        paths.push({ source: wave.source, points: points.filter((point, index) => {
          const previous = points[index - 1], next = points[index + 1];
          return !previous || !next || point.x - previous.x !== next.x - point.x || point.y - previous.y !== next.y - point.y || point.z - previous.z !== next.z - point.z;
        }) });
      }
    }
  }
  return paths;
}

export function hasJoinedOrientations(cells: Cell[], contexts: Context[]) {
  const active = new Set(cells.map(cell => cell.context));
  if (active.size < 2) return true;
  const occupied = new Map<string, Cell[]>();
  for (const cell of cells) {
    const context = contexts[cell.context];
    if (!context) continue;
    const depth = (point: Point, context: Context) => context.depthOffset + context.depthOrigin + context.viewDirection * (point.x + point.y + point.z + 1.5 - context.depthOrigin);
    for (const neighbor of occupied.get(key(cell)) ?? []) {
      const other = contexts[neighbor.context];
      if (other && neighbor.context !== cell.context && depth(cell, context) === depth(neighbor, other)) return true;
    }
    const group = occupied.get(key(cell));
    if (group) group.push(cell);
    else occupied.set(key(cell), [cell]);
  }
  return false;
}

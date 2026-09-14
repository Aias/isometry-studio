import { z } from "zod";
import { inkDefinitions, inkSurface, paperGrain } from "./ink-texture";
import { drawScene, mergeSurfaces, strokePath, unit } from "./isometry";
import type { Drawing, Face, Family, PaletteGroup, Scene } from "./isometry";

export const appearanceSchema = z.object({
  palette: z.enum(["graphite", "city", "teal", "tower", "ink", "bridge"]),
  treatment: z.enum(["flat", "hatch", "lines"]),
  paper: z.enum(["ivory", "white", "gray"]),
  lineWeight: z.number().min(.4).max(2.4),
  hatchSpacing: z.number().min(3).max(12),
  inkTexture: z.boolean().default(true),
  inkAmount: z.number().min(0).max(100).default(18),
  paperTexture: z.boolean().default(true),
  paperAmount: z.number().min(0).max(100).default(15),
  depthShading: z.boolean().default(true),
  shadowAmount: z.number().min(0).max(100).default(20),
  grid: z.boolean(),
  live: z.boolean(),
});
export type Appearance = z.infer<typeof appearanceSchema>;
type Colors = { x: string; y: string; z: string };
export type Palette = { id: Appearance["palette"]; name: string; note: string; primary: Colors; secondary: Colors; ink: string };
const graphite: Palette = { id: "graphite", name: "Graphite", note: "Paper, pencil & hatching", primary: { x: "#c6c2b7", y: "#40413c", z: "#eee9de" }, secondary: { x: "#78796e", y: "#d7d2c6", z: "#3d3f37" }, ink: "#33362f" };
export const palettes: Palette[] = [
  graphite,
  { id: "bridge", name: "Bridged structures", note: "Teal, yellow, navy / red, orange, charcoal", primary: { x: "#177a75", y: "#e9b93e", z: "#102c4a" }, secondary: { x: "#c6412b", y: "#e99435", z: "#333a39" }, ink: "#203738" },
  { id: "city", name: "City of walls", note: "Yellow, teal, navy / red, orange, charcoal", primary: { x: "#102c4a", y: "#177a75", z: "#e9b93e" }, secondary: { x: "#c6412b", y: "#e99435", z: "#333a39" }, ink: "#203738" },
  { id: "teal", name: "Ulam’s staircase", note: "Teal ink on paper", primary: { x: "#0c746f", y: "#87b5a6", z: "#eee9de" }, secondary: { x: "#71a99c", y: "#164f4c", z: "#d0d8c4" }, ink: "#204943" },
  { id: "tower", name: "Tower", note: "Red-orange & umber", primary: { x: "#483c2c", y: "#7d5634", z: "#d15d30" }, secondary: { x: "#b74627", y: "#ba7b48", z: "#44392d" }, ink: "#493b2b" },
  { id: "ink", name: "Violet studies", note: "Fineliner & layered hatching", primary: { x: "#41304f", y: "#a89bae", z: "#e7dfda" }, secondary: { x: "#9f87a1", y: "#493758", z: "#786583" }, ink: "#44364d" },
];
export const defaultAppearance: Appearance = { palette: "graphite", treatment: "hatch", paper: "ivory", lineWeight: .85, hatchSpacing: 5, inkTexture: true, inkAmount: 18, paperTexture: true, paperAmount: 15, depthShading: true, shadowAmount: 20, grid: true, live: false };
export const paperColors = { ivory: "#f0ecdf", white: "#fbfbf7", gray: "#dedfd8" };
export function getPalette(id: Appearance["palette"]) { return palettes.find(palette => palette.id === id) ?? graphite; }
export function paletteColors(palette: Palette, group: PaletteGroup): Colors {
  return group === "neutral" ? { x: "#8f8d84", y: "#363830", z: "#eee9de" } : palette[group];
}
export function stageAt(progress: number) {
  if (progress < 180) return "Seed lines";
  if (progress < 400) return "Connections";
  if (progress < 700) return "Solid structures";
  if (progress < 1000) return "Shading";
  return "Finished drawing";
}
function escapeXml(value: string) { return value.replace(/[<>&"']/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character); }

export function renderArtwork(scene: Scene, completed: Drawing, appearance: Appearance, progress = 1000, includeGrid = appearance.grid) {
  const palette = getPalette(appearance.palette), paper = paperColors[appearance.paper], bounds = scene.bounds;
  const width = Number(bounds.width.toFixed(3)), height = Number(bounds.height.toFixed(3));
  const seeds = scene.strokes.filter(stroke => stroke.kind === "seed"), connections = scene.strokes.filter(stroke => stroke.kind === "connection");
  const count = progress < 400 ? 0 : Math.ceil(Math.min(1, (progress - 400) / 300) * scene.strokes.length);
  const drawing = progress >= 700 ? completed : count ? drawScene(scene, count) : { faces: [], shadows: [], triangles: 0, visibleCells: 0 };
  const definitions: string[] = [];
  const families: Family[] = ["z", "y", "x"];
  const paletteGroups: PaletteGroup[] = ["primary", "secondary", "neutral"];
  const materials = new Map<string, string>();
  for (const group of paletteGroups) {
    const colors = paletteColors(palette, group);
    for (const family of families) {
      const density = appearance.hatchSpacing, spacing = family === "z" ? density * 2 : family === "x" ? density : density * .75;
      const base = (appearance.palette === "graphite" || group === "neutral") && family !== "y" ? paper : colors[family];
      const opacity = family === "z" ? 0 : family === "x" ? .68 : .32;
      materials.set(`url(#hatch-${group}-${family})`, opacity === 0 ? base : `${base}:${opacity}:${spacing}:${family === "x" ? -30 : 30}`);
      definitions.push(`<pattern id="hatch-${group}-${family}" patternUnits="userSpaceOnUse" width="${spacing}" height="${spacing}" patternTransform="rotate(${family === "x" ? -30 : 30})"><rect width="${spacing}" height="${spacing}" fill="${base}"/><path d="M0,0V${spacing}" stroke="${palette.ink}" stroke-width="${family === "y" ? spacing * .72 : .7}" opacity="${opacity}"/></pattern>`);
    }
  }
  const gridWidth = Math.sqrt(3) * unit;
  definitions.push(`<pattern id="iso-grid" width="${gridWidth}" height="${unit}" patternUnits="userSpaceOnUse"><path d="M0,0L${gridWidth},${unit}M0,${unit}L${gridWidth},0M0,0V${unit}M${gridWidth / 2},0V${unit}" fill="none" stroke="${appearance.paper === "gray" ? "#ffffff" : palette.ink}" stroke-opacity="${appearance.paper === "gray" ? .75 : .08}" stroke-width=".6"/></pattern>`);
  const grid = includeGrid ? `<rect x="${bounds.x}" y="${bounds.y}" width="${width}" height="${height}" fill="url(#iso-grid)"/>` : "";
  const seedProgress = Math.min(1, progress / 180) * seeds.length;
  const connectionProgress = Math.max(0, Math.min(1, (progress - 180) / 220)) * connections.length;
  const skeleton = progress < 700 ? [
    ...seeds.map((stroke, index) => ({ stroke, fraction: Math.min(1, seedProgress - index) })),
    ...connections.map((stroke, index) => ({ stroke, fraction: Math.min(1, connectionProgress - index) })),
  ].filter(item => item.fraction > 0).map(({ stroke, fraction }) => `<path d="${strokePath(stroke, scene, fraction)}" fill="none" stroke="${palette.ink}" stroke-width="${appearance.lineWeight}" stroke-linecap="round" opacity="${progress >= 400 ? .2 : .9}"/>`).join("") : "";
  const shadedCount = Math.ceil(Math.max(0, (progress - 700) / 300) * drawing.faces.length);
  const shadeOrder = [...drawing.faces].sort((a, b) => families.indexOf(a.family) - families.indexOf(b.family) || a.id.localeCompare(b.id));
  const shaded = new Set(shadeOrder.slice(0, shadedCount).map(face => face.id));
  function fillFor(face: Face) {
    const colors = paletteColors(palette, face.paletteGroup);
    const filled = appearance.treatment !== "lines" && (progress >= 1000 || shaded.has(face.id) || appearance.live && progress >= 400);
    return !filled ? paper : appearance.treatment === "hatch" ? `url(#hatch-${face.paletteGroup}-${face.family})` : colors[face.family];
  }
  const fills = new Map<string, string>();
  const surfaces = mergeSurfaces(drawing.faces, face => {
    const fill = fillFor(face);
    const material = materials.get(fill) ?? fill;
    fills.set(`${face.plane}:${material}`, fill);
    return material;
  });
  const textured = appearance.inkTexture && appearance.inkAmount > 0;
  if (textured && surfaces.length) definitions.push(inkDefinitions(palette.ink, scene.recipe.seed));
  if (appearance.depthShading && drawing.shadows.length) definitions.push(`<filter id="shadow-softness" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".6"/></filter><clipPath id="shadow-surfaces"><path d="${surfaces.map(face => face.d).join("")}" clip-rule="evenodd"/></clipPath>`);
  const shadeProgress = appearance.live && progress >= 400 ? 1 : Math.max(0, Math.min(1, (progress - 700) / 300));
  const shadows = appearance.depthShading && appearance.shadowAmount > 0 && shadeProgress > 0
    ? `<g clip-path="url(#shadow-surfaces)"><g data-depth-shading="shadows" filter="url(#shadow-softness)" fill="${palette.ink}" opacity="${appearance.shadowAmount / 100 * .55 * shadeProgress}">${drawing.shadows.map(shadow => `<path d="${shadow.d}" fill-rule="evenodd" opacity="${shadow.strength}"/>`).join("")}</g></g>` : "";
  const faces = surfaces.map((face, index) => `<path data-face="${face.id}" d="${face.d}" fill="${fills.get(face.id) ?? paper}" fill-rule="evenodd"/>${textured ? inkSurface(face, index, palette.ink, appearance.lineWeight, appearance.inkAmount) : ""}<path d="${face.d}" fill="none" stroke="${palette.ink}" stroke-width="${appearance.lineWeight}" stroke-linejoin="round"/>`).join("");
  const grain = appearance.paperTexture && appearance.paperAmount > 0 ? paperGrain(bounds, scene.recipe.seed, appearance.paperAmount) : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.x} ${bounds.y} ${width} ${height}" role="img" aria-label="Isometric drawing, ${stageAt(progress).toLowerCase()}"><title>Isometry · ${escapeXml(scene.recipe.seed)}</title><metadata>${escapeXml(JSON.stringify({ recipe: scene.recipe, appearance, progress }))}</metadata><defs>${definitions.join("")}</defs><rect x="${bounds.x}" y="${bounds.y}" width="${width}" height="${height}" fill="${paper}"/>${grain}${grid}${skeleton}${faces}${shadows}</svg>`;
}

import { getPalette, paperColors } from "./artwork";
import type { Appearance } from "./artwork";
import type { Family } from "./isometry";

const faces: Record<Family, string> = { z: "M16 5 27 11 16 17 5 11Z", y: "M16 17v12L5 23V11Z", x: "M16 17 27 11v12L16 29Z" };
const edges = "M16 5 27 11v12L16 29 5 23V11ZM16 17 27 11M16 17 5 11M16 17v12";
const hatches: Partial<Record<Family, { angle: number; opacity: number }>> = { x: { angle: -30, opacity: .68 }, y: { angle: 30, opacity: .32 } };

export function faviconUrl(appearance: Appearance) {
  const palette = getPalette(appearance.palette), paper = paperColors[appearance.paper];
  const spacing = Math.max(1.5, appearance.hatchSpacing * .4);
  const definitions: string[] = [];
  const fills = (Object.keys(faces) as Family[]).map(family => {
    if (appearance.treatment === "lines") return `<path d="${faces[family]}" fill="${paper}"/>`;
    const base = appearance.palette === "graphite" && family !== "y" ? paper : palette.primary[family];
    const hatch = hatches[family];
    if (appearance.treatment === "flat" || !hatch) return `<path d="${faces[family]}" fill="${appearance.treatment === "flat" ? palette.primary[family] : base}"/>`;
    const size = family === "y" ? spacing * .75 : spacing;
    definitions.push(`<pattern id="${family}" patternUnits="userSpaceOnUse" width="${size}" height="${size}" patternTransform="rotate(${hatch.angle})"><rect width="${size}" height="${size}" fill="${base}"/><path d="M0,0V${size}" stroke="${palette.ink}" stroke-width="${family === "y" ? size * .72 : .5}" opacity="${hatch.opacity}"/></pattern>`);
    return `<path d="${faces[family]}" fill="url(#${family})"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs>${definitions.join("")}</defs><rect width="32" height="32" rx="6" fill="${paper}"/>${fills.join("")}<path d="${edges}" fill="none" stroke="${palette.ink}" stroke-width="${appearance.lineWeight}" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

import { randomSource, screen } from "./isometry";
import type { Bounds, Face } from "./isometry";

export function paperGrain(bounds: Bounds, seed: string, amount: number) {
  const noiseSeed = Math.floor(randomSource(`${seed}:paper`)() * 65535);
  return `<filter id="paper-grain" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".7 .95" numOctaves="2" seed="${noiseSeed}"/><feColorMatrix type="saturate" values="0"/></filter><rect data-paper-texture="grain" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" filter="url(#paper-grain)" opacity="${amount / 100 * .065}"/>`;
}

export function inkDefinitions(ink: string, seed: string) {
  const random = randomSource(`${seed}:ink`);
  const grain = Array.from({ length: 120 }, () => `<circle cx="${(random() * 64).toFixed(2)}" cy="${(random() * 64).toFixed(2)}" r="${(.15 + random() * .35).toFixed(2)}" opacity="${(.08 + random() * .22).toFixed(2)}"/>`).join("");
  return `<pattern id="ink-grain" patternUnits="userSpaceOnUse" width="64" height="64"><g fill="${ink}">${grain}</g></pattern><radialGradient id="ink-pool"><stop stop-color="${ink}" stop-opacity=".65"/><stop offset=".4" stop-color="${ink}" stop-opacity=".3"/><stop offset="1" stop-color="${ink}" stop-opacity="0"/></radialGradient>`;
}

export function inkSurface(face: Face, index: number, ink: string, lineWeight: number, amount: number) {
  const points = new Map(face.rings.flat().map(point => [`${point.u},${point.v}`, screen(point)]));
  const pools = [...points.values()].map(point => `<circle cx="${point.x.toFixed(3)}" cy="${point.y.toFixed(3)}" r="${1.2 + lineWeight * 1.4}" fill="url(#ink-pool)"/>`).join("");
  const edges = [
    { width: lineWeight + 5, opacity: .035 },
    { width: lineWeight + 2.5, opacity: .07 },
    { width: lineWeight + 1, opacity: .12 },
  ].map(edge => `<path d="${face.d}" fill="none" stroke="${ink}" stroke-width="${edge.width}" stroke-opacity="${edge.opacity}" stroke-linejoin="round"/>`).join("");
  return `<clipPath id="ink-face-${index}"><path d="${face.d}" clip-rule="evenodd"/></clipPath><g data-ink-texture="surface" clip-path="url(#ink-face-${index})" opacity="${amount / 100}"><path d="${face.d}" fill="url(#ink-grain)" fill-rule="evenodd"/>${edges}${pools}</g>`;
}

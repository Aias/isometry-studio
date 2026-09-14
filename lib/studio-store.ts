import { z } from "zod";
import { defaultRecipe, drawScene, generate, recipeSchema, validateScene } from "./isometry";
import { appearanceSchema, defaultAppearance } from "./artwork";
import type { Drawing, Recipe, Scene } from "./isometry";
import type { Appearance } from "./artwork";

export const documentSchema = z.object({ recipe: recipeSchema, appearance: appearanceSchema, progress: z.number().min(0).max(1000), speed: z.number().min(.25).max(4) });
export type StudioDocument = z.infer<typeof documentSchema>;
const storageKey = "isometry-studio-drawing";
const initialDocument: StudioDocument = { recipe: defaultRecipe, appearance: defaultAppearance, progress: 1000, speed: 1 };
const initialScene = generate(defaultRecipe);
type Snapshot = { document: StudioDocument; scene: Scene; drawing: Drawing; playing: boolean; saved: string; message: string; past: StudioDocument[]; future: StudioDocument[] };
const initialSnapshot: Snapshot = {
  document: initialDocument, scene: initialScene, drawing: drawScene(initialScene), playing: false,
  saved: "Loading drawing…", message: "", past: [], future: [],
};
let snapshot = initialSnapshot;
let initialized = false;
let frame = 0;
let adjustment: StudioDocument | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(snapshot.document));
    snapshot = { ...snapshot, saved: "Saved on this device" };
  } catch {
    snapshot = { ...snapshot, saved: "Autosave unavailable", message: "Browser storage is unavailable. Keep this tab open and export your artwork before closing it." };
  }
}

function installDocument(document: StudioDocument) {
  const sameRecipe = JSON.stringify(document.recipe) === JSON.stringify(snapshot.document.recipe);
  const scene = sameRecipe ? snapshot.scene : generate(document.recipe);
  snapshot = { ...snapshot, document, scene, drawing: sameRecipe ? snapshot.drawing : drawScene(scene), message: "" };
}

function stop() {
  cancelAnimationFrame(frame);
  snapshot = { ...snapshot, playing: false };
}

function commit(document: StudioDocument) {
  finishAdjustment();
  stop();
  if (JSON.stringify(document) === JSON.stringify(snapshot.document)) { emit(); return; }
  snapshot = { ...snapshot, past: [...snapshot.past, snapshot.document], future: [] };
  installDocument(document);
  save();
  emit();
}

function previewAdjustment(document: StudioDocument) {
  stop();
  adjustment ??= snapshot.document;
  installDocument(document);
  save();
  emit();
}
export function finishAdjustment() {
  if (!adjustment) return;
  if (JSON.stringify(adjustment) !== JSON.stringify(snapshot.document)) {
    snapshot = { ...snapshot, past: [...snapshot.past, adjustment], future: [] };
  }
  adjustment = undefined;
  emit();
}
export function previewRecipe(patch: Partial<Recipe>) {
  previewAdjustment({ ...snapshot.document, recipe: recipeSchema.parse({ ...snapshot.document.recipe, ...patch }), progress: 1000 });
}
export function previewAppearance(patch: Partial<Appearance>) {
  previewAdjustment({ ...snapshot.document, appearance: appearanceSchema.parse({ ...snapshot.document.appearance, ...patch }) });
}
export function changeRecipe(patch: Partial<Recipe>) {
  const recipe = recipeSchema.parse({ ...snapshot.document.recipe, ...patch });
  commit({ ...snapshot.document, recipe, progress: 1000 });
}
export function changeAppearance(patch: Partial<Appearance>) {
  commit({ ...snapshot.document, appearance: appearanceSchema.parse({ ...snapshot.document.appearance, ...patch }) });
}
export function applyAlgorithm(algorithm: Recipe["algorithm"]) {
  const document = snapshot.document;
  commit({ ...document, recipe: { ...document.recipe, algorithm, orientation: ["enclosure", "bridge"].includes(algorithm) ? "both" : document.recipe.orientation }, appearance: ["enclosure", "bridge"].includes(algorithm) ? { ...document.appearance, palette: algorithm === "bridge" ? "bridge" : "city", treatment: "flat" } : document.appearance, progress: 1000 });
}
export function reroll() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  changeRecipe({ seed: String(values[0] ?? 0) });
}
export function seek(progress: number) {
  stop();
  snapshot = { ...snapshot, document: { ...snapshot.document, progress: Math.max(0, Math.min(1000, progress)) } };
  save();
  emit();
}
export function stepConstruction(direction: 1 | -1) {
  const progress = snapshot.document.progress;
  const seeds = snapshot.scene.strokes.filter(stroke => stroke.kind === "seed").length;
  const connections = snapshot.scene.strokes.length - seeds;
  const stages = [
    { start: 0, end: 180, count: seeds },
    { start: 180, end: 400, count: connections },
    { start: 400, end: 700, count: snapshot.scene.strokes.length },
    { start: 700, end: 1000, count: snapshot.drawing.faces.length },
  ];
  const stage = stages.find(item => direction === 1 ? progress >= item.start && progress < item.end : progress > item.start && progress <= item.end);
  if (!stage) return;
  const step = (stage.end - stage.start) / Math.max(1, stage.count);
  seek(Math.max(stage.start, Math.min(stage.end, progress + direction * step)));
}
export function setSpeed(speed: number) {
  stop();
  snapshot = { ...snapshot, document: { ...snapshot.document, speed } };
  save();
  emit();
}
export function playPause() {
  if (snapshot.playing) { stop(); save(); emit(); return; }
  const start = snapshot.document.progress >= 1000 ? 0 : snapshot.document.progress;
  const startTime = performance.now();
  let last = startTime - 100;
  snapshot = { ...snapshot, playing: true, document: { ...snapshot.document, progress: start } };
  emit();
  function tick(time: number) {
    if (!snapshot.playing) return;
    const progress = Math.min(1000, start + (time - startTime) / 22 * snapshot.document.speed);
    if (time - last >= (progress >= 400 && progress < 700 ? 45 : 12) || progress >= 1000) {
      last = time;
      snapshot = { ...snapshot, document: { ...snapshot.document, progress }, playing: progress < 1000 };
      if (progress >= 1000) save();
      emit();
    }
    if (progress < 1000) frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}
export function undo() {
  finishAdjustment();
  const document = snapshot.past.at(-1);
  if (!document) return;
  stop();
  snapshot = { ...snapshot, past: snapshot.past.slice(0, -1), future: [snapshot.document, ...snapshot.future] };
  installDocument(document);
  save();
  emit();
}
export function redo() {
  finishAdjustment();
  const document = snapshot.future[0];
  if (!document) return;
  stop();
  snapshot = { ...snapshot, past: [...snapshot.past, snapshot.document], future: snapshot.future.slice(1) };
  installDocument(document);
  save();
  emit();
}
export function report(message: string) { snapshot = { ...snapshot, message }; emit(); }
export function checkGeometry() {
  const issues = validateScene(snapshot.scene);
  report(issues.length ? issues.join(" ") : `Grid and surface checks passed. ${snapshot.scene.recipe.allowIslands ? "Detached structures are allowed." : "All structures have solid connections."} Openings expose their inner surfaces.`);
  return issues;
}
function keydown(event: KeyboardEvent) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && (target.isContentEditable || target.closest('[role="dialog"], [role="slider"], [role="combobox"], [role="menu"], [role="listbox"]'))) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
  else if (event.key === " " && !(target instanceof HTMLButtonElement)) { event.preventDefault(); playPause(); }
  else if (event.key.toLowerCase() === "g" && !event.metaKey && !event.ctrlKey) changeAppearance({ grid: !snapshot.document.appearance.grid });
}

type ModelTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown | Promise<unknown> };
declare global { interface Document { readonly modelContext?: { registerTool: (tool: ModelTool, options?: { signal?: AbortSignal }) => void | Promise<void> } } }
let modelController: AbortController | undefined;
function registerTools() {
  const context = document.modelContext;
  if (!context) return;
  modelController = new AbortController();
  const properties = {
    seed: { type: "string", maxLength: 80 }, algorithm: { type: "string", enum: recipeSchema.shape.algorithm.options },
    density: { type: "number", minimum: 10, maximum: 100 }, clustering: { type: "number", minimum: 0, maximum: 100 }, orientation: { type: "string", enum: ["above", "below", "both"] },
    orientationChange: { type: "string", enum: recipeSchema.shape.orientationChange.removeDefault().options },
  };
  const tool: ModelTool = {
    name: "generate_isometric_drawing", description: "Generate a complete isometric drawing using the current settings plus any supplied recipe changes. The visible canvas updates and the drawing is saved locally.",
    inputSchema: { type: "object", properties, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      const patch = recipeSchema.pick({ seed: true, algorithm: true, density: true, clustering: true, orientation: true, orientationChange: true }).partial().strict().parse(input);
      changeRecipe(patch);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return { seed: snapshot.document.recipe.seed, strokes: snapshot.scene.strokes.length, surfaceGroups: snapshot.drawing.faces.length, progress: snapshot.document.progress };
    },
  };
  try { void Promise.resolve(context.registerTool(tool, { signal: modelController.signal })).catch(() => report("The browser could not register drawing automation. Drawing controls are available.")); }
  catch { report("The browser could not register drawing automation. Drawing controls are available."); }
}

export function subscribe(listener: () => void) {
  if (!initialized) {
    initialized = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) installDocument(documentSchema.parse(JSON.parse(raw)));
      snapshot = { ...snapshot, saved: raw ? "Restored from this device" : "Ready to draw" };
    } catch { snapshot = { ...snapshot, saved: "Saved drawing unavailable", message: "The saved drawing could not be opened. Your stored copy is preserved until you make a change." }; }
  }
  if (listeners.size === 0) {
    window.addEventListener("keydown", keydown);
    registerTools();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { stop(); window.removeEventListener("keydown", keydown); modelController?.abort(); }
  };
}
export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => initialSnapshot;

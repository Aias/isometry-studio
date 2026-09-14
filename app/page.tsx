"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Box, Shuffle, Grid3X3, Download, Play, Pause, SkipBack, SkipForward, Undo2, Redo2, StepBack, StepForward, ZoomIn, ZoomOut, Maximize, CircleHelp, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { algorithms } from "@/lib/isometry";
import type { Recipe } from "@/lib/isometry";
import { palettes, paperColors, renderArtwork, stageAt } from "@/lib/artwork";
import { applyAlgorithm, changeAppearance, changeRecipe, checkGeometry, finishAdjustment, getServerSnapshot, getSnapshot, playPause, previewAppearance, previewRecipe, redo, report, reroll, seek, setLive, setSpeed, stepConstruction, subscribe, undo } from "@/lib/studio-store";
import { exportArtwork } from "@/lib/export-artwork";
import { faviconUrl } from "@/lib/favicon";

function IconButton({ label, children, onClick, disabled = false, active = false }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return <Tooltip><TooltipTrigger render={<Button variant={active ? "secondary" : "ghost"} size="icon" aria-label={label} disabled={disabled} onClick={onClick}/>}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
const firstValue = (value: number | readonly number[]) => typeof value === "number" ? value : value[0];
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const id = useId();
  return <div className="choice-field"><label className="field-label" htmlFor={id}>{label}</label><Select value={value} items={options} onValueChange={next => { const option = options.find(item => item.value === next); if (option) onChange(option.value); }}><SelectTrigger id={id} aria-label={label} className="full-width"><SelectValue/></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>;
}
function Range({ label, description, value, min, max, step = 1, suffix = "", onChange }: { label: string; description: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  const descriptionId = useId();
  return <div className="range-field" onLostPointerCapture={finishAdjustment}><div className="range-label"><label>{label}</label><span>{Number(value.toFixed(2))}{suffix}</span></div><Slider aria-label={label} aria-describedby={descriptionId} min={min} max={max} step={step} value={[value]} onValueChange={next => { const first = firstValue(next); if (first !== undefined) onChange(first); }} onValueCommitted={finishAdjustment}/><p id={descriptionId} className="range-description">{description}</p></div>;
}
type NumericRecipeKey = { [K in keyof Recipe]: Recipe[K] extends number ? K : never }[keyof Recipe];
const controlGroups: { name: string; controls: { key: NumericRecipeKey; label: string; description: string; min: number; max: number }[] }[] = [
  { name: "Composition", controls: [
    { key: "spread", label: "Width", description: "Sets the horizontal extent of the structure.", min: 10, max: 30 },
    { key: "height", label: "Height", description: "Sets the vertical extent of the structure.", min: 6, max: 24 },
    { key: "density", label: "Density", description: "Adds more starting strokes and layers.", min: 10, max: 100 },
    { key: "layerGap", label: "Layer spacing", description: "Sets the distance between structural layers.", min: 0, max: 10 },
    { key: "clustering", label: "Clustering", description: "Gathers strokes into pockets with shared patterns.", min: 0, max: 100 },
    { key: "pocketCount", label: "Number of pockets", description: "Sets how many local patterns shape the drawing.", min: 1, max: 8 },
    { key: "pocketContrast", label: "Variation between pockets", description: "Varies proportions and direction between pockets.", min: 0, max: 100 },
    { key: "alternateShare", label: "Alternate orientation share", description: "Sets the portion of layers using the alternate orientation.", min: 0, max: 100 },
  ] },
  { name: "Seed strokes", controls: [
    { key: "length", label: "Stroke length", description: "Sets the typical length of strokes and spans.", min: 2, max: 12 },
    { key: "lengthVariation", label: "Length variation", description: "Mixes shorter and longer strokes around that length.", min: 0, max: 100 },
    { key: "vertical", label: "Vertical bias", description: "Favors taller forms and vertical strokes.", min: 0, max: 100 },
    { key: "irregularity", label: "Irregularity", description: "Varies positions and proportions within the pattern.", min: 0, max: 100 },
    { key: "symmetry", label: "Mirrored seed lines", description: "Adds reflected copies of selected starting strokes.", min: 0, max: 100 },
  ] },
  { name: "Paths & connections", controls: [
    { key: "pathSteps", label: "Strokes per path", description: "Sets how many steps each growing path takes.", min: 1, max: 12 },
    { key: "branching", label: "Branching", description: "Adds side branches and cross-connections.", min: 0, max: 100 },
    { key: "branchReach", label: "Branch reach", description: "Sets how far side branches and loose ends can extend.", min: 1, max: 10 },
    { key: "freeEnds", label: "Free ends", description: "Sets how many bars may end in open space as counterpoint.", min: 0, max: 6 },
    { key: "depth", label: "Depth connections", description: "Extends links toward neighboring layers.", min: 0, max: 100 },
    { key: "loops", label: "Loop closure", description: "Closes more paths into frames and openings.", min: 0, max: 100 },
  ] },
  { name: "Enclosing structures", controls: [
    { key: "wallBands", label: "Enclosing bands", description: "Sets the number of bands surrounding the interior.", min: 2, max: 9 },
    { key: "enclosureMargin", label: "Enclosure clearance", description: "Sets the gap between the interior and its enclosure.", min: 1, max: 10 },
    { key: "bridgeBeams", label: "Connecting beams", description: "Sets how many long beams join the two ends.", min: 1, max: 6 },
    { key: "terminalTiers", label: "Terminal layers", description: "Repeats the frame pattern at each end of the bridge.", min: 1, max: 7 },
  ] },
];
function applicableControl(key: NumericRecipeKey, recipe: Recipe) {
  if (["wallBands", "enclosureMargin"].includes(key)) return recipe.algorithm === "enclosure";
  if (["bridgeBeams", "terminalTiers"].includes(key)) return recipe.algorithm === "bridge";
  if (key === "pathSteps") return ["meanders", "enclosure"].includes(recipe.algorithm);
  if (key === "alternateShare") return recipe.orientation === "both" && !["enclosure", "bridge"].includes(recipe.algorithm);
  if (key === "vertical") return !["combs", "terraces"].includes(recipe.algorithm);
  if (["length", "lengthVariation"].includes(key)) return recipe.algorithm !== "combs";
  if (["density", "depth", "symmetry", "branchReach"].includes(key)) return recipe.algorithm !== "bridge";
  return true;
}
const algorithmOptions: { value: Recipe["algorithm"]; label: string }[] = [
  { value: "meanders", label: "Interwoven paths" }, { value: "combs", label: "Vertical combs" },
  { value: "terraces", label: "Terraced bands" }, { value: "frames", label: "Frame studies" },
  { value: "enclosure", label: "City of walls" },
  { value: "bridge", label: "Bridged structures" },
];
const speedOptions = [.25, .5, 1, 2, 4].map(value => ({ value: String(value), label: `${value}×` }));
function ArtworkView({ svg, paper }: { svg: string; paper: string }) {
  const element = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  function applyView() { if (element.current) element.current.style.transform = `translate(${view.current.x}px,${view.current.y}px) scale(${view.current.zoom})`; }
  function changeZoom(value: number) { view.current.zoom = Math.max(.3, Math.min(5, value)); setZoom(view.current.zoom); applyView(); }
  return <div className="canvas-stage" style={{ background: paper }}>
    <div className="pan-surface" aria-label="Drawing canvas. Drag to pan; use the zoom controls to inspect." onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY, originX: view.current.x, originY: view.current.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current) return; view.current.x = drag.current.originX + event.clientX - drag.current.x; view.current.y = drag.current.originY + event.clientY - drag.current.y; applyView(); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div ref={element} className="artwork" dangerouslySetInnerHTML={{ __html: svg }}/>
    </div>
    <div className="zoom-controls"><IconButton label="Zoom out" onClick={() => changeZoom(view.current.zoom / 1.2)}><ZoomOut/></IconButton><span>{Math.round(zoom * 100)}%</span><IconButton label="Zoom in" onClick={() => changeZoom(view.current.zoom * 1.2)}><ZoomIn/></IconButton><i/><IconButton label="Fit drawing" onClick={() => { view.current = { x: 0, y: 0, zoom: 1 }; setZoom(1); applyView(); }}><Maximize/></IconButton></div>
  </div>;
}
function Help() {
  return <Dialog><DialogTrigger render={<Button variant="ghost" size="icon" aria-label="How to use Isometry"/>}><CircleHelp/></DialogTrigger><DialogContent className="help-dialog"><DialogHeader><DialogTitle>Drawing through rules</DialogTitle><DialogDescription>Start with a pattern. Change its conditions. Follow the drawing as it forms.</DialogDescription></DialogHeader><ol><li><strong>Choose a starting pattern.</strong> Keep the seed to compare parameter changes, or shuffle it for a different drawing.</li><li><strong>Explore the biases.</strong> Sliders redraw the artwork as you move them. The controls are grouped by composition, seed strokes, and connections.</li><li><strong>Watch construction.</strong> Play the sequence or scrub through seed lines, connections, solid structures, and shading.</li><li><strong>Choose the finish.</strong> Color regions and spatial orientations are independent. Live shading is optional.</li><li><strong>Keep your work.</strong> Changes save in this browser. Export the current stage as an SVG or a high-resolution PNG.</li></ol><p className="help-note">Space: play/pause · G: grid · ⌘/Ctrl Z: undo<br/>Drag the canvas to pan. Direct line editing is the next part of the studio.</p></DialogContent></Dialog>;
}
export default function Home() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { recipe, appearance, progress, speed, live } = state.document;
  const [exporting, setExporting] = useState(false);
  const [exportGrid, setExportGrid] = useState(false);
  const [helpExport, setHelpExport] = useState(false);
  const favicon = faviconUrl(appearance);
  useEffect(() => { for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) link.href = favicon; }, [favicon]);
  async function download(format: "svg" | "png") {
    setExporting(true);
    try { await exportArtwork(renderArtwork(state.scene, state.drawing, appearance, { progress, live }, exportGrid), `isometry-${recipe.seed}`, format); report(`${format.toUpperCase()} exported${exportGrid ? " with grid" : " without grid"}.`); setHelpExport(false); }
    catch (error) { report(error instanceof Error ? error.message : "Artwork export failed. Please try again."); }
    finally { setExporting(false); }
  }
  return <TooltipProvider delay={350}><main className="studio">
    <header className="app-header"><div className="brand"><Box size={24}/><h1>Isometry</h1><span className="edition">DRAWING STUDIO</span></div><div className="header-actions"><span className="save-status" role="status">{state.saved}</span><div className="history-actions"><IconButton label="Undo last change" onClick={undo} disabled={!state.past.length}><Undo2/></IconButton><IconButton label="Redo change" onClick={redo} disabled={!state.future.length}><Redo2/></IconButton></div><Help/><Dialog open={helpExport} onOpenChange={setHelpExport}><DialogTrigger render={<Button variant="outline"/>}><Download/>Export</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Export this study</DialogTitle><DialogDescription>Save the current construction stage, palette, and shading. Choose whether to include the isometric grid. Studio controls are excluded.</DialogDescription></DialogHeader><div className="switch-row"><label htmlFor="export-grid">Include grid</label><Switch id="export-grid" checked={exportGrid} onCheckedChange={setExportGrid}/></div><div className="export-options"><Button onClick={() => download("svg")} disabled={exporting}><Download/>SVG vector artwork</Button><Button variant="outline" onClick={() => download("png")} disabled={exporting}><Download/>PNG · 3000 px</Button></div><p className="field-note">{exporting ? "Preparing artwork…" : `${stageAt(progress)} · Seed ${recipe.seed}`}</p></DialogContent></Dialog></div></header>
    <div className="workspace"><aside className="control-panel">
      <Tabs defaultValue="generate" className="panel-tabs"><TabsList variant="line" className="panel-tab-list"><TabsTrigger value="generate">Generate</TabsTrigger><TabsTrigger value="finish">Finish</TabsTrigger></TabsList>
      <TabsContent value="generate"><section className="control-section first-section"><Choice label="Starting pattern" value={recipe.algorithm} options={algorithmOptions} onChange={applyAlgorithm}/><p className="field-note">{algorithms.find(item => item.id === recipe.algorithm)?.description}</p>
        <label className="field-label" htmlFor="seed">Random seed</label><form className="seed-row" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const seed = form.get("seed"); if (typeof seed === "string") changeRecipe({ seed }); }}><input id="seed" name="seed" aria-label="Random seed" maxLength={80} key={recipe.seed} defaultValue={recipe.seed} onBlur={event => { if (event.target.value !== recipe.seed) changeRecipe({ seed: event.target.value }); }}/><Button type="button" variant="outline" size="icon" aria-label="Shuffle random seed" onClick={reroll}><Shuffle/></Button></form>
      </section>
      <section className="control-section"><Choice label="Orientation" value={recipe.orientation} options={[{ value: "above", label: "Primary only" }, { value: "below", label: "Alternate only" }, { value: "both", label: "Both orientations" }]} onChange={orientation => changeRecipe({ orientation })}/>{recipe.orientation !== "above" && <Choice label="Alternate orientation" value={recipe.orientationChange} options={[{ value: "reverse", label: "Underside reversal" }, { value: "turn", label: "Quarter-turn" }, { value: "reverse-turn", label: "Turn + underside" }]} onChange={orientationChange => changeRecipe({ orientationChange })}/>}<p className="field-note compact">Reverse the visible corner, turn the structural planes, or combine both. A drawing uses at most two orientations.</p></section>
      <section className="control-section"><div className="switch-row"><label htmlFor="allow-islands">Allow islands</label><Switch id="allow-islands" checked={recipe.allowIslands} onCheckedChange={allowIslands => changeRecipe({ allowIslands })}/></div><p className="field-note compact">Turn off to join detached pieces with solid connecting strokes.</p></section>
      <section className="control-section" aria-label="Drawing parameters">{controlGroups.map(group => {
        const controls = group.controls.filter(control => applicableControl(control.key, recipe));
        return controls.length > 0 && <div className="slider-group" key={group.name}><h3 className="field-label">{group.name === "Enclosing structures" && recipe.algorithm === "bridge" ? "Bridge structure" : group.name}</h3>{controls.map(control => <Range key={control.key} label={recipe.algorithm === "bridge" && control.key === "spread" ? "Beam span" : control.label} description={recipe.algorithm === "bridge" && control.key === "spread" ? "Sets the distance between the two ends of the bridge." : control.description} value={recipe[control.key]} min={control.min} max={control.max} onChange={value => previewRecipe({ [control.key]: value })}/>)}</div>;
      })}</section>
      </TabsContent>
      <TabsContent value="finish"><section className="control-section first-section"><div className="palette-list" role="group" aria-label="Color studies">{palettes.map(item => <button key={item.id} aria-pressed={appearance.palette === item.id} className={`palette-button ${appearance.palette === item.id ? "selected" : ""}`} onClick={() => changeAppearance({ palette: item.id })}><span className="swatches">{Object.entries(item.primary).map(([family, color]) => <i key={family} style={{ background: color }}/>)}</span>{item.name}</button>)}</div></section>
      <section className="control-section"><Choice label="Surface treatment" value={appearance.treatment} options={[{ value: "flat", label: "Flat color" }, { value: "hatch", label: "Ink & hatching" }, { value: "lines", label: "Linework only" }]} onChange={treatment => changeAppearance({ treatment })}/><div className="range-after-choice"><Range label="Line weight" description="Sets the width of the drawn outlines." value={appearance.lineWeight} min={.4} max={2.4} step={.05} onChange={lineWeight => previewAppearance({ lineWeight })}/>{appearance.treatment === "hatch" && <Range label="Hatch spacing" description="Sets the distance between shading lines." value={appearance.hatchSpacing} min={3} max={12} onChange={hatchSpacing => previewAppearance({ hatchSpacing })}/>}</div><Choice label="Paper" value={appearance.paper} options={[{ value: "ivory", label: "Sketchbook" }, { value: "white", label: "White" }, { value: "gray", label: "Whitelines gray" }]} onChange={paper => changeAppearance({ paper })}/></section>
      <section className="control-section"><div className="switch-row"><label htmlFor="depth-shading">Depth shading</label><Switch id="depth-shading" checked={appearance.depthShading} onCheckedChange={depthShading => changeAppearance({ depthShading })}/></div><p className="field-note">Nearby bars cast shadows. Recesses and openings hold a little more shade.</p>{appearance.depthShading && <Range label="Shadow depth" description="Controls how strongly shadows darken the face colors." value={appearance.shadowAmount} min={0} max={100} onChange={shadowAmount => previewAppearance({ shadowAmount })}/>}</section>
      <section className="control-section"><div className="switch-row"><label htmlFor="ink-texture">Ink on paper</label><Switch id="ink-texture" checked={appearance.inkTexture} onCheckedChange={inkTexture => changeAppearance({ inkTexture })}/></div><p className="field-note">A fine ink grain, darker edges, and subtle pooling at corners.</p>{appearance.inkTexture && <Range label="Ink buildup" description="Controls the strength of the grain and ink accumulation." value={appearance.inkAmount} min={0} max={100} onChange={inkAmount => previewAppearance({ inkAmount })}/>}</section>
      <section className="control-section"><div className="switch-row"><label htmlFor="paper-texture">Paper texture</label><Switch id="paper-texture" checked={appearance.paperTexture} onCheckedChange={paperTexture => changeAppearance({ paperTexture })}/></div><p className="field-note">A faint paper grain across the drawing.</p>{appearance.paperTexture && <Range label="Paper grain" description="Controls the visibility of the paper texture." value={appearance.paperAmount} min={0} max={100} onChange={paperAmount => previewAppearance({ paperAmount })}/>}</section>
      </TabsContent></Tabs>
      <div className="panel-footer"><Button className="generate-button" onClick={reroll}><Shuffle/>New drawing</Button><button className="check-button" onClick={checkGeometry}><CheckCheck size={15}/>Check geometry</button></div>
    </aside><section className="drawing-area" style={{ background: paperColors[appearance.paper] }}><div className="canvas-top"><span>UNTITLED STUDY <i>/</i> {recipe.seed}</span><div className="canvas-tools"><IconButton label={appearance.grid ? "Hide grid (G)" : "Show grid (G)"} active={appearance.grid} onClick={() => changeAppearance({ grid: !appearance.grid })}><Grid3X3/></IconButton></div></div>
      <ArtworkView svg={renderArtwork(state.scene, state.drawing, appearance, { progress, live })} paper={paperColors[appearance.paper]}/>
      <div className="canvas-bottom"><span>{state.scene.strokes.filter(stroke => stroke.kind === "seed").length} seeds · {state.scene.strokes.length} strokes · {state.scene.freeEnds} free ends · {state.drawing.faces.length} surface groups</span><span>{recipe.orientation === "both" ? "TWO ORIENTATIONS" : recipe.orientation === "below" ? "ALTERNATE ORIENTATION" : "PRIMARY ORIENTATION"}</span></div>
      {state.message && <div className="feedback" role="status"><span>{state.message}</span><button aria-label="Dismiss message" onClick={() => report("")}><X size={15}/></button></div>}
      <div className="transport"><div className="playback-buttons"><IconButton label="Start of construction" onClick={() => seek(0)}><SkipBack/></IconButton><IconButton label="Step backward" onClick={() => stepConstruction(-1)}><StepBack/></IconButton><Button className="play-button" size="icon" aria-label={state.playing ? "Pause construction" : "Play construction"} onClick={playPause}>{state.playing ? <Pause/> : <Play/>}</Button><IconButton label="Step forward" onClick={() => stepConstruction(1)}><StepForward/></IconButton><IconButton label="Finish drawing" onClick={() => seek(1000)}><SkipForward/></IconButton></div><div className="transport-line"><div className="transport-labels">{[{ name: "Seeds", value: 179 }, { name: "Connect", value: 399 }, { name: "Resolve", value: 699 }, { name: "Shade", value: 1000 }].map(stage => <button key={stage.name} onClick={() => seek(stage.value)}>{stage.name}</button>)}</div><Slider aria-label="Construction progress" min={0} max={1000} step={1} value={[progress]} onValueChange={next => { const value = firstValue(next); if (value !== undefined) seek(value); }}/></div><div className="playback-status"><span>{stageAt(progress)}</span><Select value={String(speed)} items={speedOptions} onValueChange={value => setSpeed(Number(value))}><SelectTrigger aria-label="Playback speed" className="speed-control"><SelectValue/></SelectTrigger><SelectContent>{speedOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select><div className="switch-row"><label htmlFor="live-shading">Live shading</label><Switch id="live-shading" checked={live} onCheckedChange={setLive}/></div></div></div>
    </section></div>
  </main></TooltipProvider>;
}

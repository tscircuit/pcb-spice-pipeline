import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import type { Viewbox } from 'graphics-debug'
import {
  routeBounds, routeDisplayItems, routePane, routePaneBox, routeSectionDrawing, routeSliceDrawing, routeSourceColor, routeSources, routeText, routeTones, routeUnit,
  type SectionGeometry, type RouteSlice, type CircuitJson, type CopperScope,
} from '../board'
import { rootScope, snapshot, type Produced } from '../kernel'
import { routeCrossSection, type RouteMaterials, type RouteCoefficients, type ExtractedRoutes, type ExtractedRouteSlice } from './route-lines'
import { routeCoupling, type RouteCoupling } from './route-coupling'
import { solveCrossSection } from './cross-section'
import type { CrossSection } from './cross-section-types'

export interface RouteFieldsInput {
  geometry: SectionGeometry
  circuitJson?: CircuitJson
  scope?: CopperScope
  materials?: RouteMaterials
  maskThicknessMm?: number | null
  panels?: number
  artifactPrefix: string
}
/** Explicit unmeasured material assumptions; provenance accompanies every output. */
export const assumedRouteMaterials: RouteMaterials = { maskMm: .02, maskEr: 3.3, maskLoss: .025, substrateLoss: .02 }

/** One pair screen or one unique multiconductor BEM solve per synchronous step. */
export class RouteFieldsSolver extends BaseSolver {
  private readonly cache = new Map<string, RouteCoefficients>()
  private pairs?: RouteSlice[]
  private groups?: RouteSlice[]
  private readonly slices: ExtractedRouteSlice[] = []
  private readonly coupling: RouteCoupling[] = []
  private pairIndex = 0
  private groupIndex = 0
  private currentSlice?: RouteSlice
  private current?: CrossSection
  private output?: Produced<ExtractedRoutes>
  private solveMilliseconds = 0
  readonly materials: RouteMaterials
  /** Resolve material assumptions once; caches belong exclusively to this solver. */
  constructor(private readonly input: RouteFieldsInput) {
    super()
    this.materials = input.materials ?? { ...assumedRouteMaterials, maskMm: input.maskThicknessMm ?? assumedRouteMaterials.maskMm }
    if (!Number.isInteger(input.panels ?? 12) || (input.panels ?? 12) < 2) throw new Error('Field panels must be an integer at least 2')
  }
  /** Canonical relative geometry owns the cache identity, independent of source IDs and stimulus. */
  private solveSlice(slice: RouteSlice): { key: string; line: RouteCoefficients } {
    const section = routeCrossSection(this.input.geometry, slice, this.materials)
    this.current = section
    this.currentSlice = slice
    const key = JSON.stringify(section)
    let line = this.cache.get(key)
    if (!line) {
      const start = performance.now()
      try {
        const { atFrequency: _atFrequency, ...coefficients } = solveCrossSection(section, { panelsPerEdge: this.input.panels ?? 12 })
        line = snapshot(coefficients)
      } catch (error) {
        throw Object.assign(error as Error, { routeSection: section, wires: slice.wires, references: slice.references, solved: this.cache.size, solveMilliseconds: this.solveMilliseconds })
      }
      this.solveMilliseconds += performance.now() - start
      this.cache.set(key, line)
    } else this.stats.cacheHits = (this.stats.cacheHits ?? 0) + 1
    return { key, line }
  }
  /** Preserve the original all-pairs-first ordering and routeCoupling's sole union predicate. */
  override _step(): void {
    const start = performance.now()
    if (!this.pairs) {
      this.pairs = []
      for (const slice of this.input.geometry.slices) {
        if (slice.wires.length > 40) throw new Error(`Coupling screen has ${slice.wires.length} conductors; exceeds modest-memory limit of 40`)
        for (let i = 0; i < slice.wires.length; i++) for (let j = i + 1; j < slice.wires.length; j++) this.pairs.push({ ...slice, wires: [slice.wires[i], slice.wires[j]] })
      }
    }
    if (this.pairIndex < this.pairs.length) {
      this.solveSlice(this.pairs[this.pairIndex++])
    } else {
      this.groups ??= this.input.geometry.slices.flatMap(slice => routeCoupling(slice, pair => {
        const line = this.cache.get(JSON.stringify(routeCrossSection(this.input.geometry, pair, this.materials)))
        if (!line) throw new Error('Pair screen was not solved')
        return line
      }, this.coupling))
      if (this.groupIndex < this.groups.length) {
        const slice = this.groups[this.groupIndex++]
        this.slices.push({ ...slice, ...this.solveSlice(slice) })
      }
      if (this.groupIndex === this.groups.length) {
        const warnings = [...this.input.geometry.warnings,
          'Parallel coupling retains connected pairs until both abs(Cij)/sqrt(Cii*Cjj) and abs(Lij)/sqrt(Lii*Ljj) are below 0.005 (0.5%). Pair screening is not an aggregate waveform error bound. Geometry admission follows the recorded copper scope; fields beyond its cap and nonadjacent layers are unbounded omissions. Local solves are capped at 40 conductors and fail explicitly.']
        const sections = [...this.cache].map(([key, line]) => ({ key, line }))
        const value = snapshot({ slices: this.slices, sections, coupling: this.coupling, warnings, materials: this.materials })
        const scope = rootScope('extraction').child(this.input.artifactPrefix)
        this.output = { value, artifacts: [scope.json('fields.json', { sections, slices: this.slices.map(slice => ({ start: slice.start, end: slice.end, wires: slice.wires.map(wire => wire.id), references: slice.references, key: slice.key })), coupling: this.coupling, warnings, materials: this.materials, maskThicknessSource: this.input.materials ? 'explicit' : this.input.maskThicknessMm != null ? 'preset' : 'assumed', panelsPerEdge: this.input.panels ?? 12 })] }
        this.solved = true
      }
    }
    this.stats = { ...this.stats, uniqueSolves: this.cache.size, pairs: this.pairIndex, sections: this.groupIndex, solveMilliseconds: this.solveMilliseconds, stepMilliseconds: performance.now() - start }
  }
  /** Only a completed extraction can be consumed by the network. */
  override getOutput(): Produced<ExtractedRoutes> {
    if (!this.output) throw new Error('Route fields are incomplete')
    return this.output
  }
  /** The cache and work queues never enter debugger downloads. */
  override getConstructorParams(): [RouteFieldsInput] { return [this.input] }
  /** The board with an amber cut at the current slice, and that slice's cross-section in a pane beside it. */
  override visualize(): GraphicsObject {
    const { geometry, circuitJson, scope } = this.input
    const slice = this.currentSlice ?? geometry.slices[0]
    const drawing: GraphicsObject = circuitJson && scope
      ? routeSectionDrawing(circuitJson, geometry, scope)
      : { coordinateSystem: 'cartesian', lines: geometry.wires.map(wire => ({ points: [wire.a, wire.b].map(([x, y]) => ({ x, y })), strokeColor: routeTones.neighbour, strokeWidth: wire.width })), rects: [], polygons: [], circles: [], texts: [] }
    const sources = circuitJson && scope ? routeSources(circuitJson, scope) : [...new Set(geometry.wires.map(wire => wire.source))]
    const focus = routeBounds(drawing.lines!.flatMap(line => line.points))
    if (!slice || !focus) return drawing
    const cut = routeBounds(routeSliceDrawing(drawing, slice, routeUnit(focus)))!
    const section = this.current ?? routeCrossSection(geometry, slice, this.materials)
    const pane = routePaneBox(focus, 2)
    routePane(drawing, pane)
    const from = { x: (cut.minX + cut.maxX) / 2, y: (cut.minY + cut.maxY) / 2 }
    const right = pane.minX > focus.maxX
    drawing.lines!.push({ points: [from, right ? { x: pane.minX, y: (pane.minY + pane.maxY) / 2 } : { x: (pane.minX + pane.maxX) / 2, y: pane.maxY }], strokeColor: routeTones.slice, strokeWidth: routeUnit(focus) * 0.25, strokeDash: '6 4' })
    sectionPane(drawing, pane, section, slice.wires.map(wire => routeSourceColor(sources, wire.source)), this.cache.get(JSON.stringify(section)), this.materials)
    return drawing
  }
}

/** A to-scale stack: laminate tan, mask green, reference planes copper, conductors in net colours, coupling bands sized by k, and Z0 below. */
function sectionPane(drawing: GraphicsObject, pane: Viewbox, section: CrossSection, colors: string[], line: RouteCoefficients | undefined, materials: RouteMaterials): void {
  const unit = routeUnit(pane)
  const inner = { minX: pane.minX + unit * 6, maxX: pane.maxX - unit * 6, minY: pane.minY + unit * 13, maxY: pane.maxY - unit * 13 }
  const low = Math.min(...section.conductors.map((c) => c.xMm - c.widthMm / 2))
  const high = Math.max(...section.conductors.map((c) => c.xMm + c.widthMm / 2))
  const span = Math.max(high - low, 1e-3)
  const levels = [...new Set([
    ...section.dielectrics.flatMap((d) => [d.zMm, d.zMm + d.thicknessMm]),
    ...section.conductors.flatMap((c) => [c.zMm, c.zMm + c.thicknessMm]),
    ...section.planes.map((p) => p.zMm),
  ])].sort((a, b) => a - b)
  const heights = levels.slice(1).map((v, i) => Math.max(0.04, Math.sqrt(v - levels[i])))
  const total = heights.reduce((sum, height) => sum + height, 0)
  /** One linear transverse scale with a margin of a third of the span on each side. */
  const x = (v: number): number => inner.minX + ((v - low + span / 3) / (span * 5 / 3)) * (inner.maxX - inner.minX)
  /** Piecewise square-root z keeps thin copper and mask visible without changing their order. */
  const z = (v: number): number => {
    let height = 0
    for (let i = 1; i < levels.length; i++) height += heights[i - 1] * Math.max(0, Math.min(1, (v - levels[i - 1]) / (levels[i] - levels[i - 1])))
    return inner.minY + (height / Math.max(total, 1e-3)) * (inner.maxY - inner.minY)
  }
  const middle = (inner.minX + inner.maxX) / 2
  const width = inner.maxX - inner.minX
  for (const [i, slab] of [...section.dielectrics].sort((a, b) => a.zMm - b.zMm).entries()) {
    const mask = slab.er === materials.maskEr && slab.lossTangent === materials.maskLoss
    drawing.rects!.push({ center: { x: middle, y: (z(slab.zMm) + z(slab.zMm + slab.thicknessMm)) / 2 }, width, height: z(slab.zMm + slab.thicknessMm) - z(slab.zMm), fill: mask ? '#24573f' : i % 2 ? '#5e4d36' : '#53442f' })
  }
  for (const plane of section.planes) drawing.rects!.push({ center: { x: middle, y: z(plane.zMm) }, width, height: unit * 1.2, fill: '#b08d57' })
  for (const [i, c] of section.conductors.entries())
    drawing.rects!.push({ center: { x: x(c.xMm), y: (z(c.zMm) + z(c.zMm + c.thicknessMm)) / 2 }, width: x(c.xMm + c.widthMm / 2) - x(c.xMm - c.widthMm / 2), height: Math.max(z(c.zMm + c.thicknessMm) - z(c.zMm), unit * 0.8), fill: colors[i], stroke: colors[i] })
  if (!line) return
  const top = z(levels.at(-1)!)
  const pairs = section.conductors.flatMap((a, i) => section.conductors.slice(i + 1).map((b, offset) => {
    const j = i + offset + 1
    return { a, b, k: Math.max(Math.abs(line.C[i][j]) / Math.sqrt(line.C[i][i] * line.C[j][j]), Math.abs(line.L[i][j]) / Math.sqrt(line.L[i][i] * line.L[j][j])) }
  })).filter(pair => pair.k >= 0.005).sort((p, q) => q.k - p.k)
  // Coupling bands arc above the stack; their thickness grows with k.
  for (const pair of routeDisplayItems(pairs, 60)) {
    const [from, to] = [x(pair.a.xMm), x(pair.b.xMm)].sort((p, q) => p - q)
    const rise = Math.min(unit * 7, (to - from) * 0.35) + unit
    const thickness = unit * (0.3 + 3 * Math.sqrt(Math.min(pair.k, 1)))
    /** One edge of the band, offset from its centre arc. */
    const arc = (offset: number): { x: number; y: number }[] => Array.from({ length: 17 }, (_, t) => ({ x: from + ((to - from) * t) / 16, y: top + unit + (rise + offset) * Math.sin((Math.PI * t) / 16) }))
    drawing.polygons!.push({ points: [...arc(thickness / 2), ...arc(-thickness / 2).reverse()], fill: routeTones.coupling, stroke: 'none' })
  }
  if (section.conductors.length > 10) return
  for (const [i, c] of section.conductors.entries())
    routeText(drawing, x(c.xMm), inner.minY - unit * (i % 2 && section.conductors.length > 4 ? 9 : 4.5), `${Math.sqrt(line.L[i][i] / line.C[i][i]).toFixed(0)} Ω`, colors[i], unit * 3)
}

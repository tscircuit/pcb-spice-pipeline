import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { routeBoardDrawing, routeBoardPoint, routePosition, type SectionGeometry, type RouteSlice, type CircuitJson, type CopperScope } from '../board'
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
  /** Copper, dielectric/mask slabs and actual references occupy the cross-section atlas. */
  override visualize(): GraphicsObject {
    const section = this.current
    const drawing: GraphicsObject = { rects: [], lines: [], texts: [{ x: 120, y: 100, text: 'Fields: transverse mm / stack z', fontSize: 2.3 }] }
    if (!section) return drawing
    const low = Math.min(...section.conductors.map(c => c.xMm - c.widthMm / 2)) - .1
    const high = Math.max(...section.conductors.map(c => c.xMm + c.widthMm / 2)) + .1
    const bottom = Math.min(...section.dielectrics.map(d => d.zMm), ...section.planes.map(p => p.zMm))
    const top = Math.max(...section.dielectrics.map(d => d.zMm + d.thicknessMm), ...section.planes.map(p => p.zMm))
    /** Transverse millimetres into x=120..220. */
    const x = (v: number): number => 125 + (v - low) / (high - low) * 90
    /** Stack z into y=10..90, positive upward. */
    const z = (v: number): number => 10 + (v - bottom) / Math.max(top - bottom, .001) * 80
    drawing.rects = section.dielectrics.map(d => ({ center: { x: 170, y: (z(d.zMm) + z(d.zMm + d.thicknessMm)) / 2 }, width: 90, height: z(d.zMm + d.thicknessMm) - z(d.zMm), fill: d.er === this.materials.maskEr ? '#cffafe' : '#fef3c7', label: `er=${d.er}` }))
    drawing.rects.push(...section.conductors.map(c => ({ center: { x: x(c.xMm), y: (z(c.zMm) + z(c.zMm + c.thicknessMm)) / 2 }, width: x(c.xMm + c.widthMm / 2) - x(c.xMm - c.widthMm / 2), height: z(c.zMm + c.thicknessMm) - z(c.zMm), fill: '#2563eb', label: c.id })))
    drawing.rects.push(...section.planes.map(p => ({ center: { x: 170, y: z(p.zMm) }, width: 90, height: .25, fill: '#16a34a', stroke: '#16a34a', label: `reference z=${p.zMm} mm` })))
    drawing.lines = section.planes.map(p => ({ points: [{ x: 125, y: z(p.zMm) }, { x: 215, y: z(p.zMm) }], strokeColor: '#16a34a', strokeWidth: .5 }))
    const line = this.cache.get(JSON.stringify(section))
    if (line) drawing.texts?.push({ x: 120, y: 4, text: `C=${line.C[0][0].toExponential(3)} F/m  L=${line.L[0][0].toExponential(3)} H/m  Z0=${Math.sqrt(line.L[0][0] / line.C[0][0]).toFixed(1)} ohm`, fontSize: 1.8 })

    if (this.input.circuitJson) {
      const circuit = this.input.circuitJson
      const board = routeBoardDrawing(circuit, this.input.scope, 'Fields: current slice and solved coupling')
      if (this.currentSlice) {
        const slice = this.currentSlice
        const middle = (slice.start + slice.end) / 2
        drawing.lines.push({ points: slice.wires.map(wire => routeBoardPoint(circuit, routePosition(wire, middle))), strokeColor: '#f59e0b', strokeWidth: 1 })
      }
      for (const pair of this.coupling.slice(-200)) {
        const wires = pair.wires.map(id => this.input.geometry.wires.find(wire => wire.id === id)!)
        drawing.lines.push({ points: wires.map(wire => routeBoardPoint(circuit, routePosition(wire, (wire.start + wire.end) / 2))), strokeColor: pair.retained ? '#9333ea' : '#cbd5e1', strokeWidth: .1 + Math.max(pair.capacitive, pair.inductive) * 3 })
      }
      drawing.lines.push(...board.lines ?? [])
      drawing.texts?.push(...board.texts ?? [])
    }
    if (line) drawing.texts?.push({ x: 120, y: 1, text: `panels=${line.diagnostics.panels}; reciprocity=${line.diagnostics.reciprocityResidual.toExponential(2)}`, fontSize: 1.8 })
    return drawing
  }
}

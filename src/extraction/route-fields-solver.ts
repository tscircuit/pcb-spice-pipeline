import { BaseSolver } from '@tscircuit/solver-utils'
import { emptyVisualization } from '../solver'
import { type SectionGeometry, type RouteSlice, type CircuitJson, type CopperScope } from '../board'
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
  /** Compatibility only; the physical scene is rendered from retained domain outputs. */
  override visualize = emptyVisualization
}


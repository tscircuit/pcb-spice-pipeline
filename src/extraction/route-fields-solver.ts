import { BaseSolver } from '@tscircuit/solver-utils'
import type { GraphicsObject } from 'graphics-debug'
import { routeText, routeTextSize, routeDisplayItems, routeNetLabel, type SectionGeometry, type RouteSlice, type CircuitJson, type CopperScope } from '../board'
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
  /** Explicit material labels and self/mutual coefficients explain the current physical slice. */
  override visualize(): GraphicsObject {
    const section = this.current
    const drawing: GraphicsObject = { coordinateSystem: 'cartesian', rects: [], lines: [], texts: [], circles: [], polygons: [] }
    routeText(drawing, 132, 98, '3 · Fields: solve a cross-section', '#0f172a', routeTextSize.title)
    routeText(drawing, 132, 91, 'Transverse x (mm) × stack z (mm); thin layers expanded', '#475569')
    if (!section) {
      routeText(drawing, 132, 75, 'Waiting for the first slice; no field solve yet')
      return drawing
    }
    const low = Math.min(...section.conductors.map((c) => c.xMm - c.widthMm / 2)) - 0.1
    const high = Math.max(...section.conductors.map((c) => c.xMm + c.widthMm / 2)) + 0.1
    const levels = [
      ...new Set([
        ...section.dielectrics.flatMap((d) => [d.zMm, d.zMm + d.thicknessMm]),
        ...section.conductors.flatMap((c) => [c.zMm, c.zMm + c.thicknessMm]),
        ...section.planes.map((p) => p.zMm),
      ]),
    ].sort((a, b) => a - b)
    const heights = levels.slice(1).map((v, i) => Math.max(0.04, Math.sqrt(v - levels[i])))
    const total = heights.reduce((sum, height) => sum + height, 0)
    /** Transverse widths use one linear physical scale. */
    const x = (v: number): number => 136 + ((v - low) / (high - low)) * 156
    /** Piecewise physical z scale keeps thin copper and mask visible without changing their order. */
    const z = (v: number): number => {
      let height = 0
      for (let i = 1; i < levels.length; i++) height += heights[i - 1] * Math.max(0, Math.min(1, (v - levels[i - 1]) / (levels[i] - levels[i - 1])))
      return 40 + (height / Math.max(total, 0.001)) * 29
    }
    let labelY = 75
    for (const slab of [...section.dielectrics].sort((a, b) => b.zMm - a.zMm)) {
      const mask =
        slab.er === this.materials.maskEr &&
        slab.lossTangent === this.materials.maskLoss &&
        section.conductors.some(
          (c) => Math.abs(c.zMm - slab.zMm) < 1e-8 || Math.abs(c.zMm + c.thicknessMm - slab.zMm - slab.thicknessMm + this.materials.maskMm) < 1e-8,
        )
      const middle = (z(slab.zMm) + z(slab.zMm + slab.thicknessMm)) / 2
      drawing.rects!.push({
        center: { x: 214, y: middle },
        width: 156,
        height: z(slab.zMm + slab.thicknessMm) - z(slab.zMm),
        fill: mask ? '#cffafe' : '#fef3c7',
      })
      labelY = Math.min(middle, labelY - 6)
      drawing.lines!.push({ points: [{ x: 292, y: middle }, { x: 296, y: labelY }], strokeColor: '#64748b', strokeWidth: .15 })
      routeText(drawing, 298, labelY, `${mask ? 'Mask' : 'Dielectric'} εr=${slab.er}`, '#0f172a')
    }
    // Explicit legend remains legible even when a slab is too thin for an interior label.
    routeText(drawing, 132, 86, `Amber: laminate · Cyan: mask εr=${this.materials.maskEr} · Blue: copper`, '#475569')
    for (const [i, c] of section.conductors.entries()) {
      drawing.rects!.push({
        center: { x: x(c.xMm), y: (z(c.zMm) + z(c.zMm + c.thicknessMm)) / 2 },
        width: x(c.xMm + c.widthMm / 2) - x(c.xMm - c.widthMm / 2),
        height: z(c.zMm + c.thicknessMm) - z(c.zMm),
        fill: '#2563eb',
        stroke: '#1d4ed8',
      })
      routeText(drawing, x(c.xMm) - 8, 80 - (i % 2) * 5, `${c.id}: ${c.widthMm.toFixed(3)} × ${c.thicknessMm.toFixed(3)} mm`, '#1d4ed8')
    }
    for (const [i, plane] of section.planes.entries()) {
      drawing.lines!.push({
        points: [
          { x: 136, y: z(plane.zMm) },
          { x: 292, y: z(plane.zMm) },
        ],
        strokeColor: '#16a34a',
        strokeWidth: 0.5,
      })
      const reference = this.currentSlice?.references[i]
      drawing.polygons!.push({
        points: [
          { x: 136, y: z(plane.zMm) },
          { x: 292, y: z(plane.zMm) },
        ],
        stroke: '#16a34a',
        strokeWidth: 0.5,
      })
      routeText(drawing, 138, z(plane.zMm) + (i % 2 ? 3 : -3), `Reference: ${reference?.layer ?? 'plane'} · z=${plane.zMm.toFixed(3)} mm`, '#15803d')
    }
    routeText(drawing, 132, 33, `x: ${low.toFixed(3)} … ${high.toFixed(3)} mm; z: ${levels[0].toFixed(3)} … ${levels.at(-1)!.toFixed(3)} mm`, '#64748b')
    const line = this.cache.get(JSON.stringify(section))
    if (!line) return drawing
    for (const [i, c] of section.conductors.slice(0, 4).entries()) {
      const capacitance = line.C[i][i]
      const inductance = line.L[i][i]
      routeText(
        drawing,
        132,
        27 - i * 5,
        `${c.id}: C ${(capacitance * 1e12).toFixed(1)} pF/m · L ${(inductance * 1e9).toFixed(1)} nH/m · Z0 ${Math.sqrt(inductance / capacitance).toFixed(1)} Ω · delay ${(Math.sqrt(inductance * capacitance) * 1e9).toFixed(2)} ps/mm`,
        '#0f172a',
      )
    }
    if (this.currentSlice) {
      const slice = this.currentSlice
      const names = slice.wires
        .slice(0, 2)
        .map((wire, i) => `${i}=${this.input.circuitJson ? routeNetLabel(this.input.circuitJson, wire.source) : wire.source} /${wire.layer}`)
        .join(' · ')
      routeText(drawing, 132, 6, `Slice ${slice.start.toFixed(2)}…${slice.end.toFixed(2)} mm · ${names}`, '#64748b')
    }
    const pairs = section.conductors.flatMap((a, i) =>
      section.conductors.slice(i + 1).map((b, offset) => {
        const j = i + offset + 1
        return {
          a,
          b,
          cm: Math.abs(line.C[i][j]),
          lm: line.L[i][j],
          k: Math.max(Math.abs(line.C[i][j]) / Math.sqrt(line.C[i][i] * line.C[j][j]), Math.abs(line.L[i][j]) / Math.sqrt(line.L[i][i] * line.L[j][j])),
        }
      }),
    )
    for (const pair of routeDisplayItems(pairs, 60))
      drawing.lines!.push({
        points: [pair.a, pair.b].map((c) => ({ x: x(c.xMm), y: z(c.zMm + c.thicknessMm) + 1 })),
        strokeColor: '#9333ea',
        strokeWidth: 0.15 + Math.min(1, pair.k) * 3,
        label: `k=${pair.k.toFixed(3)}`,
      })
    // graphics-debug draws polygons after filled rectangles; repeat line strokes in this foreground layer.
    for (const line of drawing.lines!.filter((line) => line.strokeColor === '#9333ea'))
      drawing.polygons!.push({ points: line.points, stroke: line.strokeColor, strokeWidth: line.strokeWidth })
    const pair = [...pairs].sort((a, b) => b.k - a.k)[0]
    routeText(
      drawing,
      132,
      1,
      pair
        ? `Strongest pair ${pair.a.id}↔${pair.b.id}: Cm ${(pair.cm * 1e12).toFixed(2)} pF/m · Lm ${(pair.lm * 1e9).toFixed(2)} nH/m · k=${pair.k.toFixed(3)}`
        : 'One conductor in this slice: no mutual coupling',
      '#7e22ce',
    )
    routeText(
      drawing,
      132,
      -4,
      `Purple thickness = coupling · ${section.conductors.length} conductors · self values above${section.conductors.length > 4 ? ' (first 4)' : ''}`,
      '#64748b',
    )
    return drawing
  }
}

import { BaseSolver } from '@tscircuit/solver-utils'
import { routeDisplayItems, boardBounds, routeSectionDrawing, routeSliceDrawing, routeText, routeTextSize, routeTitle, routeUnion, overlayLine, type SectionGeometry, type RouteSlice, type CircuitJson, type CopperScope, type StageDrawing } from '../board'
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
  /** The amber cut on the board leads to its cross-section: slabs, copper, planes, Z0 per conductor and coupling as line weight. */
  override visualize(): StageDrawing {
    const slice = this.currentSlice ?? this.input.geometry.slices[0]
    const section = this.current ?? (slice && routeCrossSection(this.input.geometry, slice, this.materials))
    const { circuitJson: circuit, scope } = this.input
    const drawing: StageDrawing =
      circuit && scope ? routeSectionDrawing(circuit, this.input.geometry, scope) : { coordinateSystem: 'cartesian', rects: [], lines: [], texts: [], polygons: [] }
    const board = circuit ? boardBounds(circuit) : { minX: -50, maxX: 50, minY: -25, maxY: 25 }
    const side = Math.max(board.maxX - board.minX, board.maxY - board.minY) * 0.9
    const panel = { minX: board.maxX + side * 0.12, maxX: board.maxX + side * 1.12, minY: (board.minY + board.maxY) / 2 - side * 0.25, maxY: (board.minY + board.maxY) / 2 + side * 0.25 }
    const cut = circuit && slice ? routeSliceDrawing(drawing, circuit, slice) : []
    drawing.focus = routeUnion(panel, ...(drawing.focus ? [drawing.focus] : []), ...cut.map((point) => ({ minX: point.x, maxX: point.x, minY: point.y, maxY: point.y })))
    drawing.focus = { ...drawing.focus, minX: drawing.focus.minX - side * 0.08, maxX: drawing.focus.maxX + side * 0.04, maxY: drawing.focus.maxY + side * 0.12 }
    drawing.rects!.push({ center: { x: (panel.minX + panel.maxX) / 2, y: (panel.minY + panel.maxY) / 2 }, width: side, height: side * 0.5, stroke: '#cbd5e1' })
    if (cut.length)
      drawing.lines!.push({ ...overlayLine([cut[1], { x: panel.minX, y: (panel.minY + panel.maxY) / 2 }], '#f59e0b', side * 0.004), strokeDash: [side * 0.01, side * 0.008] })
    if (!section) return routeTitle(drawing, '3 · Fields', [{ text: 'No field slices', color: '#64748b' }])
    const size = routeTextSize(drawing.focus)
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
    /** Transverse widths use one linear physical scale inside the panel. */
    const x = (v: number): number => panel.minX + side * (0.05 + ((v - low) / (high - low)) * 0.9)
    /** Piecewise physical z scale keeps thin copper and mask visible without changing their order. */
    const z = (v: number): number => {
      let height = 0
      for (let i = 1; i < levels.length; i++) height += heights[i - 1] * Math.max(0, Math.min(1, (v - levels[i - 1]) / (levels[i] - levels[i - 1])))
      return panel.minY + side * 0.5 * (0.1 + (height / Math.max(total, 0.001)) * 0.6)
    }
    for (const slab of section.dielectrics) {
      const mask = slab.er === this.materials.maskEr && slab.lossTangent === this.materials.maskLoss
      drawing.rects!.push({
        center: { x: (panel.minX + panel.maxX) / 2, y: (z(slab.zMm) + z(slab.zMm + slab.thicknessMm)) / 2 },
        width: side * 0.9,
        height: z(slab.zMm + slab.thicknessMm) - z(slab.zMm),
        fill: mask ? '#cffafe' : '#fef3c7',
      })
    }
    for (const [i, plane] of section.planes.entries()) {
      drawing.lines!.push(overlayLine([{ x: x(low), y: z(plane.zMm) }, { x: x(high), y: z(plane.zMm) }], '#16a34a', side * 0.006))
      routeText(drawing, x(high) + size.body * 0.3, z(plane.zMm), slice?.references[i]?.layer ?? 'plane', '#15803d', size.body)
    }
    const line = this.cache.get(JSON.stringify(section))
    for (const [i, c] of section.conductors.entries()) {
      drawing.rects!.push({
        center: { x: x(c.xMm), y: (z(c.zMm) + z(c.zMm + c.thicknessMm)) / 2 },
        width: x(c.xMm + c.widthMm / 2) - x(c.xMm - c.widthMm / 2),
        height: z(c.zMm + c.thicknessMm) - z(c.zMm),
        fill: '#1d4ed8',
      })
      if (line && i < 6)
        drawing.texts!.push({
          x: x(c.xMm),
          y: panel.maxY - size.body * (1 + (i % 2) * 1.3),
          text: `${Math.sqrt(line.L[i][i] / line.C[i][i]).toFixed(1)} Ω`,
          color: '#1d4ed8',
          fontSize: size.body,
          anchorSide: 'center',
        })
    }
    if (!line) return routeTitle(drawing, '3 · Fields')
    const pairs = section.conductors.flatMap((a, i) =>
      section.conductors.slice(i + 1).map((b, offset) => {
        const j = i + offset + 1
        return { a, b, k: Math.max(Math.abs(line.C[i][j]) / Math.sqrt(line.C[i][i] * line.C[j][j]), Math.abs(line.L[i][j]) / Math.sqrt(line.L[i][i] * line.L[j][j])) }
      }),
    )
    for (const pair of routeDisplayItems(pairs, 60)) {
      const points = [pair.a, pair.b].map((c) => ({ x: x(c.xMm), y: z(c.zMm + c.thicknessMm) + side * 0.03 }))
      drawing.lines!.push(overlayLine(points, '#9333ea', side * (0.002 + Math.min(1, pair.k) * 0.03), `k=${pair.k.toFixed(3)}`))
      // The SVG export paints rectangles over lines; repeat the stroke as a polygon so downloads keep it.
      drawing.polygons!.push({ points, stroke: '#9333ea', strokeWidth: side * (0.002 + Math.min(1, pair.k) * 0.03) })
    }
    const pair = [...pairs].sort((a, b) => b.k - a.k)[0]
    if (pair) drawing.texts!.push({ x: (x(pair.a.xMm) + x(pair.b.xMm)) / 2, y: z(pair.a.zMm + pair.a.thicknessMm) + side * 0.03 + size.body, text: `k ${pair.k.toFixed(3)}`, color: '#7e22ce', fontSize: size.body, anchorSide: 'bottom_center' })
    return routeTitle(drawing, '3 · Fields')
  }
}

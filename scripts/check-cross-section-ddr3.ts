/** Preset-based LOCAL slice demo. Does not edit the board or invoke native extraction/simulation.
 * node --import tsx scripts/check-cross-section-ddr3.ts <board.json> <cloud-ddr-routes.json> <core-dir>
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { solveCrossSection, type CrossSection, type CrossSectionResult } from '../src/extraction'

interface Wire { route_type: string; x: number; y: number; width: number; layer: string }
interface BoardItem {
  type: string
  num_layers?: number
  thickness?: number
  material?: string
  pcb_trace_id?: string
  source_trace_id?: string
  name?: string
  route?: Wire[]
}
interface Route { name: string; from: string; to: string; layer: string; points: number[][] }
interface Segment { a: Wire; b: Wire; ux: number; uy: number; length: number; trace: BoardItem }
interface Neighbour { pitchMm: number; overlapMm: number; sample: { x: number; y: number }; segment: Segment }
interface StackLayer { layer_type: string; layer?: string; thickness: number; relative_permittivity?: number }

/** Nonzero straight top-layer pieces; no bend or oblique-to-parallel substitution. */
function segments(trace: BoardItem): Segment[] {
  const route = trace.route ?? []
  return route.slice(1).flatMap((b, i) => {
    const a = route[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    return a.route_type === 'wire' && b.route_type === 'wire' && a.layer === 'top' && b.layer === 'top' && length > .1 ? [{ a, b, ux: dx / length, uy: dy / length, length, trace }] : []
  })
}

/** Nearest parallel segment with >=0.1 mm longitudinal overlap. Optional midpoint containment. */
function neighbour(signal: Segment, others: Segment[], midpointOnly: boolean): Neighbour | undefined {
  return others.flatMap(other => {
    if (Math.abs(signal.ux * other.uy - signal.uy * other.ux) > 1e-7) return []
    const lo = (other.a.x - signal.a.x) * signal.ux + (other.a.y - signal.a.y) * signal.uy
    const hi = (other.b.x - signal.a.x) * signal.ux + (other.b.y - signal.a.y) * signal.uy
    const start = Math.max(0, Math.min(lo, hi))
    const end = Math.min(signal.length, Math.max(lo, hi))
    if (end - start < .1 || (midpointOnly && (start > signal.length / 2 || end < signal.length / 2))) return []
    const position = midpointOnly ? signal.length / 2 : (start + end) / 2
    return [{ pitchMm: Math.abs((other.a.x - signal.a.x) * signal.uy - (other.a.y - signal.a.y) * signal.ux), overlapMm: end - start, sample: { x: signal.a.x + signal.ux * position, y: signal.a.y + signal.uy * position }, segment: other }]
  }).sort((a, b) => a.pitchMm - b.pitchMm)[0]
}

/** Scalar isolated-line and symmetric even/odd mode summaries, with SI-to-mm conversions. */
function summary(result: CrossSectionResult): Record<string, unknown> {
  const scalar = { zOhm: Math.sqrt(result.L[0][0] / result.C[0][0]), delayPsPerMm: Math.sqrt(result.L[0][0] * result.C[0][0]) * 1e9 }
  return result.C.length === 1 ? scalar : {
    evenOhm: Math.sqrt((result.L[0][0] + result.L[0][1]) / (result.C[0][0] + result.C[0][1])),
    oddOhm: Math.sqrt((result.L[0][0] - result.L[0][1]) / (result.C[0][0] - result.C[0][1])),
    evenDelayPsPerMm: Math.sqrt((result.L[0][0] + result.L[0][1]) * (result.C[0][0] + result.C[0][1])) * 1e9,
    oddDelayPsPerMm: Math.sqrt((result.L[0][0] - result.L[0][1]) * (result.C[0][0] - result.C[0][1])) * 1e9,
    mutualCapacitancePfPerM: result.C[0][1] * 1e12,
    mutualInductanceNhPerM: result.L[0][1] * 1e9,
    capacitiveCoupling: -result.C[0][1] / Math.sqrt(result.C[0][0] * result.C[1][1]),
    inductiveCoupling: result.L[0][1] / Math.sqrt(result.L[0][0] * result.L[1][1]),
  }
}

/** Hash source bytes without persisting the board, routes, or installed sibling packages. */
function hash(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const [boardPath, routesPath, coreDirectory] = process.argv.slice(2)
if (!boardPath || !routesPath || !coreDirectory) throw new Error('Expected board.json, cloud-ddr-routes.json and core directory arguments')
const boardBytes = readFileSync(boardPath, 'utf8')
const routeBytes = readFileSync(routesPath, 'utf8')
const items = JSON.parse(boardBytes) as BoardItem[]
const routes = (JSON.parse(routeBytes) as { routes: Route[] }).routes
const board = items.find(item => item.type === 'pcb_board')!
const route = routes.find(item => item.from === '.U1 > .M3' && item.to === '.U3 > .F2')!
const source = items.find(item => item.type === 'source_trace' && item.name === route.name)!
const trace = items.find(item => item.type === 'pcb_trace' && item.source_trace_id === source.source_trace_id)!
const wires = trace.route!.filter(w => w.route_type === 'wire')
const widths = [...new Set(wires.map(w => w.width))]
if (route.layer !== 'top' || wires.some(w => w.layer !== 'top') || widths.length !== 1 || !widths[0]) throw new Error('DQ0 demo requires its actual uniform-width top route')
if (!route.points.every(point => wires.some(w => Math.hypot(w.x - point[0], w.y - point[1]) < 1e-9))) throw new Error('Cloud DQ0 route points differ from the built board')
const specsPath = resolve(coreDirectory, 'node_modules/@tscircuit/jlcpcb-manufacturing-specs/index.ts')
const specs = await import(pathToFileURL(specsPath).href) as { getJlcStackup: (request: { num_layers: number; thickness: number; material: string }) => { name: string; layers: StackLayer[] } }
const stack = specs.getJlcStackup({ num_layers: board.num_layers!, thickness: board.thickness!, material: board.material! })
if (!stack) throw new Error('No matching JLC template')
let depth = 0
const layers = stack.layers.map(layer => {
  const value = { ...layer, topDepthMm: depth, bottomDepthMm: depth + layer.thickness }
  depth += layer.thickness
  return value
})
const top = layers.find(layer => layer.layer === 'top')!
const ground = layers.find(layer => layer.layer === 'inner1')!
const substrate = layers.find(layer => layer.layer_type === 'dielectric')!
const height = ground.topDepthMm - top.bottomDepthMm
const signals = segments(trace)
const others = items.filter(item => item.type === 'pcb_trace' && item !== trace).flatMap(segments)
const longest = [...signals].sort((a, b) => b.length - a.length)[0]
const longNeighbour = neighbour(longest, others, true)!
const closest = signals.flatMap(signal => neighbour(signal, others, false) ?? []).sort((a, b) => a.pitchMm - b.pitchMm)[0]

/** Build an isolated or two-conductor slice from the measured widths and local transverse offset. */
function section(pitch: number | undefined, otherWidth: number, mask: boolean): CrossSection {
  return {
    conductors: [
      { id: 'DQ0', xMm: 0, zMm: height, widthMm: widths[0], thicknessMm: top.thickness },
      ...(pitch === undefined ? [] : [{ id: 'neighbour', xMm: pitch, zMm: height, widthMm: otherWidth, thicknessMm: top.thickness }]),
    ],
    planes: [{ zMm: 0 }],
    dielectrics: [
      { zMm: 0, thicknessMm: height, er: substrate.relative_permittivity!, lossTangent: 0 },
      ...(mask ? [{ zMm: height, thicknessMm: top.thickness + .02, er: 3.3, lossTangent: .025 }] : []),
    ],
  }
}

const cases = [
  { label: 'isolated, bare', slice: section(undefined, widths[0], false) },
  { label: 'isolated, assumed mask', slice: section(undefined, widths[0], true) },
  { label: 'longest run neighbour, bare', slice: section(longNeighbour.pitchMm, longNeighbour.segment.a.width, false) },
  { label: 'closest parallel neighbour, bare', slice: section(closest.pitchMm, closest.segment.a.width, false) },
  { label: 'closest parallel neighbour, assumed mask', slice: section(closest.pitchMm, closest.segment.a.width, true) },
]
console.log(JSON.stringify({
  boardSha256: hash(boardBytes), routeSha256: hash(routeBytes),
  template: stack.name, nominalThicknessMm: board.thickness, materialSumMm: depth,
  originallyHasStackup: items.some(item => item.type === 'pcb_stackup'),
  dq0: { sourceTrace: source.source_trace_id, pcbTrace: trace.pcb_trace_id, routeName: route.name, widthMm: widths[0], thicknessMm: top.thickness, groundGapMm: height },
  copperLayers: layers.filter(layer => layer.layer_type === 'copper'),
  dielectricLayers: layers.filter(layer => layer.layer_type === 'dielectric'),
  neighbours: [longNeighbour, closest].map(n => ({ trace: n.segment.trace.pcb_trace_id, source: n.segment.trace.source_trace_id, name: items.find(item => item.type === 'source_trace' && item.source_trace_id === n.segment.trace.source_trace_id)?.name, pitchMm: n.pitchMm, overlapMm: n.overlapMm, sample: n.sample })),
  assumptions: ['Applying core preset to a board without pcb_stackup; not a fabrication record', 'Infinite solid inner1 reference; two-conductor local slices, other copper omitted', 'Bare values require no assumed mask; optional planar mask is 20 um above copper, er=3.3, tan(delta)=0.025', 'Preset gives no substrate loss tangent; demo uses zero, not a measured dielectric loss'],
  cases: cases.map(({ label, slice }) => {
    const start = performance.now()
    const result = solveCrossSection(slice, { panelsPerEdge: 20, interfaceExtent: 48 })
    const ms = performance.now() - start
    const fine = solveCrossSection(slice, { panelsPerEdge: 24, interfaceExtent: 48 })
    const wide = solveCrossSection(slice, { panelsPerEdge: 20, interfaceExtent: 96 })
    /** Maximum entry change for material/vacuum capacitance and inductance. */
    const change = (other: CrossSectionResult): number => Math.max(...(['C', 'C0', 'L'] as const).flatMap(key => result[key].flatMap((row, i) => row.map((value, j) => Math.abs(value / other[key][i][j] - 1)))))
    return { label, ...summary(result), ms, diagnostics: result.diagnostics, meshRelativeChange: change(fine), domainRelativeChange: change(wide) }
  }),
}, null, 2))

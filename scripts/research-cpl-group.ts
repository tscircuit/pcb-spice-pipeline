import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { routePosition, type RouteSlice, type RouteWire, type RouteXY } from '../src/board'
import { solveCrossSection, type CrossSection, type ExtractedRoutes, type RouteCoefficients, type RouteMaterials } from '../src/extraction'
import { routeLadder } from '../src/simulation'
import { routeCplSteps } from '../src/simulation/route-cpl'

// Real extracted DDR matrices; synthetic 50-ohm terminations are a device-cost experiment.
// This is a uniform coupling section, not a vendor-driven full DDR route/scope.
const source = process.env.SI_CPL_COMPILED
if (!source) throw new Error('SI_CPL_COMPILED must name an existing routed DDR compiled artifact')
const compiled = JSON.parse(await readFile(source, 'utf8')) as { evidence: { wires: RouteWire[]; materials: RouteMaterials; slices: (Omit<RouteSlice, 'wires'> & { wires: number[]; key: string })[]; cross_sections: (RouteCoefficients & { geometry: CrossSection })[] } }
const evidence = compiled.evidence
const section = evidence.slices.filter(slice => slice.wires.length >= 2 && slice.wires.length <= 8).sort((a, b) => b.end - b.start - (a.end - a.start))[0]
if (!section) throw new Error('No supported coupled DDR section')
const coefficients = evidence.cross_sections.find(line => JSON.stringify(line.geometry) === section.key)!
if (!coefficients) throw new Error('Missing field coefficients for selected section')
const wires = section.wires.map(id => {
  const wire = evidence.wires.find(wire => wire.id === id)!
  return { ...wire, start: section.start, end: section.end, a: routePosition(wire, section.start), b: routePosition(wire, section.end) }
})
// Cached routed evidence omits vacuum C0; recover it rather than inventing unused data.
const line: RouteCoefficients = { ...coefficients, conductorIds: wires.map((_, i) => String(i)), C0: solveCrossSection(coefficients.geometry).C0 }
const slice = { ...section, wires, line }
const extracted: ExtractedRoutes = { slices: [slice], sections: [{ key: section.key, line }], materials: evidence.materials, warnings: [], coupling: [] }
const output = resolve(process.env.SI_CPL_EVIDENCE_DIR ?? '.cache/cpl', 'ddr-group')
/** The section's actual coordinate ends share stable physical conductor identities. */
const endpoint = (wire: RouteWire, point: RouteXY): string => `n${wire.id}_${point.map(value => value.toFixed(7)).join('_')}`
const probes = wires.map((wire, i) => ({ name: `DDR_SECTION_${i}`, signalNode: endpoint(wire, routePosition(wire, section.end)), referenceNode: '0' }))
const ports = wires.flatMap((wire, i) => [`VDRIVE${i} drive${i} 0 ${i === 0 ? 'PULSE(0 1.5 1e-10 1e-10 1e-10 4e-10 1e-9)' : '0'}`, `RSOURCE${i} drive${i} ${endpoint(wire, routePosition(wire, section.start))} 50`, `RLOAD${i} ${probes[i].signalNode} 0 50`])
const summary: Record<string, unknown> = { source, qualification: 'real uniform DDR extracted section with synthetic 50-ohm source/load; not full-route/system evidence', conductors: wires.length, lengthMm: section.end - section.start, maximumFullScopeConductors: Math.max(...evidence.slices.map(slice => slice.wires.length)) }
for (const candidate of ['ladder', 'cpl']) {
  const directory = join(output, candidate)
  await mkdir(directory, { recursive: true })
  const steps = routeCplSteps(extracted, endpoint, 100e-12)
  let step = steps.next()
  while (!step.done) step = steps.next()
  const network = candidate === 'cpl' ? step.value : routeLadder(extracted, endpoint, 100e-12)
  const deck = ['Actual DDR coupled section; synthetic 50-ohm device-cost fixture', '.options klu reltol=1e-4 abstol=1e-9 vntol=1e-6 method=gear maxord=2', ...ports, ...network.lines, `.save ${probes.map(probe => `v(${probe.signalNode})`).join(' ')}`, '.tran 2e-12 1e-9 0 2e-12', '.end', ''].join('\n')
  await writeFile(join(directory, 'simulation.cir'), deck)
  await writeFile(join(directory, 'probes.json'), JSON.stringify(probes, null, 2))
  summary[candidate] = { deckBytes: Buffer.byteLength(deck), cells: network.cells, kTerms: network.lines.filter(line => line.startsWith('K')).length }
}
await writeFile(join(output, 'compile.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
